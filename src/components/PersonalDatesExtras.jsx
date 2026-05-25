import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listLinksFor } from '../lib/familyLinks';
import { listSignificantDeaths } from '../lib/significantDeaths';
import { getPerson, fullName } from '../lib/people';

// "Anniversaries to remember" — derived view that lives below the
// Birthdate/Anniversary inputs in PersonDetail's Personal dates section.
//
// Aggregates three sources, all owner-scoped via RLS:
//   1) pastoral_significant_deaths for this person — gives us deceased
//      relatives (often the ones NOT in the directory) with a known
//      date_of_death and free-text relationship.
//   2) pastoral_family_links where the OTHER person is in the directory
//      AND marked deceased (pastoral_people.is_deceased + death_date).
//      Their death is a "death anniversary".
//   3) Same set as (2), but using the deceased family member's
//      birthdate — "birthday of a deceased mother", which the pastor
//      often wants to remember even though the person is gone.
//
// Sorted by next-upcoming month/day. Items within the next 30 days get
// a soft umc-50 highlight + an "in Xd" suffix so they pop visually.
//
// This is a read-only derivation. To EDIT a row, the pastor goes to
// the source row's section (Significant deaths, Family links, or the
// linked person's own End-of-life section). We deliberately don't add
// editing here to keep the UX focused on remembering.
//
// `refreshKey` (optional) lets the parent force a re-fetch — used by
// PersonDetail to refresh after an import commits new significant_deaths
// or family_links rows.

export default function PersonalDatesExtras({ personId, refreshKey }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [significantDeaths, setSignificantDeaths] = useState([]);
  const [linkedFamily, setLinkedFamily] = useState([]); // hydrated

  useEffect(() => {
    let cancelled = false;
    if (!personId) {
      setSignificantDeaths([]);
      setLinkedFamily([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [deaths, links] = await Promise.all([
          listSignificantDeaths(personId),
          listLinksFor(personId),
        ]);
        // Hydrate the OTHER person on each family link so we can read
        // birthdate / death_date / is_deceased. Tiny dataset (typical:
        // 1-15 links), capped at 30 to keep the burst sane.
        const otherIds = Array.from(
          new Set(links.map((l) => l.other_person_id).filter(Boolean))
        ).slice(0, 30);
        const others = await Promise.all(
          otherIds.map((id) => getPerson(id).catch(() => null))
        );
        const byId = new Map();
        for (const row of others) if (row) byId.set(row.id, row);
        const hydrated = links.map((l) => ({
          ...l,
          other_person: byId.get(l.other_person_id) || null,
        }));
        if (cancelled) return;
        setSignificantDeaths(deaths || []);
        setLinkedFamily(hydrated);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [personId, refreshKey]);

  // Build the unified anniversary list. Memoised so we don't re-sort
  // on every render — recomputed only when the source data changes.
  const anniversaries = useMemo(() => {
    const items = [];

    // 1) Significant deaths — death anniversaries.
    for (const d of significantDeaths) {
      if (!d.date_of_death) continue;
      items.push({
        key: `sd:${d.id}`,
        kind: 'death',
        name: d.name,
        relationship: d.relationship || '',
        date: d.date_of_death,
        // No personId — significant_deaths people often aren't in the
        // directory. Surface the row but don't render a link.
        linkToPersonId: null,
        source: 'significant_deaths',
      });
    }

    // 2 & 3) Linked family who are deceased.
    for (const l of linkedFamily) {
      const p = l.other_person;
      if (!p || !p.is_deceased) continue;
      const displayedRel = l.displayed_relationship || 'family';
      const personLabel = fullName(p);
      if (p.death_date) {
        items.push({
          key: `link-death:${l.id}`,
          kind: 'death',
          name: personLabel,
          relationship: displayedRel,
          date: p.death_date,
          linkToPersonId: p.id,
          source: 'family_links',
        });
      }
      if (p.birthdate) {
        items.push({
          key: `link-birth:${l.id}`,
          kind: 'birthday',
          name: personLabel,
          relationship: displayedRel,
          date: p.birthdate,
          linkToPersonId: p.id,
          source: 'family_links',
        });
      }
    }

    // Compute days-until-next-occurrence for each row, then sort by
    // soonest. We use the recurring (month/day) component of the
    // original date — the year is just for the original-event label.
    const today = new Date();
    const todayY = today.getFullYear();
    const todayM = today.getMonth();
    const todayD = today.getDate();
    const todayOrdinal = todayM * 31 + todayD; // crude but monotonic
    for (const it of items) {
      const parsed = parseIsoDate(it.date);
      it._parsed = parsed;
      if (!parsed) {
        it._daysUntil = 9999;
        continue;
      }
      const m = parsed.getMonth();
      const d = parsed.getDate();
      const ordinal = m * 31 + d;
      const occursThisYear = ordinal >= todayOrdinal;
      const next = new Date(
        occursThisYear ? todayY : todayY + 1,
        m,
        d
      );
      // Account for leap-day-on-non-leap years: JS will roll Feb 29 to
      // Mar 1 automatically, which is the conventional pastoral choice.
      const ms = next.getTime() - new Date(todayY, todayM, todayD).getTime();
      it._daysUntil = Math.round(ms / (1000 * 60 * 60 * 24));
      it._yearsAgo = todayY - parsed.getFullYear();
    }
    items.sort((a, b) => a._daysUntil - b._daysUntil);
    return items;
  }, [significantDeaths, linkedFamily]);

  if (!personId) return null;
  if (loading) {
    return (
      <p className="text-[11px] italic text-gray-500 mt-2">
        Loading anniversaries…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mt-2">
        Couldn't load anniversaries: {error}
      </p>
    );
  }
  if (anniversaries.length === 0) {
    return (
      <p className="text-[11px] italic text-gray-500 mt-2">
        No deceased family in the record yet. Death anniversaries and
        post-mortem birthdays of linked or significant-death relatives
        will appear here once they're added.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">
        Anniversaries to remember ({anniversaries.length})
      </p>
      <ul className="divide-y divide-gray-100 border border-gray-100 rounded">
        {anniversaries.map((it) => (
          <AnniversaryRow key={it.key} item={it} />
        ))}
      </ul>
      <p className="text-[10px] italic text-gray-400 pt-1">
        Derived from significant deaths + linked directory family. Edit
        the source rows to change names, dates, or remove an entry.
      </p>
    </div>
  );
}

function AnniversaryRow({ item }) {
  const isUpcoming = item._daysUntil >= 0 && item._daysUntil <= 30;
  const isToday = item._daysUntil === 0;
  const containerClass = isUpcoming
    ? 'bg-umc-50/60 border-l-4 border-l-umc-400'
    : '';
  const iconChar = item.kind === 'death' ? '🕊️' : '🎂';
  const kindLabel =
    item.kind === 'death'
      ? `Death anniversary`
      : `Birthday (deceased)`;
  // Render Month Day (e.g. "May 14"). We don't show year — the recurring
  // anniversary is what matters for pastoral memory.
  const monthDay = item._parsed
    ? item._parsed.toLocaleString(undefined, { month: 'long', day: 'numeric' })
    : item.date;
  // Only show the "(would be X)" / "(X years ago)" suffix when the
  // math is in a plausible human range. A negative years_ago means the
  // source date is in the future (probably a typo); > 120 means the
  // source year is wrong by a century or so (we've seen 1904 instead
  // of 1938 in practice). Suppressing it avoids confidently displaying
  // a nonsense number — and gives the pastor a visual signal to go
  // check the underlying date.
  const ageInRange = item._yearsAgo >= 0 && item._yearsAgo <= 120;
  return (
    <li className={'px-3 py-2 flex items-baseline gap-2 ' + containerClass}>
      <span className="text-base leading-none" aria-hidden="true">
        {iconChar}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap text-sm">
          <span className="font-medium text-gray-900">{monthDay}</span>
          <span className="text-gray-500 text-xs">{kindLabel}</span>
          {ageInRange && item._yearsAgo > 0 && item.kind === 'death' && (
            <span className="text-[11px] text-gray-400">
              ({item._yearsAgo} year{item._yearsAgo === 1 ? '' : 's'} ago)
            </span>
          )}
          {ageInRange && item._yearsAgo > 0 && item.kind === 'birthday' && (
            <span className="text-[11px] text-gray-400">
              (would be {item._yearsAgo})
            </span>
          )}
          {!ageInRange && (
            <span
              className="text-[11px] text-amber-700"
              title={`Computed age (${item._yearsAgo}) is outside the plausible 0–120 range — the source birth or death date on the linked record may be wrong. Open the linked person to correct it.`}
            >
              (year looks off — check source)
            </span>
          )}
        </div>
        {/* Render the relationship with an explicit possessive so the
            direction is unambiguous: "Sidney Lanier (your child)" reads
            as "Sidney is your child" — if that's wrong, the pastor sees
            it immediately and can fix the family link. */}
        <div className="text-xs text-gray-700">
          {item.linkToPersonId ? (
            <Link
              to={`/people/${item.linkToPersonId}`}
              className="text-umc-700 hover:text-umc-900 underline"
            >
              {item.name}
            </Link>
          ) : (
            item.name
          )}
          {item.relationship && (
            <span className="text-gray-500 ml-1">
              (your {item.relationship.replace(/_/g, ' ')})
            </span>
          )}
        </div>
      </div>
      {isUpcoming && (
        <span className="text-[10px] uppercase tracking-wide bg-umc-100 text-umc-800 rounded px-1.5 py-0.5 flex-shrink-0">
          {isToday
            ? 'today'
            : item._daysUntil === 1
              ? 'tomorrow'
              : `in ${item._daysUntil}d`}
        </span>
      )}
    </li>
  );
}

// ----- helpers ------------------------------------------------------

function parseIsoDate(iso) {
  if (typeof iso !== 'string') return null;
  const s = iso.trim();
  if (!s) return null;
  // The DB stores DATE columns as 'YYYY-MM-DD' — parse without timezone
  // surprises (new Date('2026-05-14') is interpreted as UTC midnight,
  // which in some locales rolls back to May 13).
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  return new Date(y, month, day);
}

