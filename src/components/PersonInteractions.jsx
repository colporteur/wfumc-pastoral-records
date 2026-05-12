import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  INTERACTION_TYPES,
  createInteraction,
  deleteInteraction,
  interactionTypeLabel,
  listInteractions,
  updateInteraction,
} from '../lib/interactions';
import { promoteToCoreIssue } from '../lib/coreIssues';

const BLANK_FORM = {
  interaction_type: 'pastoral_conversation',
  happened_at: new Date().toISOString().slice(0, 16), // local-ish ISO for datetime-local input
  duration_minutes: '',
  location: '',
  summary: '',
  body: '',
};

// Convert "YYYY-MM-DDTHH:mm" datetime-local string back to ISO with TZ.
function localToIso(local) {
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Convert ISO timestamp → "YYYY-MM-DDTHH:mm" for datetime-local input.
function isoToLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // Local time string with no timezone suffix.
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    'T' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}

export default function PersonInteractions({ personId, onChanged }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
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
      const rows = await listInteractions(personId);
      setItems(rows);
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

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => i.interaction_type === filter);
  }, [items, filter]);

  const handleAdd = async () => {
    if (!user?.id) return;
    setBusy(true);
    setError(null);
    try {
      await createInteraction({
        ownerUserId: user.id,
        personId,
        patch: {
          ...addForm,
          happened_at: localToIso(addForm.happened_at),
        },
      });
      setAddForm({ ...BLANK_FORM, happened_at: isoToLocal(new Date().toISOString()) });
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
      interaction_type: item.interaction_type,
      happened_at: isoToLocal(item.happened_at),
      duration_minutes: item.duration_minutes ?? '',
      location: item.location || '',
      summary: item.summary || '',
      body: item.body || '',
    });
  };

  const saveEdit = async (item) => {
    setBusy(true);
    setError(null);
    try {
      await updateInteraction(item.id, {
        ...editForm,
        happened_at: localToIso(editForm.happened_at),
      });
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm('Delete this interaction log entry?')) return;
    setBusy(true);
    setError(null);
    try {
      await deleteInteraction(item.id);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePromote = async (item) => {
    if (!user?.id) return;
    setBusy(true);
    setError(null);
    try {
      await promoteToCoreIssue({
        ownerUserId: user.id,
        personId,
        source: item,
        sourceType: 'interaction',
      });
      // Notify the parent so the Core Issues section can refresh.
      if (onChanged) onChanged();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const renderForm = (form, setForm) => (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <FieldLabel label="Type">
          <select
            className="input text-sm"
            value={form.interaction_type}
            onChange={(e) =>
              setForm((f) => ({ ...f, interaction_type: e.target.value }))
            }
          >
            {INTERACTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel label="When">
          <input
            type="datetime-local"
            className="input text-sm"
            value={form.happened_at}
            onChange={(e) =>
              setForm((f) => ({ ...f, happened_at: e.target.value }))
            }
          />
        </FieldLabel>
        <FieldLabel label="Duration (minutes)">
          <input
            type="number"
            min="0"
            className="input text-sm"
            value={form.duration_minutes}
            onChange={(e) =>
              setForm((f) => ({ ...f, duration_minutes: e.target.value }))
            }
            placeholder="optional"
          />
        </FieldLabel>
        <FieldLabel label="Location">
          <input
            type="text"
            className="input text-sm"
            value={form.location}
            onChange={(e) =>
              setForm((f) => ({ ...f, location: e.target.value }))
            }
            placeholder="optional"
          />
        </FieldLabel>
      </div>
      <FieldLabel label="Summary">
        <input
          type="text"
          className="input text-sm"
          value={form.summary}
          onChange={(e) =>
            setForm((f) => ({ ...f, summary: e.target.value }))
          }
          placeholder="One-liner shown in the list view"
        />
      </FieldLabel>
      <FieldLabel label="Notes / narrative">
        <textarea
          className="input text-sm min-h-[100px]"
          value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          placeholder="The longer story of what was discussed."
        />
      </FieldLabel>
    </div>
  );

  return (
    <>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
        >
          <option value="all">All types</option>
          {INTERACTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setAddForm({
                ...BLANK_FORM,
                happened_at: isoToLocal(new Date().toISOString()),
              });
              setAdding(true);
            }}
            className="btn-secondary text-xs"
          >
            + Log interaction
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
          {renderForm(addForm, setAddForm)}
          <div className="flex justify-end gap-2 pt-1">
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
              {busy ? 'Saving…' : 'Add interaction'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 italic">Loading interactions…</p>
      ) : filtered.length === 0 && !adding ? (
        <p className="text-xs text-gray-500 italic">
          {filter === 'all'
            ? 'No interactions logged yet.'
            : 'No interactions of this type.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {filtered.map((it) => {
            const isEditing = editingId === it.id;
            return (
              <li key={it.id} className="py-3">
                {isEditing ? (
                  <div className="space-y-2">
                    {renderForm(editForm, setEditForm)}
                    <div className="flex justify-end gap-2">
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
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <div className="text-xs text-gray-500">
                        <span className="font-medium text-umc-700 uppercase tracking-wide text-[10px]">
                          {interactionTypeLabel(it.interaction_type)}
                        </span>
                        <span className="ml-2">
                          {new Date(it.happened_at).toLocaleString()}
                        </span>
                        {it.duration_minutes ? (
                          <span className="ml-2">· {it.duration_minutes} min</span>
                        ) : null}
                        {it.location ? (
                          <span className="ml-2">· {it.location}</span>
                        ) : null}
                      </div>
                      <div className="flex gap-3 text-xs">
                        <button
                          type="button"
                          onClick={() => handlePromote(it)}
                          className="text-umc-700 hover:text-umc-900 underline"
                          title="Create a core pastoral issue from this interaction"
                          disabled={busy}
                        >
                          → Core issue
                        </button>
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
                    {it.summary && (
                      <p className="text-sm text-gray-900">{it.summary}</p>
                    )}
                    {it.body && (
                      <p className="text-xs text-gray-700 whitespace-pre-wrap">
                        {it.body}
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
}

function FieldLabel({ label, children }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wide text-gray-500 block mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
