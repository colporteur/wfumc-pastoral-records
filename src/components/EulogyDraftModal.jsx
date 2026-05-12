import { useEffect, useState } from 'react';
import { draftEulogyOutline } from '../lib/claude';
import { fullName } from '../lib/people';
import { listExtendedFamily } from '../lib/extendedFamily';
import {
  inverseRelationship,
  listLinksFor,
  relationshipLabel,
} from '../lib/familyLinks';
import { listSignificantDeaths } from '../lib/significantDeaths';
import { listPets } from '../lib/pets';
import { listInteractions, interactionTypeLabel } from '../lib/interactions';
import { listTranscripts } from '../lib/transcripts';
import { listNotes } from '../lib/notesLog';
import { listCoreIssues } from '../lib/coreIssues';
import { listLinks as listPrayerLinks } from '../lib/prayerRequests';
import { getPerson } from '../lib/people';
import { listDocuments } from '../lib/documents';

// Eulogy synthesis tool. Pastor picks which sections of the pastoral
// record to feed into Claude (all on by default). Claude returns a
// chronological eulogy outline. Pastor edits and saves into the
// person's eulogy_notes field.

const SECTIONS = [
  { key: 'identity', label: 'Identity, dates, status (always included)', alwaysOn: true },
  { key: 'faith_background', label: 'Faith background' },
  { key: 'church_roles', label: 'Church roles' },
  { key: 'family', label: 'Family (in directory)' },
  { key: 'extended_family', label: 'Extended family' },
  { key: 'significant_deaths', label: 'Significant deceased relationships' },
  { key: 'pets', label: 'Pets' },
  { key: 'preferences', label: 'Personal preferences' },
  { key: 'interactions', label: 'Pastoral interactions (sensitive)' },
  { key: 'transcripts', label: 'Conversation transcripts (sensitive)' },
  { key: 'notes', label: 'Pastoral notes log (sensitive)' },
  { key: 'core_issues', label: 'Core pastoral issues (sensitive)' },
  { key: 'prayer_requests', label: 'Prayer requests (made by / for)' },
  { key: 'documents', label: 'Documents, links, & screenshots' },
];

export default function EulogyDraftModal({ open, onClose, person, onAccept }) {
  const [enabled, setEnabled] = useState(() => new Set(SECTIONS.map((s) => s.key)));
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [outline, setOutline] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setOutline('');
      setError(null);
      setEnabled(new Set(SECTIONS.map((s) => s.key)));
    }
  }, [open]);

  if (!open || !person) return null;

  const toggle = (key) => {
    if (key === 'identity') return; // always on
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const ctx = await assembleContext(person, enabled);
      if (!ctx.trim()) {
        throw new Error(
          'No data was assembled — pick more sections or add data first.'
        );
      }
      const result = await draftEulogyOutline({
        personLabel: fullName(person),
        sectionsContext: ctx,
      });
      setOutline(result);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!outline.trim()) return;
    setSaving(true);
    setError(null);
    try {
      // Append to existing eulogy_notes if the pastor already has some,
      // separated by a horizontal rule with a date stamp. Replacing
      // outright would lose any prior pastor edits.
      const stamp = `\n\n---\n\nClaude draft, ${new Date().toLocaleString()}:\n\n`;
      const existing = (person.eulogy_notes || '').trim();
      const merged = existing ? existing + stamp + outline : outline;
      await onAccept(merged);
      onClose();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

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
            <h2 className="font-serif text-xl text-umc-900">
              Draft eulogy outline
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Pick which sections of {fullName(person) || 'this person'}'s
              record to feed Claude. Generated outline will append to the
              eulogy notes; nothing gets sent until you click Generate.
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
            <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">
              Sources to include
            </h3>
            <div className="space-y-1 overflow-y-auto pr-1">
              {SECTIONS.map((s) => {
                const checked = enabled.has(s.key);
                return (
                  <label
                    key={s.key}
                    className={
                      'flex items-center gap-2 text-sm cursor-pointer ' +
                      (s.alwaysOn ? 'text-gray-500' : '')
                    }
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(s.key)}
                      disabled={s.alwaysOn}
                      className="rounded border-gray-300"
                    />
                    <span>{s.label}</span>
                  </label>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-200">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || loading}
                className="btn-primary text-sm w-full disabled:opacity-50"
              >
                {generating
                  ? 'Asking Claude…'
                  : '✨ Generate outline'}
              </button>
              <p className="text-[10px] text-gray-500 mt-2 italic">
                Synthesis can take 30-60 seconds for a rich record.
              </p>
            </div>
          </div>

          <div className="flex flex-col min-h-0">
            <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">
              Generated outline (editable)
            </h3>
            <textarea
              className="text-xs text-gray-800 whitespace-pre-wrap font-serif leading-relaxed border border-gray-300 rounded p-3 flex-1 focus:outline-none focus:ring-2 focus:ring-umc-700"
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
              placeholder="Click Generate. The outline will appear here for you to refine before saving."
            />
            <p className="text-[10px] text-gray-500 mt-1 italic">
              Saving appends to the eulogy notes (with a timestamp
              divider) — your existing notes are preserved.
            </p>
          </div>
        </div>

        <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
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
            onClick={handleSave}
            disabled={saving || !outline.trim()}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Append to eulogy notes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Source assembly — fetches every section the pastor enabled and
// formats it as a single big text blob for Claude.
// =====================================================================

async function assembleContext(person, enabled) {
  const blocks = [];

  // 1. Identity (always)
  blocks.push(formatIdentity(person));

  if (enabled.has('faith_background') && person.faith_background?.trim()) {
    blocks.push('## FAITH BACKGROUND\n\n' + person.faith_background.trim());
  }

  if (
    enabled.has('church_roles') &&
    Array.isArray(person.church_roles) &&
    person.church_roles.length > 0
  ) {
    blocks.push(
      '## CHURCH ROLES\n\n' +
        person.church_roles.map((r) => `- ${r}`).join('\n')
    );
  }

  // 2. Family (in directory) — fetch the linked rows + their names.
  if (enabled.has('family')) {
    try {
      const links = await listLinksFor(person.id);
      if (links.length > 0) {
        const lines = [];
        for (const l of links) {
          let otherName = '(unknown)';
          try {
            const other = await getPerson(l.other_person_id);
            otherName = fullName(other);
          } catch {
            /* skip */
          }
          lines.push(
            `- ${relationshipLabel(l.displayed_relationship)}: ${otherName}` +
              (l.notes ? ` — ${l.notes}` : '')
          );
        }
        blocks.push('## FAMILY (IN PASTORAL DIRECTORY)\n\n' + lines.join('\n'));
      }
    } catch {
      /* skip silently — eulogy synthesis shouldn't fail on a side query */
    }
  }

  if (enabled.has('extended_family')) {
    try {
      const ext = await listExtendedFamily(person.id);
      if (ext.length > 0) {
        const lines = ext.map((r) => {
          const parts = [r.name];
          if (r.relationship) parts.push(`(${r.relationship})`);
          if (r.location) parts.push(`— ${r.location}`);
          if (r.notes) parts.push(`— ${r.notes}`);
          return '- ' + parts.join(' ');
        });
        blocks.push('## EXTENDED FAMILY (NOT IN DIRECTORY)\n\n' + lines.join('\n'));
      }
    } catch {
      /* skip */
    }
  }

  if (enabled.has('significant_deaths')) {
    try {
      const deaths = await listSignificantDeaths(person.id);
      if (deaths.length > 0) {
        const lines = deaths.map((d) => {
          const parts = [d.name];
          if (d.relationship) parts.push(`(${d.relationship})`);
          if (d.date_of_death)
            parts.push(`died ${new Date(d.date_of_death).toLocaleDateString()}`);
          if (d.notes) parts.push(`— ${d.notes}`);
          return '- ' + parts.join(' ');
        });
        blocks.push('## SIGNIFICANT DECEASED RELATIONSHIPS\n\n' + lines.join('\n'));
      }
    } catch {
      /* skip */
    }
  }

  if (enabled.has('pets')) {
    try {
      const pets = await listPets(person.id);
      if (pets.length > 0) {
        const lines = pets.map((p) => {
          const parts = [p.name];
          if (p.species) parts.push(`(${p.species})`);
          if (p.status === 'deceased') {
            parts.push('— deceased' +
              (p.date_of_death
                ? ` ${new Date(p.date_of_death).toLocaleDateString()}`
                : ''));
          }
          if (p.notes) parts.push(`— ${p.notes}`);
          return '- ' + parts.join(' ');
        });
        blocks.push('## PETS\n\n' + lines.join('\n'));
      }
    } catch {
      /* skip */
    }
  }

  if (
    enabled.has('preferences') &&
    Array.isArray(person.personal_preferences) &&
    person.personal_preferences.length > 0
  ) {
    const lines = person.personal_preferences
      .filter((p) => (p.label || '').trim() || (p.value || '').trim())
      .map((p) => `- ${p.label || '(unlabeled)'}: ${p.value || ''}`);
    if (lines.length > 0) {
      blocks.push('## PERSONAL PREFERENCES\n\n' + lines.join('\n'));
    }
  }

  if (enabled.has('interactions')) {
    try {
      const items = await listInteractions(person.id);
      if (items.length > 0) {
        const lines = items.map((i) => {
          const head = `### ${interactionTypeLabel(i.interaction_type)} — ${new Date(i.happened_at).toLocaleDateString()}`;
          const parts = [];
          if (i.summary) parts.push(`Summary: ${i.summary}`);
          if (i.body) parts.push(i.body);
          return head + '\n' + parts.join('\n\n');
        });
        blocks.push('## PASTORAL INTERACTIONS\n\n' + lines.join('\n\n'));
      }
    } catch {
      /* skip */
    }
  }

  if (enabled.has('transcripts')) {
    try {
      const items = await listTranscripts(person.id);
      if (items.length > 0) {
        const lines = items.map((t) => {
          const head = `### ${t.title || 'Transcript'} — ${new Date(t.recorded_at).toLocaleDateString()}`;
          // Prefer summary; fall back to truncated raw transcript.
          let body;
          if (t.summary) {
            body = t.summary;
          } else if (t.transcript_text) {
            body =
              t.transcript_text.slice(0, 3000) +
              (t.transcript_text.length > 3000 ? '\n\n…(truncated)' : '');
          } else {
            body = '(no content)';
          }
          return head + '\n' + body;
        });
        blocks.push('## CONVERSATION TRANSCRIPTS\n\n' + lines.join('\n\n'));
      }
    } catch {
      /* skip */
    }
  }

  if (enabled.has('notes')) {
    try {
      const items = await listNotes(person.id);
      if (items.length > 0) {
        const lines = items.map(
          (n) =>
            `- ${new Date(n.noted_at).toLocaleDateString()}: ${n.body}`
        );
        blocks.push('## PASTORAL NOTES LOG\n\n' + lines.join('\n'));
      }
    } catch {
      /* skip */
    }
  }

  if (enabled.has('core_issues')) {
    try {
      const items = await listCoreIssues(person.id);
      if (items.length > 0) {
        const lines = items.map((c) => {
          const parts = [`### ${c.title} (${c.status})`];
          if (c.description) parts.push(c.description);
          return parts.join('\n');
        });
        blocks.push('## CORE PASTORAL ISSUES\n\n' + lines.join('\n\n'));
      }
    } catch {
      /* skip */
    }
  }

  if (enabled.has('prayer_requests')) {
    try {
      const links = await listPrayerLinks(person.id);
      const confirmed = links.filter(
        (l) => l.relationship !== 'rejected' && l.prayer_request
      );
      if (confirmed.length > 0) {
        const lines = confirmed.map((l) => {
          const r = l.prayer_request;
          const date = r.submitted_at
            ? new Date(r.submitted_at).toLocaleDateString()
            : '';
          return `- (${l.relationship}, ${date}) ${r.request_text}`;
        });
        blocks.push('## PRAYER REQUESTS (LINKED)\n\n' + lines.join('\n'));
      }
    } catch {
      /* skip */
    }
  }

  if (enabled.has('documents')) {
    try {
      const docs = await listDocuments(person.id);
      if (docs.length > 0) {
        const lines = docs.map((d) => {
          const head = `### ${d.title || `(${d.kind})`} — ${new Date(d.created_at).toLocaleDateString()}`;
          // Prefer the summary; fall back to body / notes / url.
          let body;
          if (d.summary) body = d.summary;
          else if (d.body)
            body =
              d.body.slice(0, 2000) +
              (d.body.length > 2000 ? '\n…(truncated)' : '');
          else if (d.notes) body = d.notes;
          else if (d.url) body = `Link: ${d.url}`;
          else if (d.original_filename) body = `File: ${d.original_filename}`;
          else body = '(no content)';
          return head + '\n' + body;
        });
        blocks.push('## DOCUMENTS & ARTIFACTS\n\n' + lines.join('\n\n'));
      }
    } catch {
      /* skip */
    }
  }

  return blocks.join('\n\n');
}

function formatIdentity(p) {
  const lines = [];
  lines.push(`# ${fullName(p) || '(unnamed person)'}`);
  if (p.preferred_name && p.preferred_name !== p.first_name) {
    lines.push(`Goes by: ${p.preferred_name}`);
  }
  if (p.birthdate) lines.push(`Born: ${new Date(p.birthdate).toLocaleDateString()}`);
  if (p.is_deceased && p.death_date) {
    lines.push(`Died: ${new Date(p.death_date).toLocaleDateString()}`);
  }
  if (p.anniversary)
    lines.push(`Anniversary: ${new Date(p.anniversary).toLocaleDateString()}`);
  if (p.baptism_status === 'yes' && p.baptism_date) {
    lines.push(`Baptized: ${new Date(p.baptism_date).toLocaleDateString()}`);
  } else if (p.baptism_status === 'yes') {
    lines.push('Baptized: yes (date unrecorded)');
  } else if (p.baptism_status === 'no') {
    lines.push('Baptized: no');
  }
  if (p.is_church_member) {
    lines.push(
      'Church member' +
        (p.date_joined_church
          ? ` since ${new Date(p.date_joined_church).toLocaleDateString()}`
          : '')
    );
  }
  if (p.is_active_visitor) lines.push('Active visitor');
  if (p.notes && p.notes.trim()) {
    lines.push('');
    lines.push('General notes:');
    lines.push(p.notes.trim());
  }
  return '## IDENTITY\n\n' + lines.join('\n');
}
