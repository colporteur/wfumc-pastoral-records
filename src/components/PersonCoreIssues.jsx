import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  CORE_ISSUE_STATUSES,
  createCoreIssue,
  deleteCoreIssue,
  listCoreIssues,
  statusColor,
  statusLabel,
  updateCoreIssue,
} from '../lib/coreIssues';

// Core pastoral issues for a person. Surfaces a status lifecycle
// (open → monitoring → resolved) plus a breadcrumb back to whatever
// interaction / transcript / note promoted the issue.
//
// Forwards a `refresh` imperative handle so the parent can re-fetch
// after a sibling component (interactions / transcripts / notes)
// promotes a new issue.

const BLANK_FORM = { title: '', description: '', status: 'open' };

const SOURCE_LABEL = {
  interaction: 'from interaction',
  transcript: 'from transcript',
  note: 'from note',
  manual: null,
};

function statusBadgeClasses(color) {
  return (
    {
      red: 'bg-red-100 text-red-800 border-red-200',
      amber: 'bg-amber-100 text-amber-800 border-amber-200',
      green: 'bg-green-100 text-green-800 border-green-200',
      gray: 'bg-gray-100 text-gray-800 border-gray-200',
    }[color] || 'bg-gray-100 text-gray-800 border-gray-200'
  );
}

const PersonCoreIssues = forwardRef(function PersonCoreIssues(
  { personId, onCountChange },
  ref
) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState(BLANK_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(BLANK_FORM);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listCoreIssues(personId);
      setItems(rows);
      if (onCountChange) {
        onCountChange({
          total: rows.length,
          open: rows.filter((r) => r.status === 'open').length,
        });
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useImperativeHandle(ref, () => ({ refresh }), [personId]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId]);

  const handleAdd = async () => {
    if (!user?.id) return;
    if (!addForm.title.trim()) {
      setError('Title is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createCoreIssue({
        ownerUserId: user.id,
        personId,
        patch: { ...addForm, source_type: 'manual' },
      });
      setAddForm(BLANK_FORM);
      setAdding(false);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditForm({
      title: item.title || '',
      description: item.description || '',
      status: item.status || 'open',
    });
  };

  const saveEdit = async (item) => {
    setBusy(true);
    setError(null);
    try {
      await updateCoreIssue(item.id, editForm);
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleStatusChange = async (item, status) => {
    setBusy(true);
    setError(null);
    try {
      await updateCoreIssue(item.id, { status });
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (item) => {
    if (
      !window.confirm(
        `Delete "${item.title}"? The breadcrumb back to the source ` +
          `(interaction / transcript / note) is also lost.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await deleteCoreIssue(item.id);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex justify-end">
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn-secondary text-xs"
          >
            + Add core issue
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}

      {adding && (
        <div className="rounded border border-umc-200 bg-umc-50/40 p-3 space-y-2">
          <input
            type="text"
            className="input text-sm"
            value={addForm.title}
            onChange={(e) =>
              setAddForm((f) => ({ ...f, title: e.target.value }))
            }
            placeholder="Issue title (e.g. 'Wife's recent diagnosis', 'Job loss')"
          />
          <textarea
            className="input text-sm min-h-[80px]"
            value={addForm.description}
            onChange={(e) =>
              setAddForm((f) => ({ ...f, description: e.target.value }))
            }
            placeholder="Optional context."
          />
          <div className="flex items-center justify-between">
            <select
              value={addForm.status}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, status: e.target.value }))
              }
              className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
            >
              {CORE_ISSUE_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setError(null);
                }}
                disabled={busy}
                className="btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={busy}
                className="btn-primary text-xs disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Add issue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 italic">Loading core issues…</p>
      ) : items.length === 0 && !adding ? (
        <p className="text-xs text-gray-500 italic">
          No core pastoral issues yet. Use the "→ Core issue" button on
          any interaction, transcript, or note above to promote one.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {items.map((it) => {
            const isEditing = editingId === it.id;
            const sourceLabel = SOURCE_LABEL[it.source_type];
            const color = statusColor(it.status);
            return (
              <li key={it.id} className="py-3">
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      className="input text-sm"
                      value={editForm.title}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, title: e.target.value }))
                      }
                    />
                    <textarea
                      className="input text-sm min-h-[80px]"
                      value={editForm.description}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          description: e.target.value,
                        }))
                      }
                    />
                    <div className="flex items-center justify-between">
                      <select
                        value={editForm.status}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, status: e.target.value }))
                        }
                        className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
                      >
                        {CORE_ISSUE_STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          disabled={busy}
                          className="text-xs text-gray-500 hover:text-gray-800 underline"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEdit(it)}
                          disabled={busy}
                          className="text-xs text-umc-700 hover:text-umc-900 underline"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span
                          className={
                            'text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ' +
                            statusBadgeClasses(color)
                          }
                        >
                          {statusLabel(it.status)}
                        </span>
                        <span className="text-sm font-medium text-gray-900">
                          {it.title}
                        </span>
                        {sourceLabel && (
                          <span className="text-[10px] italic text-gray-500">
                            {sourceLabel}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <select
                          value={it.status}
                          onChange={(e) =>
                            handleStatusChange(it, e.target.value)
                          }
                          disabled={busy}
                          className="text-[11px] border border-gray-300 rounded px-1 py-0.5 bg-white"
                          title="Change status"
                        >
                          {CORE_ISSUE_STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => startEdit(it)}
                          className="text-gray-600 hover:text-gray-900 underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(it)}
                          className="text-red-600 hover:text-red-800 underline"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {it.description && (
                      <p className="text-xs text-gray-700 whitespace-pre-wrap mt-1">
                        {it.description}
                      </p>
                    )}
                    {it.resolved_at && (
                      <p className="text-[10px] text-gray-400 italic mt-1">
                        Resolved {new Date(it.resolved_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
});

export default PersonCoreIssues;
