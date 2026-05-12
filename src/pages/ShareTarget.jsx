import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import PersonPicker from '../components/PersonPicker.jsx';
import { createTranscript } from '../lib/transcripts';
import { createNote } from '../lib/notesLog';

// Web Share Target receiver. When the pastor uses Plaud / Google
// Recorder / any sharing-capable app and picks "WFUMC Pastoral
// Records" from the share sheet, the OS opens this route with the
// shared content in URL params (title/text/url).
//
// We pick a person via typeahead, decide whether to save as a
// transcript (default, since most shares will be) or a quick note,
// then create the row and navigate to the person's detail page.

export default function ShareTarget() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const sharedTitle = searchParams.get('title') || '';
  const sharedText = searchParams.get('text') || '';
  const sharedUrl = searchParams.get('url') || '';

  // Build the body. Some browsers put the URL in `text`; some in `url`.
  const body = useMemo(() => {
    const parts = [];
    if (sharedText) parts.push(sharedText);
    if (sharedUrl && !sharedText.includes(sharedUrl)) parts.push(sharedUrl);
    return parts.join('\n\n');
  }, [sharedText, sharedUrl]);

  const [picked, setPicked] = useState(null);
  const [target, setTarget] = useState('transcript');
  const [titleDraft, setTitleDraft] = useState(sharedTitle);
  const [bodyDraft, setBodyDraft] = useState(body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setBodyDraft(body);
  }, [body]);
  useEffect(() => {
    setTitleDraft(sharedTitle);
  }, [sharedTitle]);

  const handleSave = async () => {
    if (!user?.id) return;
    if (!picked) {
      setError('Pick a person first.');
      return;
    }
    if (!bodyDraft.trim()) {
      setError('Shared content is empty.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (target === 'transcript') {
        await createTranscript({
          ownerUserId: user.id,
          personId: picked.id,
          patch: {
            title: titleDraft || 'Shared transcript',
            recorded_at: new Date().toISOString(),
            transcript_text: bodyDraft,
            source_type: 'shared',
          },
        });
      } else {
        await createNote({
          ownerUserId: user.id,
          personId: picked.id,
          patch: {
            body: titleDraft
              ? `${titleDraft}\n\n${bodyDraft}`
              : bodyDraft,
          },
        });
      }
      navigate(`/people/${picked.id}`, { replace: true });
    } catch (e) {
      setError(e.message || String(e));
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <div className="text-sm text-gray-500 italic p-6">Loading…</div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <Link
          to="/"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Dashboard
        </Link>
        <h1 className="font-serif text-2xl text-umc-900 mt-1">
          Save shared content
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Pick a person from your directory, choose whether to save as a
          transcript or a quick note, edit if needed, and save.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="card space-y-3">
        <div>
          <label className="label">Save to person</label>
          <PersonPicker
            value={picked}
            onChange={setPicked}
            placeholder="Search the directory…"
          />
        </div>

        <div>
          <span className="label">Save as</span>
          <div className="flex flex-wrap gap-3 mt-1">
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name="share-target"
                value="transcript"
                checked={target === 'transcript'}
                onChange={() => setTarget('transcript')}
              />
              <span>Conversation transcript</span>
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name="share-target"
                value="note"
                checked={target === 'note'}
                onChange={() => setTarget('note')}
              />
              <span>Pastoral note</span>
            </label>
          </div>
        </div>

        <div>
          <label className="label">
            {target === 'transcript' ? 'Title' : 'Optional heading'}
          </label>
          <input
            type="text"
            className="input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            placeholder={
              target === 'transcript'
                ? 'e.g. Hospital visit transcript from Plaud'
                : 'e.g. Quick note from a phone call'
            }
          />
        </div>

        <div>
          <label className="label">
            {target === 'transcript' ? 'Transcript / shared text' : 'Note body'}
          </label>
          <textarea
            className="input min-h-[200px] font-mono text-xs"
            value={bodyDraft}
            onChange={(e) => setBodyDraft(e.target.value)}
          />
          <p className="text-[11px] text-gray-500 mt-1">
            After saving you can summarize it with Claude, trim it, or
            promote insights into core pastoral issues.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Link to="/" className="btn-secondary text-sm">
            Cancel
          </Link>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || !picked || !bodyDraft.trim()}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save + open record'}
          </button>
        </div>
      </div>
    </div>
  );
}
