import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  deleteDocument,
  getSignedUrl,
  uploadDocument,
} from '../lib/documents';

// Single-file upload widget for the person's obituary. Persists the
// storage path via the parent's onChange callback (which writes it to
// pastoral_people.obituary_storage_path on save). On display, we mint
// a fresh short-lived signed URL so the pastor can open the file.

export default function ObituaryUpload({ personId, value, onChange }) {
  const { user } = useAuth();
  const [signedUrl, setSignedUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setSignedUrl(null);
    if (!value) return undefined;
    (async () => {
      try {
        const url = await getSignedUrl(value);
        if (!cancelled) setSignedUrl(url);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value]);

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    if (!user?.id || !personId) return;
    setBusy(true);
    setError(null);
    try {
      // If there's already an obituary file, delete it before uploading
      // the new one so we don't accumulate orphans in storage.
      if (value) {
        try {
          await deleteDocument(value);
        } catch {
          /* best-effort */
        }
      }
      const path = await uploadDocument({
        file: files[0],
        personId,
        ownerUserId: user.id,
      });
      onChange?.(path);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    if (!value) return;
    if (
      !window.confirm(
        'Remove the obituary file? You can upload a new one later.'
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await deleteDocument(value);
      onChange?.(null);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      {value ? (
        <div className="flex items-center gap-3 text-sm">
          {signedUrl ? (
            <a
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              className="text-umc-700 hover:text-umc-900 underline"
            >
              📄 View uploaded obituary
            </a>
          ) : (
            <span className="text-gray-500 italic">
              (loading file link…)
            </span>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="text-xs text-gray-600 hover:text-gray-900 underline"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="text-xs text-red-600 hover:text-red-800 underline"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="btn-secondary text-xs disabled:opacity-50"
        >
          {busy ? 'Uploading…' : '📄 Upload obituary file'}
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt,image/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}
    </div>
  );
}
