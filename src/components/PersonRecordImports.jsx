import { useEffect, useState } from 'react';
import {
  listImportsForPerson,
  deleteImport,
  clearImportArtifacts,
} from '../lib/recordImports';
import ClergyRecordImportModal from './ClergyRecordImportModal.jsx';
import ObituaryImportModal from './ObituaryImportModal.jsx';

// The PersonDetail "Record imports" section.
//
//   - "✨ Import Clergy Record" button opens the photo-only importer.
//   - "✨ Import Obituary" button opens the URL / text / photo importer.
//   - A list of past imports for this person shows below, with Edit
//     (re-opens the relevant modal with the saved import preloaded)
//     and Delete (also clears the import-stamped child rows from the
//     family/extended/significant-death tables).
//
// When an import is created, edited, or committed by the modal, we
// re-fetch the list so the newest state shows up immediately.

export default function PersonRecordImports({ person, onChanged }) {
  const personId = person?.id;

  const [imports, setImports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [clergyOpen, setClergyOpen] = useState(false);
  const [obitOpen, setObitOpen] = useState(false);
  // When set, the relevant modal opens with this import preloaded for
  // editing (lets the pastor revisit a saved-but-not-committed import,
  // or fix a row on an already-committed one and re-commit).
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const refresh = async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listImportsForPerson(personId);
      setImports(rows);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId]);

  const handleDelete = async (imp) => {
    const stamp = imp.committed_at ? ' (and all family rows it created)' : '';
    if (
      !window.confirm(
        `Delete this ${labelFor(imp.kind)} import${stamp}? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyId(imp.id);
    setError(null);
    try {
      // If the import was committed, also wipe its stamped child rows
      // so we don't orphan family_links / extended_family / death rows.
      let counts = null;
      if (imp.committed_at) {
        counts = await clearImportArtifacts(imp.id);
      }
      await deleteImport(imp.id);
      setToast(
        counts
          ? `Deleted import. Also removed ${counts.family_links} family link${
              counts.family_links === 1 ? '' : 's'
            }, ${counts.extended_family} extended-family entr${
              counts.extended_family === 1 ? 'y' : 'ies'
            }, ${counts.deaths || counts.significant_deaths || 0} significant-death record${
              (counts.significant_deaths ?? 0) === 1 ? '' : 's'
            }.`
          : 'Deleted import.'
      );
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleOpenEdit = (imp) => {
    setEditing(imp);
    if (imp.kind === 'clergy_record') {
      setClergyOpen(true);
    } else {
      setObitOpen(true);
    }
  };

  const handleCommitted = (result) => {
    setToast(
      result.partial
        ? 'Committed with some row errors (see panel above).'
        : `Committed: ${result.counts.links} family link${
            result.counts.links === 1 ? '' : 's'
          }, ${result.counts.extended} extended-family, ${
            result.counts.deaths
          } significant-death.`
    );
    refresh();
    onChanged?.();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setClergyOpen(true);
          }}
          className="btn-secondary text-sm"
          title="Open the Clergy Record importer (photo of the funeral-home form)."
        >
          ✨ Import Clergy Record
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setObitOpen(true);
          }}
          className="btn-secondary text-sm"
          title="Open the Obituary importer (URL, pasted text, or photo)."
        >
          ✨ Import Obituary
        </button>
      </div>

      {toast && (
        <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded px-2 py-1.5">
          {toast}{' '}
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-2 underline text-green-700 hover:text-green-900"
          >
            dismiss
          </button>
        </p>
      )}

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}

      {loading && (
        <p className="text-xs italic text-gray-500">Loading imports…</p>
      )}

      {!loading && imports.length === 0 && (
        <p className="text-xs italic text-gray-500">
          No imports yet. Use the buttons above to pull family + biographical
          data out of a Clergy Record form or an obituary.
        </p>
      )}

      {imports.length > 0 && (
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded">
          {imports.map((imp) => (
            <li key={imp.id} className="px-3 py-2 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-medium text-umc-900">
                    {labelFor(imp.kind)}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-gray-500">
                    {labelForSource(imp.source_kind)}
                  </span>
                  {imp.committed_at ? (
                    <span className="text-[10px] text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                      committed
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                      review pending
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Imported{' '}
                  {new Date(imp.created_at).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                  {imp.committed_at && (
                    <>
                      {' · committed '}
                      {new Date(imp.committed_at).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </>
                  )}
                </p>
                {imp.source_url && (
                  <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                    Source URL: {imp.source_url}
                  </p>
                )}
                {imp.notes && (
                  <p className="text-[11px] italic text-gray-600 mt-0.5">
                    {imp.notes}
                  </p>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleOpenEdit(imp)}
                  disabled={busyId === imp.id}
                  className="text-xs text-gray-600 hover:text-umc-900 underline disabled:opacity-40"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(imp)}
                  disabled={busyId === imp.id}
                  className="text-xs text-red-600 hover:text-red-800 underline disabled:opacity-40"
                >
                  {busyId === imp.id ? '…' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ClergyRecordImportModal
        open={clergyOpen}
        onClose={() => {
          setClergyOpen(false);
          setEditing(null);
          refresh();
        }}
        subjectPerson={person}
        existingImport={editing && editing.kind === 'clergy_record' ? editing : null}
        onCommitted={handleCommitted}
      />
      <ObituaryImportModal
        open={obitOpen}
        onClose={() => {
          setObitOpen(false);
          setEditing(null);
          refresh();
        }}
        subjectPerson={person}
        existingImport={editing && editing.kind === 'obituary' ? editing : null}
        onCommitted={handleCommitted}
      />
    </div>
  );
}

function labelFor(kind) {
  if (kind === 'clergy_record') return 'Clergy Record';
  if (kind === 'obituary') return 'Obituary';
  return kind || 'Import';
}

function labelForSource(sourceKind) {
  if (sourceKind === 'photo') return 'photo';
  if (sourceKind === 'url') return 'url';
  if (sourceKind === 'text') return 'pasted text';
  return sourceKind || '';
}
