// CRUD for pastoral_core_issues plus a "promote from source" helper
// that one-click-creates a core issue from an interaction / transcript
// / note row.

import { supabase, withTimeout } from './supabase';

export const CORE_ISSUE_STATUSES = [
  { value: 'open', label: 'Open', color: 'red' },
  { value: 'monitoring', label: 'Monitoring', color: 'amber' },
  { value: 'resolved', label: 'Resolved', color: 'green' },
];

export function statusLabel(s) {
  return CORE_ISSUE_STATUSES.find((x) => x.value === s)?.label || s;
}

export function statusColor(s) {
  return CORE_ISSUE_STATUSES.find((x) => x.value === s)?.color || 'gray';
}

export async function listCoreIssues(personId) {
  if (!personId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_core_issues')
      .select('*')
      .eq('person_id', personId)
      // Open first, then monitoring, then resolved; newest first within
      // each bucket.
      .order('status', { ascending: true })
      .order('created_at', { ascending: false })
  );
  if (error) throw error;
  return data ?? [];
}

export async function createCoreIssue({
  ownerUserId,
  personId,
  patch,
}) {
  if (!ownerUserId || !personId) throw new Error('Missing user or person.');
  if (!patch?.title?.trim()) throw new Error('Title is required.');
  const payload = {
    owner_user_id: ownerUserId,
    person_id: personId,
    title: patch.title.trim(),
    description: patch.description?.trim() || null,
    status: patch.status || 'open',
    source_type: patch.source_type || 'manual',
    source_id: patch.source_id || null,
  };
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_core_issues')
      .insert(payload)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function updateCoreIssue(id, patch) {
  const out = {};
  if (patch.title !== undefined)
    out.title = patch.title?.trim() || null;
  if (patch.description !== undefined)
    out.description = patch.description?.trim() || null;
  if (patch.status !== undefined) {
    out.status = patch.status;
    // Stamp resolved_at when the user moves an issue to resolved;
    // clear it on re-open.
    if (patch.status === 'resolved' && !patch.resolved_at) {
      out.resolved_at = new Date().toISOString();
    } else if (patch.status !== 'resolved') {
      out.resolved_at = null;
    }
  }
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_core_issues')
      .update(out)
      .eq('id', id)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteCoreIssue(id) {
  const { error } = await withTimeout(
    supabase.from('pastoral_core_issues').delete().eq('id', id)
  );
  if (error) throw error;
}

// Promote a source row (interaction / transcript / note) into a core
// pastoral issue. Pre-fills title from the source's most descriptive
// field; pastor edits before/after.
export async function promoteToCoreIssue({
  ownerUserId,
  personId,
  source,
  sourceType,  // 'interaction' | 'transcript' | 'note'
  titleOverride,
}) {
  let title = titleOverride;
  let description = '';
  if (!title) {
    if (sourceType === 'interaction') {
      title = source.summary || source.body?.slice(0, 60) || 'Pastoral concern';
      description = source.body || '';
    } else if (sourceType === 'transcript') {
      title = source.title || source.summary?.slice(0, 60) || 'From transcript';
      description = source.summary || source.transcript_text?.slice(0, 500) || '';
    } else if (sourceType === 'note') {
      title = source.body?.slice(0, 60) || 'Note';
      description = source.body || '';
    } else {
      title = 'Pastoral concern';
    }
  }
  return createCoreIssue({
    ownerUserId,
    personId,
    patch: {
      title,
      description,
      status: 'open',
      source_type: sourceType,
      source_id: source.id,
    },
  });
}
