import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  createDocument,
  deleteDocumentRow,
  deleteDocument as deleteStorageFile,
  fetchSignedUrls,
  isImageDocument,
  listDocuments,
  updateDocument,
  uploadDocument,
} from '../lib/documents';
import { summarizeDocument } from '../lib/claude';
import { fullName } from '../lib/people';
import CoreIssueSuggesterButton from './CoreIssueSuggesterButton.jsx';

// Per-person documents archive: files, links, inline notes.
//
// File rendering rules:
//   - Image files (jpg/png/gif/webp/heic) get an inline thumbnail.
//   - Other files get a "📄 Open" link to a fresh signed URL.
//   - Links open in a new tab.
//   - Notes show their body inline.

export default function PersonDocuments({ person, onChanged }) {
  const { user } = useAuth();
  const personId = person?.id;
  const [items, setItems] = useState([]);
  const [urls, setUrls] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [addKind, setAddKind] = useState(null); // 'file' | 'link' | 'note' | null
  const [addForm, setAddForm] = useState({
    title: '',
    url: '',
    body: '',
    notes: '',
  });
  const fileInputRef = useRef(null);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [summarizingId, setSummarizingId] = useState(null);

  const refresh = async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listDocuments(personId);
      setItems(rows);
      const paths = rows
        .map((r) => r.storage_path)
        .filter(Boolean);
      const urlMap = paths.length > 0 ? await fetchSignedUrls(paths) : new Map();
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

  const resetAdd = () => {
    setAddKind(null);
    setAddForm({ title: '', url: '', body: '', notes: '' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // File-kind handler: triggered by the hidden <input type="file">.
  const handleFile = async (files) => {
    if (!user?.id || !files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const file = files[0];
      const storagePath = await uploadDocument({
        file,
        personId,
        ownerUserId: user.id,
      });
      await createDocument({
        ownerUserId: user.id,
        personId,
        patch: {
          kind: 'file',
          title: addForm.title || file.name,
          storage_path: storagePath,
          original_filename: file.name,
          content_type: file.type || null,
          notes: addForm.notes,
        },
      });
      resetAdd();
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleAddLink = async () => {
    if (!user?.id) return;
    if (!addForm.url.trim()) {
      setError('URL is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createDocument({
        ownerUserId: user.id,
        personId,
        patch: {
          kind: 'link',
          title: addForm.title || addForm.url,
          url: addForm.url,
          notes: addForm.notes,
        },
      });
      resetAdd();
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleAddNote = async () => {
    if (!user?.id) return;
    if (!addForm.body.trim()) {
      setError('Note body is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createDocument({
        ownerUserId: user.id,
        personId,
        patch: {
          kind: 'note',
          title: addForm.title,
          body: addForm.body,
          notes: addForm.notes,
        },
      });
      resetAdd();
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (doc) => {
    setEditingId(doc.id);
    setEditForm({
      title: doc.title || '',
      url: doc.url || '',
      body: doc.body || '',
      notes: doc.notes || '',
      summary: doc.summary || '',
    });
  };

  const saveEdit = async (doc) => {
    setBusy(true);
    setError(null);
    try {
      await updateDocument(doc.id, editForm);
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (doc) => {
    if (
      !window.confirm(
        doc.kind === 'file'
          ? 'Delete this document and remove the file from storage?'
          : 'Delete this entry?'
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await deleteDocumentRow(doc);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSummarize = async (doc) => {
    setSummarizingId(doc.id);
    setError(null);
    try {
      // Build source text from whatever the document HAS that's
      // textual. Files don't get read server-side here — we feed
      // Claude the title + pastor's notes so the summary is grounded
      // in something.
      const parts = [];
      if (doc.title) parts.push(`Title: ${doc.title}`);
      if (doc.url) parts.push(`URL: ${doc.url}`);
      if (doc.original_filename)
        parts.push(`Filename: ${doc.original_filename}`);
      if (doc.body) parts.push('Body:\n' + doc.body);
      if (doc.notes) parts.push('Pastor notes:\n' + doc.notes);
      const sourceText = parts.join('\n\n');
      if (!sourceText.trim()) {
        throw new Error(
          'Nothing to summarize. Add a body or pastor note first.'
        );
      }
      const summary = await summarizeDocument({
        sourceText,
        personName: fullName(person),
        title: doc.title,
      });
      await updateDocument(doc.id, { summary });
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSummarizingId(null);
    }
  };

  // Build the source text for Claude's core-issue suggester.
  const sourceTextFor = (doc) => {
    const parts = [];
    if (doc.title) parts.push(doc.title);
    if (doc.summary) parts.push('Summary: ' + doc.summary);
    if (doc.body) parts.push(doc.body);
    if (doc.notes) parts.push('Pastor notes: ' + doc.notes);
    if (doc.url) parts.push('URL: ' + doc.url);
    return parts.join('\n\n');
  };

  return (
    <>
      <div className="flex flex-wrap gap-2 justify-end">
        <button
          type="button"
          onClick={() => {
            resetAdd();
            setAddKind('file');
            // Trigger file picker on next paint so the hidden input
            // is mounted.
            setTimeout(() => fileInputRef.current?.click(), 0);
          }}
          className="btn-secondary text-xs"
        >
          + Upload file
        </button>
        <button
          type="button"
          onClick={() => {
            resetAdd();
            setAddKind('link');
          }}
          className="btn-secondary text-xs"
        >
          + Add link
        </button>
        <button
          type="button"
          onClick={() => {
            resetAdd();
            setAddKind('note');
          }}
          className="btn-secondary text-xs"
        >
          + Add note
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => handleFile(e.target.files)}
      />

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}

      {addKind === 'link' && (
        <div className="rounded border border-umc-200 bg-umc-50/40 p-3 space-y-2">
          <FieldLabel label="URL *">
            <input
              type="url"
              className="input text-sm"
              value={addForm.url}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, url: e.target.value }))
              }
              placeholder="https://…"
            />
          </FieldLabel>
          <FieldLabel label="Title">
            <input
              type="text"
              className="input text-sm"
              value={addForm.title}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, title: e.target.value }))
              }
              placeholder="Optional — defaults to the URL"
            />
          </FieldLabel>
          <FieldLabel label="Pastor notes">
            <textarea
              className="input text-sm min-h-[60px]"
              value={addForm.notes}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, notes: e.target.value }))
              }
              placeholder="Optional — anything about the link worth remembering."
            />
          </FieldLabel>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={resetAdd}
              disabled={busy}
              className="btn-secondary text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddLink}
              disabled={busy}
              className="btn-primary text-xs disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Add link'}
            </button>
          </div>
        </div>
      )}

      {addKind === 'note' && (
        <div className="rounded border border-umc-200 bg-umc-50/40 p-3 space-y-2">
          <FieldLabel label="Title">
            <input
              type="text"
              className="input text-sm"
              value={addForm.title}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, title: e.target.value }))
              }
              placeholder="Optional"
            />
          </FieldLabel>
          <FieldLabel label="Body *">
            <textarea
              className="input text-sm min-h-[100px] font-serif"
              value={addForm.body}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, body: e.target.value }))
              }
              placeholder="Paste a quote, copy/paste a text-message thread, capture anything that needs to live here."
            />
          </FieldLabel>
          <FieldLabel label="Pastor notes">
            <textarea
              className="input text-sm min-h-[60px]"
              value={addForm.notes}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, notes: e.target.value }))
              }
              placeholder="Optional — your own gloss on the captured content."
            />
          </FieldLabel>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={resetAdd}
              disabled={busy}
              className="btn-secondary text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddNote}
              disabled={busy}
              className="btn-primary text-xs disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Add note'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 italic">Loading documents…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-500 italic">
          No documents yet. Use the buttons above to upload a file, paste
          a link, or capture an inline note.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {items.map((doc) => {
            const isEditing = editingId === doc.id;
            const signedUrl =
              doc.storage_path && urls.get(doc.storage_path);
            const isImage = isImageDocument(doc);
            return (
              <li key={doc.id} className="py-3">
                {isEditing ? (
                  <div className="space-y-2">
                    <FieldLabel label="Title">
                      <input
                        type="text"
                        className="input text-sm"
                        value={editForm.title}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            title: e.target.value,
                          }))
                        }
                      />
                    </FieldLabel>
                    {doc.kind === 'link' && (
                      <FieldLabel label="URL">
                        <input
                          type="url"
                          className="input text-sm"
                          value={editForm.url}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              url: e.target.value,
                            }))
                          }
                        />
                      </FieldLabel>
                    )}
                    {doc.kind === 'note' && (
                      <FieldLabel label="Body">
                        <textarea
                          className="input text-sm min-h-[100px] font-serif"
                          value={editForm.body}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              body: e.target.value,
                            }))
                          }
                        />
                      </FieldLabel>
                    )}
                    <FieldLabel label="Summary">
                      <textarea
                        className="input text-sm min-h-[50px]"
                        value={editForm.summary}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            summary: e.target.value,
                          }))
                        }
                      />
                    </FieldLabel>
                    <FieldLabel label="Pastor notes">
                      <textarea
                        className="input text-sm min-h-[60px]"
                        value={editForm.notes}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            notes: e.target.value,
                          }))
                        }
                      />
                    </FieldLabel>
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
                        onClick={() => saveEdit(doc)}
                        disabled={busy}
                        className="text-xs text-umc-700 hover:text-umc-900 underline"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <span className="text-[10px] uppercase tracking-wide text-gray-500 mr-1">
                          {doc.kind}
                        </span>
                        <span className="text-sm font-medium text-gray-900">
                          {doc.title || '(untitled)'}
                        </span>
                        <span className="ml-2 text-[10px] text-gray-400">
                          {new Date(doc.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex gap-3 text-xs flex-wrap">
                        <button
                          type="button"
                          onClick={() => handleSummarize(doc)}
                          disabled={summarizingId === doc.id}
                          className="text-umc-700 hover:text-umc-900 underline disabled:opacity-50"
                        >
                          {summarizingId === doc.id ? '…' : '✨ Summarize'}
                        </button>
                        <CoreIssueSuggesterButton
                          person={person}
                          source={doc}
                          sourceType="document"
                          sourceText={sourceTextFor(doc)}
                          onPromoted={onChanged}
                        />
                        <button
                          type="button"
                          onClick={() => startEdit(doc)}
                          className="text-gray-600 hover:text-gray-900 underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(doc)}
                          className="text-red-600 hover:text-red-800 underline"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* File rendering */}
                    {doc.kind === 'file' && signedUrl && (
                      <div className="mt-2">
                        {isImage ? (
                          <a
                            href={signedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block"
                          >
                            <img
                              src={signedUrl}
                              alt={doc.title || doc.original_filename || 'document'}
                              className="max-h-48 rounded border border-gray-200"
                              loading="lazy"
                            />
                          </a>
                        ) : (
                          <a
                            href={signedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-umc-700 hover:text-umc-900 underline"
                          >
                            📄 Open {doc.original_filename || 'file'}
                          </a>
                        )}
                      </div>
                    )}

                    {/* Link rendering */}
                    {doc.kind === 'link' && doc.url && (
                      <p className="mt-1">
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-umc-700 hover:text-umc-900 underline break-all"
                        >
                          🔗 {doc.url}
                        </a>
                      </p>
                    )}

                    {/* Note body */}
                    {doc.kind === 'note' && doc.body && (
                      <p className="text-xs text-gray-800 whitespace-pre-wrap mt-1 font-serif leading-relaxed">
                        {doc.body}
                      </p>
                    )}

                    {/* Summary + pastor notes are common to all kinds */}
                    {doc.summary && (
                      <p className="text-[11px] text-gray-700 italic mt-1">
                        Summary: {doc.summary}
                      </p>
                    )}
                    {doc.notes && (
                      <p className="text-[11px] text-gray-700 mt-1 whitespace-pre-wrap">
                        {doc.notes}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
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
