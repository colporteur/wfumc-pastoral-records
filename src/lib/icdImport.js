// Map an Instant Church Directory export (the JSON file produced by the
// in-browser extractor) into pastoral_people patches.
//
// Conventions:
//   * One row per person from family.persons[]
//   * Family-level fields (address, anniversary, family phone) propagate
//     to every person in the family
//   * Family-level phone goes to home_phone on each person
//   * Person-level mobilePhoneNumber goes to cell_phone
//   * birthday lands on birthdate
//   * "In Loving Memory of <Name>" is detected by searching the family's
//     allFirstNames / adultFirstNames / childrenFirstNames text for
//     "In Loving Memory of <person.firstName>" — when matched, we mark
//     the row is_deceased=true so the pastor can fill in death_date
//     later if known.
//   * isMemberOfChurch boolean → is_church_member
//   * personType ('Adult' / 'Child' / 'Spouse' / etc.) is preserved in
//     notes so the pastor has the original ICD context

const SOURCE = 'icd';

// Detect "In Loving Memory of …" entries that ICD uses for deceased
// family members still listed for memorial purposes.
function isInLovingMemoryOf(personFirstName, familyFirstNamesAll) {
  if (!personFirstName || !familyFirstNamesAll) return false;
  const stripped = (familyFirstNamesAll || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .toLowerCase();
  const target = personFirstName.toLowerCase().trim();
  if (!target) return false;
  return new RegExp(
    'in\\s+loving\\s+memory\\s+of\\s+' +
      target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'i'
  ).test(stripped);
}

// Convert ICD's birthday format (typically "MM/DD/YYYY" or ISO) to the
// YYYY-MM-DD shape Postgres' date type wants. Returns null if unparseable.
function normalizeDate(input) {
  if (!input) return null;
  if (typeof input === 'string') {
    // Already ISO-ish?
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    // M/D/YYYY or MM/DD/YYYY
    const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.exec(input);
    if (m) {
      let [_, mo, da, yr] = m;
      if (yr.length === 2) yr = (Number(yr) > 30 ? '19' : '20') + yr;
      return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
    }
  }
  // Date object or epoch-ish
  const d = new Date(input);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// Build the patch and external_id for a single person record from the
// ICD payload. Returns null if the person isn't worth importing (e.g.
// missing first name).
export function buildPersonPatch(record, person) {
  const family = record.family || {};
  const firstName = (person.firstName || '').trim();
  if (!firstName) return null;

  const lastName =
    (person.lastNameAlt || '').trim() ||
    (family.lastName || '').trim() ||
    null;

  const allFirstNames = family.allFirstNames || '';
  const isDeceased = isInLovingMemoryOf(firstName, allFirstNames);

  // Adult vs child? ICD's personType strings vary — treat anything that
  // CONTAINS "Child" (case-insensitive) as a child for our heuristic, all
  // else as adult. Anniversary applies to adults only.
  const isChild = /child/i.test(person.personType || '');

  const patch = {
    first_name: firstName,
    last_name: lastName,
    cell_phone: person.mobilePhoneNumber || null,
    home_phone: family.phone || null,
    email: person.emailAddress || family.email || null,
    address_line1: family.address || null,
    address_line2: family.address2 || null,
    city: family.city || null,
    state: family.state || null,
    zip: family.zip || null,
    birthdate: normalizeDate(person.birthday),
    is_church_member: !!person.isMemberOfChurch,
    is_deceased: isDeceased,
    notes: composeNotes(record, person),
  };
  if (!isChild) {
    patch.anniversary = normalizeDate(family.anniversaryDate);
  }
  return {
    externalId: person.personId,
    patch,
  };
}

// Stash the bits of ICD context that don't have a structured home — the
// person type, the family's additionalDetails, the groups they're in.
// Goes into the notes field; the pastor can prune later.
function composeNotes(record, person) {
  const lines = [];
  if (person.personType) lines.push(`ICD person type: ${person.personType}`);
  if (record.family?.additionalDetails)
    lines.push(`Family details: ${record.family.additionalDetails}`);
  if (record.groups && record.groups.length > 0) {
    lines.push(
      `ICD groups: ${record.groups.map((g) => g.name).filter(Boolean).join(', ')}`
    );
  }
  if (record.familyPhones && record.familyPhones.length > 0) {
    lines.push(
      `Other family phones: ${record.familyPhones
        .map((p) => p.phoneNumber || p.number || JSON.stringify(p))
        .join(', ')}`
    );
  }
  if (record.familyEmails && record.familyEmails.length > 0) {
    lines.push(
      `Other family emails: ${record.familyEmails
        .map((e) => e.emailAddress || e.email || JSON.stringify(e))
        .join(', ')}`
    );
  }
  return lines.join('\n');
}

// Walk an ICD export blob and yield one { externalId, patch, family,
// person } for each person. Used by the importer to drive the actual
// upserts.
export function buildImportPatches(exportBlob) {
  if (!exportBlob || !Array.isArray(exportBlob.records)) return [];
  const out = [];
  for (const record of exportBlob.records) {
    const persons = record.persons || [];
    for (const person of persons) {
      const built = buildPersonPatch(record, person);
      if (built) {
        out.push({
          externalSource: SOURCE,
          externalId: built.externalId,
          patch: built.patch,
          family: record.family,
          person,
        });
      }
    }
  }
  return out;
}

export function summarizeExport(exportBlob) {
  if (!exportBlob || !Array.isArray(exportBlob.records))
    return { familyCount: 0, personCount: 0 };
  let personCount = 0;
  for (const r of exportBlob.records) personCount += (r.persons || []).length;
  return {
    familyCount: exportBlob.records.length,
    personCount,
    extractedAt: exportBlob.extractedAt,
    source: exportBlob.source,
  };
}
