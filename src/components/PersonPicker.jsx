import { useEffect, useMemo, useRef, useState } from 'react';
import { listPeople, fullName, shortName } from '../lib/people';

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
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

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
            </div>
          )}
        </>
      )}
    </div>
  );
}
