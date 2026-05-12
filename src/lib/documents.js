// Storage helpers for pastoral_documents bucket. Used in Phase 6 for
// the obituary-file upload, and in Phase 7 for the documents archive.
//
// Bucket: pastoral-documents (private — see migration 0050)
// Path layout: <owner_user_id>/<person_id>/<timestamp>-<rand>.<ext>
// Read via supabase.storage.createSignedUrl().

import { supabase, withTimeout } from './supabase';

const BUCKET = 'pastoral-documents';
const SIGNED_URL_TTL_SECONDS = 3600;

function makeStoragePath(ownerUserId, personId, originalFilename) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  // Keep extension if present so the file opens correctly when downloaded.
  const m = /\.([a-z0-9]{2,8})$/i.exec(originalFilename || '');
  const ext = m ? '.' + m[1].toLowerCase() : '';
  return `${ownerUserId}/${personId}/${ts}-${rand}${ext}`;
}

// Upload a file to the pastoral-documents bucket. Returns the storage
// path so the caller can persist it on whatever row triggered the
// upload (pastoral_people.obituary_storage_path, etc.).
export async function uploadDocument({
  file,
  personId,
  ownerUserId,
}) {
  if (!file) throw new Error('No file selected.');
  if (!personId || !ownerUserId)
    throw new Error('Missing person or user.');
  const path = makeStoragePath(ownerUserId, personId, file.name);
  const { error } = await withTimeout(
    supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      cacheControl: '3600',
      upsert: false,
    })
  );
  if (error) throw error;
  return path;
}

export async function deleteDocument(path) {
  if (!path) return;
  const { error } = await withTimeout(
    supabase.storage.from(BUCKET).remove([path])
  );
  if (error && !/not found/i.test(error.message || '')) throw error;
}

// Generate a short-lived signed URL for reading a single document.
export async function getSignedUrl(path) {
  if (!path) return null;
  const { data, error } = await withTimeout(
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  );
  if (error) throw error;
  return data?.signedUrl || null;
}
