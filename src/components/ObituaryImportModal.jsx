import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { extractObituary } from '../lib/claude';
import {
  createImport,
  updateImport,
  fetchObituaryUrl,
} from '../lib/recordImports';
import { prepareImageForUpload } from '../lib/imageHelpers';
import {
  uploadDocument,
  getSignedUrl,
  createDocument,
} from '../lib/documents';
import RecordImportReviewPanel from './RecordImportReviewPanel.jsx';
import { fullName } from '../lib/people';

// "✨ Import Obituary" modal — opened from PersonDetail.
//
// Three source modes, picked via tabs:
//   - URL    → fetchObituaryUrl (url-fetch Edge Function) → text → Claude
//   - Text   → pastor pastes the obit; we pass it straight to Claude
//   - Photo  → upload to pastoral-documents bucket, base64 to Claude vision
//
// Same end-state as the Clergy importer: a pastoral_record_imports row
// (kind='obituary'), a pastoral_documents row pointing at the file or
// link, then handed off to RecordImportReviewPanel.

const TABS = [
  { value: 'url', label: 'URL' },
  { value: 'text', label: 'Pasted text' },
  { value: 'photo', label: 'Photo' },
];

export default function ObituaryImportModal({
  open,
  onClose,
  subjectPerson,
  existingImport = null,
  onCommitted,
}) {
  const { user } = useAuth();
  const fileInputRef = useRef(null);

  const [tab, setTab] = useState('url');
  const [step, setStep] = useState('pick');
  const [importRow, setImportRow] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);
  const [progressMsg, setProgressMsg] = useState('');

  // Input state, scoped per tab so switching doesn't blow away values
  // the pastor already typed.
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');

  useEffect(() => {
    if (!open) return;
    setError(null);
    setProgressMsg('');
    if (existingImport) {
      setImportRow(existingImport);
      setStep('review');
      if (existingImport.source_storage_path) {
        getSignedUrl(existingImport.source_storage_path)
          .then((u) => setPreviewUrl(u))
          .catch(() => setPreviewUrl(null));
      } else {
        setPreviewUrl(null);
      }
      // Pre-fill the tab + inputs from the saved import so re-extract works.
      setTab(existingImport.source_kind || 'url');
      setUrlInput(existingImport.source_url || '');
      setTextInput(existingImport.source_text || '');
    } else {
      setImportRow(null);
      setPreviewUrl(null);
      setStep('pick');
      setTab('url');
      setUrlInput('');
      setTextInput('');
    }
  }, [open, existingImport?.id, subjectPerson?.id]);

  if (!open) return null;

  // ---- URL flow ----------------------------------------------------

  const runUrlImport = async () => {
    const raw = urlInput.trim();
    if (!raw) {
      setError('Paste an obituary URL first.');
      return;
    }
    setStep('extracting');
    setError(null);
    try {
      setProgressMsg('Fetching the obituary page…');
      const fetched = await fetchObituaryUrl(raw);
      setProgressMsg('Creating the import record…');
      const created = await createImport({
        subjectPersonId: subjectPerson.id,
        ownerUserId: user.id,
        kind: 'obituary',
        sourceKind: 'url',
        sourceUrl: fetched.finalUrl,
        sourceText: fetched.text,
      });
      // Also drop a link-kind pastoral_documents row so the obit URL
      // shows up in the Documents archive.
      try {
        const docRow = await createDocument({
          ownerUserId: user.id,
          personId: subjectPerson.id,
          patch: {
            kind: 'link',
            title: fetched.title || `Obituary — ${fullName(subjectPerson)}`,
            url: fetched.finalUrl,
            notes: 'Imported via Obituary importer.',
          },
        });
        if (docRow?.id) {
          await updateImport(created.id, { sourceDocumentId: docRow.id });
        }
      } catch {
        /* non-fatal — Documents archive entry is a courtesy */
      }
      setProgressMsg('Asking Claude to read the obituary…');
      const extraction = await extractObituary({
        url: fetched.finalUrl,
        pastedText: fetched.text,
      });
      extraction.model = 'claude-text';
      extraction.extracted_at = new Date().toISOString();
      const updated = await updateImport(created.id, {
        rawExtraction: extraction,
      });
      setImportRow(updated);
      setStep('review');
    } catch (e) {
      setError(e.message || String(e));
      setStep('pick');
    } finally {
      setProgressMsg('');
    }
  };

  // ---- Text flow ---------------------------------------------------

  const runTextImport = async () => {
    const raw = textInput.trim();
    if (!raw) {
      setError('Paste some obituary text first.');
      return;
    }
    setStep('extracting');
    setError(null);
    try {
      setProgressMsg('Creating the import record…');
      const created = await createImport({
        subjectPersonId: subjectPerson.id,
        ownerUserId: user.id,
        kind: 'obituary',
        sourceKind: 'text',
        sourceText: raw,
      });
      // Drop a note-kind pastoral_documents row so the pasted obit is
      // browseable from the Documents archive too.
      try {
        const docRow = await createDocument({
          ownerUserId: user.id,
          personId: subjectPerson.id,
          patch: {
            kind: 'note',
            title: `Obituary text — ${fullName(subjectPerson)}`,
            body: raw,
            notes: 'Imported via Obituary importer (pasted text).',
          },
        });
        if (docRow?.id) {
          await updateImport(created.id, { sourceDocumentId: docRow.id });
        }
      } catch {
        /* non-fatal */
      }
      setProgressMsg('Asking Claude to read the obituary…');
      const extraction = await extractObituary({ pastedText: raw });
      extraction.model = 'claude-text';
      extraction.extracted_at = new Date().toISOString();
      const updated = await updateImport(created.id, {
        rawExtraction: extraction,
      });
      setImportRow(updated);
      setStep('review');
    } catch (e) {
      setError(e.message || String(e));
      setStep('pick');
    } finally {
      setProgressMsg('');
    }
  };

  // ---- Photo flow --------------------------------------------------

  const handlePickPhoto = () => fileInputRef.current?.click();

  const runPhotoImport = async (files) => {
    if (!files || !files[0]) return;
    const file = files[0];
    setStep('extracting');
    setError(null);
    try {
      setProgressMsg('Preparing image…');
      const { blob, mediaType } = await prepareImageForUpload(file, 2000, 0.88);
      setProgressMsg('Uploading source photo…');
      const upFile = new File([blob], file.name || 'obituary.jpg', {
        type: mediaType,
      });
      const storagePath = await uploadDocument({
        file: upFile,
        personId: subjectPerson.id,
        ownerUserId: user.id,
      });
      setProgressMsg('Filing the photo in the Documents archive…');
      const docRow = await createDocument({
        ownerUserId: user.id,
        personId: subjectPerson.id,
        patch: {
          kind: 'file',
          title: `Obituary — ${fullName(subjectPerson)}`,
          storage_path: storagePath,
          original_filename: file.name || null,
          content_type: mediaType,
          notes: 'Imported via Obituary importer (photo).',
        },
      });
      setProgressMsg('Asking Claude to read the obituary…');
      const created = await createImport({
        subjectPersonId: subjectPerson.id,
        ownerUserId: user.id,
        kind: 'obituary',
        sourceKind: 'photo',
        sourceStoragePath: storagePath,
        sourceDocumentId: docRow?.id || null,
      });
      const base64 = await blobToBase64(blob);
      const extraction = await extractObituary({
        imageBase64: base64,
        mimeType: mediaType,
      });
      extraction.model = 'claude-vision';
      extraction.extracted_at = new Date().toISOString();
      const updated = await updateImport(created.id, {
        rawExtraction: extraction,
      });
      try {
        const u = await getSignedUrl(storagePath);
        setPreviewUrl(u);
      } catch {
        setPreviewUrl(null);
      }
      setImportRow(updated);
      setStep('review');
    } catch (e) {
      setError(e.message || String(e));
      setStep('pick');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setProgressMsg('');
    }
  };

  // Re-run Claude on the saved source (whichever kind it was).
  const handleReExtract = async () => {
    if (!importRow) return;
    setStep('extracting');
    setError(null);
    try {
      let extraction;
      if (importRow.source_kind === 'photo' && importRow.source_storage_path) {
        setProgressMsg('Re-downloading source photo…');
        const url = await getSignedUrl(importRow.source_storage_path);
        const res = await fetch(url);
        const blob = await res.blob();
        const base64 = await blobToBase64(blob);
        setProgressMsg('Asking Claude to re-read the obituary…');
        extraction = await extractObituary({
          imageBase64: base64,
          mimeType: blob.type || 'image/jpeg',
        });
      } else if (importRow.source_kind === 'url') {
        setProgressMsg('Re-fetching the obituary page…');
        const fetched = await fetchObituaryUrl(importRow.source_url);
        await updateImport(importRow.id, {
          sourceUrl: fetched.finalUrl,
          sourceText: fetched.text,
        });
        setProgressMsg('Asking Claude to re-read the obituary…');
        extraction = await extractObituary({
          url: fetched.finalUrl,
          pastedText: fetched.text,
        });
      } else if (importRow.source_kind === 'text' && importRow.source_text) {
        setProgressMsg('Asking Claude to re-read the obituary…');
        extraction = await extractObituary({ pastedText: importRow.source_text });
      } else {
        throw new Error('No source on file for this import.');
      }
      extraction.model =
        importRow.source_kind === 'photo' ? 'claude-vision' : 'claude-text';
      extraction.extracted_at = new Date().toISOString();
      const updated = await updateImport(importRow.id, {
        rawExtraction: extraction,
      });
      setImportRow(updated);
      setStep('review');
    } catch (e) {
      setError(e.message || String(e));
      setStep('review');
    } finally {
      setProgressMsg('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start sm:items-center justify-center p-3 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full my-4 p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl text-umc-900">
              ✨ Import Obituary
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Subject: <strong>{fullName(subjectPerson)}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={step === 'extracting'}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none disabled:opacity-30"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {step === 'pick' && (
          <div className="space-y-3">
            <div className="flex gap-1 border-b border-gray-200">
              {TABS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTab(t.value)}
                  className={
                    'text-sm px-3 py-1.5 border-b-2 -mb-px ' +
                    (tab === t.value
                      ? 'border-umc-700 text-umc-900 font-medium'
                      : 'border-transparent text-gray-500 hover:text-gray-800')
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'url' && (
              <div className="space-y-2">
                <p className="text-sm text-gray-700">
                  Paste a funeral-home, newspaper, or family-blog obituary
                  URL. We fetch the page and Claude extracts the structured
                  data.
                </p>
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://benefieldfhwedowee.com/tribute/details/…"
                  className="input w-full text-sm"
                />
                <p className="text-[11px] text-gray-500">
                  If the page is behind a paywall or rendered entirely in
                  JavaScript, the URL fetch may fail — try the Pasted text
                  tab instead.
                </p>
                <button
                  type="button"
                  onClick={runUrlImport}
                  disabled={!urlInput.trim()}
                  className="btn-primary text-sm disabled:opacity-50"
                >
                  ✨ Import from URL
                </button>
              </div>
            )}

            {tab === 'text' && (
              <div className="space-y-2">
                <p className="text-sm text-gray-700">
                  Paste the obituary text directly. Useful when the source
                  page can't be fetched (paywall, login, or
                  JavaScript-only rendering).
                </p>
                <textarea
                  rows={10}
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Paste the full obituary text here…"
                  className="input w-full text-sm font-serif"
                />
                <button
                  type="button"
                  onClick={runTextImport}
                  disabled={!textInput.trim()}
                  className="btn-primary text-sm disabled:opacity-50"
                >
                  ✨ Import from text
                </button>
              </div>
            )}

            {tab === 'photo' && (
              <div className="space-y-2">
                <p className="text-sm text-gray-700">
                  Upload a photo of a printed obituary (e.g. from a
                  newspaper cutting or a funeral program). Claude vision
                  reads the text and extracts the structured data.
                </p>
                <button
                  type="button"
                  onClick={handlePickPhoto}
                  className="btn-primary text-sm"
                >
                  📸 Choose photo
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => runPhotoImport(e.target.files)}
                />
              </div>
            )}

            {error && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                {error}
              </p>
            )}
          </div>
        )}

        {step === 'extracting' && (
          <div className="text-sm text-gray-600 italic flex items-center gap-2 py-6">
            <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            {progressMsg || 'Working…'}
          </div>
        )}

        {step === 'review' && importRow && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2">
                <RecordImportReviewPanel
                  importRow={importRow}
                  subjectPerson={subjectPerson}
                  onSaved={(updated) => setImportRow(updated)}
                  onCommitted={(result) => {
                    setImportRow(result.import);
                    onCommitted?.(result);
                  }}
                  onCancel={onClose}
                />
              </div>
              <aside className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">
                  Source
                </p>
                {importRow.source_kind === 'photo' && previewUrl && (
                  <a href={previewUrl} target="_blank" rel="noreferrer">
                    <img
                      src={previewUrl}
                      alt="Obituary source photo"
                      className="w-full max-h-[60vh] object-contain border border-gray-200 rounded bg-gray-50"
                    />
                  </a>
                )}
                {importRow.source_kind === 'url' && importRow.source_url && (
                  <a
                    href={importRow.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-umc-700 hover:text-umc-900 underline break-all"
                  >
                    {importRow.source_url}
                  </a>
                )}
                {importRow.source_kind === 'text' && (
                  <pre className="text-[11px] whitespace-pre-wrap max-h-[60vh] overflow-y-auto bg-gray-50 border border-gray-200 rounded p-2">
                    {(importRow.source_text || '').slice(0, 4000)}
                    {(importRow.source_text || '').length > 4000 ? '\n…' : ''}
                  </pre>
                )}
                <button
                  type="button"
                  onClick={handleReExtract}
                  className="btn-secondary text-xs w-full"
                  title="Re-run Claude on the saved source (replaces the current extraction — your manual edits will be lost)."
                >
                  ↻ Re-run Claude
                </button>
                {error && (
                  <pre className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 whitespace-pre-wrap">
                    {error}
                  </pre>
                )}
              </aside>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// Helpers
// =====================================================================

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const comma = String(dataUrl).indexOf(',');
      resolve(comma >= 0 ? String(dataUrl).slice(comma + 1) : '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
