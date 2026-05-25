// CRUD for pastoral_document_shares — junction that lets a single
// pastoral_documents row appear on multiple linked people's PersonDetail
// pages.
//
// The document is still OWNED by one person (pastoral_documents.person_id);
// shares are read-only references from other people in the family graph.
// Unique (document_id, person_id) is enforced at the DB level (migration
// 0054) so the same document can't be shared twice to the same person.
//
// Naming convention: "owner" = the person under whose record the doc was
// originally uploaded. "share target" = the other person who can also see
// it via PersonDocuments.

import { supabase, withTimeout } from './supabase';

export async function listSharesForDocument(documentId) {
  if (!documentId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_document_shares')
      .select(
        // Pull a thin person row for the share target so the UI can
        // render "shared with [Name]" without a second round-trip.
        'id, document_id, person_id, owner_user_id, shared_by_import_id, notes, created_at, ' +
          'person:pastoral_people!pastoral_document_shares_person_id_fkey(id, first_name, middle_name, last_name, preferred_name)'
      )
      .eq('document_id', documentId)
      .order('created_at', { ascending: true })
  );
  if (error) throw error;
  return data ?? [];
}

// Documents shared TO this person (from someone else's record). Returns
// the joined pastoral_documents row PLUS a small `share` envelope so the
// UI can render the "shared from X" badge and offer to remove the share.
export async function listSharedDocsForPerson(personId) {
  if (!personId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_document_shares')
      .select(
        'id, document_id, person_id, owner_user_id, shared_by_import_id, notes, created_at, ' +
          'document:pastoral_documents!pastoral_document_shares_document_id_fkey(*), ' +
          // The doc's primary owner — for the "shared from [Name]" badge.
          // We grab the owner row by joining through pastoral_documents.person_id.
          'document_owner:pastoral_documents!pastoral_document_shares_document_id_fkey(person:pastoral_people!pastoral_documents_person_id_fkey(id, first_name, middle_name, last_name, preferred_name))'
      )
      .eq('person_id', personId)
      .order('created_at', { ascending: false })
  );
  if (error) throw error;
  // Flatten the nested join so consumers don't need to dig 3 levels deep.
  return (data ?? []).map((row) => ({
    share: {
      id: row.id,
      person_id: row.person_id,
      shared_by_import_id: row.shared_by_import_id,
      notes: row.notes,
      created_at: row.created_at,
    },
    document: row.document || null,
    owner_person: row.document_owner?.person || null,
  }));
}

export async function createShare({
  documentId,
  personId,
  ownerUserId,
  sharedByImportId = null,
  notes = null,
}) {
  if (!documentId || !personId || !ownerUserId) {
    throw new Error(
      'createShare requires documentId, personId, ownerUserId.'
    );
  }
  // Refuse silently when the share already exists — surfacing "duplicate
  // key" errors here would be ugly, and the UI just wants to know the
  // pair is wired up.
  const { data: existing, error: existErr } = await withTimeout(
    supabase
      .from('pastoral_document_shares')
      .select('id')
      .eq('document_id', documentId)
      .eq('person_id', personId)
      .limit(1)
  );
  if (existErr) throw existErr;
  if (existing && existing.length > 0) {
    return { id: existing[0].id, already_existed: true };
  }
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_document_shares')
      .insert({
        document_id: documentId,
        person_id: personId,
        owner_user_id: ownerUserId,
        shared_by_import_id: sharedByImportId,
        notes: notes?.trim() || null,
      })
      .select('*')
      .single()
  );
  if (error) throw error;
  return { ...data, already_existed: false };
}

export async function deleteShare(shareId) {
  if (!shareId) throw new Error('shareId required');
  const { error } = await withTimeout(
    supabase.from('pastoral_document_shares').delete().eq('id', shareId)
  );
  if (error) throw error;
}

// Bulk-share helper used by the importer commit step. Given a single
// document id and an array of target person ids, create shares for the
// ones that don't already exist. Returns { created, skipped } counts.
export async function bulkCreateShares({
  documentId,
  personIds,
  ownerUserId,
  sharedByImportId = null,
}) {
  if (!documentId || !ownerUserId) {
    throw new Error(
      'bulkCreateShares requires documentId and ownerUserId.'
    );
  }
  const ids = Array.from(new Set(personIds || [])).filter(Boolean);
  let created = 0;
  let skipped = 0;
  for (const pid of ids) {
    const r = await createShare({
      documentId,
      personId: pid,
      ownerUserId,
      sharedByImportId,
    });
    if (r.already_existed) skipped++;
    else created++;
  }
  return { created, skipped };
}
