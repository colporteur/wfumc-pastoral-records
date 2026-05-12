import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { suggestCoreIssues } from '../lib/claude';
import { createCoreIssue } from '../lib/coreIssues';
import { fullName } from '../lib/people';

// Button + modal: ask Claude to suggest 0-3 core pastoral issues from
// a source row (interaction / transcript / note), then let the pastor
// promote each one with a click.
//
// Two precision modes:
//   'precise' (default)   — only flag clearly-named pastoral concerns
//   'speculative'         — also include subtle hints
//
// On promote we stamp source_type / source_id breadcrumbs so the new
// core issue knows where it came from.

export default function CoreIssueSuggesterButton({
  person,
  source,            // the row (interaction / transcript / note)
  sourceType,        // 'interaction' | 'transcript' | 'note'
  sourceText,        // the text Claude should analyze
  onPromoted,        // optional callback after a suggestion is promoted
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('precise');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [promoted, setPromoted] = useState(new Set()); // ids of suggestions already added

  const fetchSuggestions = async (modeOverride) => {
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setPromoted(new Set());
    try {
      const rows = await suggestCoreIssues({
        sourceText,
        sourceLabel: sourceType,
        personName: fullName(person),
        mode: modeOverride || mode,
      });
      setSuggestions(rows);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = async () => {
    setOpen(true);
    await fetchSuggestions('precise');
  };

  const handleModeSwitch = async (newMode) => {
    setMode(newMode);
    await fetchSuggestions(newMode);
  };

  const handlePromote = async (suggestion, idx) => {
    if (!user?.id) return;
    setError(null);
    try {
      await createCoreIssue({
        ownerUserId: user.id,
        personId: person.id,
        patch: {
          title: suggestion.title,
          description: suggestion.description,
          status: 'open',
          source_type: sourceType,
          source_id: source.id,
        },
      });
      setPromoted((s) => new Set([...s, idx]));
      if (onPromoted) onPromoted();
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="text-xs text-umc-700 hover:text-umc-900 underline"
        title="Ask Claude to suggest core pastoral issues from this source"
      >
        ✨ Suggest issues
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white w-full sm:max-w-2xl rounded-t-lg sm:rounded-lg shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 space-y-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-serif text-xl text-umc-900">
                  Suggested core issues
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-gray-400 hover:text-gray-700 text-sm"
                >
                  Close
                </button>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <span className="text-gray-600">Mode:</span>
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="suggester-mode"
                    value="precise"
                    checked={mode === 'precise'}
                    onChange={() => handleModeSwitch('precise')}
                    disabled={loading}
                  />
                  <span>Precise (only clearly-named concerns)</span>
                </label>
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="suggester-mode"
                    value="speculative"
                    checked={mode === 'speculative'}
                    onChange={() => handleModeSwitch('speculative')}
                    disabled={loading}
                  />
                  <span>Speculative (include subtler hints)</span>
                </label>
              </div>

              {error && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {error}
                </p>
              )}

              {loading ? (
                <p className="text-sm text-gray-500 italic">
                  Asking Claude…
                </p>
              ) : suggestions.length === 0 ? (
                <p className="text-sm text-gray-600">
                  Claude didn't surface any{' '}
                  {mode === 'precise' ? 'clearly-named' : 'subtle'} pastoral
                  concerns in this source. Try the other mode, or add an
                  issue manually from the Core Pastoral Issues section.
                </p>
              ) : (
                <ul className="divide-y divide-gray-200 border border-gray-200 rounded">
                  {suggestions.map((s, i) => {
                    const isPromoted = promoted.has(i);
                    return (
                      <li key={i} className="p-3 space-y-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="text-sm font-medium text-gray-900">
                            {s.title}
                          </h3>
                          {isPromoted ? (
                            <span className="text-xs text-green-700">
                              ✓ Added
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handlePromote(s, i)}
                              className="btn-primary text-xs"
                            >
                              + Add as core issue
                            </button>
                          )}
                        </div>
                        {s.description && (
                          <p className="text-xs text-gray-700">
                            {s.description}
                          </p>
                        )}
                        {s.rationale && (
                          <p className="text-[11px] text-gray-500 italic">
                            Rationale: {s.rationale}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
