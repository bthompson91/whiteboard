import * as XLSX from 'xlsx';
import { Booking } from '../types';
import { ParsedVenueConfig, resolveRooms } from './venueConfig';

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function normalizeDate(value: string): string {
  if (!value) return '';

  const iso = /^\d{4}-\d{2}-\d{2}/.exec(value);
  if (iso) return iso[0];

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return value;
}

export async function parseBookingWorkbook(
  file: File,
  venue: ParsedVenueConfig
): Promise<Booking[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true
  });

  const bookings: Booking[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: ''
    });

    rows.forEach((row, index) => {
      const get = (fieldKey: string) => {
        const columnName = venue.fields[fieldKey];
        return columnName ? cellToString(row[columnName]) : '';
      };

      const date = normalizeDate(get('event_date'));
      const roomName = get('room_name');
      const primary = get(venue.display.primaryLabel);
      const secondary = get(venue.display.secondaryLabel);
      const status = get('booking_status');
      const startTime = get('start_time');
      const endTime = get('end_time');

      if (!date || !roomName || !primary) return;

      if (
        venue.display.allowedStatuses.length > 0 &&
        !venue.display.allowedStatuses.includes(status)
      ) {
        return;
      }

      const roomIds = resolveRooms(roomName, venue);
      if (roomIds.length === 0) return;

      bookings.push({
        id: `${sheetName}-${index}-${crypto.randomUUID()}`,
        date,
        roomId: roomIds[0],
        roomIds,
        startTime,
        endTime,
        title: primary,
        status,
        notes:
          venue.display.suppressSecondaryWhenEqual && secondary === primary
            ? ''
            : secondary
      });
    });
  }

  if (bookings.length === 0) {
    throw new Error(
      'No matching bookings found. Check that the XLS headers match the YAML field mappings and that bookings use an allowed status.'
    );
  }

  return bookings;
}
