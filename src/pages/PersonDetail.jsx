import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import CollapsibleSection from '../components/CollapsibleSection.jsx';
import PersonPhotos from '../components/PersonPhotos.jsx';
import PersonFamilyLinks from '../components/PersonFamilyLinks.jsx';
import PersonExtendedFamily from '../components/PersonExtendedFamily.jsx';
import PersonInteractions from '../components/PersonInteractions.jsx';
import PersonTranscripts from '../components/PersonTranscripts.jsx';
import PersonNotes from '../components/PersonNotes.jsx';
import PersonCoreIssues from '../components/PersonCoreIssues.jsx';
import PersonPrayerRequests from '../components/PersonPrayerRequests.jsx';
import {
  deletePerson,
  fullName,
  getPerson,
  updatePerson,
} from '../lib/people';

// Full editor for a pastoral_people row. Phase 1 fields only.
// State model: a single `draft` object mirrors the row; `dirty` tracks
// whether it differs from `saved`; an explicit "Save changes" button
// commits. Boolean checkboxes in this UI also fall under `dirty` —
// the pastor sees one save banner for everything.

export default function PersonDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);

  // Ref the Core Issues section so the interaction / transcript / note
  // components can ask it to refresh after promoting a new issue.
  const coreIssuesRef = useRef(null);
  const refreshCoreIssues = () => coreIssuesRef.current?.refresh();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const row = await getPerson(id);
      setSaved(row);
      setDraft(rowToDraft(row));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const dirty = useMemo(() => {
    if (!saved || !draft) return false;
    return JSON.stringify(rowToDraft(saved)) !== JSON.stringify(draft);
  }, [saved, draft]);

  const update = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      const row = await updatePerson(id, draftToPatch(draft));
      setSaved(row);
      setDraft(rowToDraft(row));
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        `Delete the record for ${fullName(saved)}? This cannot be undone — ` +
          `all their data is permanently removed.`
      )
    )
      return;
    try {
      await deletePerson(id);
      navigate('/people', { replace: true });
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  if (loading) return <LoadingSpinner label="Loading person…" />;
  if (!draft) {
    return (
      <div className="card text-sm text-gray-600">
        Couldn't load that record.
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <Link
            to="/people"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← People
          </Link>
          <h1 className="font-serif text-2xl text-umc-900 mt-1">
            {fullName(draft) || '(unnamed person)'}
            {draft.is_deceased && (
              <span className="ml-2 text-base font-normal text-gray-500 italic">
                (deceased)
              </span>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && !dirty && (
            <span className="text-xs text-green-700">
              Saved {savedAt.toLocaleTimeString()}
            </span>
          )}
          {dirty && (
            <span className="text-xs text-amber-700">Unsaved changes</span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <Section title="Identity" defaultOpen={true}>
        <Grid>
          <Field label="First name *">
            <input
              type="text"
              className="input"
              value={draft.first_name}
              onChange={(e) => update('first_name', e.target.value)}
            />
          </Field>
          <Field label="Middle name">
            <input
              type="text"
              className="input"
              value={draft.middle_name}
              onChange={(e) => update('middle_name', e.target.value)}
            />
          </Field>
          <Field label="Last name">
            <input
              type="text"
              className="input"
              value={draft.last_name}
              onChange={(e) => update('last_name', e.target.value)}
            />
          </Field>
          <Field label="Preferred name">
            <input
              type="text"
              className="input"
              value={draft.preferred_name}
              onChange={(e) => update('preferred_name', e.target.value)}
            />
          </Field>
        </Grid>
      </Section>

      <Section title="Photos" defaultOpen={true}>
        <PersonPhotos personId={id} />
      </Section>

      <Section title="Contact" defaultOpen={true}>
        <Grid>
          <Field label="Cell phone">
            <input
              type="tel"
              className="input"
              value={draft.cell_phone}
              onChange={(e) => update('cell_phone', e.target.value)}
            />
          </Field>
          <Field label="Home phone">
            <input
              type="tel"
              className="input"
              value={draft.home_phone}
              onChange={(e) => update('home_phone', e.target.value)}
            />
          </Field>
          <Field label="Email" full>
            <input
              type="email"
              className="input"
              value={draft.email}
              onChange={(e) => update('email', e.target.value)}
            />
          </Field>
        </Grid>
        <SocialMediaEditor
          profiles={draft.social_media_profiles}
          onChange={(p) => update('social_media_profiles', p)}
        />
      </Section>

      <Section title="Address">
        <Grid>
          <Field label="Address line 1" full>
            <input
              type="text"
              className="input"
              value={draft.address_line1}
              onChange={(e) => update('address_line1', e.target.value)}
            />
          </Field>
          <Field label="Address line 2" full>
            <input
              type="text"
              className="input"
              value={draft.address_line2}
              onChange={(e) => update('address_line2', e.target.value)}
            />
          </Field>
          <Field label="City">
            <input
              type="text"
              className="input"
              value={draft.city}
              onChange={(e) => update('city', e.target.value)}
            />
          </Field>
          <Field label="State">
            <input
              type="text"
              className="input"
              value={draft.state}
              onChange={(e) => update('state', e.target.value)}
            />
          </Field>
          <Field label="ZIP">
            <input
              type="text"
              className="input"
              value={draft.zip}
              onChange={(e) => update('zip', e.target.value)}
            />
          </Field>
        </Grid>
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer mt-3">
          <input
            type="checkbox"
            checked={draft.has_house_in_wedowee_resides_elsewhere}
            onChange={(e) =>
              update(
                'has_house_in_wedowee_resides_elsewhere',
                e.target.checked
              )
            }
            className="rounded border-gray-300"
          />
          Has a house in Wedowee but resides elsewhere
        </label>
        {draft.has_house_in_wedowee_resides_elsewhere && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <p className="text-xs text-gray-500 mb-2">Secondary address</p>
            <Grid>
              <Field label="Address line 1" full>
                <input
                  type="text"
                  className="input"
                  value={draft.secondary_address_line1}
                  onChange={(e) =>
                    update('secondary_address_line1', e.target.value)
                  }
                />
              </Field>
              <Field label="Address line 2" full>
                <input
                  type="text"
                  className="input"
                  value={draft.secondary_address_line2}
                  onChange={(e) =>
                    update('secondary_address_line2', e.target.value)
                  }
                />
              </Field>
              <Field label="City">
                <input
                  type="text"
                  className="input"
                  value={draft.secondary_city}
                  onChange={(e) => update('secondary_city', e.target.value)}
                />
              </Field>
              <Field label="State">
                <input
                  type="text"
                  className="input"
                  value={draft.secondary_state}
                  onChange={(e) => update('secondary_state', e.target.value)}
                />
              </Field>
              <Field label="ZIP">
                <input
                  type="text"
                  className="input"
                  value={draft.secondary_zip}
                  onChange={(e) => update('secondary_zip', e.target.value)}
                />
              </Field>
            </Grid>
          </div>
        )}
      </Section>

      <Section title="Status" defaultOpen={true}>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
          <Toggle
            label="Church member"
            checked={draft.is_church_member}
            onChange={(v) => update('is_church_member', v)}
          />
          <Toggle
            label="Active visitor"
            checked={draft.is_active_visitor}
            onChange={(v) => update('is_active_visitor', v)}
          />
          <Toggle
            label="Extended family"
            checked={draft.is_extended_family}
            onChange={(v) => update('is_extended_family', v)}
          />
          <Toggle
            label="Non-active visitor"
            checked={draft.is_non_active_visitor}
            onChange={(v) => update('is_non_active_visitor', v)}
          />
          <Toggle
            label="🎄 Christmas card list"
            checked={draft.on_christmas_card_list}
            onChange={(v) => update('on_christmas_card_list', v)}
          />
        </div>
        {draft.is_church_member && (
          <div className="mt-3 max-w-xs">
            <Field label="Date joined church">
              <input
                type="date"
                className="input"
                value={draft.date_joined_church}
                onChange={(e) => update('date_joined_church', e.target.value)}
              />
            </Field>
          </div>
        )}
      </Section>

      <Section title="Baptism">
        <div className="flex items-baseline gap-4 flex-wrap">
          <div>
            <span className="label">Baptized?</span>
            <div className="flex gap-3">
              {['yes', 'no', 'unknown'].map((opt) => (
                <label
                  key={opt}
                  className="inline-flex items-center gap-1.5 text-sm cursor-pointer"
                >
                  <input
                    type="radio"
                    name="baptism_status"
                    value={opt}
                    checked={draft.baptism_status === opt}
                    onChange={(e) =>
                      update('baptism_status', e.target.value)
                    }
                  />
                  <span className="capitalize">{opt}</span>
                </label>
              ))}
            </div>
          </div>
          {draft.baptism_status === 'yes' && (
            <div className="max-w-xs">
              <Field label="Date of baptism">
                <input
                  type="date"
                  className="input"
                  value={draft.baptism_date}
                  onChange={(e) => update('baptism_date', e.target.value)}
                />
              </Field>
            </div>
          )}
        </div>
      </Section>

      <Section title="Personal dates">
        <Grid>
          <Field label="Birthdate">
            <input
              type="date"
              className="input"
              value={draft.birthdate}
              onChange={(e) => update('birthdate', e.target.value)}
            />
          </Field>
          <Field label="Anniversary">
            <input
              type="date"
              className="input"
              value={draft.anniversary}
              onChange={(e) => update('anniversary', e.target.value)}
            />
          </Field>
        </Grid>
      </Section>

      <Section title="Church roles">
        <ChurchRolesEditor
          roles={draft.church_roles}
          onChange={(r) => update('church_roles', r)}
        />
      </Section>

      <Section title="Notes">
        <textarea
          className="input min-h-[120px] font-serif text-sm leading-relaxed"
          value={draft.notes}
          onChange={(e) => update('notes', e.target.value)}
          placeholder="Anything else worth remembering. (Pastoral interaction logs, prayer requests, eulogy notes, and core issues will get their own dedicated sections in later phases.)"
        />
      </Section>

      <Section title="Pastoral interactions">
        <PersonInteractions person={saved} onChanged={refreshCoreIssues} />
      </Section>

      <Section title="Conversation transcripts">
        <PersonTranscripts person={saved} onChanged={refreshCoreIssues} />
      </Section>

      <Section title="Pastoral notes log">
        <PersonNotes person={saved} onChanged={refreshCoreIssues} />
      </Section>

      <Section title="Core pastoral issues" defaultOpen={true}>
        <PersonCoreIssues personId={id} ref={coreIssuesRef} />
      </Section>

      <Section title="Prayer requests (made by / for)">
        <PersonPrayerRequests person={saved} />
      </Section>

      <Section title="Family (in directory)">
        <PersonFamilyLinks personId={id} />
      </Section>

      <Section title="Extended family (not in directory)">
        <PersonExtendedFamily personId={id} />
      </Section>

      <Section title="Deceased">
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={draft.is_deceased}
            onChange={(e) => update('is_deceased', e.target.checked)}
            className="rounded border-gray-300"
          />
          Mark as deceased
        </label>
        <p className="text-xs text-gray-500 mt-1">
          A future phase will add the full end-of-life workflow (death
          date, obituary upload, eulogy notes, eulogy synthesis tool). For
          now this just hides the person from default list views.
        </p>
      </Section>

      <div className="flex items-center justify-between pt-4 border-t border-gray-200">
        <button
          type="button"
          onClick={handleDelete}
          className="text-sm text-red-700 hover:text-red-900 underline"
        >
          Delete this record
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// --- Sub-editors ----------------------------------------------------

function SocialMediaEditor({ profiles, onChange }) {
  const list = Array.isArray(profiles) ? profiles : [];
  const update = (i, k, v) =>
    onChange(list.map((p, j) => (i === j ? { ...p, [k]: v } : p)));
  const add = () =>
    onChange([...list, { label: '', url: '' }]);
  const remove = (i) => onChange(list.filter((_, j) => j !== i));

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between mb-1">
        <span className="label mb-0">Social media profiles</span>
        <button
          type="button"
          onClick={add}
          className="text-xs text-umc-700 hover:text-umc-900 underline"
        >
          + Add profile
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-gray-500 italic">No profiles yet.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((p, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Label (e.g., Facebook)"
                className="input text-sm flex-shrink-0"
                style={{ width: '10rem' }}
                value={p.label || ''}
                onChange={(e) => update(i, 'label', e.target.value)}
              />
              <input
                type="url"
                placeholder="URL"
                className="input text-sm flex-1"
                value={p.url || ''}
                onChange={(e) => update(i, 'url', e.target.value)}
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-xs text-red-600 hover:text-red-800 underline whitespace-nowrap"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChurchRolesEditor({ roles, onChange }) {
  const list = Array.isArray(roles) ? roles : [];
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (list.includes(v)) {
      setDraft('');
      return;
    }
    onChange([...list, v]);
    setDraft('');
  };
  const remove = (i) => onChange(list.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {list.length === 0 && (
          <p className="text-xs text-gray-500 italic">No roles yet.</p>
        )}
        {list.map((r, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 text-xs bg-umc-50 text-umc-900 border border-umc-200 rounded px-2 py-0.5"
          >
            {r}
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-umc-700 hover:text-umc-900"
              aria-label={`Remove ${r}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          className="input text-sm flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="e.g., SPRC chair, Trustee, Sunday School teacher"
        />
        <button
          type="button"
          onClick={add}
          className="btn-secondary text-sm"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// --- Layout helpers --------------------------------------------------

// Local Section helper forwards to CollapsibleSection, deriving a
// per-section storageKey from the title so open/closed state survives
// page reloads. defaultOpen defaults to false (most sections collapse);
// the call site passes defaultOpen={true} for the few that should
// start expanded.
function Section({ title, defaultOpen = false, badge, children }) {
  const storageKey = `pastoral.section.${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')}.open`;
  return (
    <CollapsibleSection
      title={title}
      defaultOpen={defaultOpen}
      storageKey={storageKey}
      badge={badge}
    >
      {children}
    </CollapsibleSection>
  );
}

function Grid({ children }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
  );
}

function Field({ label, children, full }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-gray-300"
      />
      <span>{label}</span>
    </label>
  );
}

// --- Row <-> draft adapters ------------------------------------------

const TEXT_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'preferred_name',
  'cell_phone', 'home_phone', 'email',
  'address_line1', 'address_line2', 'city', 'state', 'zip',
  'secondary_address_line1', 'secondary_address_line2',
  'secondary_city', 'secondary_state', 'secondary_zip',
  'notes',
];
const DATE_FIELDS = [
  'birthdate', 'anniversary', 'baptism_date', 'date_joined_church',
];
const BOOL_FIELDS = [
  'is_church_member', 'is_active_visitor', 'is_extended_family',
  'is_non_active_visitor', 'on_christmas_card_list',
  'has_house_in_wedowee_resides_elsewhere', 'is_deceased',
];

function rowToDraft(row) {
  const out = {};
  for (const k of TEXT_FIELDS) out[k] = row[k] ?? '';
  for (const k of DATE_FIELDS) out[k] = row[k] ?? '';
  for (const k of BOOL_FIELDS) out[k] = !!row[k];
  out.baptism_status = row.baptism_status || 'unknown';
  out.church_roles = Array.isArray(row.church_roles) ? row.church_roles : [];
  out.social_media_profiles = Array.isArray(row.social_media_profiles)
    ? row.social_media_profiles
    : [];
  return out;
}

function draftToPatch(draft) {
  // Strip empty social media rows so we don't persist {label:'', url:''} junk.
  const profiles = (draft.social_media_profiles || []).filter(
    (p) => (p.label || '').trim() || (p.url || '').trim()
  );
  return { ...draft, social_media_profiles: profiles };
}
