import { useEffect, useRef, useState } from 'react';
import {
  deletePhoto,
  fetchSignedUrls,
  listPhotos,
  setAsMain,
  updatePhoto,
  uploadPhoto,
} from '../lib/photos';
import { useAuth } from '../contexts/AuthContext.jsx';

// Photo gallery for a single pastoral_people row. Upload, set main,
// edit caption, delete. Signed URLs are fetched in batch and cached
// for the session.

export default function PersonPhotos({ personId }) {
  const { user } = useAuth();
  const [photos, setPhotos] = useState([]);
  const [urls, setUrls] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [editingCaptionId, setEditingCaptionId] = useState(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const fileInputRef = useRef(null);

  const refresh = async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listPhotos(personId);
      setPhotos(rows);
      const paths = rows.map((p) => p.storage_path).filter(Boolean);
      const urlMap = await fetchSignedUrls(paths);
      setUrls(urlMap);
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

  const handleFiles = async (files) => {
    if (!user?.id) return;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await uploadPhoto({
          file,
          personId,
          ownerUserId: user.id,
        });
      }
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSetMain = async (photo) => {
    setError(null);
    try {
      await setAsMain(photo);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  const handleDelete = async (photo) => {
    if (!window.confirm('Delete this photo? This cannot be undone.')) return;
    setError(null);
    try {
      await deletePhoto(photo);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  const startEditCaption = (photo) => {
    setEditingCaptionId(photo.id);
    setCaptionDraft(photo.caption || '');
  };

  const saveCaption = async (photo) => {
    setError(null);
    try {
      await updatePhoto(photo.id, { caption: captionDraft });
      setEditingCaptionId(null);
      setCaptionDraft('');
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="font-serif text-lg text-umc-900">Photos</h2>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn-secondary text-xs disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : '+ Upload photo(s)'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 italic">Loading photos…</p>
      ) : photos.length === 0 ? (
        <p className="text-xs text-gray-500 italic">
          No photos yet. Use “+ Upload photo(s)” to add some.
        </p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map((p) => {
            const url = urls.get(p.storage_path);
            const isEditing = editingCaptionId === p.id;
            return (
              <li
                key={p.id}
                className={
                  'rounded border ' +
                  (p.is_main
                    ? 'border-umc-700 ring-1 ring-umc-700'
                    : 'border-gray-200')
                }
              >
                <div className="relative bg-gray-50">
                  {url ? (
                    <img
                      src={url}
                      alt={p.caption || p.original_filename || 'Photo'}
                      className="w-full h-40 object-cover rounded-t"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-40 flex items-center justify-center text-xs text-gray-400">
                      (loading)
                    </div>
                  )}
                  {p.is_main && (
                    <span className="absolute top-1 left-1 text-[10px] bg-umc-700 text-white px-1.5 py-0.5 rounded">
                      MAIN
                    </span>
                  )}
                </div>
                <div className="p-2 text-xs space-y-1">
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={captionDraft}
                        onChange={(e) => setCaptionDraft(e.target.value)}
                        className="input text-xs flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => saveCaption(p)}
                        className="text-[10px] text-umc-700 hover:text-umc-900 underline"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingCaptionId(null)}
                        className="text-[10px] text-gray-500 hover:text-gray-800 underline"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditCaption(p)}
                      className="block w-full text-left text-gray-700 hover:text-umc-900"
                      title="Click to edit caption"
                    >
                      {p.caption || (
                        <span className="text-gray-400 italic">
                          (no caption)
                        </span>
                      )}
                    </button>
                  )}
                  <div className="flex justify-between text-[10px] text-gray-500">
                    {!p.is_main && (
                      <button
                        type="button"
                        onClick={() => handleSetMain(p)}
                        className="hover:text-umc-900 underline"
                      >
                        Set as main
                      </button>
                    )}
                    {p.is_main && <span />}
                    <button
                      type="button"
                      onClick={() => handleDelete(p)}
                      className="text-red-600 hover:text-red-800 underline ml-auto"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
