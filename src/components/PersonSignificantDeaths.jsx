import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  createSignificantDeath,
  deleteSignificantDeath,
  listSignificantDeaths,
  updateSignificantDeath,
} from '../lib/significantDeaths';

const BLANK_FORM = {
  name: '',
  relationship: '',
  date_of_death: '',
  notes: '',
};

export default function PersonSignificantDeaths({ personId }) {
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
      setItems(await listSignificantDeaths(personId));
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
    if (!addForm.name.trim()) {
      setError('Name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createSignificantDeath({
        ownerUserId: user.id,
        personId,
        patch: addForm,
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

  const startEdit = (it) => {
    setEditingId(it.id);
    setEditForm({
      name: it.name || '',
      relationship: it.relationship || '',
      date_of_death: it.date_of_death || '',
      notes: it.notes || '',
    });
  };

  const saveEdit = async (it) => {
    setBusy(true);
    setError(null);
    try {
      await updateSignificantDeath(it.id, editForm);
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (it) => {
    if (!window.confirm(`Remove ${it.name} from significant deaths?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSignificantDeath(it.id);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const renderForm = (form, setForm) => (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <FieldLabel label="Name *">
          <input
            type="text"
            className="input text-sm"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </FieldLabel>
        <FieldLabel label="Relationship">
          <input
            type="text"
            className="input text-sm"
            value={form.relationship}
            onChange={(e) =>
              setForm((f) => ({ ...f, relationship: e.target.value }))
            }
            placeholder="Spouse, Mother, Best friend…"
          />
        </FieldLabel>
        <FieldLabel label="Date of death">
          <input
            type="date"
            className="input text-sm"
            value={form.date_of_death}
            onChange={(e) =>
              setForm((f) => ({ ...f, date_of_death: e.target.value }))
            }
          />
        </FieldLabel>
      </div>
      <FieldLabel label="Notes">
        <textarea
          className="input text-sm min-h-[60px]"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder="Anything pastoral worth remembering."
        />
      </FieldLabel>
    </div>
  );

  return (
    <>
      <div className="flex justify-end">
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn-secondary text-xs"
          >
            + Add deceased relationship
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
                setAddForm(BLANK_FORM);
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
              {busy ? 'Saving…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 italic">Loading…</p>
      ) : items.length === 0 && !adding ? (
        <p className="text-xs text-gray-500 italic">
          No significant deceased relationships recorded.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {items.map((it) => {
            const isEditing = editingId === it.id;
            return (
              <li key={it.id} className="py-2">
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
                  <div>
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <div className="text-sm">
                        <span className="font-medium text-gray-900">
                          {it.name}
                        </span>
                        {it.relationship && (
                          <span className="ml-2 text-xs text-gray-500 italic">
                            ({it.relationship})
                          </span>
                        )}
                        {it.date_of_death && (
                          <span className="ml-2 text-xs text-gray-500">
                            died{' '}
                            {new Date(it.date_of_death).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-3 text-xs">
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
                          Remove
                        </button>
                      </div>
                    </div>
                    {it.notes && (
                      <p className="text-xs text-gray-700 whitespace-pre-wrap mt-0.5">
                        {it.notes}
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
