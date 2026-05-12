// CRUD for pastoral_significant_deaths — relatives or close friends
// who have died, surfaced on the directory person's record so the
// pastor can remember them on anniversaries and in pastoral care.

import { supabase, withTimeout } from './supabase';

const ALLOWED = [
  'name',
  'relationship',
  'date_of_death',
  'notes',
  'sort_order',
];

function normalize(patch) {
  const out = {};
  for (const k of ALLOWED) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (typeof v === 'string') v = v.trim() || null;
    if (k === 'date_of_death' && v === '') v = null;
    out[k] = v;
  }
  return out;
}

export async function listSignificantDeaths(personId) {
  if (!personId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_significant_deaths')
      .select('*')
      // Most recent deaths first by default — they're most likely to
      // still be raw for the parishioner.
      .eq('person_id', personId)
      .order('date_of_death', { ascending: false, nullsFirst: false })
      .order('sort_order', { ascending: true })
  );
  if (error) throw error;
  return data ?? [];
}

export async function createSignificantDeath({
  ownerUserId,
  personId,
  patch,
}) {
  if (!ownerUserId || !personId)
    throw new Error('Missing user or parent person.');
  if (!patch?.name?.trim()) throw new Error('Name is required.');
  const payload = {
    owner_user_id: ownerUserId,
    person_id: personId,
    ...normalize(patch),
  };
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_significant_deaths')
      .insert(payload)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function updateSignificantDeath(id, patch) {
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_significant_deaths')
      .update(normalize(patch))
      .eq('id', id)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteSignificantDeath(id) {
  const { error } = await withTimeout(
    supabase.from('pastoral_significant_deaths').delete().eq('id', id)
  );
  if (error) throw error;
}
