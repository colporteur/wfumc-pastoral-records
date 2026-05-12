// CRUD for pastoral_notes — the running note log per person.
// Named notesLog (not notes) so the file doesn't shadow the per-person
// "notes" column on pastoral_people.

import { supabase, withTimeout } from './supabase';

export async function listNotes(personId) {
  if (!personId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_notes')
      .select('*')
      .eq('person_id', personId)
      .order('noted_at', { ascending: false })
  );
  if (error) throw error;
  return data ?? [];
}

export async function createNote({ ownerUserId, personId, patch }) {
  if (!ownerUserId || !personId) throw new Error('Missing user or person.');
  if (!patch?.body?.trim()) throw new Error('Note body is required.');
  const payload = {
    owner_user_id: ownerUserId,
    person_id: personId,
    body: patch.body.trim(),
  };
  if (patch.noted_at) payload.noted_at = patch.noted_at;
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_notes')
      .insert(payload)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function updateNote(id, patch) {
  const out = {};
  if (patch.body !== undefined) {
    if (!patch.body?.trim()) throw new Error('Note body is required.');
    out.body = patch.body.trim();
  }
  if (patch.noted_at !== undefined) out.noted_at = patch.noted_at || null;
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_notes')
      .update(out)
      .eq('id', id)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteNote(id) {
  const { error } = await withTimeout(
    supabase.from('pastoral_notes').delete().eq('id', id)
  );
  if (error) throw error;
}
