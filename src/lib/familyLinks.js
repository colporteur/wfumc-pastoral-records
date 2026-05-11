// Bidirectional family relationship links between two pastoral_people
// rows. Each relationship is stored as ONE row from A's perspective
// (relationship_a_to_b). When we display the row from B's side, we
// invert via REL_INVERSE.
//
// Symmetric relationships (spouse, sibling, cousin, in_law, other) map
// to themselves. Asymmetric pairs (parent/child, grandparent/grandchild,
// aunt_uncle/niece_nephew) flip.

import { supabase, withTimeout } from './supabase';

export const RELATIONSHIP_OPTIONS = [
  { value: 'spouse', label: 'Spouse' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'grandparent', label: 'Grandparent' },
  { value: 'grandchild', label: 'Grandchild' },
  { value: 'aunt_uncle', label: 'Aunt / Uncle' },
  { value: 'niece_nephew', label: 'Niece / Nephew' },
  { value: 'cousin', label: 'Cousin' },
  { value: 'in_law', label: 'In-law' },
  { value: 'other', label: 'Other (see notes)' },
];

const REL_INVERSE = {
  spouse: 'spouse',
  sibling: 'sibling',
  parent: 'child',
  child: 'parent',
  grandparent: 'grandchild',
  grandchild: 'grandparent',
  aunt_uncle: 'niece_nephew',
  niece_nephew: 'aunt_uncle',
  cousin: 'cousin',
  in_law: 'in_law',
  other: 'other',
};

export function inverseRelationship(rel) {
  return REL_INVERSE[rel] || rel;
}

export function relationshipLabel(rel) {
  return (
    RELATIONSHIP_OPTIONS.find((r) => r.value === rel)?.label || rel || 'Related'
  );
}

// Fetch every link involving a given person. Each returned row is
// normalized to have a `displayed_relationship` field describing the
// OTHER person's role from THIS person's perspective, plus an
// `other_person_id` pointer for convenience.
export async function listLinksFor(personId) {
  if (!personId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_family_links')
      .select('*')
      .or(`person_a_id.eq.${personId},person_b_id.eq.${personId}`)
      .order('created_at', { ascending: true })
  );
  if (error) throw error;
  return (data ?? []).map((row) => {
    if (row.person_a_id === personId) {
      return {
        ...row,
        other_person_id: row.person_b_id,
        displayed_relationship: row.relationship_a_to_b,
      };
    }
    return {
      ...row,
      other_person_id: row.person_a_id,
      displayed_relationship: inverseRelationship(row.relationship_a_to_b),
    };
  });
}

// Create a new family link, refusing to insert a duplicate (regardless
// of which side is "a" vs "b"). The relationship is stored from the
// perspective of `fromPersonId` → `toPersonId`.
export async function createLink({
  ownerUserId,
  fromPersonId,
  toPersonId,
  relationship,
  notes = '',
}) {
  if (!ownerUserId) throw new Error('Missing user.');
  if (!fromPersonId || !toPersonId)
    throw new Error('Both people are required.');
  if (fromPersonId === toPersonId)
    throw new Error('Pick a different person.');
  // Refuse duplicates between the same pair (any direction).
  const { data: existing, error: existErr } = await withTimeout(
    supabase
      .from('pastoral_family_links')
      .select('id, person_a_id, person_b_id, relationship_a_to_b')
      .or(
        `and(person_a_id.eq.${fromPersonId},person_b_id.eq.${toPersonId}),` +
          `and(person_a_id.eq.${toPersonId},person_b_id.eq.${fromPersonId})`
      )
      .limit(1)
  );
  if (existErr) throw existErr;
  if (existing && existing.length > 0) {
    throw new Error(
      'A family link already exists between these two people. ' +
        'Edit or delete it instead of adding a duplicate.'
    );
  }

  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_family_links')
      .insert({
        owner_user_id: ownerUserId,
        person_a_id: fromPersonId,
        person_b_id: toPersonId,
        relationship_a_to_b: relationship,
        notes: notes?.trim() || null,
      })
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

// Update an existing link. If `viewedFromPersonId` is provided, the
// caller's `relationship` value is interpreted from THAT person's side
// — we'll invert it before storing if `viewedFromPersonId` matches
// person_b_id rather than person_a_id.
export async function updateLink(linkId, patch, { viewedFromPersonId } = {}) {
  const allowed = {};
  if (patch.notes !== undefined) allowed.notes = patch.notes?.trim() || null;
  if (patch.relationship !== undefined) {
    let rel = patch.relationship;
    if (viewedFromPersonId) {
      // Look up which side viewedFromPersonId is on.
      const { data: row, error: getErr } = await withTimeout(
        supabase
          .from('pastoral_family_links')
          .select('person_a_id')
          .eq('id', linkId)
          .single()
      );
      if (getErr) throw getErr;
      if (row.person_a_id !== viewedFromPersonId) {
        rel = inverseRelationship(rel);
      }
    }
    allowed.relationship_a_to_b = rel;
  }
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_family_links')
      .update(allowed)
      .eq('id', linkId)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteLink(linkId) {
  const { error } = await withTimeout(
    supabase.from('pastoral_family_links').delete().eq('id', linkId)
  );
  if (error) throw error;
}
