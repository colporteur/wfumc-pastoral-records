import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  commitExtensions,
  gatherFamilyOf,
  proposeExtensionsFromAnchor,
} from '../lib/familyExtraction';
import { fullName } from '../lib/people';
import { relationshipLabel } from '../lib/familyLinks';

// "✨ Extract relatives from linked family" modal.
//
// Step 1 (pick): show the subject's currently-linked directory family
//   members as a checklist. Pastor picks which anchors to extract from
//   (typically one — "extract Sidney's family"; sometimes more).
//
// Step 2 (run): we walk each anchor's family graph and call
//   inferRelativeToRelative for each relative. While that's happening,
//   we tick a per-anchor progress counter so the pastor can see motion.
//
// Step 3 (review): proposals grouped by source anchor + by target
//   table. Each row has an editable name, relationship label, dropdown
//   to switch target table, confidence badge, rationale tooltip, and
//   an approve checkbox (pre-checked for high-confidence inferences,
//   unchecked for medium/low so the pastor explicitly OKs them).
//
// Step 4 (commit): writes the approved rows via commitExtensions and
//   reports the count.
//
// On any step, the pastor can close the modal — no rows are written
// until the explicit commit.

const TARGET_OPTIONS = [
  { value: 'directory_link', label: 'Directory link' },
  { value: 'extended_family', label: 'Extended family (not in directory)' },
  { value: 'significant_death', label: 'Significant death' },
];

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

export default function ExtractFromFamilyModal({
  open,
  onClose,
  subjectPerson,
  onCommitted,
}) {
  const { user } = useAuth();

  // 'pick' | 'running' | 'review' | 'committing'
  const [step, setStep] = useState('pick');
  const [error, setError] = useState(null);

  // Step 1 state.
  const [linkedFamily, setLinkedFamily] = useState([]);
  const [loadingFamily, setLoadingFamily] = useState(false);
  const [pickedAnchorIds, setPickedAnchorIds] = useState(() => new Set());

  // Step 2 state.
  const [progressMsg, setProgressMsg] = useState('');

  // Step 3 state — array of proposal rows (each with _approved, name,
  // relationship_to_subject, family_link_relationship, kind, etc.).
  const [proposals, setProposals] = useState([]);

  // Reset every time the modal opens with a fresh subject.
  useEffect(() => {
    if (!open) return;
    setStep('pick');
    setError(null);
    setProposals([]);
    setPickedAnchorIds(new Set());
    setProgressMsg('');
    if (!subjectPerson?.id) {
      setLinkedFamily([]);
      return;
    }
    setLoadingFamily(true);
    (async () => {
      try {
        const graph = await gatherFamilyOf(subjectPerson.id);
        setLinkedFamily(
          graph.familyLinks.filter((l) => l.other_person)
        );
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoadingFamily(false);
      }
    })();
  }, [open, subjectPerson?.id]);

  if (!open) return null;

  const toggleAnchor = (id) => {
    setPickedAnchorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Step 1 → 2 → 3
  const runExtraction = async () => {
    if (pickedAnchorIds.size === 0) {
      setError('Pick at least one linked family member to extract from.');
      return;
    }
    setStep('running');
    setError(null);
    const all = [];
    let i = 0;
    for (const anchorId of pickedAnchorIds) {
      i++;
      const anchorLink = linkedFamily.find(
        (l) => l.other_person_id === anchorId
      );
      const label = anchorLink?.other_person
        ? fullName(anchorLink.other_person)
        : '(anchor)';
      setProgressMsg(
        `Asking Claude to infer relationships via ${label} (${i} of ${pickedAnchorIds.size})…`
      );
      try {
        const { proposals: batch } = await proposeExtensionsFromAnchor({
          subjectPerson,
          anchorPersonId: anchorId,
          ownerUserId: user.id,
        });
        all.push(...batch);
      } catch (e) {
        // Keep going; one bad anchor shouldn't poison the rest.
        // Stash the error so the review panel can show it.
        all.push({
          kind: 'error',
          name: label,
          message: e.message || String(e),
        });
      }
    }
    setProposals(all);
    setStep('review');
    setProgressMsg('');
    if (all.filter((p) => p.kind !== 'error').length === 0) {
      setError(
        'No new relatives to propose. Either the linked family graph is empty, or every relative is already in this person\'s record.'
      );
    }
  };

  const updateProposal = (idx, patch) => {
    setProposals((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, ...patch } : p))
    );
  };
  const toggleProposal = (idx) => {
    setProposals((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, _approved: !p._approved } : p))
    );
  };

  const handleCommit = async () => {
    const approved = proposals.filter(
      (p) => p && p.kind !== 'error' && p._approved
    );
    if (approved.length === 0) {
      setError('Approve at least one row first.');
      return;
    }
    setStep('committing');
    setError(null);
    try {
      const result = await commitExtensions({
        subjectPersonId: subjectPerson.id,
        ownerUserId: user.id,
        proposals,
      });
      onCommitted?.(result);
      onClose();
    } catch (e) {
      // commitExtensions throws a partial error when some rows fail.
      // Show the summary and stay in the modal so the pastor can fix.
      setError(e.message || String(e));
      if (e?.counts) {
        // Report what DID land — the parent can re-fetch.
        onCommitted?.({ counts: e.counts, partial: true });
      }
      setStep('review');
    }
  };

  // ---- Render ------------------------------------------------------

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-3 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full my-4 p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl text-umc-900">
              ✨ Extract relatives from linked family
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Subject: <strong>{fullName(subjectPerson)}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={step === 'running' || step === 'committing'}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none disabled:opacity-30"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <pre className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 whitespace-pre-wrap">
            {error}
          </pre>
        )}

        {/* Step 1: pick anchor(s) */}
        {step === 'pick' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Pick one or more directory-linked family members to extract
              from. We'll ask Claude to figure out how each of their
              relatives relates to {fullName(subjectPerson)} (e.g., your
              father's brother becomes your uncle).
            </p>
            {loadingFamily ? (
              <p className="text-sm italic text-gray-500">
                Loading linked family…
              </p>
            ) : linkedFamily.length === 0 ? (
              <p className="text-sm italic text-gray-500">
                {fullName(subjectPerson)} has no directory-linked family
                yet. Add a family link first (use "+ Add family link"
                in the Family section above), then re-run extraction.
              </p>
            ) : (
              <ul className="space-y-1">
                {linkedFamily.map((l) => {
                  const p = l.other_person;
                  if (!p) return null;
                  const checked = pickedAnchorIds.has(p.id);
                  return (
                    <li key={l.id}>
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAnchor(p.id)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <span className="font-medium text-gray-900">
                          {fullName(p)}
                        </span>
                        <span className="text-xs text-gray-500">
                          (your{' '}
                          {relationshipLabel(l.displayed_relationship)
                            .toLowerCase()}
                          )
                        </span>
                        {p.is_deceased && (
                          <span className="text-[10px] text-gray-400 italic">
                            (deceased)
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runExtraction}
                disabled={pickedAnchorIds.size === 0}
                className="btn-primary text-sm disabled:opacity-50"
              >
                ✨ Extract from {pickedAnchorIds.size}{' '}
                {pickedAnchorIds.size === 1 ? 'anchor' : 'anchors'}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: running */}
        {step === 'running' && (
          <div className="py-6 text-sm text-gray-600 italic flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            {progressMsg || 'Working…'}
          </div>
        )}

        {/* Step 3: review */}
        {step === 'review' && (
          <ReviewPanel
            proposals={proposals}
            onToggle={toggleProposal}
            onUpdate={updateProposal}
            onCommit={handleCommit}
            onBack={() => setStep('pick')}
          />
        )}

        {/* Step 4: committing */}
        {step === 'committing' && (
          <div className="py-6 text-sm text-gray-600 italic flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            Writing approved rows…
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// Review panel + row
// =====================================================================

function ReviewPanel({ proposals, onToggle, onUpdate, onCommit, onBack }) {
  const validProposals = useMemo(
    () => proposals.filter((p) => p && p.kind !== 'error'),
    [proposals]
  );
  const errorProposals = useMemo(
    () => proposals.filter((p) => p && p.kind === 'error'),
    [proposals]
  );
  const approvedCount = validProposals.filter((p) => p._approved).length;

  // Group by source anchor for readability.
  const groups = useMemo(() => {
    const map = new Map();
    proposals.forEach((p, idx) => {
      if (!p || p.kind === 'error') return;
      const key = p.source_anchor_id || 'unknown';
      if (!map.has(key)) {
        map.set(key, {
          anchorLabel: p.source_anchor_label || '(anchor)',
          rows: [],
        });
      }
      map.get(key).rows.push({ p, idx });
    });
    return Array.from(map.values());
  }, [proposals]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700">
        {validProposals.length === 0
          ? 'No proposals to review.'
          : `${approvedCount} of ${validProposals.length} proposed row${
              validProposals.length === 1 ? '' : 's'
            } approved. High-confidence inferences are pre-checked; medium / low start unchecked.`}
      </p>

      {errorProposals.length > 0 && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          {errorProposals.length} anchor{errorProposals.length === 1 ? '' : 's'}{' '}
          failed to extract:
          <ul className="list-disc list-inside mt-1">
            {errorProposals.map((p, i) => (
              <li key={i}>
                {p.name}: {p.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.map((g) => (
        <fieldset key={g.anchorLabel} className="border border-gray-200 rounded p-3 space-y-2">
          <legend className="px-1 text-xs uppercase tracking-wide text-gray-500">
            via {g.anchorLabel} ({g.rows.length})
          </legend>
          {g.rows.map(({ p, idx }) => (
            <ProposalRow
              key={idx}
              proposal={p}
              onToggle={() => onToggle(idx)}
              onUpdate={(patch) => onUpdate(idx, patch)}
            />
          ))}
        </fieldset>
      ))}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onBack}
          className="btn-secondary text-sm"
        >
          ← Back to anchor picker
        </button>
        <button
          type="button"
          onClick={onCommit}
          disabled={approvedCount === 0}
          className="btn-primary text-sm disabled:opacity-50"
        >
          ✓ Commit {approvedCount} row{approvedCount === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}

function ProposalRow({ proposal, onToggle, onUpdate }) {
  const confidenceColor =
    proposal._confidence === 'high'
      ? 'text-green-700'
      : proposal._confidence === 'low'
        ? 'text-amber-700'
        : 'text-gray-600';
  return (
    <div
      className={
        'rounded border p-2.5 space-y-2 ' +
        (proposal._approved
          ? 'border-umc-200 bg-umc-50/40'
          : 'border-gray-200 bg-white')
      }
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={!!proposal._approved}
          onChange={onToggle}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap text-sm">
            <span className="font-medium text-gray-900">{proposal.name}</span>
            <span className="text-gray-500 text-xs">
              proposed as your {proposal.relationship_to_subject}
            </span>
            <span className={'text-[10px] ' + confidenceColor}>
              {proposal._confidence} confidence
            </span>
            {proposal.status === 'deceased' && (
              <span className="text-[10px] text-gray-500 italic">
                (deceased)
              </span>
            )}
          </div>
          {proposal._rationale && (
            <p className="text-[11px] italic text-gray-500 mt-0.5">
              {proposal._rationale}
            </p>
          )}
          <p className="text-[11px] text-gray-400 mt-0.5">
            {proposal.source_breadcrumb}
          </p>
        </div>
      </div>
      {/* Editable bits — collapsed unless approved, to keep the visual
          weight low for unchecked rows. */}
      {proposal._approved && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-6">
          <label className="block text-xs">
            <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
              Name
            </span>
            <input
              type="text"
              value={proposal.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              className="input w-full text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
              Relationship (free text)
            </span>
            <input
              type="text"
              value={proposal.relationship_to_subject}
              onChange={(e) =>
                onUpdate({ relationship_to_subject: e.target.value })
              }
              className="input w-full text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
              Target
            </span>
            <select
              value={proposal.kind}
              onChange={(e) => onUpdate({ kind: e.target.value })}
              className="input w-full text-sm"
            >
              {TARGET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {proposal.kind === 'directory_link' && (
            <label className="block text-xs">
              <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                Family-link relationship (enum)
              </span>
              <select
                value={proposal.family_link_relationship || 'other'}
                onChange={(e) =>
                  onUpdate({ family_link_relationship: e.target.value })
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
          )}
          {proposal.kind === 'significant_death' && (
            <label className="block text-xs">
              <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                Date of death
              </span>
              <input
                type="text"
                value={proposal.date_of_death || ''}
                onChange={(e) =>
                  onUpdate({ date_of_death: e.target.value })
                }
                placeholder="YYYY-MM-DD"
                className="input w-full text-sm"
              />
            </label>
          )}
          {proposal.kind === 'extended_family' && (
            <label className="block text-xs">
              <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                Location
              </span>
              <input
                type="text"
                value={proposal.location || ''}
                onChange={(e) => onUpdate({ location: e.target.value })}
                className="input w-full text-sm"
              />
            </label>
          )}
          <label className="block text-xs sm:col-span-2">
            <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
              Notes
            </span>
            <input
              type="text"
              value={proposal.notes || ''}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              className="input w-full text-sm"
            />
          </label>
        </div>
      )}
    </div>
  );
}
