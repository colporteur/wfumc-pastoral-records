import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  LINK_RELATIONSHIPS,
  deleteLink,
  fetchAutoMatchedRequests,
  listLinks,
  relationshipLabel,
  searchPrayerRequests,
  upsertLink,
} from '../lib/prayerRequests';

// Surface prayer requests this person is involved in. Three buckets:
//   1. Manually linked (confirmed): authoritative, comes from the
//      pastoral_prayer_request_links table.
//   2. Auto-match suggestions: text-search hits we *haven't* explicitly
//      linked or rejected. The pastor can confirm or reject each.
//   3. Free-text search: pastor pastes a name / fragment to find a
//      request the auto-matcher missed, then links it.

export default function PersonPrayerRequests({ person }) {
  const { user } = useAuth();
  const personId = person?.id;
  const [links, setLinks] = useState([]);
  const [autoMatches, setAutoMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Free-text search state.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const refresh = async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    try {
      const [linkRows, autoRows] = await Promise.all([
        listLinks(personId),
        fetchAutoMatchedRequests(person),
      ]);
      setLinks(linkRows);
      setAutoMatches(autoRows);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, person?.first_name, person?.last_name, person?.preferred_name]);

  // Build a Set of prayer_request_ids that already have a link row
  // (any relationship, including 'rejected'), so we can filter the
  // auto-match suggestions to the remaining ones.
  const linkedRequestIds = useMemo(
    () => new Set(links.map((l) => l.prayer_request_id)),
    [links]
  );
  const visibleAutoMatches = useMemo(
    () =>
      autoMatches.filter(
        (m) => !linkedRequestIds.has(m.id) && m.is_active !== false
      ),
    [autoMatches, linkedRequestIds]
  );

  const confirmedLinks = useMemo(
    () => links.filter((l) => l.relationship !== 'rejected'),
    [links]
  );
  const rejectedCount = links.filter((l) => l.relationship === 'rejected')
    .length;

  const handleConfirm = async (req, relationship) => {
    if (!user?.id) return;
    setBusy(true);
    setError(null);
    try {
      await upsertLink({
        ownerUserId: user.id,
        personId,
        prayerRequestId: req.id,
        relationship,
      });
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (req) => {
    if (!user?.id) return;
    setBusy(true);
    setError(null);
    try {
      await upsertLink({
        ownerUserId: user.id,
        personId,
        prayerRequestId: req.id,
        relationship: 'rejected',
      });
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async (link) => {
    if (
      !window.confirm(
        'Remove this prayer request link? It may reappear as an auto-match suggestion.'
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

  const handleChangeRelationship = async (link, relationship) => {
    if (!user?.id) return;
    setBusy(true);
    setError(null);
    try {
      await upsertLink({
        ownerUserId: user.id,
        personId,
        prayerRequestId: link.prayer_request_id,
        relationship,
      });
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const rows = await searchPrayerRequests(searchTerm);
      // Hide rows that are already linked to this person (any way).
      const filtered = rows.filter((r) => !linkedRequestIds.has(r.id));
      setSearchResults(filtered);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 italic">
          Loading prayer requests…
        </p>
      ) : (
        <div className="space-y-4">
          {/* Confirmed manual links */}
          <div>
            <h3 className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
              Linked ({confirmedLinks.length})
            </h3>
            {confirmedLinks.length === 0 ? (
              <p className="text-xs text-gray-500 italic">
                No prayer requests linked yet.
              </p>
            ) : (
              <ul className="divide-y divide-gray-200 border border-gray-200 rounded">
                {confirmedLinks.map((link) => {
                  const r = link.prayer_request;
                  if (!r) return null;
                  return (
                    <li key={link.id} className="px-3 py-2 text-xs">
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <span className="text-[10px] uppercase tracking-wide text-umc-700 mr-1">
                            {relationshipLabel(link.relationship)}
                          </span>
                          <span className="text-gray-500">
                            {r.is_anonymous
                              ? '(anonymous)'
                              : r.submitter_name || '(no name)'}
                            {' · '}
                            {r.submitted_at &&
                              new Date(r.submitted_at).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={link.relationship}
                            onChange={(e) =>
                              handleChangeRelationship(link, e.target.value)
                            }
                            disabled={busy}
                            className="text-[11px] border border-gray-300 rounded px-1 py-0.5 bg-white"
                          >
                            {LINK_RELATIONSHIPS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleUnlink(link)}
                            className="text-red-600 hover:text-red-800 underline"
                            disabled={busy}
                          >
                            Unlink
                          </button>
                        </div>
                      </div>
                      <p className="text-gray-800 whitespace-pre-wrap mt-1">
                        {r.request_text}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Auto-match suggestions */}
          {visibleAutoMatches.length > 0 && (
            <div>
              <h3 className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                Auto-match suggestions ({visibleAutoMatches.length})
              </h3>
              <ul className="divide-y divide-gray-200 border border-amber-200 bg-amber-50/30 rounded">
                {visibleAutoMatches.map((r) => (
                  <li key={r.id} className="px-3 py-2 text-xs">
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <div className="text-gray-500">
                        Matched as{' '}
                        <span className="font-medium">
                          {relationshipLabel(r.match_kind)}
                        </span>{' '}
                        ·{' '}
                        {r.is_anonymous
                          ? '(anonymous)'
                          : r.submitter_name || '(no name)'}
                        {' · '}
                        {r.submitted_at &&
                          new Date(r.submitted_at).toLocaleDateString()}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleConfirm(r, r.match_kind)}
                          disabled={busy}
                          className="text-[10px] text-umc-700 hover:text-umc-900 underline"
                          title={`Confirm as ${relationshipLabel(r.match_kind)}`}
                        >
                          Confirm
                        </button>
                        {r.match_kind !== 'both' && (
                          <button
                            type="button"
                            onClick={() => handleConfirm(r, 'both')}
                            disabled={busy}
                            className="text-[10px] text-umc-700 hover:text-umc-900 underline ml-1"
                            title="Confirm as both made_by AND for_them"
                          >
                            (as both)
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleReject(r)}
                          disabled={busy}
                          className="text-[10px] text-gray-500 hover:text-gray-800 underline ml-2"
                          title="Hide this auto-match — it's not actually about this person"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                    <p className="text-gray-800 whitespace-pre-wrap mt-1">
                      {r.request_text}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rejectedCount > 0 && (
            <p className="text-[10px] text-gray-400 italic">
              {rejectedCount} auto-match{rejectedCount === 1 ? '' : 'es'}{' '}
              previously rejected and hidden from suggestions.
            </p>
          )}

          {/* Free-text manual search + add */}
          <div className="border-t border-gray-200 pt-3">
            {!searchOpen ? (
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="text-xs text-umc-700 hover:text-umc-900 underline"
              >
                + Manually link a prayer request
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSearch();
                      }
                    }}
                    placeholder="Search submitter name or request text…"
                    className="input text-sm flex-1"
                  />
                  <button
                    type="button"
                    onClick={handleSearch}
                    disabled={searching || !searchTerm.trim()}
                    className="btn-secondary text-xs disabled:opacity-50"
                  >
                    {searching ? 'Searching…' : 'Search'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchOpen(false);
                      setSearchTerm('');
                      setSearchResults([]);
                    }}
                    className="text-xs text-gray-500 hover:text-gray-800 underline"
                  >
                    Close
                  </button>
                </div>
                {searchResults.length > 0 && (
                  <ul className="divide-y divide-gray-200 border border-gray-200 rounded max-h-72 overflow-y-auto">
                    {searchResults.map((r) => (
                      <li key={r.id} className="px-3 py-2 text-xs">
                        <div className="flex items-baseline justify-between gap-2 flex-wrap">
                          <div className="text-gray-500">
                            {r.is_anonymous
                              ? '(anonymous)'
                              : r.submitter_name || '(no name)'}
                            {' · '}
                            {r.submitted_at &&
                              new Date(r.submitted_at).toLocaleDateString()}
                          </div>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => handleConfirm(r, 'made_by')}
                              disabled={busy}
                              className="text-[10px] text-umc-700 hover:text-umc-900 underline"
                            >
                              + Made by
                            </button>
                            <button
                              type="button"
                              onClick={() => handleConfirm(r, 'for_them')}
                              disabled={busy}
                              className="text-[10px] text-umc-700 hover:text-umc-900 underline"
                            >
                              + For them
                            </button>
                            <button
                              type="button"
                              onClick={() => handleConfirm(r, 'both')}
                              disabled={busy}
                              className="text-[10px] text-umc-700 hover:text-umc-900 underline"
                            >
                              + Both
                            </button>
                          </div>
                        </div>
                        <p className="text-gray-800 whitespace-pre-wrap mt-1">
                          {r.request_text}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
