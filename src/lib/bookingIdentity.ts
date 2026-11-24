// Booking identity: the event (for matching and carrying colour across
// re-imports) and the unique id (for one row of an import). Kept in one
// place so the import and the comparison cannot drift apart.
import type { Booking } from '../types';

type Row = Booking & { activity?: string };

export const normalizeIdentity = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
export const normalizeJobNumber = (value?: string) => (value || '').trim().replace(/^0+(?=\d)/, '');

// The job number matching uses: the booking's own number, else its
// first per-room number (rooms sorted, so it is stable). Job numbers
// are per room now, but a match only needs one number to tell two
// bookings apart — a different number on both sides means a different
// booking, and that veto must still fire when the numbers live per room.
export const matchJobNumber = (booking: Booking): string => {
  if (booking.jobNumber) return normalizeJobNumber(booking.jobNumber);
  const rooms = Object.keys(booking.jobNumbers || {}).sort();
  for (const room of rooms) {
    const n = normalizeJobNumber(booking.jobNumbers![room]);
    if (n) return n;
  }
  return '';
};

const stableHash = (value: string) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  return hash.toString(36).padStart(7, '0');
};

// The event identity: venue, date, title, rooms, activity and start
// time. This is what matching and colour carry-over use. It is per
// session, not per event: a daytime session and a dinner session of the
// same event in the same rooms are different bookings (a Setup, a
// Dinner and a Crew Meals for "The 2026 Enchanted Ball" in Palladium
// are three identities, not one), so a job number or NO AV set on one
// session cannot leak onto another on re-import. The end time is not
// in it — a session that runs long is the same session. It excludes
// the job number: the number is set by the user in the inspector,
// never by an import, so including it made a booking unfindable the
// moment a number was set — the carry-over missed, the review called
// it unchanged, and the number was lost on the next re-import. The job
// number still vetoes a fuzzy/single-field match (see
// importComparison), and it stays in the id below, which is unique
// per row. A booking that was re-timed no longer matches by identity,
// but the review's fuzzy scoring (name 40 + date 30 + rooms 10) still
// matches it as changed and the merge carries its colour and number
// over, so re-timing keeps its settings.
export const identityKey = (booking: Row, venueName: string) => JSON.stringify([
  normalizeIdentity(venueName),
  booking.date,
  normalizeIdentity(booking.title),
  [...booking.roomIds].sort(),
  normalizeIdentity(booking.activity || ''),
  booking.startTime || ''
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
