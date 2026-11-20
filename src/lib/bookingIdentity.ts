// Booking identity: the event (for matching and carrying colour across
// re-imports) and the unique id (for one row of an import). Kept in one
// place so the import and the comparison cannot drift apart.
import type { Booking } from '../types';

type Row = Booking & { activity?: string };

export const normalizeIdentity = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
export const normalizeJobNumber = (value?: string) => (value || '').trim().replace(/^0+(?=\d)/, '');

const stableHash = (value: string) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  return hash.toString(36).padStart(7, '0');
};

// The event identity: venue, date, title and rooms. This is what
// matching and colour carry-over use, and it deliberately excludes
// times and activity, so a booking that was re-timed or renamed is still
// the same booking and keeps its colour. It also excludes the job
// number: the number is set by the user in the inspector, never by an
// import, so including it made a booking unfindable the moment a number
// was set — the carry-over missed, the review called it unchanged, and
// the number was lost on the next re-import. The job number still
// vetoes a fuzzy/single-field match (see importComparison), and it
// stays in the id below, which is unique per row.
export const identityKey = (booking: Row, venueName: string) => JSON.stringify([
  normalizeIdentity(venueName),
  booking.date,
  normalizeIdentity(booking.title),
  [...booking.roomIds].sort()
]);

// The id must be unique per distinct booking (per row of the import).
// The event identity above is shared by several rows of one event — a
// Setup, a Dinner and a Crew Meals for "The 2026 Enchanted Ball" in
// Palladium all share it — so the id also folds in the time and the
// activity. Without this they share one id, and saving one in the
// inspector replaces all of them (which is how colour-coding a merged
// block deleted its setup).
const bookingIdKey = (booking: Row, venueName: string) => JSON.stringify([
  normalizeIdentity(venueName),
  booking.date,
  normalizeJobNumber(booking.jobNumber),
  normalizeIdentity(booking.title),
  [...booking.roomIds].sort(),
  booking.startTime,
  booking.endTime,
  normalizeIdentity(booking.activity || '')
]);
export const bookingId = (booking: Row, venueName: string) => `booking-${stableHash(bookingIdKey(booking, venueName))}`;
