// CRUD for pastoral_interactions.

import { supabase, withTimeout } from './supabase';

export const INTERACTION_TYPES = [
  { value: 'office_visit', label: 'Office visit' },
  { value: 'pastoral_conversation', label: 'Pastoral conversation' },
  { value: 'home_visit', label: 'Home visit' },
  { value: 'hospital_visit', label: 'Hospital visit' },
  { value: 'phone_call', label: 'Phone call' },
  { value: 'message', label: 'Text / email message' },
  { value: 'counseling_session', label: 'Counseling session' },
  { value: 'wedding', label: 'Wedding' },
  { value: 'funeral', label: 'Funeral' },
  { value: 'baptism', label: 'Baptism' },
  { value: 'communion_at_home', label: 'Communion at home' },
  { value: 'other', label: 'Other' },
];

export function interactionTypeLabel(t) {
  return INTERACTION_TYPES.find((i) => i.value === t)?.label || t;
}

const ALLOWED = [
  'interaction_type',
  'happened_at',
  'duration_minutes',
  'location',
  'summary',
  'body',
];

function normalize(patch) {
  const out = {};
  for (const k of ALLOWED) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (typeof v === 'string') v = v.trim() || null;
    if (k === 'duration_minutes') {
      v = v === '' || v === null ? null : Number(v);
      if (Number.isNaN(v)) v = null;
    }
    out[k] = v;
  }
  return out;
}

export async function listInteractions(personId) {
  if (!personId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_interactions')
      .select('*')
      .eq('person_id', personId)
      .order('happened_at', { ascending: false })
  );
  if (error) throw error;
  return data ?? [];
}

export async function createInteraction({ ownerUserId, personId, patch }) {
  if (!ownerUserId || !personId) throw new Error('Missing user or person.');
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_interactions')
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

export async function updateInteraction(id, patch) {
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_interactions')
      .update(normalize(patch))
      .eq('id', id)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteInteraction(id) {
  const { error } = await withTimeout(
    supabase.from('pastoral_interactions').delete().eq('id', id)
  );
  if (error) throw error;
}
