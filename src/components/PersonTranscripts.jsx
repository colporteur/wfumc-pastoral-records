import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  createTranscript,
  deleteTranscript,
  listTranscripts,
  updateTranscript,
} from '../lib/transcripts';
import { promoteToCoreIssue } from '../lib/coreIssues';
import {
  proposeTranscriptTrim,
  summarizeTranscript,
} from '../lib/claude';
import { fullName } from '../lib/people';
import CoreIssueSuggesterButton from './CoreIssueSuggesterButton.jsx';
import TranscriptTrimModal from './TranscriptTrimModal.jsx';

const BLANK_FORM = {
  title: '',
  recorded_at: '',
  transcript_text: '',
  summary: '',
};

function isoToLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    'T' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}

function localToIso(local) {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function PersonTranscripts({ person, onChanged }) {
  const { user } = useAuth();
  const personId = person?.id;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState(BLANK_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(BLANK_FORM);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [summarizingId, setSummarizingId] = useState(null);
  const [trimmingTranscript, setTrimmingTranscript] = useState(null);

  const refresh = async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listTranscripts(personId);
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
    setBusy(true);
    setError(null);
    try {
      await createTranscript({
        ownerUserId: user.id,
        personId,
        patch: {
          ...addForm,
          recorded_at: localToIso(addForm.recorded_at),
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

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditForm({
      title: item.title || '',
      recorded_at: isoToLocal(item.recorded_at),
      transcript_text: item.transcript_text || '',
      summary: item.summary || '',
    });
  };

  const saveEdit = async (item) => {
    setBusy(true);
    setError(null);
    try {
      await updateTranscript(item.id, {
        ...editForm,
        recorded_at: localToIso(editForm.recorded_at),
      });
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm('Delete this transcript?')) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTranscript(item.id);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePromote = async (item) => {
    if (!user?.id) return;
    setBusy(true);
    setError(null);
    try {
      await promoteToCoreIssue({
        ownerUserId: user.id,
        personId,
        source: item,
        sourceType: 'transcript',
      });
      if (onChanged) onChanged();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSummarize = async (item) => {
    setSummarizingId(item.id);
    setError(null);
    try {
      const summary = await summarizeTranscript({
        transcriptText: item.transcript_text,
        personName: fullName(person),
        title: item.title,
      });
      await updateTranscript(item.id, { summary });
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSummarizingId(null);
    }
  };

  const handleAcceptTrim = async (newText) => {
    if (!trimmingTranscript) return;
    await updateTranscript(trimmingTranscript.id, {
      transcript_text: newText,
    });
    await refresh();
  };

  const renderForm = (form, setForm) => (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <FieldLabel label="Title">
          <input
            type="text"
            className="input text-sm"
            value={form.title}
            onChange={(e) =>
              setForm((f) => ({ ...f, title: e.target.value }))
            }
            placeholder="e.g. Hospital bedside conversation"
          />
        </FieldLabel>
        <FieldLabel label="When recorded">
          <input
            type="datetime-local"
            className="input text-sm"
            value={form.recorded_at}
            onChange={(e) =>
              setForm((f) => ({ ...f, recorded_at: e.target.value }))
            }
          />
        </FieldLabel>
      </div>
      <FieldLabel label="Summary">
        <textarea
          className="input text-sm min-h-[60px]"
          value={form.summary}
          onChange={(e) =>
            setForm((f) => ({ ...f, summary: e.target.value }))
          }
          placeholder="Short summary; future audio imports will auto-fill this with Claude."
        />
      </FieldLabel>
      <FieldLabel label="Full transcript">
        <textarea
          className="input text-sm min-h-[160px] font-mono"
          value={form.transcript_text}
          onChange={(e) =>
            setForm((f) => ({ ...f, transcript_text: e.target.value }))
          }
          placeholder="Paste a transcript from Plaud / Google Recorder, or type one in directly."
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
            onClick={() => {
              setAddForm({
                ...BLANK_FORM,
                recorded_at: isoToLocal(new Date().toISOString()),
              });
              setAdding(true);
            }}
            className="btn-secondary text-xs"
          >
            + Add transcript
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
              {busy ? 'Saving…' : 'Add transcript'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 italic">Loading transcripts…</p>
      ) : items.length === 0 && !adding ? (
        <p className="text-xs text-gray-500 italic">No transcripts yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {items.map((it) => {
            const isEditing = editingId === it.id;
            const isExpanded = expandedId === it.id;
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
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900">
                          {it.title || '(untitled transcript)'}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(it.recorded_at).toLocaleString()}
                          {it.source_type !== 'manual' && (
                            <span className="ml-2 italic">
                              (via {it.source_type})
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-3 text-xs flex-wrap">
                        <button
                          type="button"
                          onClick={() => handleSummarize(it)}
                          disabled={
                            summarizingId === it.id ||
                            !it.transcript_text?.trim()
                          }
                          className="text-umc-700 hover:text-umc-900 underline disabled:opacity-50"
                          title="Have Claude write a 2-4 sentence summary"
                        >
                          {summarizingId === it.id
                            ? '…'
                            : '✨ Summarize'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setTrimmingTranscript(it)}
                          disabled={!it.transcript_text?.trim()}
                          className="text-umc-700 hover:text-umc-900 underline disabled:opacity-50"
                          title="Trim small talk, keep pastoral content"
                        >
                          ✂ Trim
                        </button>
                        <CoreIssueSuggesterButton
                          person={person}
                          source={it}
                          sourceType="transcript"
                          sourceText={
                            (it.transcript_text || '') +
                            (it.summary ? '\n\nSummary: ' + it.summary : '')
                          }
                          onPromoted={onChanged}
                        />
                        <button
                          type="button"
                          onClick={() => handlePromote(it)}
                          className="text-gray-600 hover:text-gray-900 underline"
                          disabled={busy}
                          title="Promote directly without Claude suggestions"
                        >
                          → Core issue
                        </button>
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
                          Delete
                        </button>
                      </div>
                    </div>
                    {it.summary && (
                      <p className="text-xs text-gray-700 whitespace-pre-wrap mt-1">
                        {it.summary}
                      </p>
                    )}
                    {it.transcript_text && (
                      <div>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId((e) =>
                              e === it.id ? null : it.id
                            )
                          }
                          className="text-[10px] text-gray-500 hover:text-gray-800 underline mt-1"
                        >
                          {isExpanded
                            ? '▴ Hide transcript'
                            : '▾ Show full transcript'}
                        </button>
                        {isExpanded && (
                          <pre className="text-[11px] text-gray-700 whitespace-pre-wrap font-mono mt-1 bg-gray-50 border border-gray-200 rounded p-2 max-h-96 overflow-y-auto">
                            {it.transcript_text}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <TranscriptTrimModal
        open={!!trimmingTranscript}
        transcript={trimmingTranscript}
        person={person}
        onClose={() => setTrimmingTranscript(null)}
        onAccept={handleAcceptTrim}
      />
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
