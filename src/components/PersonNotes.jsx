import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  createNote,
  deleteNote,
  listNotes,
  updateNote,
} from '../lib/notesLog';
import { promoteToCoreIssue } from '../lib/coreIssues';

// Running pastoral note log per person. Distinct from the per-person
// `notes` field on pastoral_people — that's one bag of text, this is
// a dated stream.

export default function PersonNotes({ personId, onChanged }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listNotes(personId);
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

  const handleAdd = async () => {
    if (!user?.id) return;
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createNote({
        ownerUserId: user.id,
        personId,
        patch: { body: draft },
      });
      setDraft('');
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditDraft(item.body || '');
  };

  const saveEdit = async (item) => {
    if (!editDraft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await updateNote(item.id, { body: editDraft });
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm('Delete this note?')) return;
    setBusy(true);
    setError(null);
    try {
      await deleteNote(item.id);
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
        sourceType: 'note',
      });
      if (onChanged) onChanged();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div>
        <textarea
          className="input text-sm min-h-[60px]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Quick pastoral note. Press the button to add it to the dated log."
        />
        <div className="flex justify-end mt-1">
          <button
            type="button"
            onClick={handleAdd}
            disabled={busy || !draft.trim()}
            className="btn-primary text-xs disabled:opacity-50"
          >
            {busy ? 'Adding…' : '+ Add note'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 italic">Loading notes…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-500 italic">No notes in the log yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {items.map((it) => {
            const isEditing = editingId === it.id;
            return (
              <li key={it.id} className="py-2">
                {isEditing ? (
                  <div className="space-y-1">
                    <textarea
                      className="input text-sm min-h-[60px]"
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                    />
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
                        disabled={busy || !editDraft.trim()}
                        className="text-xs text-umc-700 hover:text-umc-900 underline"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <div className="text-[10px] text-gray-500">
                        {new Date(it.noted_at).toLocaleString()}
                      </div>
                      <div className="flex gap-3 text-xs">
                        <button
                          type="button"
                          onClick={() => handlePromote(it)}
                          className="text-umc-700 hover:text-umc-900 underline"
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
                    <p className="text-sm text-gray-800 whitespace-pre-wrap mt-0.5">
                      {it.body}
                    </p>
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
