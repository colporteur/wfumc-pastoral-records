// Pastoral photo storage helpers.
//
// Bucket: pastoral-photos (private — see migration 0047).
// Path layout: <owner_user_id>/<person_id>/<timestamp>-<rand>.jpg
//
// Photos are NEVER public. Display via signed URLs from
// supabase.storage.createSignedUrl(). The signed URL pattern means a
// third party who somehow gets a storage_path string still can't view
// the image — they need a fresh signed URL, which requires the pastor's
// session.

import { supabase, withTimeout } from './supabase';
import { prepareImageForUpload } from './imageHelpers';

const BUCKET = 'pastoral-photos';
// 1 hour signed URLs — long enough to scroll a long person record
// without re-fetching, short enough that a leaked URL expires soon.
const SIGNED_URL_TTL_SECONDS = 3600;

function makeStoragePath(ownerUserId, personId) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ownerUserId}/${personId}/${ts}-${rand}.jpg`;
}

// Cheap count of how many photo rows a person has. Used by the
// importer to decide whether to seed a family photo (we only seed
// when the person has 0 photos so we don't trample anything the
// pastor uploaded by hand).
export async function countPhotos(personId) {
  if (!personId) return 0;
  const { count, error } = await withTimeout(
    supabase
      .from('pastoral_people_photos')
      .select('id', { count: 'exact', head: true })
      .eq('person_id', personId)
  );
  if (error) throw error;
  return count ?? 0;
}

// List all photos for a person, oldest first within sort_order.
export async function listPhotos(personId) {
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_people_photos')
      .select('*')
      .eq('person_id', personId)
      .order('is_main', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
  );
  if (error) throw error;
  return data ?? [];
}

// Upload a single image file. Resizes to JPEG, uploads to storage,
// inserts the metadata row. If the person has no photos yet, this
// upload is automatically marked is_main so they immediately get a
// thumbnail.
export async function uploadPhoto({
  file,
  personId,
  ownerUserId,
  caption = '',
}) {
  if (!file) throw new Error('No file selected.');
  if (!personId || !ownerUserId) throw new Error('Missing person or user.');

  // 1. Resize + re-encode as JPEG.
  const { blob, mediaType } = await prepareImageForUpload(file);

  // 2. Upload to storage.
  const path = makeStoragePath(ownerUserId, personId);
  const { error: upErr } = await withTimeout(
    supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: mediaType,
      cacheControl: '3600',
      upsert: false,
    })
  );
  if (upErr) throw upErr;

  // 3. Decide whether this should be the main photo (first upload wins).
  const { count: existingCount, error: countErr } = await withTimeout(
    supabase
      .from('pastoral_people_photos')
      .select('id', { count: 'exact', head: true })
      .eq('person_id', personId)
  );
  if (countErr) throw countErr;
  const isMain = (existingCount ?? 0) === 0;

  // 4. Insert metadata row.
  const { data: row, error: insErr } = await withTimeout(
    supabase
      .from('pastoral_people_photos')
      .insert({
        person_id: personId,
        owner_user_id: ownerUserId,
        storage_path: path,
        original_filename: file.name || null,
        caption: caption?.trim() || null,
        is_main: isMain,
        sort_order: existingCount ?? 0,
      })
      .select('*')
      .single()
  );
  if (insErr) {
    // Try to clean up the orphaned storage object so we don't pile up
    // bytes that have no metadata pointer.
    try {
      await supabase.storage.from(BUCKET).remove([path]);
    } catch {
      /* best-effort */
    }
    throw insErr;
  }
  return row;
}

// Update caption / sort_order on an existing photo row.
export async function updatePhoto(id, patch) {
  const allowed = {};
  if (patch.caption !== undefined)
    allowed.caption = patch.caption?.trim?.() || null;
  if (patch.sort_order !== undefined) allowed.sort_order = patch.sort_order;
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_people_photos')
      .update(allowed)
      .eq('id', id)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

// Set a given photo as the main photo for its person. Atomically
// unsets any existing main first so the partial-unique-index doesn't
// reject the new one.
export async function setAsMain(photo) {
  if (!photo?.id || !photo?.person_id) throw new Error('Bad photo row.');
  // Unset any current main (best-effort; null no-op if there isn't one).
  const { error: clrErr } = await withTimeout(
    supabase
      .from('pastoral_people_photos')
      .update({ is_main: false })
      .eq('person_id', photo.person_id)
      .eq('is_main', true)
  );
  if (clrErr) throw clrErr;
  const { data, error: setErr } = await withTimeout(
    supabase
      .from('pastoral_people_photos')
      .update({ is_main: true })
      .eq('id', photo.id)
      .select('*')
      .single()
  );
  if (setErr) throw setErr;
  return data;
}

// Delete the metadata row AND the underlying storage object. If
// metadata delete succeeds but storage cleanup fails we surface it,
// since the inverse (orphaned storage with no metadata) is harder to
// notice. Storage cleanup runs first so a failed metadata delete
// doesn't leave a stale row pointing at a missing file.
export async function deletePhoto(photo) {
  if (!photo?.id) throw new Error('Bad photo row.');
  if (photo.storage_path) {
    const { error: rmErr } = await withTimeout(
      supabase.storage.from(BUCKET).remove([photo.storage_path])
    );
    if (rmErr && !/not found/i.test(rmErr.message || '')) throw rmErr;
  }
  const { error: delErr } = await withTimeout(
    supabase.from('pastoral_people_photos').delete().eq('id', photo.id)
  );
  if (delErr) throw delErr;
}

// Generate signed URLs for a batch of storage paths. Returns a Map of
// path → signedUrl. Callers should treat URLs as short-lived (~1hr).
export async function fetchSignedUrls(paths) {
  if (!paths || paths.length === 0) return new Map();
  const { data, error } = await withTimeout(
    supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
  );
  if (error) throw error;
  const out = new Map();
  for (const r of data ?? []) {
    if (r.path && r.signedUrl) out.set(r.path, r.signedUrl);
  }
  return out;
}

// Convenience: resolve the main-photo signed URL for a list of person
// IDs. Returns Map<personId, signedUrl>. Useful for the list page
// thumbnails.
export async function fetchMainPhotoUrlsForPeople(personIds) {
  if (!personIds || personIds.length === 0) return new Map();
  const { data: photos, error } = await withTimeout(
    supabase
      .from('pastoral_people_photos')
      .select('person_id, storage_path')
      .in('person_id', personIds)
      .eq('is_main', true)
  );
  if (error) throw error;
  const paths = (photos ?? []).map((p) => p.storage_path).filter(Boolean);
  if (paths.length === 0) return new Map();
  const urlByPath = await fetchSignedUrls(paths);
  const out = new Map();
  for (const p of photos) {
    const url = urlByPath.get(p.storage_path);
    if (url) out.set(p.person_id, url);
  }
  return out;
}
