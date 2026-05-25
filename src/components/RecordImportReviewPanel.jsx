import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import PersonPicker from './PersonPicker.jsx';
import {
  commitImport,
  countImportArtifacts,
  updateImport,
} from '../lib/recordImports';
import { inferRelativeToRelative } from '../lib/claude';
import { listLinksFor, relationshipLabel } from '../lib/familyLinks';
import { getPerson, fullName } from '../lib/people';

// Shared review UI for both the Clergy Record and Obituary importers.
//
// Given:
//   - `importRow` — the pastoral_record_imports row (after Claude has
//     populated raw_extraction)
//   - `subjectPerson` — the directory pastoral_people row this import
//     is FOR (used for subject-field backfill comparisons + naming)
//
// Lets the pastor:
//   - Edit Subject fields, tick which to backfill on the directory person
//   - Edit each Family member's row: name, dates, status, relationship,
//     target table (directory link / extended family / significant death /
//     skip), and — for directory_link rows — pick the existing directory
//     person to link to
//   - Add or remove family rows entirely
//   - Edit pastor notes on the import
//   - Save (persist edits to raw_extraction without committing) or
//     Commit (also create the actual family_links / extended_family /
//     significant_deaths rows in one transaction-ish pass)
//
// Re-committing an already-committed import is allowed — commitImport
// calls clearImportArtifacts first, so the previous commit's rows are
// wiped and re-created from the latest decisions.
//
// Heuristic for default "target table":
//   - status = "deceased" AND we have a death_date → significant_death
//   - status = "deceased" without a date            → significant_death
//   - status = "living"  AND directory match found  → directory_link
//   - status = "living"  AND no directory match     → extended_family
//
// We DON'T pre-pick directory matches — that requires the pastor to
// search and confirm. We just show a PersonPicker on each row.

// Map common free-text relationships (the way they appear in obits /
// clergy forms) onto the pastoral_family_links enum, so the relationship
// dropdown for directory links pre-selects the right value.
const FREE_TEXT_TO_ENUM = {
  daughter: 'child',
  son: 'child',
  stepdaughter: 'child',
  stepson: 'child',
  'daughter-in-law': 'in_law',
  'son-in-law': 'in_law',
  child: 'child',
  father: 'parent',
  mother: 'parent',
  stepfather: 'parent',
  stepmother: 'parent',
  'father-in-law': 'in_law',
  'mother-in-law': 'in_law',
  parent: 'parent',
  brother: 'sibling',
  sister: 'sibling',
  'brother-in-law': 'in_law',
  'sister-in-law': 'in_law',
  sibling: 'sibling',
  spouse: 'spouse',
  wife: 'spouse',
  husband: 'spouse',
  ex_wife: 'spouse',
  ex_husband: 'spouse',
  partner: 'spouse',
  grandmother: 'grandparent',
  grandfather: 'grandparent',
  grandparent: 'grandparent',
  grandson: 'grandchild',
  granddaughter: 'grandchild',
  grandchild: 'grandchild',
  'grand-child': 'grandchild',
  greatgrandchild: 'grandchild',
  'great-grandchild': 'grandchild',
  greatgrandson: 'grandchild',
  greatgranddaughter: 'grandchild',
  niece: 'niece_nephew',
  nephew: 'niece_nephew',
  aunt: 'aunt_uncle',
  uncle: 'aunt_uncle',
  cousin: 'cousin',
};

function guessFamilyLinkEnum(freeText) {
  if (!freeText) return 'other';
  const s = freeText.trim().toLowerCase().replace(/\s+/g, '-');
  if (FREE_TEXT_TO_ENUM[s]) return FREE_TEXT_TO_ENUM[s];
  const s2 = s.replace(/-/g, '');
  if (FREE_TEXT_TO_ENUM[s2]) return FREE_TEXT_TO_ENUM[s2];
  // Soft contains-match as a fallback.
  for (const [k, v] of Object.entries(FREE_TEXT_TO_ENUM)) {
    if (s.includes(k)) return v;
  }
  return 'other';
}

function defaultTarget(member) {
  if (!member) return 'skip';
  const status = (member.status || '').toLowerCase();
  if (status === 'deceased') return 'significant_death';
  return 'extended_family';
}

function blankFamilyDecision() {
  return {
    skip: false,
    name: '',
    status: 'living',
    relationship_to_subject: '',
    birth_date: '',
    death_date: '',
    notes: '',
    target: 'extended_family',
    directory_person_id: null,
    directory_person_label: '',
    family_link_relationship: 'other',
  };
}

// Hydrate the Phase A raw_extraction.family[] array into the decision
// shape the panel renders + commitImport expects.
//
// Phase E: When the import has been saved previously, the family rows
// carry editor-only fields prefixed with `_` (e.g. _target,
// _directory_person_id) that record the pastor's per-row decisions.
// Prefer those over the defaults so re-opening a saved import shows
// exactly what the pastor left it as — not a freshly-defaulted view.
function decisionsFromExtraction(extraction) {
  const fam = Array.isArray(extraction?.family) ? extraction.family : [];
  return fam.map((m) => {
    const hasEditorState =
      m._target !== undefined ||
      m._directory_person_id !== undefined ||
      m._skip !== undefined;
    return {
      skip: hasEditorState ? Boolean(m._skip) : false,
      name: (m.name || '').trim(),
      status:
        (m.status || '').toLowerCase() === 'deceased' ? 'deceased' : 'living',
      relationship_to_subject: (m.relationship_to_subject || '').trim(),
      birth_date: (m.birth_date || '').trim(),
      death_date: (m.death_date || '').trim(),
      notes: hasEditorState
        ? // On rehydrate the saved notes already include whatever the
          // pastor typed (which subsumed the spouse_of bridge text on
          // first decoration), so don't re-decorate.
          (m.notes || '').trim()
        : [m.notes, m.spouse_of ? `spouse of ${m.spouse_of}` : '']
            .filter(Boolean)
            .join(' · '),
      target: hasEditorState && m._target ? m._target : defaultTarget(m),
      directory_person_id: hasEditorState
        ? m._directory_person_id || null
        : null,
      directory_person_label: hasEditorState
        ? m._directory_person_label || ''
        : '',
      family_link_relationship:
        hasEditorState && m._family_link_relationship
          ? m._family_link_relationship
          : guessFamilyLinkEnum(m.relationship_to_subject),
    };
  });
}

// Per-field guard: only show the "Apply to directory person" checkbox
// when the directory person's existing value for that field is blank
// (so we never silently overwrite something the pastor already typed).
function isBlank(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

export default function RecordImportReviewPanel({
  importRow,
  subjectPerson,
  onSaved,
  onCommitted,
  onCancel,
}) {
  const { user } = useAuth();

  // Editable state, seeded from the import's raw_extraction. We don't
  // copy from props on every render — only when the import id changes.
  const [subjectDraft, setSubjectDraft] = useState(() => ({
    name: importRow?.raw_extraction?.subject?.name || '',
    birth_date: importRow?.raw_extraction?.subject?.birth_date || '',
    death_date: importRow?.raw_extraction?.subject?.death_date || '',
    place_of_birth: importRow?.raw_extraction?.subject?.place_of_birth || '',
    place_of_death: importRow?.raw_extraction?.subject?.place_of_death || '',
    marital_status: importRow?.raw_extraction?.subject?.marital_status || '',
    church_affiliation:
      importRow?.raw_extraction?.subject?.church_affiliation || '',
    religion: importRow?.raw_extraction?.subject?.religion || '',
    address: importRow?.raw_extraction?.subject?.address || '',
  }));
  const [subjectApplyFlags, setSubjectApplyFlags] = useState({});
  const [decisions, setDecisions] = useState(() =>
    decisionsFromExtraction(importRow?.raw_extraction || {})
  );
  const [notes, setNotes] = useState(importRow?.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  // ---- Phase E: last-commit summary ----
  //
  // When the import has been committed before, count the child rows
  // currently stamped with this import's id so the pastor sees what
  // would be wiped on re-commit. Fast — uses HEAD counts on indexed
  // columns. Re-fetched whenever the importRow id changes or a commit
  // completes.
  const [lastCommitCounts, setLastCommitCounts] = useState(null);
  const [lastCommitLoading, setLastCommitLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!importRow?.id || !importRow.committed_at) {
      setLastCommitCounts(null);
      return undefined;
    }
    setLastCommitLoading(true);
    (async () => {
      try {
        const c = await countImportArtifacts(importRow.id);
        if (!cancelled) setLastCommitCounts(c);
      } catch {
        if (!cancelled) setLastCommitCounts(null);
      } finally {
        if (!cancelled) setLastCommitLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [importRow?.id, importRow?.committed_at]);

  // ---- Phase C: subject's existing directory family + inferred links ----
  //
  // existingFamily: array of { other_person_id, displayed_relationship,
  //   other_person: { id, first_name, last_name, ... } } — subject's
  //   existing directory family, loaded once on panel open. The
  //   "Suggest auto-links" button uses this to compute proposals.
  // inferredProposals: array of { person_a_id, person_b_id, relationship_a_to_b,
  //   _label, _rationale, _confidence, _approved } — pastor toggles
  //   _approved per row, and approved rows ride along on commit.
  const [existingFamily, setExistingFamily] = useState([]);
  const [existingFamilyLoading, setExistingFamilyLoading] = useState(false);
  const [inferredProposals, setInferredProposals] = useState([]);
  const [inferring, setInferring] = useState(false);
  const [inferError, setInferError] = useState(null);
  // documentShareTargetIds: pastoral_people.id list to receive a share
  // of the import's source_document_id on commit. Defaults to every
  // directory_link target currently in `decisions`, unless the pastor
  // has explicitly customised the set (tracked by shareTargetsDirty).
  const [shareTargetIds, setShareTargetIds] = useState(() => new Set());
  // Set to true once the pastor manually ticks/unticks a share target;
  // suppresses the auto-default effect from then on so their explicit
  // choices stick across keystrokes. Also rehydrated from a saved
  // import's raw_extraction (`_share_targets_dirty`).
  const [shareTargetsDirty, setShareTargetsDirty] = useState(false);

  // Load subject's existing directory family once per subject. The
  // resolver in lib/familyLinks.js already normalizes the rows to
  // "from THIS person's perspective" — we still need to fetch the
  // OTHER person's row for the display label, so we hydrate that on
  // the way back. Cheap; tiny dataset (a handful of links).
  useEffect(() => {
    let cancelled = false;
    if (!subjectPerson?.id) {
      setExistingFamily([]);
      return undefined;
    }
    setExistingFamilyLoading(true);
    (async () => {
      try {
        const links = await listLinksFor(subjectPerson.id);
        // Hydrate the other-person rows in parallel — limited to ~15 to
        // keep the burst sane. (Beyond that the pastor probably has a
        // good reason and we still serve them.)
        const ids = Array.from(
          new Set(links.map((l) => l.other_person_id).filter(Boolean))
        ).slice(0, 30);
        const personRows = await Promise.all(
          ids.map((id) => getPerson(id).catch(() => null))
        );
        const byId = new Map();
        for (const row of personRows) if (row) byId.set(row.id, row);
        const hydrated = links.map((l) => ({
          ...l,
          other_person: byId.get(l.other_person_id) || null,
        }));
        if (!cancelled) setExistingFamily(hydrated);
      } catch (e) {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.warn('Failed to load subject family for auto-link:', e);
          setExistingFamily([]);
        }
      } finally {
        if (!cancelled) setExistingFamilyLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subjectPerson?.id]);

  // Default share-targets to the directory_link picks the pastor has
  // currently accepted. Recomputed whenever the decision set or its
  // directory_person_ids change — UNLESS the pastor has manually
  // customised the set (shareTargetsDirty), in which case we preserve
  // their explicit choices. Their customisation is also persisted into
  // the raw_extraction so it survives close+reopen.
  useEffect(() => {
    if (shareTargetsDirty) return;
    const defaults = new Set();
    for (const d of decisions) {
      if (
        !d.skip &&
        d.target === 'directory_link' &&
        d.directory_person_id
      ) {
        defaults.add(d.directory_person_id);
      }
    }
    setShareTargetIds(defaults);
    // We deliberately don't depend on decisions itself (object identity
    // changes every keystroke); the stringified ids list is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    shareTargetsDirty,
    decisions
      .filter((d) => !d.skip && d.target === 'directory_link')
      .map((d) => d.directory_person_id)
      .filter(Boolean)
      .sort()
      .join('|'),
  ]);

  // Re-seed when the underlying import switches (e.g. user opened the
  // "Edit import" flow and we passed a different importRow in).
  //
  // Phase E: also rehydrate the editor-only cross-row state from the
  // saved raw_extraction so the pastor sees their prior auto-link
  // approvals and share-target toggles, not freshly-defaulted state.
  useEffect(() => {
    const ex = importRow?.raw_extraction || {};
    setSubjectDraft({
      name: ex?.subject?.name || '',
      birth_date: ex?.subject?.birth_date || '',
      death_date: ex?.subject?.death_date || '',
      place_of_birth: ex?.subject?.place_of_birth || '',
      place_of_death: ex?.subject?.place_of_death || '',
      marital_status: ex?.subject?.marital_status || '',
      church_affiliation: ex?.subject?.church_affiliation || '',
      religion: ex?.subject?.religion || '',
      address: ex?.subject?.address || '',
    });
    setSubjectApplyFlags(
      ex?._subject_apply_flags && typeof ex._subject_apply_flags === 'object'
        ? { ...ex._subject_apply_flags }
        : {}
    );
    setDecisions(decisionsFromExtraction(ex));
    setNotes(importRow?.notes || '');
    setSavedAt(null);
    // Inferred-link proposals: restore each one exactly, preserving
    // the pastor's per-row approval flags.
    setInferredProposals(
      Array.isArray(ex?._inferred_proposals)
        ? ex._inferred_proposals.map((p) => ({
            person_a_id: p.person_a_id,
            person_b_id: p.person_b_id,
            relationship_a_to_b: p.relationship_a_to_b,
            _label: p._label || '',
            _rationale: p._rationale || '',
            _confidence: p._confidence || 'medium',
            _approved: !!p._approved,
          }))
        : []
    );
    // Share-target overrides: if the pastor never customised them, let
    // the default-effect repopulate from decisions. If they did, restore
    // exactly what was saved.
    if (ex?._share_targets_dirty) {
      setShareTargetIds(new Set(ex._share_target_ids || []));
      setShareTargetsDirty(true);
    } else {
      setShareTargetIds(new Set());
      setShareTargetsDirty(false);
    }
    setInferError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importRow?.id]);

  // Which subject fields are blank on the directory person AND have a
  // value in the extraction. Those are the only ones we offer to backfill.
  const backfillableFields = useMemo(() => {
    const out = {};
    const subj = subjectPerson || {};
    if (subjectDraft.birth_date && isBlank(subj.birthdate)) {
      out.birthdate = subjectDraft.birth_date;
    }
    if (subjectDraft.death_date && isBlank(subj.death_date)) {
      out.death_date = subjectDraft.death_date;
    }
    // place_of_birth / place_of_death don't have direct columns on
    // pastoral_people; we leave them in the import for reference but
    // don't offer to backfill them as structured fields. Pastor can
    // copy them into notes manually if useful.
    return out;
  }, [subjectDraft, subjectPerson]);

  const updateSubject = (k, v) =>
    setSubjectDraft((p) => ({ ...p, [k]: v }));
  const toggleApplyFlag = (k) =>
    setSubjectApplyFlags((p) => ({ ...p, [k]: !p[k] }));

  const updateDecision = (idx, patch) => {
    setDecisions((prev) =>
      prev.map((d, i) => (i === idx ? { ...d, ...patch } : d))
    );
  };
  const removeDecision = (idx) => {
    setDecisions((prev) => prev.filter((_, i) => i !== idx));
  };
  const addBlankDecision = () => {
    setDecisions((prev) => [...prev, blankFamilyDecision()]);
  };

  // Assemble the raw_extraction shape from the edited state, mirroring
  // what Claude originally returned (so re-extract → re-edit is symmetric).
  //
  // Editor-only fields are persisted alongside Claude's original output
  // (prefixed `_` on family rows; top-level keys for cross-row state)
  // so re-open shows exactly what the pastor left it as without making
  // them re-run Claude or re-tick share targets.
  const buildRawExtractionForSave = () => {
    const family = decisions.map((d) => ({
      name: d.name,
      relationship_to_subject: d.relationship_to_subject,
      status: d.status,
      birth_date: d.birth_date || null,
      death_date: d.death_date || null,
      notes: d.notes,
      // Editor-only — see decisionsFromExtraction for the rehydration.
      _target: d.target,
      _directory_person_id: d.directory_person_id || null,
      _directory_person_label: d.directory_person_label || '',
      _family_link_relationship: d.family_link_relationship || 'other',
      _skip: d.skip,
    }));
    return {
      ...(importRow.raw_extraction || {}),
      subject: {
        ...(importRow.raw_extraction?.subject || {}),
        name: subjectDraft.name,
        birth_date: subjectDraft.birth_date || null,
        death_date: subjectDraft.death_date || null,
        place_of_birth: subjectDraft.place_of_birth || null,
        place_of_death: subjectDraft.place_of_death || null,
        marital_status: subjectDraft.marital_status || null,
        church_affiliation: subjectDraft.church_affiliation || null,
        religion: subjectDraft.religion || null,
        address: subjectDraft.address || null,
      },
      family,
      // Phase E: cross-row editor state.
      _inferred_proposals: inferredProposals.map((p) => ({
        person_a_id: p.person_a_id,
        person_b_id: p.person_b_id,
        relationship_a_to_b: p.relationship_a_to_b,
        _label: p._label || '',
        _rationale: p._rationale || '',
        _confidence: p._confidence || 'medium',
        _approved: !!p._approved,
      })),
      _share_target_ids: Array.from(shareTargetIds),
      _share_targets_dirty: shareTargetsDirty,
      _subject_apply_flags: { ...subjectApplyFlags },
    };
  };

  // Persist edits to raw_extraction without committing the inserts.
  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateImport(importRow.id, {
        rawExtraction: buildRawExtractionForSave(),
        notes: notes.trim() || null,
      });
      setSavedAt(new Date());
      onSaved?.(updated);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // ---- Phase C: Suggest auto-links ----
  //
  // For each directory_link decision (the "new relative") that has a
  // directory_person_id, walk every existing family-link of the subject
  // (the "existing relative") and ask Claude to infer the implied
  // relationship between the new and existing relatives. Each proposal
  // lands in `inferredProposals` with _approved=false by default; the
  // pastor toggles which to keep.
  const runSuggestAutoLinks = async () => {
    setInferring(true);
    setInferError(null);
    try {
      const newDirectoryLinks = decisions
        .map((d, i) => ({ d, i }))
        .filter(
          ({ d }) =>
            !d.skip &&
            d.target === 'directory_link' &&
            d.directory_person_id &&
            d.directory_person_label
        );
      if (newDirectoryLinks.length === 0) {
        setInferError(
          'Assign at least one family member to "Directory link" first — auto-link only works for directory-linked relatives.'
        );
        return;
      }
      const existing = existingFamily.filter(
        (l) =>
          l.other_person_id &&
          // Skip rows whose other person is already in the new-link set
          // — Claude has no extra signal there.
          !newDirectoryLinks.some(
            ({ d }) => d.directory_person_id === l.other_person_id
          )
      );
      if (existing.length === 0) {
        setInferError(
          'No existing directory family on the subject to auto-link to. Once a few family-link rows are added (manually or via this importer), the auto-link button will have material to work with.'
        );
        return;
      }
      const subjName = fullName(subjectPerson);
      const proposals = [];
      // Sequential Claude calls — the dataset is small (typical: 3-8
      // new × 2-4 existing = 6-32 calls). Parallel bursts of more than
      // ~5 risk Claude rate limits, so we keep it tidy.
      for (const { d } of newDirectoryLinks) {
        for (const ex of existing) {
          const exLabel = ex.other_person
            ? fullName(ex.other_person)
            : '(directory member)';
          try {
            const inference = await inferRelativeToRelative({
              subjectName: subjName,
              relativeAName: d.directory_person_label,
              relativeARelToSubject: d.relationship_to_subject || 'relative',
              relativeBName: exLabel,
              relativeBRelToSubject: relationshipLabel(
                ex.displayed_relationship
              ),
            });
            if (!inference.relationship_a_to_b) continue;
            proposals.push({
              person_a_id: d.directory_person_id,
              person_b_id: ex.other_person_id,
              relationship_a_to_b: inference.relationship_a_to_b,
              _label: `${d.directory_person_label} → ${exLabel}`,
              _rationale: inference.rationale || '',
              _confidence: inference.confidence || 'medium',
              // Default-approve high-confidence inferences; medium/low
              // start unchecked so the pastor explicitly reviews them.
              _approved: inference.confidence === 'high',
            });
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('inferRelativeToRelative failed:', e);
          }
        }
      }
      setInferredProposals(proposals);
      if (proposals.length === 0) {
        setInferError(
          'Claude couldn\'t produce any usable relationship inferences. You can still commit the panel without auto-links.'
        );
      }
    } catch (e) {
      setInferError(e.message || String(e));
    } finally {
      setInferring(false);
    }
  };

  const toggleProposal = (idx) => {
    setInferredProposals((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, _approved: !p._approved } : p))
    );
  };

  const updateProposalRel = (idx, rel) => {
    setInferredProposals((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, relationship_a_to_b: rel } : p
      )
    );
  };

  const toggleShareTarget = (personId) => {
    // Once the pastor manually touches the share-target set, their
    // selection should stick — even if they later add/remove
    // directory_link decisions that would otherwise re-default it.
    setShareTargetsDirty(true);
    setShareTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };

  // Save edits and then run commitImport. Subject patches go in if the
  // user ticked their backfill checkboxes.
  const handleCommit = async () => {
    setBusy(true);
    setError(null);
    try {
      // 1) Save edits first so even a failed commit preserves them.
      await updateImport(importRow.id, {
        rawExtraction: buildRawExtractionForSave(),
        notes: notes.trim() || null,
      });
      // 2) Assemble subject patch from ticked flags.
      const subjectUpdates = {};
      for (const [k, on] of Object.entries(subjectApplyFlags)) {
        if (on && backfillableFields[k]) {
          subjectUpdates[k] = backfillableFields[k];
        }
      }
      // 3) Commit. Inferred-link rows ride along if any were approved.
      //    Document share targets default to directory-link picks; the
      //    pastor can untick any they don't want shared.
      const approvedInferred = inferredProposals
        .filter((p) => p._approved)
        .map((p) => ({
          person_a_id: p.person_a_id,
          person_b_id: p.person_b_id,
          relationship_a_to_b: p.relationship_a_to_b,
          _label: p._label,
        }));
      const result = await commitImport({
        importId: importRow.id,
        ownerUserId: user.id,
        subjectPersonId: subjectPerson.id,
        decisions,
        subjectUpdates,
        inferredLinks: approvedInferred,
        documentShareTargetIds: Array.from(shareTargetIds),
      });
      // Refresh the last-commit count so the banner reflects what just
      // landed (the previous count was the PRE-recommit state).
      try {
        const fresh = await countImportArtifacts(importRow.id);
        setLastCommitCounts(fresh);
      } catch {
        /* non-fatal — banner just stays stale until next re-open */
      }
      onCommitted?.(result);
    } catch (e) {
      // commitImport's "partial" errors come back with .counts; in that
      // case the inserts that succeeded are real, we just surface the
      // per-row failures so the pastor can fix and re-commit.
      const msg = e.message || String(e);
      setError(msg);
      if (e?.partial && e?.import) {
        onCommitted?.({ counts: e.counts, import: e.import, partial: true });
      }
    } finally {
      setBusy(false);
    }
  };

  const acceptedCount = decisions.filter((d) => !d.skip).length;

  return (
    <div className="space-y-4">
      {/* Phase E — previously-committed banner */}
      {importRow.committed_at && (
        <div className="rounded border border-umc-200 bg-umc-50/60 px-3 py-2 text-xs space-y-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-umc-800 font-medium">
              ⟳ Editing an already-committed import
            </span>
            <span className="text-gray-500">
              committed{' '}
              {new Date(importRow.committed_at).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </span>
          </div>
          {lastCommitLoading && (
            <p className="text-gray-500 italic">Counting prior rows…</p>
          )}
          {lastCommitCounts && (
            <p className="text-gray-700">
              Currently in the directory from this import:{' '}
              {lastCommitCounts.family_links} family-link
              {lastCommitCounts.family_links === 1 ? '' : 's'},{' '}
              {lastCommitCounts.extended_family} extended-family,{' '}
              {lastCommitCounts.significant_deaths} significant-death,{' '}
              {lastCommitCounts.document_shares} doc share
              {lastCommitCounts.document_shares === 1 ? '' : 's'}.
            </p>
          )}
          <p className="text-[11px] text-gray-600 italic">
            Re-committing wipes those rows and creates fresh ones from
            the decisions below. Rows you added manually (without this
            importer) are NOT touched.
          </p>
        </div>
      )}

      {/* Subject fields */}
      <fieldset className="border border-gray-200 rounded p-3 space-y-2">
        <legend className="px-1 text-xs uppercase tracking-wide text-gray-500">
          Subject (the person this record is about)
        </legend>
        <p className="text-[11px] text-gray-500">
          Editing here updates the import only. To send a field back to the
          directory entry for <strong>{fullName(subjectPerson)}</strong>,
          tick the "apply to directory" checkbox. (Only blank fields on the
          directory entry can be overwritten — your existing data is safe.)
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <SubjectField
            label="Name (as recorded)"
            value={subjectDraft.name}
            onChange={(v) => updateSubject('name', v)}
          />
          <SubjectField
            label="Marital status"
            value={subjectDraft.marital_status}
            onChange={(v) => updateSubject('marital_status', v)}
          />
          <SubjectField
            label="Date of birth (YYYY-MM-DD)"
            value={subjectDraft.birth_date}
            onChange={(v) => updateSubject('birth_date', v)}
            applyFlag={
              backfillableFields.birthdate !== undefined
                ? {
                    checked: !!subjectApplyFlags.birthdate,
                    onToggle: () => toggleApplyFlag('birthdate'),
                    hint: 'Backfill directory Birthdate (currently blank)',
                  }
                : null
            }
          />
          <SubjectField
            label="Date of death (YYYY-MM-DD)"
            value={subjectDraft.death_date}
            onChange={(v) => updateSubject('death_date', v)}
            applyFlag={
              backfillableFields.death_date !== undefined
                ? {
                    checked: !!subjectApplyFlags.death_date,
                    onToggle: () => toggleApplyFlag('death_date'),
                    hint: 'Backfill directory Death date (currently blank)',
                  }
                : null
            }
          />
          <SubjectField
            label="Place of birth"
            value={subjectDraft.place_of_birth}
            onChange={(v) => updateSubject('place_of_birth', v)}
          />
          <SubjectField
            label="Place of death"
            value={subjectDraft.place_of_death}
            onChange={(v) => updateSubject('place_of_death', v)}
          />
          <SubjectField
            label="Church affiliation"
            value={subjectDraft.church_affiliation}
            onChange={(v) => updateSubject('church_affiliation', v)}
          />
          <SubjectField
            label="Religion"
            value={subjectDraft.religion}
            onChange={(v) => updateSubject('religion', v)}
          />
          <SubjectField
            label="Address (as recorded)"
            value={subjectDraft.address}
            onChange={(v) => updateSubject('address', v)}
            wide
          />
        </div>
      </fieldset>

      {/* Family members table */}
      <fieldset className="border border-gray-200 rounded p-3 space-y-2">
        <legend className="px-1 text-xs uppercase tracking-wide text-gray-500">
          Family ({acceptedCount} of {decisions.length} accepted)
        </legend>
        <p className="text-[11px] text-gray-500">
          For each person, pick where they should land. "Directory link"
          requires picking an existing entry in the directory; if you want
          to create a new directory entry, do that first in another tab and
          then come back. "Skip" excludes the row from this import.
        </p>
        <div className="space-y-2">
          {decisions.length === 0 && (
            <p className="text-xs italic text-gray-500">
              No family members extracted. You can add one manually below.
            </p>
          )}
          {decisions.map((d, i) => (
            <FamilyDecisionRow
              key={i}
              decision={d}
              subjectPersonId={subjectPerson.id}
              onChange={(patch) => updateDecision(i, patch)}
              onRemove={() => removeDecision(i)}
            />
          ))}
          <button
            type="button"
            onClick={addBlankDecision}
            className="text-xs text-umc-700 hover:text-umc-900 underline"
          >
            + Add family member
          </button>
        </div>
      </fieldset>

      {/* Auto-link to subject's existing directory family ------------- */}
      <fieldset className="border border-gray-200 rounded p-3 space-y-2">
        <legend className="px-1 text-xs uppercase tracking-wide text-gray-500">
          Auto-link to subject's existing family
          {existingFamilyLoading && (
            <span className="ml-1 normal-case tracking-normal text-gray-400">
              (loading…)
            </span>
          )}
        </legend>
        <p className="text-[11px] text-gray-500">
          Ask Claude to infer relationships between your new directory-linked
          relatives and the people already in <strong>{fullName(subjectPerson)}</strong>'s
          family graph. Example: a newly-imported brother becomes a niece's
          uncle. You approve each proposal before commit.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={runSuggestAutoLinks}
            disabled={inferring}
            className="btn-secondary text-xs disabled:opacity-50"
            title="Run Claude on each (new directory-linked relative × existing subject family) pair to suggest relative-to-relative links."
          >
            {inferring ? 'Asking Claude…' : '✨ Suggest auto-links'}
          </button>
          {existingFamily.length > 0 && (
            <span className="text-[11px] text-gray-500">
              {existingFamily.length} existing family-link
              {existingFamily.length === 1 ? '' : 's'} on file
            </span>
          )}
        </div>
        {inferError && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            {inferError}
          </p>
        )}
        {inferredProposals.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-gray-500">
              {inferredProposals.filter((p) => p._approved).length} of{' '}
              {inferredProposals.length} proposal
              {inferredProposals.length === 1 ? '' : 's'} approved. High-
              confidence inferences are pre-checked; medium/low start
              unchecked.
            </p>
            {inferredProposals.map((p, i) => (
              <InferredProposalRow
                key={i}
                proposal={p}
                onToggle={() => toggleProposal(i)}
                onChangeRel={(rel) => updateProposalRel(i, rel)}
              />
            ))}
          </div>
        )}
      </fieldset>

      {/* Share source document with linked family -------------------- */}
      {importRow.source_document_id &&
        Array.from(shareTargetIds).length >= 0 && (
          <fieldset className="border border-gray-200 rounded p-3 space-y-2">
            <legend className="px-1 text-xs uppercase tracking-wide text-gray-500">
              Share source document with linked family
            </legend>
            <p className="text-[11px] text-gray-500">
              The Clergy Record / Obituary source is filed under{' '}
              <strong>{fullName(subjectPerson)}</strong>'s Documents archive.
              Tick the directory-linked relatives who should ALSO see it on
              their own PersonDetail page (they'll see a "shared from"
              badge). You can change this later from PersonDocuments.
            </p>
            {decisions
              .filter(
                (d) =>
                  !d.skip &&
                  d.target === 'directory_link' &&
                  d.directory_person_id
              ).length === 0 ? (
              <p className="text-[11px] italic text-gray-500">
                No directory-linked relatives in this import yet.
              </p>
            ) : (
              <div className="space-y-1">
                {decisions
                  .filter(
                    (d) =>
                      !d.skip &&
                      d.target === 'directory_link' &&
                      d.directory_person_id
                  )
                  .map((d, i) => (
                    <label
                      key={d.directory_person_id + ':' + i}
                      className="flex items-start gap-2 cursor-pointer text-xs text-gray-700"
                    >
                      <input
                        type="checkbox"
                        checked={shareTargetIds.has(d.directory_person_id)}
                        onChange={() =>
                          toggleShareTarget(d.directory_person_id)
                        }
                        className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300"
                      />
                      <span>
                        {d.directory_person_label}
                        {d.relationship_to_subject && (
                          <span className="text-gray-400 ml-1">
                            ({d.relationship_to_subject})
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
              </div>
            )}
          </fieldset>
        )}

      {/* Service info (read-only — pastor can copy into other places) */}
      {importRow?.raw_extraction?.service && (
        <fieldset className="border border-gray-200 rounded p-3 space-y-1">
          <legend className="px-1 text-xs uppercase tracking-wide text-gray-500">
            Service info (reference)
          </legend>
          <ServiceLine
            label="Date"
            v={importRow.raw_extraction.service.date}
          />
          <ServiceLine
            label="Time"
            v={importRow.raw_extraction.service.time}
          />
          <ServiceLine
            label="Location"
            v={importRow.raw_extraction.service.location}
          />
          <ServiceLine
            label="Interment"
            v={importRow.raw_extraction.service.interment}
          />
          <ServiceLine
            label="Clergy"
            v={importRow.raw_extraction.service.clergy}
          />
        </fieldset>
      )}

      {/* Confidence notes from Claude, if any */}
      {importRow?.raw_extraction?.confidence_notes && (
        <p className="text-[11px] italic text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Claude's notes on uncertainty:{' '}
          {importRow.raw_extraction.confidence_notes}
        </p>
      )}

      {/* Pastor notes about this import */}
      <label className="block text-xs">
        <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
          Your notes about this import
        </span>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="input w-full text-sm"
          placeholder='e.g. "From Benefield FH, faxed Tuesday. Daughter Mary corrected spelling on second pass."'
        />
      </label>

      {error && (
        <pre className="text-xs text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1 whitespace-pre-wrap">
          {error}
        </pre>
      )}

      {savedAt && !error && (
        <p className="text-[11px] text-green-700">
          Edits saved at {savedAt.toLocaleTimeString()} (not yet committed
          to the directory).
        </p>
      )}

      <div className="flex items-center justify-end gap-2 flex-wrap">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="btn-secondary text-sm"
        >
          Close
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="btn-secondary text-sm disabled:opacity-50"
          title="Save your edits to this import without yet creating directory/family rows."
        >
          {busy ? 'Working…' : 'Save edits'}
        </button>
        <button
          type="button"
          onClick={handleCommit}
          disabled={busy || acceptedCount === 0}
          className="btn-primary text-sm disabled:opacity-50"
          title={
            acceptedCount === 0
              ? 'Accept at least one family row first.'
              : importRow.committed_at
                ? 'Re-commit: previous commit\'s rows will be wiped and re-created.'
                : 'Create the family/extended/significant-death rows from the accepted decisions.'
          }
        >
          {busy
            ? 'Working…'
            : importRow.committed_at
              ? '⟳ Re-commit'
              : '✓ Commit to directory'}
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// Subcomponents
// =====================================================================

function SubjectField({ label, value, onChange, wide = false, applyFlag = null }) {
  return (
    <label className={'block text-xs ' + (wide ? 'sm:col-span-2' : '')}>
      <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
        {label}
      </span>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="input w-full text-sm"
      />
      {applyFlag && (
        <label className="flex items-center gap-1.5 mt-0.5 text-[11px] text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={applyFlag.checked}
            onChange={applyFlag.onToggle}
            className="h-3 w-3 rounded border-gray-300"
          />
          {applyFlag.hint}
        </label>
      )}
    </label>
  );
}

const FAMILY_LINK_OPTIONS = [
  { value: 'spouse', label: 'Spouse' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'grandparent', label: 'Grandparent' },
  { value: 'grandchild', label: 'Grandchild' },
  { value: 'aunt_uncle', label: 'Aunt / Uncle' },
  { value: 'niece_nephew', label: 'Niece / Nephew' },
  { value: 'cousin', label: 'Cousin' },
  { value: 'in_law', label: 'In-law' },
  { value: 'other', label: 'Other' },
];

const TARGET_OPTIONS = [
  { value: 'directory_link', label: 'Directory link (pick existing person)' },
  { value: 'extended_family', label: 'Extended family (not in directory)' },
  { value: 'significant_death', label: 'Significant death' },
];

function FamilyDecisionRow({
  decision,
  subjectPersonId,
  onChange,
  onRemove,
}) {
  return (
    <div
      className={
        'rounded border p-2.5 space-y-2 ' +
        (decision.skip
          ? 'border-gray-200 bg-gray-50 opacity-60'
          : 'border-gray-200 bg-white')
      }
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-[11px] text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={decision.skip}
            onChange={(e) => onChange({ skip: e.target.checked })}
            className="h-3 w-3 rounded border-gray-300"
          />
          Skip
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="text-[11px] text-red-600 hover:text-red-800 underline ml-auto"
        >
          Remove row
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block text-xs">
          <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
            Name
          </span>
          <input
            type="text"
            value={decision.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="input w-full text-sm"
            disabled={decision.skip}
          />
        </label>
        <label className="block text-xs">
          <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
            Relationship (as stated)
          </span>
          <input
            type="text"
            value={decision.relationship_to_subject}
            onChange={(e) =>
              onChange({
                relationship_to_subject: e.target.value,
                family_link_relationship: guessFamilyLinkEnum(e.target.value),
              })
            }
            className="input w-full text-sm"
            disabled={decision.skip}
            placeholder='e.g. "daughter", "brother"'
          />
        </label>
        <label className="block text-xs">
          <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
            Status
          </span>
          <select
            value={decision.status}
            onChange={(e) =>
              onChange({
                status: e.target.value,
                // Re-default the target when status flips.
                target:
                  e.target.value === 'deceased'
                    ? 'significant_death'
                    : decision.target === 'significant_death'
                      ? 'extended_family'
                      : decision.target,
              })
            }
            className="input w-full text-sm"
            disabled={decision.skip}
          >
            <option value="living">Living</option>
            <option value="deceased">Deceased</option>
          </select>
        </label>
        <label className="block text-xs">
          <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
            {decision.status === 'deceased' ? 'Date of death' : 'Birth date'}
          </span>
          <input
            type="text"
            value={
              decision.status === 'deceased'
                ? decision.death_date
                : decision.birth_date
            }
            onChange={(e) => {
              const key =
                decision.status === 'deceased' ? 'death_date' : 'birth_date';
              onChange({ [key]: e.target.value });
            }}
            className="input w-full text-sm"
            disabled={decision.skip}
            placeholder="YYYY-MM-DD"
          />
        </label>
      </div>
      <label className="block text-xs">
        <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
          Target
        </span>
        <select
          value={decision.target}
          onChange={(e) => onChange({ target: e.target.value })}
          className="input w-full text-sm"
          disabled={decision.skip}
        >
          {TARGET_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {/* For directory_link, show person picker + relationship enum */}
      {decision.target === 'directory_link' && !decision.skip && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
              Directory person
            </span>
            <PersonPicker
              value={
                decision.directory_person_id
                  ? {
                      id: decision.directory_person_id,
                      first_name: decision.directory_person_label,
                      last_name: '',
                    }
                  : null
              }
              onChange={(p) =>
                onChange({
                  directory_person_id: p?.id || null,
                  directory_person_label: p ? fullName(p) : '',
                })
              }
              excludeIds={[subjectPersonId]}
              placeholder="Search directory…"
            />
          </div>
          <label className="block text-xs">
            <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
              Family-link relationship (subject → this person)
            </span>
            <select
              value={decision.family_link_relationship || 'other'}
              onChange={(e) =>
                onChange({ family_link_relationship: e.target.value })
              }
              className="input w-full text-sm"
            >
              {FAMILY_LINK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <label className="block text-xs">
        <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
          Notes
        </span>
        <input
          type="text"
          value={decision.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          className="input w-full text-sm"
          disabled={decision.skip}
        />
      </label>
    </div>
  );
}

function InferredProposalRow({ proposal, onToggle, onChangeRel }) {
  const confidenceColor =
    proposal._confidence === 'high'
      ? 'text-green-700'
      : proposal._confidence === 'low'
        ? 'text-amber-700'
        : 'text-gray-600';
  return (
    <div
      className={
        'rounded border p-2 flex items-start gap-2 ' +
        (proposal._approved
          ? 'border-umc-200 bg-umc-50/40'
          : 'border-gray-200 bg-white')
      }
    >
      <input
        type="checkbox"
        checked={!!proposal._approved}
        onChange={onToggle}
        className="mt-1 h-3.5 w-3.5 rounded border-gray-300 flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap text-xs">
          <span className="font-medium text-gray-800">{proposal._label}</span>
          <span className="text-[10px] uppercase tracking-wide text-gray-500">
            relationship A → B:
          </span>
          <select
            value={proposal.relationship_a_to_b}
            onChange={(e) => onChangeRel(e.target.value)}
            className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white"
            disabled={!proposal._approved}
          >
            {FAMILY_LINK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className={'text-[10px] ' + confidenceColor}>
            {proposal._confidence} confidence
          </span>
        </div>
        {proposal._rationale && (
          <p className="text-[11px] italic text-gray-500 mt-0.5">
            {proposal._rationale}
          </p>
        )}
      </div>
    </div>
  );
}

function ServiceLine({ label, v }) {
  if (!v) return null;
  return (
    <div className="text-xs flex gap-2">
      <span className="text-gray-500 w-24 flex-shrink-0">{label}:</span>
      <span className="text-gray-800">{v}</span>
    </div>
  );
}
