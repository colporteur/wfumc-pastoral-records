// CRUD for pastoral_pets — sub-records under a directory person.

import { supabase, withTimeout } from './supabase';

const ALLOWED = [
  'name',
  'species',
  'status',
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

export async function listPets(personId) {
  if (!personId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_pets')
      .select('*')
      .eq('person_id', personId)
      .order('status', { ascending: true })       // living first, deceased after
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
  );
  if (error) throw error;
  return data ?? [];
}

export async function createPet({ ownerUserId, personId, patch }) {
  if (!ownerUserId || !personId)
    throw new Error('Missing user or parent person.');
  if (!patch?.name?.trim()) throw new Error("Pet's name is required.");
  const payload = {
    owner_user_id: ownerUserId,
    person_id: personId,
    status: 'living',
    ...normalize(patch),
  };
  const { data, error } = await withTimeout(
    supabase.from('pastoral_pets').insert(payload).select('*').single()
  );
  if (error) throw error;
  return data;
}

export async function updatePet(id, patch) {
  // If status flips from deceased back to living, clear the date.
  const out = normalize(patch);
  if (out.status === 'living') out.date_of_death = null;
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_pets')
      .update(out)
      .eq('id', id)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deletePet(id) {
  const { error } = await withTimeout(
    supabase.from('pastoral_pets').delete().eq('id', id)
  );
  if (error) throw error;
}
