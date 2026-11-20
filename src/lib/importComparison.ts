import { Booking } from '../types';
import { identityKey, normalizeIdentity as normalizeText, matchJobNumber } from './bookingIdentity';

export type ImportChangeType = 'unchanged' | 'changed' | 'new' | 'disappeared';
export type MatchClassification = 'strong' | 'possible' | 'unmatched';

export interface BookingMatch {
  previous: Booking;
  score: number;
  classification: MatchClassification;
  reason?: string;
}

export interface BookingChange {
  type: ImportChangeType;
  booking: Booking;
  previous?: Booking;
  changedFields: string[];
  match?: BookingMatch;
}

export interface ImportComparison {
  changes: BookingChange[];
  summary: Record<ImportChangeType, number>;
}

const comparableFields: Array<{ field: string; read: (booking: Booking) => unknown }> = [
  { field: 'date', read: booking => booking.date },
  { field: 'title', read: booking => normalizeText(booking.title) },
  { field: 'startTime', read: booking => booking.startTime },
  { field: 'endTime', read: booking => booking.endTime },
  { field: 'rooms', read: booking => [...booking.roomIds].sort() },
  { field: 'status', read: booking => booking.status || '' },
  { field: 'notes', read: booking => booking.notes || '' }
];
// The job number is deliberately NOT a comparable field: it is set by
// the user in the inspector, never by an import, so a difference in it
// must never flag the booking as changed or removable. It is carried
// over from the previous booking on import (see bookingImport.ts).
// It still vetoes a fuzzy/single-field match in the tiers below —
// a different job number on both sides means a different booking —
// but that is matching, not changing the job number.

function changedFields(current: Booking, previous: Booking): string[] {
  return comparableFields
    .filter(({ read }) => JSON.stringify(read(current)) !== JSON.stringify(read(previous)))
    .map(({ field }) => field);
}

const minutes = (time: string) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
};

const duration = (booking: Booking) => {
  const start = minutes(booking.startTime);
  const end = minutes(booking.endTime);
  return end > start ? end - start : end + 1440 - start;
};

const titleSimilarity = (a: string, b: string) => {
  const left = new Set(normalizeText(a).split(/[^a-z0-9]+/).filter(Boolean));
  const right = new Set(normalizeText(b).split(/[^a-z0-9]+/).filter(Boolean));
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter(value => right.has(value)).length;
  return intersection / (left.size + right.size - intersection);
};

function matchScore(current: Booking, previous: Booking): number {
  const currentDate = new Date(current.date).getTime();
  const previousDate = new Date(previous.date).getTime();
  const dayDifference = Math.abs(currentDate - previousDate) / 86400000;
  // The display name (the title on the block) and the date are weighted
  // most heavily: a match must be the same event on the same day to be
  // trusted. Name 40 + date 30 is 70 of 100, so a match that gets the
  // name or the date wrong cannot reach 80% certainty. The date gets no
  // partial credit for being a day off: an event that moved a day is a
  // possible match to confirm, not an automatic one.
  const dateScore = dayDifference === 0 ? 30 : 0;

  const currentStart = minutes(current.startTime);
  const currentEnd = currentStart + duration(current);
  const previousStart = minutes(previous.startTime);
  const previousEnd = previousStart + duration(previous);
  const overlap = Math.max(0, Math.min(currentEnd, previousEnd) - Math.max(currentStart, previousStart));
  const timeScore = overlap ? (overlap / Math.min(duration(current), duration(previous))) * 15 : 0;

  const currentRooms = new Set(current.roomIds);
  const previousRooms = new Set(previous.roomIds);
  const roomIntersection = [...currentRooms].filter(room => previousRooms.has(room)).length;
  const roomUnion = new Set([...currentRooms, ...previousRooms]).size;
  const roomScore = roomUnion ? (roomIntersection / roomUnion) * 10 : 0;

  const nameScore = titleSimilarity(current.title, previous.title) * 40;
  const durationDifference = Math.abs(duration(current) - duration(previous));
  const durationScore = (1 - durationDifference / Math.max(duration(current), duration(previous))) * 5;

  return Math.round(dateScore + timeScore + roomScore + nameScore + durationScore);
}

function classify(score: number): MatchClassification {
  if (score >= 80) return 'strong';
  if (score >= 45) return 'possible';
  return 'unmatched';
}

export function compareImports(previous: Booking[] | null, current: Booking[], venueName: string): ImportComparison {
  const previousById = new Map(previous?.filter(booking => booking.id).map(booking => [booking.id, booking]) || []);
  const previousByIdentity = new Map(
    (previous || []).map(booking => [identityKey(booking, venueName), booking])
  );
  const matchedPreviousIds = new Set<string>();
  const changes: BookingChange[] = [];
  const unmatchedCurrent: Booking[] = [];
  // The new file's date range: a previous booking outside it is not
  // disappeared, it is simply on a day this file does not cover.
  const dates = current.map(booking => booking.date).sort();
  const firstDate = dates[0] ?? '';
  const lastDate = dates[dates.length - 1] ?? '';

  for (const booking of current) {
    const previousBooking = previousById.get(booking.id) || previousByIdentity.get(identityKey(booking, venueName));
    if (!previousBooking) {
      unmatchedCurrent.push(booking);
      continue;
    }
    matchedPreviousIds.add(previousBooking.id);
    const fields = changedFields(booking, previousBooking);
    changes.push({ type: fields.length ? 'changed' : 'unchanged', booking, previous: previousBooking, changedFields: fields });
  }

  const unmatchedPrevious = (previous || []).filter(booking => !matchedPreviousIds.has(booking.id));
  const linkedPreviousIds = new Set<string>();

  // Tier 2 — single-field change: same date, and exactly one of title, time
  // or rooms differs. Events are renamed, re-timed or moved between rooms,
  // but rarely more than one of those at once, so a lone difference against
  // an otherwise identical booking is a strong match. A differing job
  // number on both sides rules it out: that points at a different booking.
  // The candidate must also be unique — if two previous bookings each
  // differ in one field, fall through to fuzzy scoring instead of guessing.
  const singleFieldChange = (current: Booking, candidate: Booking): string | null => {
    if (current.date !== candidate.date) return null;
    const diffs: string[] = [];
    if (normalizeText(current.title) !== normalizeText(candidate.title)) diffs.push('title');
    if (current.startTime !== candidate.startTime || current.endTime !== candidate.endTime) diffs.push('time');
    if (JSON.stringify([...current.roomIds].sort()) !== JSON.stringify([...candidate.roomIds].sort())) diffs.push('rooms');
    if (diffs.length !== 1) return null;
    if (
      matchJobNumber(current) && matchJobNumber(candidate) &&
      matchJobNumber(current) !== matchJobNumber(candidate)
    ) return null;
    return diffs[0];
  };
  const singleFieldLabel: Record<string, string> = {
    title: 'Title changed',
    time: 'Time changed',
    rooms: 'Rooms changed'
  };

  for (const booking of unmatchedCurrent) {
    const tierTwo = unmatchedPrevious
      .filter(candidate => !linkedPreviousIds.has(candidate.id))
      .map(candidate => ({ candidate, field: singleFieldChange(booking, candidate) }))
      .filter((item): item is { candidate: Booking; field: string } => item.field !== null);
    if (tierTwo.length === 1) {
      const match = tierTwo[0];
      linkedPreviousIds.add(match.candidate.id);
      changes.push({
        type: 'new',
        booking,
        changedFields: [],
        match: { previous: match.candidate, score: 90, classification: 'strong', reason: singleFieldLabel[match.field] }
      });
      continue;
    }
    // Tier 3 — fuzzy scoring for the rest (typos, two fields changed).
    // A differing job number on both sides vetoes the match outright:
    // it is the closest thing to an id in the data.
    const candidates = unmatchedPrevious
      .filter(candidate => !linkedPreviousIds.has(candidate.id))
      .filter(candidate => !(matchJobNumber(booking) && matchJobNumber(candidate) && matchJobNumber(booking) !== matchJobNumber(candidate)))
      .map(candidate => ({ candidate, score: matchScore(booking, candidate) }))
      .sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best && best.score >= 45) {
      linkedPreviousIds.add(best.candidate.id);
      changes.push({
        type: 'new',
        booking,
        changedFields: [],
        match: { previous: best.candidate, score: best.score, classification: classify(best.score) }
      });
    } else {
      changes.push({ type: 'new', booking, changedFields: [] });
    }
  }

  for (const booking of unmatchedPrevious) {
    if (linkedPreviousIds.has(booking.id)) continue;
    // A previous booking whose date is outside the new file's date
    // range is not gone — the new file simply does not cover that day.
    // Importing a different date range must not delete the bookings
    // (and the colour coding on them) from other days, so those are
    // kept as unchanged. Only a booking on a day the new file does
    // cover, but missing from it, is treated as disappeared.
    if (booking.date < firstDate || booking.date > lastDate) {
      changes.push({ type: 'unchanged', booking, previous: booking, changedFields: [] });
    } else {
      changes.push({ type: 'disappeared', booking, previous: booking, changedFields: [] });
    }
  }

  const summary: Record<ImportChangeType, number> = { unchanged: 0, changed: 0, new: 0, disappeared: 0 };
  for (const change of changes) summary[change.type]++;
  return { changes, summary };
}
