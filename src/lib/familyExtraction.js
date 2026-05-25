// Transitive family inference — Phase F.
//
// Generalises the Phase C importer's "Suggest auto-links" pass so the
// pastor can run it from any PersonDetail page, not just inside an
// import review modal. The use case: JoBeth is directory-linked to her
// father Sidney; Sidney's record has his brother, sister, late mother,
// extended cousins, etc. Click "Extract from linked family" on
// JoBeth's page → we walk Sidney's family graph, run each relative
// through inferRelativeToRelative with Sidney as the common subject,
// and propose new rows for JoBeth (Sidney's brother → JoBeth's uncle,
// Sidney's late mother → JoBeth's late grandmother, etc.).
//
// "Anchor" = an existing directory-linked family member we're
// extracting FROM (Sidney, in the example).
// "Subject" = the person on whose PersonDetail page we're running the
// extraction (JoBeth, in the example).
//
// Proposals get dedupe-checked against the subject's existing graph so
// we never propose a row they already have. The pastor then
// approves/edits/skips each one in the modal.

import { supabase, withTimeout } from './supabase';
import { listLinksFor, relationshipLabel } from './familyLinks';
import { listExtendedFamily } from './extendedFamily';
import { listSignificantDeaths } from './significantDeaths';
import { getPerson, fullName } from './people';
import { inferRelativeToRelative } from './claude';

// ---------------------------------------------------------------------
// gatherFamilyOf — pull every family-graph piece a person has.
// Hydrated to make the inference call sites readable.
// ---------------------------------------------------------------------
//
// Returns:
//   {
//     familyLinks: [{...row, displayed_relationship, other_person_id,
//                    other_person: hydrated pastoral_people row}],
//     extendedFamily: [...pastoral_extended_family rows],
//     significantDeaths: [...pastoral_significant_deaths rows]
//   }
//
// We hydrate `other_person` on family_links so the consumer doesn't
// have to make a second pass.

export async function gatherFamilyOf(personId) {
  if (!personId) {
    return { familyLinks: [], extendedFamily: [], significantDeaths: [] };
  }
  const [links, extended, deaths] = await Promise.all([
    listLinksFor(personId),
    listExtendedFamily(personId),
    listSignificantDeaths(personId),
  ]);
  const otherIds = Array.from(
    new Set(links.map((l) => l.other_person_id).filter(Boolean))
  ).slice(0, 60);
  const persons = await Promise.all(
    otherIds.map((id) => getPerson(id).catch(() => null))
  );
  const byId = new Map();
  for (const p of persons) if (p) byId.set(p.id, p);
  return {
    familyLinks: links.map((l) => ({
      ...l,
      other_person: byId.get(l.other_person_id) || null,
    })),
    extendedFamily: extended,
    significantDeaths: deaths,
  };
}

// ---------------------------------------------------------------------
// proposeExtensionsFromAnchor — for one (subject, anchor) pair, walk
// the anchor's family graph and produce inferred proposals for subject.
// ---------------------------------------------------------------------
//
// Each proposal has a `target` (directory_link / extended_family /
// significant_death), a suggested relationship, and a confidence + a
// human-readable source breadcrumb (so the pastor can see "this comes
// from Sidney's listed brother"). Deduped against subject's existing
// graph; the dedupe is conservative (case-insensitive name match for
// non-directory rows; person_id match for directory rows).
//
// Cost: one Claude call per anchor-relative pair. Anchors typically
// have under 15 relatives, so a single anchor extraction is around
// 5-15 calls. The caller is responsible for batching across multiple
// anchors when the pastor picks more than one.

const NEEDS_RELATIONSHIP_INFERENCE_HINT =
  'If the relationship looks like an in-law connection ' +
  '(spouse of an in-law, sibling of a spouse, etc.), prefer "in_law" ' +
  'with medium/low confidence rather than a blood-relation label.';

export async function proposeExtensionsFromAnchor({
  subjectPerson,
  anchorPersonId,
  ownerUserId,
}) {
  if (!subjectPerson?.id || !anchorPersonId || !ownerUserId) {
    throw new Error(
      'proposeExtensionsFromAnchor requires subjectPerson, anchorPersonId, ownerUserId.'
    );
  }
  if (subjectPerson.id === anchorPersonId) {
    throw new Error('Subject and anchor must be different people.');
  }

  // 1) Fetch subject's existing graph for dedupe.
  const subjectGraph = await gatherFamilyOf(subjectPerson.id);
  const subjectLinkedIds = new Set(
    subjectGraph.familyLinks
      .map((l) => l.other_person_id)
      .filter(Boolean)
  );
  // Cheap normalize for name-based dedupe on extended_family /
  // significant_deaths.
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const subjectExtendedNames = new Set(
    subjectGraph.extendedFamily.map((e) => norm(e.name))
  );
  const subjectDeathNames = new Set(
    subjectGraph.significantDeaths.map((d) => norm(d.name))
  );

  // 2) Confirm the anchor really is a directory-linked relative — if
  //    not, the inference has no common-subject footing.
  const anchorLink = subjectGraph.familyLinks.find(
    (l) => l.other_person_id === anchorPersonId
  );
  if (!anchorLink) {
    throw new Error(
      'The anchor isn\'t in this person\'s directory family. Add the family link first, then re-run extraction.'
    );
  }
  const anchorPerson = anchorLink.other_person;
  const anchorLabel = anchorPerson
    ? fullName(anchorPerson)
    : '(linked family member)';
  // anchor's role from subject's perspective (e.g., 'parent' means
  // "anchor is subject's parent"). To use anchor as Claude's common
  // subject, we need subject's role from anchor's perspective —
  // i.e., the inverse.
  const subjectRoleFromAnchor = invertReadable(
    anchorLink.displayed_relationship
  );
  const subjectLabel = fullName(subjectPerson);

  // 3) Fetch anchor's family graph.
  const anchorGraph = await gatherFamilyOf(anchorPersonId);

  const proposals = [];

  // 3a) Anchor's directory family — propose as new directory_link
  //     rows for subject.
  for (const link of anchorGraph.familyLinks) {
    if (!link.other_person_id || !link.other_person) continue;
    if (link.other_person_id === subjectPerson.id) continue;
    if (subjectLinkedIds.has(link.other_person_id)) continue;

    const other = link.other_person;
    const otherLabel = fullName(other);
    const anchorViewRel = link.displayed_relationship; // e.g., 'sibling'
    // The relative's role from anchor's perspective IS the link's
    // displayed_relationship (because we asked listLinksFor(anchor)).
    const inference = await runInference({
      subjectName: anchorLabel,
      relativeAName: otherLabel,
      relativeARelToSubject: relationshipLabel(anchorViewRel),
      relativeBName: subjectLabel,
      relativeBRelToSubject: subjectRoleFromAnchor || 'relative',
    });
    if (!inference) continue;
    proposals.push({
      kind: 'directory_link',
      // Pre-filled but editable in the review panel:
      name: otherLabel,
      relationship_to_subject: humanLabel(inference.relationship_a_to_b),
      family_link_relationship: inference.relationship_a_to_b,
      directory_person_id: other.id,
      // Source / provenance:
      source_kind: 'directory',
      source_anchor_id: anchorPersonId,
      source_anchor_label: anchorLabel,
      source_breadcrumb: `via ${anchorLabel} → ${relationshipLabel(
        anchorViewRel
      ).toLowerCase()}`,
      // Status for dates:
      status: other.is_deceased ? 'deceased' : 'living',
      birth_date: other.birthdate || null,
      death_date: other.death_date || null,
      // Confidence + approval:
      _confidence: inference.confidence,
      _rationale: inference.rationale,
      _approved: inference.confidence === 'high',
    });
  }

  // 3b) Anchor's extended_family — propose as new extended_family
  //     rows for subject. Source relationship is free text.
  for (const ext of anchorGraph.extendedFamily) {
    if (!ext.name?.trim()) continue;
    if (subjectExtendedNames.has(norm(ext.name))) continue;
    const inference = await runInference({
      subjectName: anchorLabel,
      relativeAName: ext.name,
      relativeARelToSubject: ext.relationship || 'relative',
      relativeBName: subjectLabel,
      relativeBRelToSubject: subjectRoleFromAnchor || 'relative',
    });
    if (!inference) continue;
    proposals.push({
      kind: 'extended_family',
      name: ext.name,
      relationship_to_subject: humanLabel(inference.relationship_a_to_b),
      // Carry forward any age/location/notes the anchor's row had so
      // the pastor doesn't have to retype.
      age: ext.age || (ext.age === 'deceased' ? 'deceased' : null),
      location: ext.location || null,
      notes: ext.notes || null,
      status:
        (ext.age || '').toLowerCase() === 'deceased' ? 'deceased' : 'living',
      source_kind: 'extended_family',
      source_anchor_id: anchorPersonId,
      source_anchor_label: anchorLabel,
      source_breadcrumb: `via ${anchorLabel} → extended family (${ext.relationship || 'relative'})`,
      _confidence: inference.confidence,
      _rationale: inference.rationale,
      _approved: inference.confidence === 'high',
    });
  }

  // 3c) Anchor's significant_deaths — propose as new significant_death
  //     rows for subject. Carry the death date forward.
  for (const sd of anchorGraph.significantDeaths) {
    if (!sd.name?.trim()) continue;
    if (subjectDeathNames.has(norm(sd.name))) continue;
    const inference = await runInference({
      subjectName: anchorLabel,
      relativeAName: sd.name,
      relativeARelToSubject: sd.relationship || 'relative',
      relativeBName: subjectLabel,
      relativeBRelToSubject: subjectRoleFromAnchor || 'relative',
    });
    if (!inference) continue;
    proposals.push({
      kind: 'significant_death',
      name: sd.name,
      relationship_to_subject: humanLabel(inference.relationship_a_to_b),
      date_of_death: sd.date_of_death || null,
      notes: sd.notes || null,
      status: 'deceased',
      source_kind: 'significant_death',
      source_anchor_id: anchorPersonId,
      source_anchor_label: anchorLabel,
      source_breadcrumb: `via ${anchorLabel} → significant death (${sd.relationship || 'relative'})`,
      _confidence: inference.confidence,
      _rationale: inference.rationale,
      _approved: inference.confidence === 'high',
    });
  }

  return { proposals, anchorPerson, subjectRoleFromAnchor };
}

// ---------------------------------------------------------------------
// commitExtensions — write the approved proposals.
// ---------------------------------------------------------------------
//
// Per-row error isolation matching commitImport's posture: a bad row
// doesn't poison the rest of the batch.
// `ownerUserId` and `subjectPersonId` are passed once; each proposal
// is dispatched to the right table based on its `kind`.

export async function commitExtensions({
  subjectPersonId,
  ownerUserId,
  proposals,
}) {
  if (!subjectPersonId || !ownerUserId) {
    throw new Error(
      'commitExtensions requires subjectPersonId and ownerUserId.'
    );
  }
  const counts = {
    family_links: 0,
    extended_family: 0,
    significant_deaths: 0,
    already_linked: 0,
  };
  const errors = [];

  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];
    if (!p || !p._approved) continue;
    const label = p.name || `Row ${i + 1}`;
    try {
      if (p.kind === 'directory_link') {
        if (!p.directory_person_id) {
          throw new Error('Missing directory_person_id.');
        }
        if (p.directory_person_id === subjectPersonId) {
          throw new Error('Cannot link a person to themselves.');
        }
        // Dedupe at insert time too (extraction was deduped at
        // suggestion time, but the graph can change between suggest
        // and commit).
        const { data: existing, error: existErr } = await withTimeout(
          supabase
            .from('pastoral_family_links')
            .select('id')
            .or(
              `and(person_a_id.eq.${subjectPersonId},person_b_id.eq.${p.directory_person_id}),` +
                `and(person_a_id.eq.${p.directory_person_id},person_b_id.eq.${subjectPersonId})`
            )
            .limit(1)
        );
        if (existErr) throw existErr;
        if (existing && existing.length > 0) {
          counts.already_linked += 1;
          continue;
        }
        const { error: linkErr } = await withTimeout(
          supabase.from('pastoral_family_links').insert({
            owner_user_id: ownerUserId,
            person_a_id: subjectPersonId,
            person_b_id: p.directory_person_id,
            relationship_a_to_b: p.family_link_relationship || 'other',
            notes: trimOrNull(p.notes),
          })
        );
        if (linkErr) throw linkErr;
        counts.family_links += 1;
      } else if (p.kind === 'extended_family') {
        if (!p.name?.trim()) throw new Error('Name is required.');
        const { error: extErr } = await withTimeout(
          supabase.from('pastoral_extended_family').insert({
            owner_user_id: ownerUserId,
            person_id: subjectPersonId,
            name: p.name.trim(),
            relationship: trimOrNull(p.relationship_to_subject),
            age:
              p.status === 'deceased' ? 'deceased' : trimOrNull(p.age),
            location: trimOrNull(p.location),
            notes: trimOrNull(p.notes),
          })
        );
        if (extErr) throw extErr;
        counts.extended_family += 1;
      } else if (p.kind === 'significant_death') {
        if (!p.name?.trim()) throw new Error('Name is required.');
        const { error: sdErr } = await withTimeout(
          supabase.from('pastoral_significant_deaths').insert({
            owner_user_id: ownerUserId,
            person_id: subjectPersonId,
            name: p.name.trim(),
            relationship: trimOrNull(p.relationship_to_subject),
            date_of_death: normalizeDateOrNull(p.date_of_death),
            notes: trimOrNull(p.notes),
          })
        );
        if (sdErr) throw sdErr;
        counts.significant_deaths += 1;
      } else {
        throw new Error(`Unknown proposal kind: ${p.kind}`);
      }
    } catch (e) {
      errors.push({
        index: i,
        label,
        message: e.message || String(e),
      });
    }
  }

  if (errors.length > 0) {
    const summary = errors
      .slice(0, 5)
      .map((r) => `  • ${r.label}: ${r.message}`)
      .join('\n');
    const more =
      errors.length > 5 ? `\n  …and ${errors.length - 5} more` : '';
    const err = new Error(
      `${errors.length} row${
        errors.length === 1 ? '' : 's'
      } failed to commit:\n${summary}${more}`
    );
    err.partial = true;
    err.counts = counts;
    err.errors = errors;
    throw err;
  }

  return { counts };
}

// ---------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------

// Wrapper around inferRelativeToRelative that swallows individual
// failures (returning null so the caller skips that pair) — one bad
// Claude response shouldn't abort a 15-relative scan.
async function runInference(args) {
  try {
    const result = await inferRelativeToRelative(args);
    if (!result?.relationship_a_to_b) return null;
    return result;
  } catch {
    return null;
  }
}

const READABLE_LABELS = {
  spouse: 'spouse',
  sibling: 'sibling',
  parent: 'parent',
  child: 'child',
  grandparent: 'grandparent',
  grandchild: 'grandchild',
  aunt_uncle: 'aunt/uncle',
  niece_nephew: 'niece/nephew',
  cousin: 'cousin',
  in_law: 'in-law',
  other: 'relative',
};

function humanLabel(enumValue) {
  return READABLE_LABELS[enumValue] || enumValue || 'relative';
}

// Invert an enum into its reverse human-readable form so Claude has a
// well-grounded "subject's role from anchor's perspective". E.g.,
// "anchor is subject's parent" ⇒ "subject is anchor's child".
const REL_INVERSE = {
  spouse: 'spouse',
  sibling: 'sibling',
  parent: 'child',
  child: 'parent',
  grandparent: 'grandchild',
  grandchild: 'grandparent',
  aunt_uncle: 'niece/nephew',
  niece_nephew: 'aunt/uncle',
  cousin: 'cousin',
  in_law: 'in-law',
  other: 'relative',
};
function invertReadable(enumValue) {
  return REL_INVERSE[enumValue] || 'relative';
}

function trimOrNull(s) {
  if (typeof s !== 'string') return s ?? null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

function normalizeDateOrNull(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

// Keep the hint accessible for the prompt-tuning fans — exposed for
// callers that want to thread it into a future, richer prompt.
export const EXTRACTION_HINT = NEEDS_RELATIONSHIP_INFERENCE_HINT;
