// CRUD for pastoral_extended_family — child records under a directory
// person, capturing relatives who AREN'T in the directory themselves.

import { supabase, withTimeout } from './supabase';

export async function listExtendedFamily(personId) {
  if (!personId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_extended_family')
      .select('*')
      .eq('person_id', personId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
  );
  if (error) throw error;
  return data ?? [];
}

const ALLOWED = [
  'name',
  'location',
  'gender',
  'age',
  'relationship',
  'visit_history',
  'notes',
  'sort_order',
];

function normalize(patch) {
  const out = {};
  for (const k of ALLOWED) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (typeof v === 'string') v = v.trim() || null;
    out[k] = v;
  }
  return out;
}

export async function createExtendedFamily({
  ownerUserId,
  personId,
  patch,
}) {
  if (!ownerUserId || !personId)
    throw new Error('Missing user or parent person.');
  if (!patch?.name?.trim()) throw new Error('Name is required.');
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_extended_family')
      .insert({
        owner_user_id: ownerUserId,
        person_id: personId,
        ...normalize(patch),
      })
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function updateExtendedFamily(id, patch) {
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_extended_family')
      .update(normalize(patch))
      .eq('id', id)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteExtendedFamily(id) {
  const { error } = await withTimeout(
    supabase.from('pastoral_extended_family').delete().eq('id', id)
  );
  if (error) throw error;
}
