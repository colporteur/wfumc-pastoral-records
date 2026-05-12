import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  RELATIONSHIP_OPTIONS,
  createLink,
  deleteLink,
  inverseRelationship,
  listLinksFor,
  relationshipLabel,
  updateLink,
} from '../lib/familyLinks';
import { getPerson, fullName } from '../lib/people';
import PersonPicker from './PersonPicker.jsx';

// Family relationship links between this person and other directory
// entries. Bidirectional: when the pastor sets X as Y's parent here,
// the same link appears on X's record as "child: Y" — same row,
// inverted at display time by the lib.

export default function PersonFamilyLinks({ personId }) {
  const { user } = useAuth();
  const [links, setLinks] = useState([]);
  const [otherPeople, setOtherPeople] = useState({}); // id → person row
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [adding, setAdding] = useState(false);
  const [pickedPerson, setPickedPerson] = useState(null);
  const [pickedRel, setPickedRel] = useState('spouse');
  const [pickedNotes, setPickedNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editRel, setEditRel] = useState('spouse');
  const [editNotes, setEditNotes] = useState('');

  const refresh = async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listLinksFor(personId);
      setLinks(rows);
      // Fetch the names of the other party for each row.
      const otherIds = Array.from(
        new Set(rows.map((r) => r.other_person_id))
      );
      const map = {};
      // Fetch sequentially to keep this dead simple — the typical
      // person has < 10 links.
      for (const id of otherIds) {
        try {
          map[id] = await getPerson(id);
        } catch {
          /* row may have been deleted; just skip */
        }
      }
      setOtherPeople(map);
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

  const excludeIds = useMemo(
    () => [personId, ...links.map((l) => l.other_person_id)],
    [personId, links]
  );

  const handleAdd = async () => {
    if (!user?.id) return;
    if (!pickedPerson) {
      setError('Pick a person first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createLink({
        ownerUserId: user.id,
        fromPersonId: personId,
        toPersonId: pickedPerson.id,
        relationship: pickedRel,
        notes: pickedNotes,
      });
      // Reset add form.
      setPickedPerson(null);
      setPickedRel('spouse');
      setPickedNotes('');
      setAdding(false);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (link) => {
    setEditingId(link.id);
    setEditRel(link.displayed_relationship);
    setEditNotes(link.notes || '');
  };

  const saveEdit = async (link) => {
    setBusy(true);
    setError(null);
    try {
      await updateLink(
        link.id,
        { relationship: editRel, notes: editNotes },
        { viewedFromPersonId: personId }
      );
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (link) => {
    const other = otherPeople[link.other_person_id];
    const name = other ? fullName(other) : 'this person';
    if (
      !window.confirm(
        `Remove the family link to ${name}? The same row is removed from their record too.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await deleteLink(link.id);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!adding && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn-secondary text-xs"
          >
            + Add family link
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}

      {adding && (
        <div className="rounded border border-umc-200 bg-umc-50/40 p-3 space-y-2">
          <p className="text-xs text-gray-600">
            <span className="font-semibold">This person</span> is …
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select
              value={pickedRel}
              onChange={(e) => setPickedRel(e.target.value)}
              className="input text-sm"
            >
              {RELATIONSHIP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-gray-600 italic flex items-center">
              … of:
            </span>
            <PersonPicker
              value={pickedPerson}
              onChange={setPickedPerson}
              excludeIds={excludeIds}
            />
          </div>
          <input
            type="text"
            value={pickedNotes}
            onChange={(e) => setPickedNotes(e.target.value)}
            placeholder="Optional note (e.g., 'estranged for 5 years')"
            className="input text-sm"
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setPickedPerson(null);
                setPickedRel('spouse');
                setPickedNotes('');
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
              disabled={busy || !pickedPerson}
              className="btn-primary text-xs disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Add link'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 italic">Loading family links…</p>
      ) : links.length === 0 && !adding ? (
        <p className="text-xs text-gray-500 italic">
          No family links yet. (Family who aren't in your directory go in
          the "Extended family" section below.)
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {links.map((l) => {
            const other = otherPeople[l.other_person_id];
            const name = other ? fullName(other) : '(missing record)';
            const isEditing = editingId === l.id;
            return (
              <li key={l.id} className="py-2">
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
                      <select
                        value={editRel}
                        onChange={(e) => setEditRel(e.target.value)}
                        className="input text-sm"
                      >
                        {RELATIONSHIP_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-xs text-gray-600 italic">
                        of:
                      </span>
                      <span className="text-sm text-gray-900 truncate">
                        {name}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Optional note"
                      className="input text-sm"
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
                        onClick={() => saveEdit(l)}
                        disabled={busy}
                        className="text-xs text-umc-700 hover:text-umc-900 underline"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <div className="text-sm">
                      <span className="text-gray-500">
                        {relationshipLabel(l.displayed_relationship)} of:
                      </span>{' '}
                      {other ? (
                        <Link
                          to={`/people/${other.id}`}
                          className="text-umc-700 hover:text-umc-900 hover:underline font-medium"
                        >
                          {name}
                        </Link>
                      ) : (
                        <span className="italic text-gray-400">{name}</span>
                      )}
                      {l.notes && (
                        <span className="ml-2 text-xs text-gray-500 italic">
                          — {l.notes}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => startEdit(l)}
                        className="text-gray-600 hover:text-gray-900 underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(l)}
                        className="text-red-600 hover:text-red-800 underline"
                      >
                        Remove
                      </button>
                    </div>
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
