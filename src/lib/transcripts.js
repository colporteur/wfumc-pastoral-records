// CRUD for pastoral_transcripts.

import { supabase, withTimeout } from './supabase';

const ALLOWED = [
  'title',
  'recorded_at',
  'transcript_text',
  'summary',
  'source_type',
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

export async function listTranscripts(personId) {
  if (!personId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_transcripts')
      .select('*')
      .eq('person_id', personId)
      .order('recorded_at', { ascending: false })
  );
  if (error) throw error;
  return data ?? [];
}

export async function createTranscript({ ownerUserId, personId, patch }) {
  if (!ownerUserId || !personId) throw new Error('Missing user or person.');
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_transcripts')
      .insert({
        owner_user_id: ownerUserId,
        person_id: personId,
        source_type: 'manual',
        ...normalize(patch),
      })
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function updateTranscript(id, patch) {
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_transcripts')
      .update(normalize(patch))
      .eq('id', id)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteTranscript(id) {
  const { error } = await withTimeout(
    supabase.from('pastoral_transcripts').delete().eq('id', id)
  );
  if (error) throw error;
}
