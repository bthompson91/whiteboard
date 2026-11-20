import { Booking } from '../types';
import { BookingChange } from './importComparison';
import { normalizeJobNumber } from './bookingIdentity';

// A review change is identified by what it is, not where it sits in the
// list, so ticking a box still refers to the same booking after the list is
// recomputed (for example by linking a match).
export const changeKey = (change: BookingChange) =>
  `${change.type}:${change.booking.id}:${change.match?.previous.id ?? change.previous?.id ?? ''}`;

// Merge a matched new booking onto its previous booking: the new values
// win, but the booking keeps its previous id and its colour, salesperson,
// unavailable flag, hidden status, job number and timeline carry over
// when the new booking does not bring its own. A new import whose
// setup/teardown rows did not attach must not erase the previous
// booking's setup and teardown times. Used both when a review change is
// accepted and when a match is linked in the review.
export function mergeMatchedBooking(previous: Booking, booking: Booking): Booking {
  return {
    ...previous,
    ...booking,
    id: previous.id,
    colour: booking.colour ?? previous.colour,
    salespersonId: booking.salespersonId ?? previous.salespersonId,
    unavailable: booking.unavailable ?? previous.unavailable,
    hidden: booking.hidden ?? previous.hidden,
    hiddenRooms: booking.hiddenRooms ?? previous.hiddenRooms,
    jobNumber: booking.jobNumber || previous.jobNumber,
    jobNumbers: booking.jobNumbers ?? previous.jobNumbers,
    timeline: booking.timeline ?? previous.timeline
  };
}

// Apply staged job-number edits (from the inspector's related list) to
// the bookings they name: the number replaces the booking's own number
// and clears its per-room numbers, so the booking shows the number that
// was typed; an empty edit clears the number. Bookings in the edited
// block are untouched — they share the block's number already.
export function applyJobNumberEdits(bookings: Booking[], edits: Record<string, string>, blockIds: Set<string> = new Set()): Booking[] {
  return bookings.map(booking => {
    const edit = edits[booking.id];
    if (edit === undefined || blockIds.has(booking.id)) return booking;
    const n = normalizeJobNumber(edit);
    return { ...booking, jobNumber: n || undefined, jobNumbers: undefined };
  });
}

// Turn a reviewed import into the bookings to publish. `selected` maps a
// change key to whether that change is applied; anything absent counts as
// applied, so a fresh review publishes everything. The rules that stop
// data loss live here, in one testable place:
// - rejecting a new booking that was matched to a previous one keeps the
//   previous booking instead of dropping both;
// - accepting a matched new booking merges it onto the previous booking:
//   the new values win, but the booking keeps its previous id and its
//   colour, salesperson, hidden status, job number and timeline carry over;
// - rejecting a changed booking keeps the previous version;
// - a disappeared booking is only removed when its change is applied;
//   unticking it keeps it on the board.
export function applyReview(changes: BookingChange[], selected: Record<string, boolean>): Booking[] {
  const bookings: Booking[] = [];
  for (const change of changes) {
    const apply = selected[changeKey(change)] !== false;
    if (change.type === 'unchanged') {
      bookings.push(change.booking);
      continue;
    }
    if (change.type === 'changed') {
      bookings.push(apply ? change.booking : (change.previous ?? change.booking));
      continue;
    }
    if (change.type === 'new') {
      if (!apply) {
        if (change.match) bookings.push(change.match.previous);
        continue;
      }
      if (change.match) {
        bookings.push(mergeMatchedBooking(change.match.previous, change.booking));
      } else {
        bookings.push(change.booking);
      }
      continue;
    }
    // Disappeared: applied means remove it; unticked means keep it.
    if (!apply && change.previous) bookings.push(change.previous);
  }
  return bookings;
}
