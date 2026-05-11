import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { createPerson } from '../lib/people';

// Phase 1 stub for the directory-import flow. Accepts pasted CSV text
// with a fixed header set so the pastor can move data over from the
// church's online directory (manually copy/paste the table for now;
// proper scraping integration comes in a later phase).
//
// CSV header expected (first row): first_name,last_name,email,cell_phone
//
// Each row creates one pastoral_people record. Empty cells are OK.

const EXPECTED_HEADER = ['first_name', 'last_name', 'email', 'cell_phone'];

export default function ImportPage() {
  const { user } = useAuth();
  const [csvText, setCsvText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleImport = async () => {
    if (!user?.id) return;
    if (!csvText.trim()) {
      setError('Paste some CSV text first.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const rows = parseCsv(csvText);
      if (rows.length === 0) {
        throw new Error('No data rows found in the pasted text.');
      }
      const header = rows[0].map((c) => c.trim().toLowerCase());
      const headerOk = EXPECTED_HEADER.every((h) => header.includes(h));
      if (!headerOk) {
        throw new Error(
          `First row must include the columns: ${EXPECTED_HEADER.join(', ')}.\n` +
            `Found: ${header.join(', ')}`
        );
      }
      const idx = Object.fromEntries(
        EXPECTED_HEADER.map((k) => [k, header.indexOf(k)])
      );
      const created = [];
      const failed = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (r.every((c) => !c || !c.trim())) continue;
        const patch = {
          first_name: pickCell(r, idx.first_name),
          last_name: pickCell(r, idx.last_name),
          email: pickCell(r, idx.email),
          cell_phone: pickCell(r, idx.cell_phone),
        };
        if (!patch.first_name) {
          failed.push({ row: i + 1, reason: 'No first name' });
          continue;
        }
        try {
          await createPerson({ ownerUserId: user.id, patch });
          created.push(patch);
        } catch (e) {
          failed.push({ row: i + 1, reason: e.message || String(e) });
        }
      }
      setResult({ created: created.length, failed });
      if (created.length > 0) setCsvText('');
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
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
          Paste CSV text below to bulk-create pastoral records. The first
          row must be the header line; expected columns:{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">
            {EXPECTED_HEADER.join(', ')}
          </code>
          . Extra columns are ignored.
        </p>
        <p className="text-xs text-gray-500 mt-1">
          A future phase will add a proper church-directory scraper /
          field-mapper. For now this is the manual paste path.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 whitespace-pre-wrap">
          {error}
        </p>
      )}

      <div className="card space-y-3">
        <textarea
          className="input min-h-[240px] font-mono text-xs"
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={`first_name,last_name,email,cell_phone\nJohn,Smith,john@example.com,555-555-1234\nJane,Doe,jane@example.com,`}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleImport}
            disabled={busy || !csvText.trim()}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Import rows'}
          </button>
        </div>
      </div>

      {result && (
        <div className="card text-sm space-y-2">
          <p className="text-green-700">
            ✓ Imported {result.created} record{result.created === 1 ? '' : 's'}.
          </p>
          {result.failed.length > 0 && (
            <div>
              <p className="text-red-700">
                {result.failed.length} row{result.failed.length === 1 ? '' : 's'}{' '}
                failed:
              </p>
              <ul className="list-disc pl-6 text-xs text-gray-700 mt-1">
                {result.failed.slice(0, 20).map((f, i) => (
                  <li key={i}>
                    Row {f.row}: {f.reason}
                  </li>
                ))}
                {result.failed.length > 20 && (
                  <li>… and {result.failed.length - 20} more</li>
                )}
              </ul>
            </div>
          )}
          <Link to="/people" className="btn-secondary text-sm inline-block">
            View people
          </Link>
        </div>
      )}
    </div>
  );
}

function pickCell(row, idx) {
  if (idx === undefined || idx < 0) return '';
  return (row[idx] || '').trim();
}

// Tiny CSV parser. Handles quoted fields with commas inside; assumes \n
// or \r\n line endings. Doesn't handle escaped quotes in fields perfectly
// but is good enough for a directory paste.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
  }
  // Flush any trailing cell / row.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
