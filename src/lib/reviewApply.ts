import { Booking } from '../types';
import { BookingChange } from './importComparison';

// A review change is identified by what it is, not where it sits in the
// list, so ticking a box still refers to the same booking after the list is
// recomputed (for example by linking a match).
export const changeKey = (change: BookingChange) =>
  `${change.type}:${change.booking.id}:${change.match?.previous.id ?? change.previous?.id ?? ''}`;

// Turn a reviewed import into the bookings to publish. `selected` maps a
// change key to whether that change is applied; anything absent counts as
// applied, so a fresh review publishes everything. The rules that stop
// data loss live here, in one testable place:
// - rejecting a new booking that was matched to a previous one keeps the
//   previous booking instead of dropping both;
// - accepting a matched new booking merges it onto the previous booking:
//   the new values win, but the booking keeps its previous id and its
//   colour, salesperson, hidden status and job number carry over;
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
        const previous = change.match.previous;
        bookings.push({
          ...previous,
          ...change.booking,
          id: previous.id,
          colour: change.booking.colour ?? previous.colour,
          salespersonId: change.booking.salespersonId ?? previous.salespersonId,
          unavailable: change.booking.unavailable ?? previous.unavailable,
          hidden: change.booking.hidden ?? previous.hidden,
          jobNumber: change.booking.jobNumber || previous.jobNumber
        });
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
