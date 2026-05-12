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

// Batch signed-URL fetch for many storage paths — same convenience
// helper as fetchSignedUrls in lib/photos.js, scoped to this bucket.
// Returns Map<path, signedUrl>.
export async function fetchSignedUrls(paths) {
  if (!paths || paths.length === 0) return new Map();
  const { data, error } = await withTimeout(
    supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
  );
  if (error) throw error;
  const out = new Map();
  for (const r of data ?? []) {
    if (r.path && r.signedUrl) out.set(r.path, r.signedUrl);
  }
  return out;
}

// =====================================================================
// pastoral_documents table CRUD (Phase 7)
// =====================================================================

const DOC_ALLOWED = [
  'kind',
  'title',
  'storage_path',
  'url',
  'body',
  'notes',
  'summary',
  'content_type',
  'original_filename',
  'sort_order',
];

function normalizeDoc(patch) {
  const out = {};
  for (const k of DOC_ALLOWED) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (typeof v === 'string') v = v.trim() || null;
    out[k] = v;
  }
  return out;
}

export async function listDocuments(personId) {
  if (!personId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_documents')
      .select('*')
      .eq('person_id', personId)
      .order('created_at', { ascending: false })
  );
  if (error) throw error;
  return data ?? [];
}

export async function createDocument({ ownerUserId, personId, patch }) {
  if (!ownerUserId || !personId)
    throw new Error('Missing user or person.');
  const payload = {
    owner_user_id: ownerUserId,
    person_id: personId,
    kind: 'file',
    ...normalizeDoc(patch),
  };
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_documents')
      .insert(payload)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function updateDocument(id, patch) {
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_documents')
      .update(normalizeDoc(patch))
      .eq('id', id)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

// Delete the metadata row AND clean up storage if there's a file attached.
export async function deleteDocumentRow(doc) {
  if (!doc?.id) throw new Error('Bad document row.');
  if (doc.storage_path) {
    try {
      await deleteDocument(doc.storage_path);
    } catch {
      /* best-effort — surface only the metadata-delete error if any */
    }
  }
  const { error } = await withTimeout(
    supabase.from('pastoral_documents').delete().eq('id', doc.id)
  );
  if (error) throw error;
}

// Image-extension test so the gallery can render inline thumbnails.
export function isImageDocument(doc) {
  if (!doc) return false;
  if (doc.content_type && doc.content_type.startsWith('image/')) return true;
  const name = doc.original_filename || doc.storage_path || '';
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(name);
}
