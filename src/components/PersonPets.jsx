import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  createPet,
  deletePet,
  listPets,
  updatePet,
} from '../lib/pets';

const BLANK_FORM = {
  name: '',
  species: '',
  status: 'living',
  date_of_death: '',
  notes: '',
};

export default function PersonPets({ personId }) {
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
      setItems(await listPets(personId));
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
      setError("Pet's name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createPet({
        ownerUserId: user.id,
        personId,
        patch: {
          ...addForm,
          // If marked deceased but no date provided, leave null —
          // pastor can fill in later.
          date_of_death:
            addForm.status === 'deceased' ? addForm.date_of_death : null,
        },
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
      species: it.species || '',
      status: it.status || 'living',
      date_of_death: it.date_of_death || '',
      notes: it.notes || '',
    });
  };

  const saveEdit = async (it) => {
    setBusy(true);
    setError(null);
    try {
      await updatePet(it.id, {
        ...editForm,
        date_of_death:
          editForm.status === 'deceased' ? editForm.date_of_death : null,
      });
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (it) => {
    if (!window.confirm(`Remove ${it.name}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deletePet(it.id);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const renderForm = (form, setForm) => (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <FieldLabel label="Name *">
          <input
            type="text"
            className="input text-sm"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </FieldLabel>
        <FieldLabel label="Species">
          <input
            type="text"
            className="input text-sm"
            value={form.species}
            onChange={(e) =>
              setForm((f) => ({ ...f, species: e.target.value }))
            }
            placeholder="dog, cat, parakeet…"
          />
        </FieldLabel>
        <FieldLabel label="Status">
          <select
            className="input text-sm"
            value={form.status}
            onChange={(e) =>
              setForm((f) => ({ ...f, status: e.target.value }))
            }
          >
            <option value="living">Living</option>
            <option value="deceased">Deceased</option>
          </select>
        </FieldLabel>
      </div>
      {form.status === 'deceased' && (
        <FieldLabel label="Date of death">
          <input
            type="date"
            className="input text-sm max-w-xs"
            value={form.date_of_death}
            onChange={(e) =>
              setForm((f) => ({ ...f, date_of_death: e.target.value }))
            }
          />
        </FieldLabel>
      )}
      <FieldLabel label="Notes">
        <textarea
          className="input text-sm min-h-[60px]"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder="Anything worth remembering."
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
            + Add pet
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
              {busy ? 'Saving…' : 'Add pet'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 italic">Loading pets…</p>
      ) : items.length === 0 && !adding ? (
        <p className="text-xs text-gray-500 italic">No pets recorded.</p>
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
                        {it.species && (
                          <span className="ml-2 text-xs text-gray-500">
                            ({it.species})
                          </span>
                        )}
                        {it.status === 'deceased' && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-500 italic">
                            deceased
                            {it.date_of_death &&
                              ` ${new Date(it.date_of_death).toLocaleDateString()}`}
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
