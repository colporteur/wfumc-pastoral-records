// Clergy Record / Obituary importer — DB layer (Phase A).
//
// Read/write helpers for pastoral_record_imports. Pure CRUD; the smarts
// (Claude vision calls, family-graph propagation, commit) live in
// lib/claude.js and the UI components built in Phase B-C.
//
// Each function is owner-scoped via RLS — the auth.uid() check on the
// server side does the real enforcement; we just pass owner_user_id
// on insert and trust SELECTs to return only the user's rows.
//
// Also exposes fetchObituaryUrl() — a thin wrapper around the existing
// url-fetch Edge Function that pre-fetches an obituary URL's plain
// text so extractObituary() can mine it.

import { supabase, withTimeout } from './supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

// =====================================================================
// CRUD
// =====================================================================

/**
 * Insert a new pastoral_record_imports row. The raw_extraction starts
 * empty; the caller typically updates it after Claude returns.
 *
 * @param {Object} args
 * @param {string} args.subjectPersonId — directory person the record is FOR
 * @param {string} args.ownerUserId
 * @param {'clergy_record'|'obituary'} args.kind
 * @param {'photo'|'url'|'text'} args.sourceKind
 * @param {string} [args.sourceStoragePath]
 * @param {string} [args.sourceUrl]
 * @param {string} [args.sourceText]
 * @param {string} [args.sourceDocumentId]
 * @param {Object} [args.rawExtraction]  initial extraction (or {})
 * @param {string} [args.notes]
 * @returns {Promise<Object>} the inserted row
 */
export async function createImport({
  subjectPersonId,
  ownerUserId,
  kind,
  sourceKind,
  sourceStoragePath = null,
  sourceUrl = null,
  sourceText = null,
  sourceDocumentId = null,
  rawExtraction = {},
  notes = null,
}) {
  if (!subjectPersonId || !ownerUserId) {
    throw new Error('createImport requires subjectPersonId and ownerUserId.');
  }
  if (!['clergy_record', 'obituary'].includes(kind)) {
    throw new Error(`Invalid import kind: ${kind}`);
  }
  if (!['photo', 'url', 'text'].includes(sourceKind)) {
    throw new Error(`Invalid sourceKind: ${sourceKind}`);
  }
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_record_imports')
      .insert({
        subject_person_id: subjectPersonId,
        owner_user_id: ownerUserId,
        kind,
        source_kind: sourceKind,
        source_storage_path: sourceStoragePath,
        source_url: sourceUrl,
        source_text: sourceText,
        source_document_id: sourceDocumentId,
        raw_extraction: rawExtraction || {},
        notes,
      })
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function getImport(importId) {
  if (!importId) throw new Error('importId required');
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_record_imports')
      .select('*')
      .eq('id', importId)
      .single()
  );
  if (error) throw error;
  return data;
}

export async function listImportsForPerson(personId) {
  if (!personId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_record_imports')
      .select('*')
      .eq('subject_person_id', personId)
      .order('created_at', { ascending: false })
  );
  if (error) throw error;
  return data || [];
}

/**
 * List imports that have been extracted but not yet committed — i.e.
 * the pastor ran Claude but hasn't approved the review panel yet.
 * Used by the future "Pending imports" surface on the Dashboard.
 */
export async function listPendingImports({ limit = 50 } = {}) {
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_record_imports')
      .select('*')
      .is('committed_at', null)
      .order('created_at', { ascending: false })
      .limit(limit)
  );
  if (error) throw error;
  return data || [];
}

/**
 * Patch arbitrary fields on a pastoral_record_imports row. Most
 * commonly used to write the rawExtraction back after Claude returns,
 * or to stamp committed_at when the user accepts the review panel.
 *
 * Pass camelCase keys; we translate to the DB column names.
 */
export async function updateImport(importId, updates = {}) {
  if (!importId) throw new Error('importId required');
  const colMap = {
    rawExtraction: 'raw_extraction',
    notes: 'notes',
    committedAt: 'committed_at',
    sourceStoragePath: 'source_storage_path',
    sourceUrl: 'source_url',
    sourceText: 'source_text',
    sourceDocumentId: 'source_document_id',
  };
  const patch = {};
  for (const [k, v] of Object.entries(updates)) {
    const col = colMap[k] || k;
    patch[col] = v;
  }
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_record_imports')
      .update(patch)
      .eq('id', importId)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

/**
 * Mark an import committed (stamp committed_at = now()). Re-commits
 * are allowed — committed_at gets overwritten with the latest commit
 * time, which the future re-commit logic relies on to know which
 * import-stamped child rows to wipe before inserting fresh.
 */
export async function markCommitted(importId) {
  return updateImport(importId, { committedAt: new Date().toISOString() });
}

/**
 * Delete an import. Note that ON DELETE SET NULL is configured on the
 * import_source_id columns of pastoral_family_links, etc. — so child
 * rows survive (un-stamped) rather than vanishing. If the caller wants
 * to also remove child rows, they should clearImportArtifacts() FIRST.
 */
export async function deleteImport(importId) {
  if (!importId) throw new Error('importId required');
  const { error } = await withTimeout(
    supabase.from('pastoral_record_imports').delete().eq('id', importId)
  );
  if (error) throw error;
}

/**
 * Wipe every row stamped with this import's id from the three target
 * tables (family_links, extended_family, significant_deaths) and also
 * any document_shares created by it. Used by the re-commit logic in
 * Phase C and by deleteImport callers that want a full cascade.
 *
 * Returns the deleted-row counts per table for the audit-style toast
 * the UI shows ("Removed 3 family links, 5 extended-family entries, …").
 */
export async function clearImportArtifacts(importId) {
  if (!importId) throw new Error('importId required');
  const counts = {
    family_links: 0,
    extended_family: 0,
    significant_deaths: 0,
    document_shares: 0,
  };
  // Run as four separate deletes so a failure in one doesn't poison
  // the others. supabase-js DELETE returns the deleted rows when we
  // .select() — useful for the count.
  const tables = [
    ['pastoral_family_links', 'family_links'],
    ['pastoral_extended_family', 'extended_family'],
    ['pastoral_significant_deaths', 'significant_deaths'],
  ];
  for (const [table, key] of tables) {
    const { data, error } = await withTimeout(
      supabase.from(table).delete().eq('import_source_id', importId).select('id')
    );
    if (error) throw error;
    counts[key] = (data || []).length;
  }
  const { data: sharesDel, error: sharesErr } = await withTimeout(
    supabase
      .from('pastoral_document_shares')
      .delete()
      .eq('shared_by_import_id', importId)
      .select('id')
  );
  if (sharesErr) throw sharesErr;
  counts.document_shares = (sharesDel || []).length;
  return counts;
}

// =====================================================================
// commitImport — the "create the actual rows" step
// =====================================================================
//
// Given an import id, a structured set of `decisions` (one per
// extracted family member, with their target table and pickable
// directory match), and optional `subjectUpdates` (patches the pastor
// approved for backfilling the directory person's blank fields),
// create the family_links / extended_family / significant_deaths /
// document_shares rows.
//
// Idempotent: if the import has been committed before, calls
// clearImportArtifacts() first to wipe previously-stamped rows, then
// inserts fresh ones. The committed_at timestamp is updated to "now"
// on each commit.
//
// Family decision shape:
//   {
//     skip: false,
//     name: "Mary Ann Lanier",
//     status: "living" | "deceased",
//     relationship_to_subject: "daughter",
//     birth_date: null | "YYYY-MM-DD",
//     death_date: null | "YYYY-MM-DD",
//     notes: "",
//     // Where this row should land:
//     target: "directory_link" | "extended_family" | "significant_death",
//     // Required if target = "directory_link": the pastoral_people.id
//     // of the existing directory entry to link to. (Phase B does NOT
//     // auto-create new directory entries — the pastor handles that.)
//     directory_person_id: "uuid",
//     // For directory_link: the relationship_a_to_b enum value to use
//     // when inserting into pastoral_family_links. Should map the free-
//     // text relationship_to_subject onto the closest enum value.
//     family_link_relationship: "child" | "parent" | "sibling" | ...
//   }
//
// Subject updates shape (any subset of these, all optional):
//   { birthdate, death_date, place_of_birth, place_of_death,
//     marital_status, church_affiliation, religion, address,
//     is_deceased }   // pastor can flip is_deceased on commit
//
// Returns { counts: {links, extended, deaths, shares, subject_patched},
//           import: <updated row> }.

const FAMILY_LINK_RELATIONSHIPS = [
  'spouse',
  'sibling',
  'parent',
  'child',
  'grandparent',
  'grandchild',
  'aunt_uncle',
  'niece_nephew',
  'cousin',
  'in_law',
  'other',
];

function isValidFamilyLinkEnum(v) {
  return typeof v === 'string' && FAMILY_LINK_RELATIONSHIPS.includes(v);
}

function emptyString(v) {
  return typeof v !== 'string' || v.trim().length === 0;
}

function normalizeDateOrNull(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  // The DATE column accepts YYYY-MM-DD; pass through anything matching,
  // otherwise null it out so the insert doesn't throw.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

export async function commitImport({
  importId,
  ownerUserId,
  subjectPersonId,
  decisions = [],
  subjectUpdates = {},
}) {
  if (!importId || !ownerUserId || !subjectPersonId) {
    throw new Error(
      'commitImport requires importId, ownerUserId, subjectPersonId.'
    );
  }

  // 1) Wipe any rows previously stamped by this import — so re-commits
  //    don't accumulate duplicates next to the prior commit's rows.
  await clearImportArtifacts(importId);

  const counts = {
    links: 0,
    extended: 0,
    deaths: 0,
    shares: 0,
    subject_patched: false,
  };

  // 2) Backfill subject fields (only the ones the pastor approved).
  //    The review-panel UI only ships keys whose checkboxes were ticked,
  //    so we trust the patch — but we still normalize date fields.
  if (subjectUpdates && Object.keys(subjectUpdates).length > 0) {
    const patch = {};
    for (const [k, v] of Object.entries(subjectUpdates)) {
      if (v === undefined) continue;
      let value = v;
      if (k === 'birthdate' || k === 'death_date') {
        value = normalizeDateOrNull(v);
      } else if (typeof v === 'string') {
        value = v.trim() || null;
      }
      patch[k] = value;
    }
    if (Object.keys(patch).length > 0) {
      const { error: subjErr } = await withTimeout(
        supabase
          .from('pastoral_people')
          .update(patch)
          .eq('id', subjectPersonId)
      );
      if (subjErr) throw subjErr;
      counts.subject_patched = true;
    }
  }

  // 3) For each accepted family decision, insert into the appropriate
  //    table. We do NOT short-circuit on the first error — instead we
  //    collect per-row errors and surface them at the end so the pastor
  //    can see exactly which row failed without losing the rest.
  const rowErrors = [];
  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    if (!d || d.skip) continue;
    const label = d.name || `Row ${i + 1}`;
    try {
      if (d.target === 'directory_link') {
        if (!d.directory_person_id) {
          throw new Error(
            'Pick the existing directory entry to link to (or change the target).'
          );
        }
        if (d.directory_person_id === subjectPersonId) {
          throw new Error('Cannot link a person to themselves.');
        }
        if (!isValidFamilyLinkEnum(d.family_link_relationship)) {
          throw new Error(
            `Relationship "${d.family_link_relationship || '(blank)'}" is not one of the allowed values.`
          );
        }
        // Refuse duplicates between the same pair (in either direction),
        // matching createLink()'s posture in familyLinks.js.
        const { data: existing, error: existErr } = await withTimeout(
          supabase
            .from('pastoral_family_links')
            .select('id')
            .or(
              `and(person_a_id.eq.${subjectPersonId},person_b_id.eq.${d.directory_person_id}),` +
                `and(person_a_id.eq.${d.directory_person_id},person_b_id.eq.${subjectPersonId})`
            )
            .limit(1)
        );
        if (existErr) throw existErr;
        if (existing && existing.length > 0) {
          throw new Error(
            'A family link already exists between these two people. Edit it manually, or change this row\'s target.'
          );
        }
        const { error: linkErr } = await withTimeout(
          supabase.from('pastoral_family_links').insert({
            owner_user_id: ownerUserId,
            person_a_id: subjectPersonId,
            person_b_id: d.directory_person_id,
            relationship_a_to_b: d.family_link_relationship,
            notes: emptyString(d.notes) ? null : d.notes.trim(),
            import_source_id: importId,
          })
        );
        if (linkErr) throw linkErr;
        counts.links += 1;
      } else if (d.target === 'extended_family') {
        if (emptyString(d.name)) {
          throw new Error('Name is required for an extended-family row.');
        }
        const { error: extErr } = await withTimeout(
          supabase.from('pastoral_extended_family').insert({
            owner_user_id: ownerUserId,
            person_id: subjectPersonId,
            name: d.name.trim(),
            relationship: emptyString(d.relationship_to_subject)
              ? null
              : d.relationship_to_subject.trim(),
            // Phase 2 schema stores age as text — pass deceased-ness via
            // notes so it's visible in the existing UI. (Phase D will
            // surface anniversary derivation off significant_deaths +
            // family_links, so we lean on those.)
            age:
              d.status === 'deceased'
                ? 'deceased'
                : null,
            notes: emptyString(d.notes) ? null : d.notes.trim(),
            import_source_id: importId,
          })
        );
        if (extErr) throw extErr;
        counts.extended += 1;
      } else if (d.target === 'significant_death') {
        if (emptyString(d.name)) {
          throw new Error('Name is required for a significant-death row.');
        }
        const { error: dthErr } = await withTimeout(
          supabase.from('pastoral_significant_deaths').insert({
            owner_user_id: ownerUserId,
            person_id: subjectPersonId,
            name: d.name.trim(),
            relationship: emptyString(d.relationship_to_subject)
              ? null
              : d.relationship_to_subject.trim(),
            date_of_death: normalizeDateOrNull(d.death_date),
            notes: emptyString(d.notes) ? null : d.notes.trim(),
            import_source_id: importId,
          })
        );
        if (dthErr) throw dthErr;
        counts.deaths += 1;
      } else {
        throw new Error(
          `Unknown target "${d.target}" — expected directory_link, extended_family, or significant_death.`
        );
      }
    } catch (e) {
      rowErrors.push({
        index: i,
        label,
        message: e.message || String(e),
      });
    }
  }

  // 4) Stamp the import as committed and bump updated_at.
  const updated = await markCommitted(importId);

  // 5) Surface a single combined error if any rows failed — but only
  //    AFTER we've committed the successful inserts, so the pastor
  //    doesn't lose the rows that did go in.
  if (rowErrors.length > 0) {
    const summary = rowErrors
      .slice(0, 5)
      .map((r) => `  • ${r.label}: ${r.message}`)
      .join('\n');
    const more =
      rowErrors.length > 5 ? `\n  …and ${rowErrors.length - 5} more` : '';
    const err = new Error(
      `${rowErrors.length} row${
        rowErrors.length === 1 ? '' : 's'
      } failed to commit:\n${summary}${more}\n\n` +
        `The rest of the import was saved. Edit the failed rows and re-commit.`
    );
    err.partial = true;
    err.counts = counts;
    err.rowErrors = rowErrors;
    err.import = updated;
    throw err;
  }

  return { counts, import: updated };
}

// =====================================================================
// URL-fetch wrapper — used by the Obituary importer to pull the page
// body text BEFORE handing it to Claude. The existing url-fetch Edge
// Function (in the Bulletin App's Supabase project) is already deployed
// and JWT-gated, so this is just a thin caller.
// =====================================================================

/**
 * Fetch an obituary URL's plain-text body via the url-fetch Edge
 * Function. Returns { text, title, finalUrl } on success or throws
 * with a readable message on failure.
 *
 * The Edge Function caps the response to 200k chars / 5 MB raw, so
 * the returned text is safe to send to Claude in a single message.
 */
export async function fetchObituaryUrl(url) {
  const raw = (url || '').trim();
  if (!raw) throw new Error('No URL provided.');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('That URL doesn\'t look valid.');
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('Only http(s) URLs are supported.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in.');

  const res = await withTimeout(
    fetch(`${supabaseUrl}/functions/v1/url-fetch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ url: parsed.toString() }),
    }),
    45000
  );
  if (!res.ok) {
    let errBody;
    try {
      errBody = await res.json();
    } catch {
      errBody = { error: await res.text() };
    }
    throw new Error(
      `Couldn't fetch the obituary page: ${errBody?.error || res.statusText}`
    );
  }
  const body = await res.json();
  if (!body?.text || !body.text.trim()) {
    throw new Error(
      'The page returned no readable text. The obituary may be behind a ' +
        'login, a paywall, or rendered entirely in JavaScript. Try ' +
        'pasting the text directly, or upload a screenshot.'
    );
  }
  return {
    text: body.text,
    title: body.title || '',
    finalUrl: body.finalUrl || parsed.toString(),
  };
}
