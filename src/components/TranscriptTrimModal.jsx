import { useEffect, useState } from 'react';
import { proposeTranscriptTrim } from '../lib/claude';
import { fullName } from '../lib/people';

// Side-by-side trim modal:
//   Original transcript (read-only)  |  Claude-proposed trimmed version (editable)
//
// The pastor can edit the proposed trim before accepting. Word-count
// readout shows what was cut. Accept replaces the transcript_text on
// the underlying transcript row via the onAccept callback.

export default function TranscriptTrimModal({
  open,
  onClose,
  transcript,
  person,
  onAccept,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [proposed, setProposed] = useState('');
  const [removedSummary, setRemovedSummary] = useState('');
  const [edited, setEdited] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !transcript) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProposed('');
    setRemovedSummary('');
    setEdited('');
    (async () => {
      try {
        const result = await proposeTranscriptTrim({
          transcriptText: transcript.transcript_text,
          personName: fullName(person),
          title: transcript.title,
        });
        if (cancelled) return;
        setProposed(result.trimmed_text || '');
        setEdited(result.trimmed_text || '');
        setRemovedSummary(result.removed_summary || '');
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, transcript, person]);

  if (!open || !transcript) return null;

  const originalWords = countWords(transcript.transcript_text);
  const editedWords = countWords(edited);
  const reduction =
    originalWords > 0
      ? Math.round((1 - editedWords / originalWords) * 100)
      : 0;

  const handleAccept = async () => {
    if (!edited.trim()) {
      setError('Trimmed transcript is empty.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onAccept(edited);
      onClose();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleResetToProposed = () => setEdited(proposed);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-5xl rounded-lg shadow-xl flex flex-col max-h-[95vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-200 flex items-baseline justify-between gap-2">
          <div>
            <h2 className="font-serif text-xl text-umc-900">Trim transcript</h2>
            <p className="text-xs text-gray-500 mt-1">
              Claude removes small talk and keeps pastorally-relevant content.
              Edit the proposed trim if needed, then click Accept to replace
              the transcript.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-sm"
          >
            Close
          </button>
        </div>

        {error && (
          <p className="mx-5 mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </p>
        )}

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 overflow-hidden">
          <div className="flex flex-col min-h-0">
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="text-xs uppercase tracking-wide text-gray-500">
                Original ({originalWords} words)
              </h3>
            </div>
            <pre className="text-[11px] text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 border border-gray-200 rounded p-2 flex-1 overflow-y-auto">
              {transcript.transcript_text || ''}
            </pre>
          </div>
          <div className="flex flex-col min-h-0">
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="text-xs uppercase tracking-wide text-gray-500">
                Proposed trim ({editedWords} words
                {originalWords > 0 ? `, ${reduction}% shorter` : ''})
              </h3>
              {edited !== proposed && (
                <button
                  type="button"
                  onClick={handleResetToProposed}
                  className="text-[10px] text-gray-500 hover:text-gray-800 underline"
                >
                  Reset to Claude's proposal
                </button>
              )}
            </div>
            {loading ? (
              <div className="text-[11px] text-gray-500 italic bg-gray-50 border border-gray-200 rounded p-2 flex-1 flex items-center justify-center">
                Asking Claude to trim…
              </div>
            ) : (
              <textarea
                className="text-[11px] text-gray-800 whitespace-pre-wrap font-mono border border-gray-300 rounded p-2 flex-1 focus:outline-none focus:ring-2 focus:ring-umc-700"
                value={edited}
                onChange={(e) => setEdited(e.target.value)}
                placeholder="Claude will fill this in…"
              />
            )}
          </div>
        </div>

        <div className="p-5 border-t border-gray-200 flex items-baseline justify-between gap-3 flex-wrap">
          <p className="text-xs text-gray-500 italic">
            {removedSummary
              ? `Cut: ${removedSummary}`
              : 'Claude\'s proposal — edit if needed before accepting.'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary text-sm"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={loading || saving || !edited.trim()}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Accept + replace transcript'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function countWords(s) {
  if (!s || !s.trim()) return 0;
  return s.trim().split(/\s+/).length;
}
