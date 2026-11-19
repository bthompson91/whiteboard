import { Booking } from '../types';

export type ImportChangeType = 'unchanged' | 'changed' | 'new' | 'disappeared';

export interface BookingChange {
  type: ImportChangeType;
  booking: Booking;
  previous?: Booking;
  changedFields: string[];
}

export interface ImportComparison {
  changes: BookingChange[];
  summary: Record<ImportChangeType, number>;
}

const normalizeText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const normalizeJobNumber = (value?: string) => (value || '').trim().replace(/^0+(?=\d)/, '');

const identityKey = (booking: Booking, venueName: string) => JSON.stringify([
  normalizeText(venueName),
  booking.date,
  normalizeJobNumber(booking.jobNumber),
  normalizeText(booking.title),
  [...booking.roomIds].sort()
]);

const comparableFields: Array<{ field: string; read: (booking: Booking) => unknown }> = [
  { field: 'date', read: booking => booking.date },
  { field: 'title', read: booking => normalizeText(booking.title) },
  { field: 'jobNumber', read: booking => normalizeJobNumber(booking.jobNumber) },
  { field: 'startTime', read: booking => booking.startTime },
  { field: 'endTime', read: booking => booking.endTime },
  { field: 'rooms', read: booking => [...booking.roomIds].sort() },
  { field: 'status', read: booking => booking.status || '' },
  { field: 'notes', read: booking => booking.notes || '' }
];

function changedFields(current: Booking, previous: Booking): string[] {
  return comparableFields
    .filter(({ read }) => JSON.stringify(read(current)) !== JSON.stringify(read(previous)))
    .map(({ field }) => field);
}

export function compareImports(previous: Booking[] | null, current: Booking[], venueName: string): ImportComparison {
  const previousById = new Map(previous?.filter(booking => booking.id).map(booking => [booking.id, booking]) || []);
  const previousByIdentity = new Map(
    (previous || []).map(booking => [identityKey(booking, venueName), booking])
  );
  const matchedPreviousIds = new Set<string>();
  const changes: BookingChange[] = [];

  for (const booking of current) {
    const previousBooking = previousById.get(booking.id) || previousByIdentity.get(identityKey(booking, venueName));
    if (!previousBooking) {
      changes.push({ type: 'new', booking, changedFields: [] });
      continue;
    }
    matchedPreviousIds.add(previousBooking.id);
    const fields = changedFields(booking, previousBooking);
    changes.push({ type: fields.length ? 'changed' : 'unchanged', booking, previous: previousBooking, changedFields: fields });
  }

  for (const booking of previous || []) {
    if (!matchedPreviousIds.has(booking.id)) changes.push({ type: 'disappeared', booking, changedFields: [] });
  }

  const summary: Record<ImportChangeType, number> = { unchanged: 0, changed: 0, new: 0, disappeared: 0 };
  for (const change of changes) summary[change.type]++;
  return { changes, summary };
}
