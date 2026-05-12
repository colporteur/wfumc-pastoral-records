// CRUD helpers for the pastoral_people table.
//
// Every record is owned by the calling user — RLS enforces this at the
// database layer. Helpers here also stamp owner_user_id on insert so
// the row is visible to its creator immediately.

import { supabase, withTimeout } from './supabase';

// Display the person's name in a consistent way across the app:
//   "Preferred (First Middle) Last"  — when preferred differs from first
//   "First Middle Last"              — otherwise
// Skips empty parts so "John Smith" doesn't render as "John  Smith".
export function fullName(p) {
  if (!p) return '';
  const first = p.first_name?.trim() || '';
  const middle = p.middle_name?.trim() || '';
  const last = p.last_name?.trim() || '';
  const preferred = p.preferred_name?.trim() || '';
  if (preferred && preferred.toLowerCase() !== first.toLowerCase()) {
    const stack = [first, middle].filter(Boolean).join(' ');
    return `${preferred}${stack ? ` (${stack})` : ''}${last ? ' ' + last : ''}`.trim();
  }
  return [first, middle, last].filter(Boolean).join(' ');
}

// Compact label for typeaheads / rosters. "Last, First" or "First Last"
// fallback when last is missing.
export function shortName(p) {
  if (!p) return '';
  const first = p.preferred_name?.trim() || p.first_name?.trim() || '';
  const last = p.last_name?.trim() || '';
  if (last && first) return `${last}, ${first}`;
  return first || last || '(unnamed)';
}

const ALLOWED_FIELDS = [
  'first_name',
  'middle_name',
  'last_name',
  'preferred_name',
  'cell_phone',
  'home_phone',
  'email',
  'social_media_profiles',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip',
  'has_house_in_wedowee_resides_elsewhere',
  'secondary_address_line1',
  'secondary_address_line2',
  'secondary_city',
  'secondary_state',
  'secondary_zip',
  'birthdate',
  'anniversary',
  'is_church_member',
  'date_joined_church',
  'is_active_visitor',
  'is_extended_family',
  'is_non_active_visitor',
  'baptism_status',
  'baptism_date',
  'church_roles',
  'on_christmas_card_list',
  'notes',
  'is_deceased',
  'faith_background',
  'personal_preferences',
  'death_date',
  'obituary_url',
  'obituary_storage_path',
  'eulogy_notes',
];

// Filter a patch object down to only fields we recognize. Empty strings
// for date fields become null (Postgres rejects '' for date columns).
function normalizePatch(patch) {
  const out = {};
  for (const k of ALLOWED_FIELDS) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (
      (k === 'birthdate' ||
        k === 'anniversary' ||
        k === 'baptism_date' ||
        k === 'date_joined_church' ||
        k === 'death_date') &&
      typeof v === 'string' &&
      v.trim() === ''
    ) {
      v = null;
    }
    if (typeof v === 'string') v = v.trim() || null;
    out[k] = v;
  }
  return out;
}

export async function listPeople({
  search = '',
  filters = {},
  includeDeceased = false,
} = {}) {
  let q = supabase
    .from('pastoral_people')
    .select('*')
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true });
  if (!includeDeceased) q = q.eq('is_deceased', false);
  // Status filters
  if (filters.is_church_member) q = q.eq('is_church_member', true);
  if (filters.is_active_visitor) q = q.eq('is_active_visitor', true);
  if (filters.is_extended_family) q = q.eq('is_extended_family', true);
  if (filters.is_non_active_visitor) q = q.eq('is_non_active_visitor', true);
  if (filters.on_christmas_card_list)
    q = q.eq('on_christmas_card_list', true);
  if (filters.is_deceased) q = q.eq('is_deceased', true);
  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    // OR-search across the common name fields. case-insensitive (ilike).
    q = q.or(
      [
        `first_name.ilike.${s}`,
        `middle_name.ilike.${s}`,
        `last_name.ilike.${s}`,
        `preferred_name.ilike.${s}`,
        `email.ilike.${s}`,
      ].join(',')
    );
  }
  const { data, error } = await withTimeout(q);
  if (error) throw error;
  return data ?? [];
}

export async function getPerson(id) {
  const { data, error } = await withTimeout(
    supabase.from('pastoral_people').select('*').eq('id', id).single()
  );
  if (error) throw error;
  return data;
}

export async function createPerson({ ownerUserId, patch }) {
  if (!ownerUserId) throw new Error('Missing user.');
  if (!patch?.first_name?.trim()) {
    throw new Error('First name is required.');
  }
  const payload = {
    owner_user_id: ownerUserId,
    ...normalizePatch(patch),
  };
  const { data, error } = await withTimeout(
    supabase.from('pastoral_people').insert(payload).select('*').single()
  );
  if (error) throw error;
  return data;
}

export async function updatePerson(id, patch) {
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_people')
      .update(normalizePatch(patch))
      .eq('id', id)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deletePerson(id) {
  const { error } = await withTimeout(
    supabase.from('pastoral_people').delete().eq('id', id)
  );
  if (error) throw error;
}
