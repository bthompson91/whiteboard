import * as XLSX from 'xlsx';
import yaml from 'js-yaml';
import { Booking, BookingSnapshot, ImportHistoryEntry, ImportSource } from '../types';
import { ImportComparison, compareImports } from './importComparison';
import { ParsedVenueConfig, resolveRooms } from './venueConfig';
import { dateValue, timeValue } from './dateTime';
export type BoardBooking = Booking & { activity?: string };
export interface ImportResult {
  bookings: Booking[];
  comparison: ImportComparison;
  source: ImportSource;
}
const text = (v: unknown) => v == null ? '' : String(v).trim();
const PREVIOUS_IMPORT_KEY = 'whiteboard-previous-import';
const IMPORT_HISTORY_KEY = 'whiteboard-import-history';
const normalizeIdentity = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const normalizeJobNumber = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed.replace(/^0+(?=\d)/, '') : '';
};
const hashBytes = (bytes: Uint8Array) => {
  let hash = 5381;
  for (let i = 0; i < bytes.length; i++) hash = ((hash << 5) + hash + bytes[i]) >>> 0;
  return hash.toString(36);
};
const stableHash = (value: string) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  return hash.toString(36).padStart(7, '0');
};
const identityKey = (booking: BoardBooking, venueName: string) => JSON.stringify([
  normalizeIdentity(venueName),
  booking.date,
  normalizeJobNumber(booking.jobNumber || ''),
  normalizeIdentity(booking.title),
  [...booking.roomIds].sort()
]);
export function readPreviousImport(): BookingSnapshot | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREVIOUS_IMPORT_KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.bookings)) return null;
    return { importedAt: typeof parsed.importedAt === 'string' ? parsed.importedAt : '', bookings: parsed.bookings };
  } catch {
    return null;
  }
}
export function savePreviousImport(bookings: Booking[]) {
  try {
    const snapshot: BookingSnapshot = { importedAt: new Date().toISOString(), bookings };
    localStorage.setItem(PREVIOUS_IMPORT_KEY, JSON.stringify(snapshot));
  } catch {
    /* The import remains usable even if this browser cannot retain the snapshot. */
  }
}
export function readImportHistory(): ImportHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(IMPORT_HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
export function saveImportHistory(entry: ImportHistoryEntry) {
  const history = [entry, ...readImportHistory()].slice(0, 10);
  try {
    localStorage.setItem(IMPORT_HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* Import history is a convenience cache and must not prevent publishing. */
  }
}
export function revertToImport(entry: ImportHistoryEntry): Booking[] {
  savePreviousImport(entry.bookings);
  return entry.bookings;
}
async function readWorkbook(file: File): Promise<{ workbook: XLSX.WorkBook; fingerprint: string }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const fingerprint = hashBytes(bytes);
  const probe = new TextDecoder('windows-1252').decode(bytes.slice(0, 8192));
  if (!/<(?:html|head|table)\b/i.test(probe)) return { workbook: XLSX.read(buffer, { type: 'array', cellDates: false }), fingerprint };
  const declared = /charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(probe)?.[1] || 'utf-8';
  let source: string;
  try { source = new TextDecoder(declared).decode(buffer); } catch { source = new TextDecoder('windows-1252').decode(buffer); }
  const document = new DOMParser().parseFromString(source, 'text/html');
  const workbook = XLSX.utils.book_new();
  Array.from(document.querySelectorAll('table')).filter(t => !t.parentElement?.closest('table')).forEach((table, i) => {
    const rows = Array.from(table.rows).map(row => Array.from(row.cells).map(cell => (cell.textContent || '').replace(/\u00a0/g,' ').trim()));
    if (rows.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), `Table ${i+1}`);
  });
  if (!workbook.SheetNames.length) throw new Error('The export contains no readable HTML tables.');
  return { workbook, fingerprint };
}
export async function parseBookingWorkbook(file: File, venue: ParsedVenueConfig): Promise<ImportResult> {
  const { workbook, fingerprint } = await readWorkbook(file);
  let labels: string[] = [];
  try {
    const config = yaml.load(localStorage.getItem('whiteboard-venue-yaml') || '') as { timeline_items?: string[] };
    labels = config?.timeline_items || [];
  } catch { /* Config was already validated by the venue loader. */ }
  const previous = readPreviousImport();
  const previousByIdentity = new Map<string, Booking>();
  for (const booking of previous?.bookings || []) {
    const identity = identityKey(booking as BoardBooking, venue.name);
    if (!previousByIdentity.has(identity)) previousByIdentity.set(identity, booking);
  }
  const rows: BoardBooking[] = [];
  for (const sheetName of workbook.SheetNames) {
    const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '', raw: true });
    records.forEach((row, index) => {
      const get = (key: string) => row[venue.fields[key]];
      const title = text(get(venue.display.primaryLabel));
      const roomIds = resolveRooms(text(get('room_name')), venue).filter(id => venue.rooms.some(r => r.id === id));
      const status = text(get('booking_status'));
      if (!title || !roomIds.length || !get('event_date')) return;
      if (venue.display.allowedStatuses.length && !venue.display.allowedStatuses.includes(status)) return;
      const activity = text(get(venue.display.secondaryLabel));
      const jobNumber = venue.fields.job_number ? text(get('job_number')) : '';
      const booking: BoardBooking = {
        id: '',
        title,
        activity,
        notes: activity === title ? '' : activity,
        status,
        date: dateValue(get('event_date'), !!workbook.Workbook?.WBProps?.date1904, venue.dateFormat),
        startTime: timeValue(get('start_time')),
        endTime: timeValue(get('end_time')),
        roomId: roomIds[0],
        roomIds
      };
      if (jobNumber) booking.jobNumber = jobNumber;
      booking.id = `booking-${stableHash(identityKey(booking, venue.name))}`;
      const existing = previousByIdentity.get(identityKey(booking, venue.name));
      if (existing) {
        if (existing.id) booking.id = existing.id;
        if (existing.colour) booking.colour = existing.colour;
        if (existing.salespersonId) booking.salespersonId = existing.salespersonId;
        if (existing.unavailable !== undefined) booking.unavailable = existing.unavailable;
        if (existing.hidden !== undefined) booking.hidden = existing.hidden;
        if (existing.timeline?.length) booking.timeline = existing.timeline;
      }
      rows.push(booking);
    });
  }
  const key = (b: BoardBooking) => JSON.stringify([b.title, b.date, [...b.roomIds].sort()]);
  const isTimeline = (b: BoardBooking) => labels.some(l => l.toLowerCase() === b.activity?.toLowerCase());
  const result: BoardBooking[] = rows.filter(b => !isTimeline(b));
  for (const b of rows.filter(isTimeline)) {
    const candidates = result.filter(r => key(r) === key(b) && !isTimeline(r));
    if (candidates.length === 1) {
      const target = candidates[0];
      target.timeline = [...(target.timeline || []), { label: b.activity || '', start: b.startTime, end: b.endTime }];
    } else result.push(b);
  }
  if (!result.length) throw new Error('No matching bookings found. Check headers, room mappings and allowed statuses.');
  const comparison = compareImports(previous?.bookings || null, result, venue.name);
  return {
    bookings: result,
    comparison,
    source: { name: file.name, fingerprint, importedAt: new Date().toISOString() }
  };
}
