// Prayer-request integration with the bulletin app's prayer_requests
// table. Two layers:
//
//   1. Fuzzy auto-match — find requests whose submitter_name OR
//      request_text contains this person's first or last name.
//   2. Manual links — pastoral_prayer_request_links rows let the
//      pastor confirm an auto-match (with a stated relationship)
//      or reject it (so it stops appearing as a suggestion).

import { supabase, withTimeout } from './supabase';

export const LINK_RELATIONSHIPS = [
  { value: 'made_by', label: 'Submitted by them' },
  { value: 'for_them', label: 'Submitted for them' },
  { value: 'both', label: 'Submitted by AND about them' },
];

export function relationshipLabel(rel) {
  return (
    LINK_RELATIONSHIPS.find((r) => r.value === rel)?.label ||
    (rel === 'rejected' ? 'Rejected' : rel)
  );
}

// Fetch every prayer request that fuzzy-matches this person. Matching
// rule: any of the person's name parts appears in submitter_name OR
// request_text (case-insensitive). Returns matches with a heuristic
// `match_kind` of 'made_by' / 'for_them' / 'both' so the UI can show
// what triggered the match.
export async function fetchAutoMatchedRequests(person) {
  if (!person) return [];
  const parts = [
    person.preferred_name,
    person.first_name,
    person.last_name,
  ]
    .map((p) => (p || '').trim())
    .filter((p) => p.length >= 2); // Skip 1-char names — too noisy.
  if (parts.length === 0) return [];

  // Build OR-clauses against submitter_name AND request_text.
  const orClauses = [];
  for (const p of parts) {
    const escaped = p.replace(/[%_]/g, ''); // strip wildcards
    orClauses.push(`submitter_name.ilike.%${escaped}%`);
    orClauses.push(`request_text.ilike.%${escaped}%`);
  }

  const { data, error } = await withTimeout(
    supabase
      .from('prayer_requests')
      .select(
        'id, category_id, submitter_name, is_anonymous, request_text, submitted_at, is_active'
      )
      .or(orClauses.join(','))
      .order('submitted_at', { ascending: false })
      .limit(50)
  );
  if (error) throw error;

  // Stamp each row with match_kind so the UI can show "submitted by"
  // vs "submitted for" hints next to the auto-suggestion.
  const lower = (s) => (s || '').toLowerCase();
  return (data ?? []).map((r) => {
    const submitter = lower(r.submitter_name);
    const text = lower(r.request_text);
    const inSubmitter = parts.some((p) => submitter.includes(lower(p)));
    const inText = parts.some((p) => text.includes(lower(p)));
    let match_kind = 'for_them';
    if (inSubmitter && inText) match_kind = 'both';
    else if (inSubmitter) match_kind = 'made_by';
    return { ...r, match_kind };
  });
}

// Fetch all manual links for this person, joined with the underlying
// prayer_requests so the UI can render the request text directly.
export async function listLinks(personId) {
  if (!personId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_prayer_request_links')
      .select(
        '*, prayer_request:prayer_requests(' +
          'id, submitter_name, is_anonymous, request_text, submitted_at, is_active' +
          ')'
      )
      .eq('person_id', personId)
      .order('created_at', { ascending: false })
  );
  if (error) throw error;
  return data ?? [];
}

// Upsert a link (one row per (person_id, prayer_request_id) pair).
export async function upsertLink({
  ownerUserId,
  personId,
  prayerRequestId,
  relationship,
  notes = '',
}) {
  if (!ownerUserId || !personId || !prayerRequestId)
    throw new Error('Missing required ids.');
  const payload = {
    owner_user_id: ownerUserId,
    person_id: personId,
    prayer_request_id: prayerRequestId,
    relationship,
    notes: notes?.trim() || null,
  };
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_prayer_request_links')
      .upsert(payload, { onConflict: 'person_id,prayer_request_id' })
      .select(
        '*, prayer_request:prayer_requests(' +
          'id, submitter_name, is_anonymous, request_text, submitted_at, is_active' +
          ')'
      )
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteLink(linkId) {
  const { error } = await withTimeout(
    supabase.from('pastoral_prayer_request_links').delete().eq('id', linkId)
  );
  if (error) throw error;
}

// Search prayer_requests by free-text — used by the "manually add a
// prayer request" flow when the auto-matcher missed one.
export async function searchPrayerRequests(query) {
  const q = (query || '').trim();
  if (!q) return [];
  const escaped = q.replace(/[%_]/g, '');
  const { data, error } = await withTimeout(
    supabase
      .from('prayer_requests')
      .select(
        'id, submitter_name, is_anonymous, request_text, submitted_at, is_active'
      )
      .or(
        `submitter_name.ilike.%${escaped}%,request_text.ilike.%${escaped}%`
      )
      .order('submitted_at', { ascending: false })
      .limit(25)
  );
  if (error) throw error;
  return data ?? [];
}
