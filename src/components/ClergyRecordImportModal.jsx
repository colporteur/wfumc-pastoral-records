import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { extractClergyRecord } from '../lib/claude';
import {
  createImport,
  getImport,
  updateImport,
} from '../lib/recordImports';
import { prepareImageForUpload } from '../lib/imageHelpers';
import {
  uploadDocument,
  getSignedUrl,
  createDocument,
} from '../lib/documents';
import RecordImportReviewPanel from './RecordImportReviewPanel.jsx';
import { fullName } from '../lib/people';

// "✨ Import Clergy Record" modal — opened from PersonDetail.
//
// Workflow:
//   1) Pastor uploads a photo of the funeral-home Clergy Record form.
//   2) We downscale via prepareImageForUpload (consistent with the
//      existing photo upload widgets), upload to pastoral-documents
//      bucket, AND create a pastoral_documents row pointing at it so
//      the source file lives in the person's Documents archive.
//   3) We create a pastoral_record_imports row (kind='clergy_record',
//      source_kind='photo') stamped with the document_id so the import
//      can re-render the source preview later.
//   4) Call extractClergyRecord — Claude vision returns the JSON.
//   5) Patch the import with raw_extraction, hand off to the review
//      panel so the pastor edits and commits.
//
// Re-open after the page refreshes is supported by passing an
// `existingImport` prop — Step 1-4 are skipped and we jump straight to
// the review panel.

export default function ClergyRecordImportModal({
  open,
  onClose,
  subjectPerson,
  existingImport = null,
  onCommitted,
}) {
  const { user } = useAuth();
  const fileInputRef = useRef(null);

  const [step, setStep] = useState('pick'); // 'pick' | 'extracting' | 'review'
  const [importRow, setImportRow] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);
  const [progressMsg, setProgressMsg] = useState('');

  // Reset on each open / new subject; jump to review if we were handed
  // an existing import to edit.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setProgressMsg('');
    if (existingImport) {
      setImportRow(existingImport);
      setStep('review');
      // Try to mint a signed URL for the original photo so the review
      // panel can show it next to the extracted data.
      if (existingImport.source_storage_path) {
        getSignedUrl(existingImport.source_storage_path)
          .then((u) => setPreviewUrl(u))
          .catch(() => setPreviewUrl(null));
      } else {
        setPreviewUrl(null);
      }
    } else {
      setImportRow(null);
      setPreviewUrl(null);
      setStep('pick');
    }
  }, [open, existingImport?.id, subjectPerson?.id]);

  if (!open) return null;

  const handlePickFile = () => fileInputRef.current?.click();

  const handleFile = async (files) => {
    if (!files || !files[0]) return;
    const file = files[0];
    if (!user?.id || !subjectPerson?.id) {
      setError('Missing user or subject. Refresh and try again.');
      return;
    }
    setStep('extracting');
    setError(null);
    try {
      // 1) Downscale + re-encode as JPEG so Claude (and storage) don't
      //    drag around full-resolution phone photos.
      setProgressMsg('Preparing image…');
      const { blob, mediaType } = await prepareImageForUpload(file, 2000, 0.88);
      // 2) Upload to the pastoral-documents bucket.
      setProgressMsg('Uploading source photo to your private archive…');
      const upFile = new File([blob], file.name || 'clergy-record.jpg', {
        type: mediaType,
      });
      const storagePath = await uploadDocument({
        file: upFile,
        personId: subjectPerson.id,
        ownerUserId: user.id,
      });
      // 3) Create the pastoral_documents row so it shows in the person's
      //    Documents archive too.
      setProgressMsg('Filing the photo in the Documents archive…');
      const docRow = await createDocument({
        ownerUserId: user.id,
        personId: subjectPerson.id,
        patch: {
          kind: 'file',
          title: `Clergy Record — ${fullName(subjectPerson)}`,
          storage_path: storagePath,
          original_filename: file.name || null,
          content_type: mediaType,
          notes: 'Imported via Clergy Record importer.',
        },
      });
      // 4) Create the import row, then call Claude.
      setProgressMsg('Asking Claude to read the form…');
      const created = await createImport({
        subjectPersonId: subjectPerson.id,
        ownerUserId: user.id,
        kind: 'clergy_record',
        sourceKind: 'photo',
        sourceStoragePath: storagePath,
        sourceDocumentId: docRow?.id || null,
      });
      // Base64-encode the blob for the Claude API.
      const base64 = await blobToBase64(blob);
      const extraction = await extractClergyRecord({
        imageBase64: base64,
        mimeType: mediaType,
      });
      extraction.model = 'claude-vision';
      extraction.extracted_at = new Date().toISOString();
      const updated = await updateImport(created.id, {
        rawExtraction: extraction,
      });
      // Mint preview URL for the review pane.
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

  // Re-run Claude on the existing source image (used when the pastor
  // wants a fresh extraction after editing the saved decisions).
  const handleReExtract = async () => {
    if (!importRow?.source_storage_path) {
      setError('No source image on file for this import.');
      return;
    }
    setStep('extracting');
    setError(null);
    try {
      setProgressMsg('Re-downloading source photo…');
      // Re-download the file via signed URL → blob → base64.
      const url = await getSignedUrl(importRow.source_storage_path);
      const res = await fetch(url);
      const blob = await res.blob();
      const base64 = await blobToBase64(blob);
      setProgressMsg('Asking Claude to re-read the form…');
      const extraction = await extractClergyRecord({
        imageBase64: base64,
        mimeType: blob.type || 'image/jpeg',
      });
      extraction.model = 'claude-vision';
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

  // `items-start` always (not sm:items-center) — when the modal content
  // is taller than the viewport, centering pushes the top above the
  // scroll boundary and the pastor can't reach it. Anchor at top so the
  // backdrop scrolls naturally.
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-3 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full my-4 p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl text-umc-900">
              ✨ Import Clergy Record
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
            <p className="text-sm text-gray-700">
              Upload a photo of the funeral-home Clergy Record form. Claude
              will extract the deceased's biographical information, family
              members (living + preceded-in-death), and service details.
              You'll review and edit before anything is committed to the
              directory.
            </p>
            <p className="text-[11px] text-gray-500">
              The photo is filed into <em>{fullName(subjectPerson)}</em>'s
              private Documents archive, so you can always come back to it.
            </p>
            <button
              type="button"
              onClick={handlePickFile}
              className="btn-primary text-sm"
            >
              📸 Choose photo
            </button>
            {/* No `capture` attribute — that would force phones into
                camera-only mode. Without it, mobile browsers offer the
                normal Camera / Photo Library / Files chooser. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files)}
            />
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
                  Source photo
                </p>
                {previewUrl ? (
                  <a href={previewUrl} target="_blank" rel="noreferrer">
                    <img
                      src={previewUrl}
                      alt="Clergy Record source photo"
                      className="w-full max-h-[60vh] object-contain border border-gray-200 rounded bg-gray-50"
                    />
                  </a>
                ) : (
                  <p className="text-xs italic text-gray-500">
                    (no preview)
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleReExtract}
                  className="btn-secondary text-xs w-full"
                  title="Re-run Claude on the original photo (replaces the current extraction — your manual edits will be lost)."
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
