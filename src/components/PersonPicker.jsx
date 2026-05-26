import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { createPerson, listPeople, fullName, shortName } from '../lib/people';

// Reusable typeahead for picking another pastoral_people record. Used
// by the family-links editor to search the directory for the person
// you want to link to. Results exclude any IDs in `excludeIds` (so
// you can't link a person to themselves or re-link an existing pair).

export default function PersonPicker({
  value,
  onChange,
  excludeIds = [],
  placeholder = 'Search by name…',
  disabled = false,
}) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  // Inline "Create new" form state. When `creatingMode` is true, the
  // dropdown swaps results for a one-field create form. On submit we
  // insert a minimal pastoral_people row (first_name + optional
  // last_name) and treat it as the picked person, no detail-page
  // round-trip required.
  const [creatingMode, setCreatingMode] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Stable string key from excludeIds so the effect doesn't loop on
  // every render (a fresh array reference would re-trigger).
  const excludeKey = useMemo(
    () => Array.from(new Set(excludeIds)).sort().join('|'),
    [excludeIds]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await listPeople({
          search,
          includeDeceased: true,
        });
        if (cancelled) return;
        const exclude = new Set(excludeKey ? excludeKey.split('|') : []);
        const filtered = rows.filter((r) => !exclude.has(r.id)).slice(0, 25);
        setResults(filtered);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search, open, excludeKey]);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const handlePick = (p) => {
    onChange?.(p);
    setSearch('');
    setOpen(false);
    setCreatingMode(false);
    setNewName('');
  };

  // Split "John Smith" → {first_name: "John", last_name: "Smith"};
  // single-word names go in first_name. The pastor can fix multi-word
  // last names ("Van Allen") on the detail page afterward.
  const handleCreate = async () => {
    if (!user?.id) {
      setError('Not signed in.');
      return;
    }
    const trimmed = newName.trim();
    if (!trimmed) {
      setError('Enter a name first.');
      return;
    }
    const parts = trimmed.split(/\s+/);
    const patch = { first_name: '' };
    if (parts.length === 1) {
      patch.first_name = parts[0];
    } else {
      patch.last_name = parts[parts.length - 1];
      patch.first_name = parts.slice(0, -1).join(' ');
    }
    setCreating(true);
    setError(null);
    try {
      const created = await createPerson({
        ownerUserId: user.id,
        patch,
      });
      handlePick(created);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setCreating(false);
    }
  };

  const enterCreateMode = () => {
    // Pre-fill the create form with whatever the pastor was typing —
    // saves them re-typing if they searched, found nothing, and decided
    // to add this exact name.
    setNewName(search.trim());
    setCreatingMode(true);
  };

  return (
    <div ref={containerRef} className="relative">
      {value ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded px-2 py-1.5 truncate">
            {fullName(value)}
          </span>
          <button
            type="button"
            onClick={() => onChange?.(null)}
            disabled={disabled}
            className="text-xs text-gray-500 hover:text-gray-800 underline disabled:opacity-40"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            disabled={disabled}
            placeholder={placeholder}
            className="input"
          />
          {open && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-72 overflow-y-auto">
              {creatingMode ? (
                <div className="p-2 space-y-2">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 px-1">
                    Create new directory entry
                  </p>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreate();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setCreatingMode(false);
                      }
                    }}
                    placeholder="Full name (e.g. Mary Ann Lanier)"
                    className="input text-sm"
                    autoFocus
                    disabled={creating}
                  />
                  <p className="text-[10px] text-gray-500 px-1">
                    Just the name is saved now. Fill in phone, address,
                    family, etc. on their PersonDetail page later.
                  </p>
                  {error && (
                    <p className="text-xs text-red-600 px-1">{error}</p>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingMode(false);
                        setError(null);
                      }}
                      disabled={creating}
                      className="text-xs text-gray-500 hover:text-gray-800 underline disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreate}
                      disabled={creating || !newName.trim()}
                      className="btn-primary text-xs disabled:opacity-50"
                    >
                      {creating ? 'Creating…' : 'Create + pick'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {loading && (
                    <p className="text-xs text-gray-500 italic px-3 py-2">
                      Searching…
                    </p>
                  )}
                  {error && (
                    <p className="text-xs text-red-600 px-3 py-2">{error}</p>
                  )}
                  {!loading && !error && results.length === 0 && (
                    <p className="text-xs text-gray-500 italic px-3 py-2">
                      {search.trim()
                        ? 'No matches.'
                        : 'Type to search the directory.'}
                    </p>
                  )}
                  {results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => handlePick(r)}
                      className="block w-full text-left px-3 py-1.5 text-sm hover:bg-umc-50"
                    >
                      <span className="font-medium">{shortName(r)}</span>
                      {r.email && (
                        <span className="ml-2 text-xs text-gray-500">
                          {r.email}
                        </span>
                      )}
                      {r.is_deceased && (
                        <span className="ml-2 text-xs italic text-gray-400">
                          (deceased)
                        </span>
                      )}
                    </button>
                  ))}
                  {/* "+ Create new" lives at the bottom of every results
                      panel — even when there ARE matches, in case the
                      pastor knows the existing matches aren't the same
                      person they have in mind. */}
                  <button
                    type="button"
                    onClick={enterCreateMode}
                    className="block w-full text-left px-3 py-1.5 text-sm text-umc-700 hover:bg-umc-50 border-t border-gray-100"
                  >
                    + Create new{search.trim() ? `: "${search.trim()}"` : ' directory entry'}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
