import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { listPeople, fullName } from '../lib/people';
import { fetchMainPhotoUrlsForPeople } from '../lib/photos';

// People list. URL-persisted search + filters so back-navigation
// preserves what the pastor was looking at.

const FILTER_KEYS = [
  { key: 'is_church_member', label: 'Members' },
  { key: 'is_active_visitor', label: 'Active visitors' },
  { key: 'is_extended_family', label: 'Extended family' },
  { key: 'is_non_active_visitor', label: 'Non-active visitors' },
  { key: 'on_christmas_card_list', label: '🎄 Christmas card list' },
  { key: 'is_deceased', label: 'Deceased' },
];

export default function PersonList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') || '';
  const filters = useMemo(() => {
    const out = {};
    for (const { key } of FILTER_KEYS) {
      if (searchParams.get(key) === '1') out[key] = true;
    }
    return out;
  }, [searchParams]);
  const includeDeceased = searchParams.get('include_deceased') === '1';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [people, setPeople] = useState([]);
  const [photoUrls, setPhotoUrls] = useState(new Map());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const rows = await listPeople({
          search,
          filters,
          includeDeceased: includeDeceased || filters.is_deceased,
        });
        if (cancelled) return;
        setPeople(rows);
        // Batch-fetch main-photo signed URLs for the visible page.
        try {
          const urlMap = await fetchMainPhotoUrlsForPeople(
            rows.map((r) => r.id)
          );
          if (!cancelled) setPhotoUrls(urlMap);
        } catch {
          // Non-fatal — list still renders without thumbnails.
          if (!cancelled) setPhotoUrls(new Map());
        }
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search, filters, includeDeceased]);

  const setSearch = (v) => {
    const next = new URLSearchParams(searchParams);
    if (v) next.set('q', v);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  const toggleFilter = (key) => {
    const next = new URLSearchParams(searchParams);
    if (next.get(key) === '1') next.delete(key);
    else next.set(key, '1');
    setSearchParams(next, { replace: true });
  };

  const toggleIncludeDeceased = () => {
    const next = new URLSearchParams(searchParams);
    if (next.get('include_deceased') === '1') next.delete('include_deceased');
    else next.set('include_deceased', '1');
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const hasActiveFilters =
    search || Object.keys(filters).length > 0 || includeDeceased;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="font-serif text-2xl text-umc-900">People</h1>
        <Link to="/people/new" className="btn-primary text-sm">
          + Add person
        </Link>
      </div>

      <div className="card space-y-3">
        <div>
          <label className="label">Search</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or email…"
            className="input"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTER_KEYS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => toggleFilter(f.key)}
              className={
                'text-xs px-2 py-1 rounded border ' +
                (filters[f.key]
                  ? 'bg-umc-100 border-umc-300 text-umc-900'
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50')
              }
            >
              {f.label}
            </button>
          ))}
          <label className="text-xs flex items-center gap-1.5 ml-2 text-gray-600">
            <input
              type="checkbox"
              checked={includeDeceased}
              onChange={toggleIncludeDeceased}
              className="rounded border-gray-300"
            />
            Include deceased in results
          </label>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-gray-500 hover:text-gray-800 underline ml-auto"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <LoadingSpinner label="Loading people…" />
      ) : people.length === 0 ? (
        <div className="card text-center text-sm text-gray-600 space-y-2">
          <p>
            {hasActiveFilters
              ? 'No people match those filters.'
              : 'No pastoral records yet.'}
          </p>
          {!hasActiveFilters && (
            <Link to="/people/new" className="btn-primary inline-block">
              Add your first person
            </Link>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 bg-white rounded-lg border border-gray-200 shadow-sm">
          {people.map((p) => (
            <li key={p.id}>
              <Link
                to={`/people/${p.id}`}
                className="block px-4 py-3 hover:bg-gray-50"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    {photoUrls.get(p.id) ? (
                      <img
                        src={photoUrls.get(p.id)}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover bg-gray-200"
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full bg-umc-100 text-umc-700 flex items-center justify-center text-xs font-semibold"
                        aria-hidden="true"
                      >
                        {(p.preferred_name || p.first_name || '?')
                          .charAt(0)
                          .toUpperCase()}
                        {(p.last_name || '').charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex items-baseline justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">
                      {fullName(p)}
                      {p.is_deceased && (
                        <span className="ml-2 text-xs text-gray-500 italic">
                          (deceased)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                      {p.cell_phone && <span>{p.cell_phone}</span>}
                      {p.email && <span>{p.email}</span>}
                      {p.city && (
                        <span>
                          {p.city}
                          {p.state ? `, ${p.state}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    {p.is_church_member && (
                      <Badge color="green">member</Badge>
                    )}
                    {p.is_active_visitor && (
                      <Badge color="blue">active visitor</Badge>
                    )}
                    {p.is_extended_family && (
                      <Badge color="purple">extended family</Badge>
                    )}
                    {p.is_non_active_visitor && (
                      <Badge color="gray">non-active visitor</Badge>
                    )}
                    {p.on_christmas_card_list && (
                      <Badge color="red">🎄</Badge>
                    )}
                  </div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Badge({ color, children }) {
  const cls = {
    green: 'bg-green-100 text-green-800 border-green-200',
    blue: 'bg-blue-100 text-blue-800 border-blue-200',
    purple: 'bg-purple-100 text-purple-800 border-purple-200',
    gray: 'bg-gray-100 text-gray-700 border-gray-200',
    red: 'bg-red-100 text-red-800 border-red-200',
  }[color];
  return (
    <span
      className={'inline-flex items-center px-1.5 py-0.5 rounded border ' + cls}
    >
      {children}
    </span>
  );
}
