import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  createExtendedFamily,
  deleteExtendedFamily,
  listExtendedFamily,
  updateExtendedFamily,
} from '../lib/extendedFamily';

// Extended-family child records: relatives who AREN'T in the pastoral
// directory themselves. (Family who ARE in the directory go in
// PersonFamilyLinks above.)

const BLANK_FORM = {
  name: '',
  relationship: '',
  location: '',
  gender: '',
  age: '',
  visit_history: '',
  notes: '',
};

export default function PersonExtendedFamily({ personId }) {
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
      const rows = await listExtendedFamily(personId);
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
    if (!addForm.name.trim()) {
      setError('Name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createExtendedFamily({
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

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditForm({
      name: item.name || '',
      relationship: item.relationship || '',
      location: item.location || '',
      gender: item.gender || '',
      age: item.age || '',
      visit_history: item.visit_history || '',
      notes: item.notes || '',
    });
  };

  const saveEdit = async (item) => {
    setBusy(true);
    setError(null);
    try {
      await updateExtendedFamily(item.id, editForm);
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Remove ${item.name} from extended family?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteExtendedFamily(item.id);
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
        <Field label="Name *">
          <input
            type="text"
            className="input text-sm"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>
        <Field label="Relationship">
          <input
            type="text"
            className="input text-sm"
            value={form.relationship}
            onChange={(e) =>
              setForm((f) => ({ ...f, relationship: e.target.value }))
            }
            placeholder="e.g. daughter, son-in-law, great-aunt"
          />
        </Field>
        <Field label="Location">
          <input
            type="text"
            className="input text-sm"
            value={form.location}
            onChange={(e) =>
              setForm((f) => ({ ...f, location: e.target.value }))
            }
            placeholder="e.g. Birmingham, AL"
          />
        </Field>
        <Field label="Gender">
          <input
            type="text"
            className="input text-sm"
            value={form.gender}
            onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
          />
        </Field>
        <Field label="Age">
          <input
            type="text"
            className="input text-sm"
            value={form.age}
            onChange={(e) => setForm((f) => ({ ...f, age: e.target.value }))}
            placeholder="e.g. 47, early 60s, infant"
          />
        </Field>
      </div>
      <Field label="Visit history">
        <textarea
          className="input text-sm min-h-[60px]"
          value={form.visit_history}
          onChange={(e) =>
            setForm((f) => ({ ...f, visit_history: e.target.value }))
          }
          placeholder="Running log of when / how you've connected with this person."
        />
      </Field>
      <Field label="Notes">
        <textarea
          className="input text-sm min-h-[60px]"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder="Anything else worth remembering."
        />
      </Field>
    </div>
  );

  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="font-serif text-lg text-umc-900">
          Extended family (not in directory)
        </h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn-secondary text-xs"
          >
            + Add relative
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
              {busy ? 'Saving…' : 'Add relative'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 italic">
          Loading extended family…
        </p>
      ) : items.length === 0 && !adding ? (
        <p className="text-xs text-gray-500 italic">
          No extended-family records yet.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {items.map((it) => {
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
                      <div className="text-sm font-medium text-gray-900">
                        {it.name}
                        {it.relationship && (
                          <span className="ml-2 text-xs text-gray-500 italic font-normal">
                            ({it.relationship})
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
                    <div className="text-xs text-gray-600 flex flex-wrap gap-x-3">
                      {it.location && <span>{it.location}</span>}
                      {it.gender && <span>{it.gender}</span>}
                      {it.age && <span>age {it.age}</span>}
                    </div>
                    {it.visit_history && (
                      <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap">
                        <span className="font-semibold">Visits:</span>{' '}
                        {it.visit_history}
                      </p>
                    )}
                    {it.notes && (
                      <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap">
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
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wide text-gray-500 block mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
