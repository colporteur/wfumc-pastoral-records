import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { upsertPersonByExternalId } from '../lib/people';
import {
  buildImportPatches,
  summarizeExport,
} from '../lib/icdImport';

// Import flow for the Instant Church Directory JSON file produced by
// the in-browser extractor. Two phases:
//
//   1. PREVIEW — drag/drop or pick a JSON file. We parse it client-side,
//      build the patches, show the pastor what would be created vs
//      updated, and let them confirm.
//   2. COMMIT — iterate the patches and call upsertPersonByExternalId
//      for each. Idempotent: re-running the same export updates rows
//      in place rather than duplicating.

export default function ImportPage() {
  const { user } = useAuth();
  const fileInputRef = useRef(null);

  const [exportBlob, setExportBlob] = useState(null);
  const [filename, setFilename] = useState('');
  const [parseError, setParseError] = useState(null);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const [errors, setErrors] = useState([]);

  const summary = exportBlob ? summarizeExport(exportBlob) : null;

  const handleFiles = (files) => {
    setParseError(null);
    setResult(null);
    setErrors([]);
    if (!files || files.length === 0) return;
    const file = files[0];
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result || ''));
        if (json.source !== 'instantchurchdirectory.com') {
          throw new Error(
            'This doesn\'t look like an Instant Church Directory export. ' +
              'Expected source=\'instantchurchdirectory.com\' in the JSON.'
          );
        }
        if (!Array.isArray(json.records)) {
          throw new Error('JSON is missing the `records` array.');
        }
        setExportBlob(json);
      } catch (e) {
        setExportBlob(null);
        setParseError(e.message || String(e));
      }
    };
    reader.onerror = () => setParseError('Could not read file.');
    reader.readAsText(file);
  };

  const handleCommit = async () => {
    if (!exportBlob || !user?.id) return;
    const patches = buildImportPatches(exportBlob);
    if (patches.length === 0) {
      setParseError('No importable people found in this file.');
      return;
    }
    setRunning(true);
    setProgress({ done: 0, total: patches.length });
    setErrors([]);
    const tally = { created: 0, updated: 0, failed: 0 };
    for (let i = 0; i < patches.length; i++) {
      const { externalSource, externalId, patch, person } = patches[i];
      try {
        const { action } = await upsertPersonByExternalId({
          ownerUserId: user.id,
          externalSource,
          externalId,
          patch,
        });
        if (action === 'created') tally.created++;
        else tally.updated++;
      } catch (e) {
        tally.failed++;
        setErrors((prev) =>
          prev.length < 25
            ? [
                ...prev,
                {
                  who:
                    `${person?.firstName || ''} ${
                      person?.familyLastName || ''
                    }`.trim() || externalId,
                  error: e.message || String(e),
                },
              ]
            : prev
        );
      }
      setProgress({ done: i + 1, total: patches.length });
    }
    setResult(tally);
    setRunning(false);
  };

  const reset = () => {
    setExportBlob(null);
    setFilename('');
    setParseError(null);
    setResult(null);
    setErrors([]);
    setProgress({ done: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <Link
          to="/"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Dashboard
        </Link>
        <h1 className="font-serif text-2xl text-umc-900 mt-1">
          Import directory
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Upload an Instant Church Directory export — the JSON file
          produced by running the extractor in your browser on
          members.instantchurchdirectory.com. Each person becomes a
          pastoral record. Re-running the same import is safe — rows
          update in place rather than duplicating.
        </p>
      </div>

      {parseError && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {parseError}
        </p>
      )}

      {!exportBlob && !result && (
        <div className="card text-center space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="btn-primary"
          >
            📄 Pick JSON file
          </button>
          <p className="text-xs text-gray-500">
            Look for{' '}
            <code className="bg-gray-100 px-1 rounded">
              icd-export-YYYY-MM-DD.json
            </code>{' '}
            in your Downloads folder.
          </p>
        </div>
      )}

      {exportBlob && !result && (
        <>
          <div className="card space-y-2">
            <h2 className="font-serif text-lg text-umc-900">
              Preview: {filename}
            </h2>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>Source: {summary.source}</li>
              <li>Extracted: {new Date(summary.extractedAt).toLocaleString()}</li>
              <li>
                <strong>{summary.familyCount}</strong> families,{' '}
                <strong>{summary.personCount}</strong> people
              </li>
            </ul>
            <p className="text-xs text-gray-500">
              Each person will be upserted by their ICD personId. Re-runs
              update rows in place — no duplicates. Pastoral fields you've
              added (notes, faith background, eulogy notes, etc.) are
              preserved on update.
            </p>
          </div>

          {running ? (
            <div className="card text-center">
              <p className="text-sm text-gray-700">
                Importing… {progress.done} / {progress.total}
              </p>
              <div className="w-full bg-gray-200 rounded h-2 mt-2">
                <div
                  className="bg-umc-700 h-2 rounded"
                  style={{
                    width: `${
                      progress.total > 0
                        ? Math.round((progress.done / progress.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={reset}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCommit}
                className="btn-primary text-sm"
              >
                Run import ({summary.personCount} people)
              </button>
            </div>
          )}
        </>
      )}

      {result && (
        <div className="card space-y-3">
          <h2 className="font-serif text-lg text-umc-900">Import complete</h2>
          <ul className="text-sm space-y-1">
            <li className="text-green-700">
              ✓ Created: <strong>{result.created}</strong>
            </li>
            <li className="text-blue-700">
              ↻ Updated: <strong>{result.updated}</strong>
            </li>
            {result.failed > 0 && (
              <li className="text-red-700">
                ⚠ Failed: <strong>{result.failed}</strong>
              </li>
            )}
          </ul>
          {errors.length > 0 && (
            <details className="text-xs text-gray-700 mt-2">
              <summary className="cursor-pointer text-red-700">
                Show {errors.length} error{errors.length === 1 ? '' : 's'}
              </summary>
              <ul className="list-disc pl-6 mt-1 space-y-0.5">
                {errors.map((e, i) => (
                  <li key={i}>
                    <strong>{e.who}:</strong> {e.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Link to="/people" className="btn-secondary text-sm">
              View people
            </Link>
            <button type="button" onClick={reset} className="btn-primary text-sm">
              Import another file
            </button>
          </div>
        </div>
      )}

      <details className="text-xs text-gray-500 mt-6">
        <summary className="cursor-pointer hover:text-gray-700">
          How to produce the JSON file
        </summary>
        <ol className="list-decimal pl-6 mt-2 space-y-1">
          <li>
            Sign in to{' '}
            <code className="bg-gray-100 px-1 rounded">
              members.instantchurchdirectory.com
            </code>{' '}
            and open the Families page.
          </li>
          <li>Open DevTools (F12) → Console tab.</li>
          <li>
            Paste the in-browser extractor snippet (see the project
            README) and press Enter. Wait ~10 seconds.
          </li>
          <li>
            A file named{' '}
            <code className="bg-gray-100 px-1 rounded">
              icd-export-YYYY-MM-DD.json
            </code>{' '}
            will download to your Downloads folder.
          </li>
          <li>Come back here and pick that file.</li>
        </ol>
      </details>
    </div>
  );
}
