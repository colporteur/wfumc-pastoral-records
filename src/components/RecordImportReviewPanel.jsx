import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import PersonPicker from './PersonPicker.jsx';
import { commitImport, updateImport } from '../lib/recordImports';
import { fullName } from '../lib/people';

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

// Hydrate the Phase A raw_extraction.family[] array into the
// decision shape the panel renders + commitImport expects.
function decisionsFromExtraction(extraction) {
  const fam = Array.isArray(extraction?.family) ? extraction.family : [];
  return fam.map((m) => ({
    skip: false,
    name: (m.name || '').trim(),
    status: (m.status || '').toLowerCase() === 'deceased' ? 'deceased' : 'living',
    relationship_to_subject: (m.relationship_to_subject || '').trim(),
    birth_date: (m.birth_date || '').trim(),
    death_date: (m.death_date || '').trim(),
    notes: [m.notes, m.spouse_of ? `spouse of ${m.spouse_of}` : '']
      .filter(Boolean)
      .join(' · '),
    target: defaultTarget(m),
    directory_person_id: null,
    directory_person_label: '',
    family_link_relationship: guessFamilyLinkEnum(m.relationship_to_subject),
  }));
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

  // Re-seed when the underlying import switches (e.g. user opened the
  // "Edit import" flow and we passed a different importRow in).
  useEffect(() => {
    setSubjectDraft({
      name: importRow?.raw_extraction?.subject?.name || '',
      birth_date: importRow?.raw_extraction?.subject?.birth_date || '',
      death_date: importRow?.raw_extraction?.subject?.death_date || '',
      place_of_birth:
        importRow?.raw_extraction?.subject?.place_of_birth || '',
      place_of_death:
        importRow?.raw_extraction?.subject?.place_of_death || '',
      marital_status:
        importRow?.raw_extraction?.subject?.marital_status || '',
      church_affiliation:
        importRow?.raw_extraction?.subject?.church_affiliation || '',
      religion: importRow?.raw_extraction?.subject?.religion || '',
      address: importRow?.raw_extraction?.subject?.address || '',
    });
    setSubjectApplyFlags({});
    setDecisions(decisionsFromExtraction(importRow?.raw_extraction || {}));
    setNotes(importRow?.notes || '');
    setSavedAt(null);
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
  const buildRawExtractionForSave = () => {
    const family = decisions.map((d) => ({
      name: d.name,
      relationship_to_subject: d.relationship_to_subject,
      status: d.status,
      birth_date: d.birth_date || null,
      death_date: d.death_date || null,
      notes: d.notes,
      // Editor-only fields persisted into the extraction so re-open
      // remembers the pastor's per-row decisions:
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
      // 3) Commit.
      const result = await commitImport({
        importId: importRow.id,
        ownerUserId: user.id,
        subjectPersonId: subjectPerson.id,
        decisions,
        subjectUpdates,
      });
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

function ServiceLine({ label, v }) {
  if (!v) return null;
  return (
    <div className="text-xs flex gap-2">
      <span className="text-gray-500 w-24 flex-shrink-0">{label}:</span>
      <span className="text-gray-800">{v}</span>
    </div>
  );
}
