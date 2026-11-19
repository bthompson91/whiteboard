import * as XLSX from 'xlsx';
import yaml from 'js-yaml';
import { Booking, BookingSnapshot } from '../types';
import { ParsedVenueConfig, resolveRooms } from './venueConfig';
export type BoardBooking = Booking & { activity?: string; timeline?: { label: string; start: string; end: string }[] };
const text = (v: unknown) => v == null ? '' : String(v).trim();
const PREVIOUS_IMPORT_KEY = 'whiteboard-previous-import';
const normalizeIdentity = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const normalizeJobNumber = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed.replace(/^0+(?=\d)/, '') : '';
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
function readPreviousImport(): BookingSnapshot | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREVIOUS_IMPORT_KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.bookings)) return null;
    return { importedAt: typeof parsed.importedAt === 'string' ? parsed.importedAt : '', bookings: parsed.bookings };
  } catch {
    return null;
  }
}
function writePreviousImport(bookings: Booking[]) {
  try {
    const snapshot: BookingSnapshot = { importedAt: new Date().toISOString(), bookings };
    localStorage.setItem(PREVIOUS_IMPORT_KEY, JSON.stringify(snapshot));
  } catch {
    /* The import remains usable even if this browser cannot retain the snapshot. */
  }
}
async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buffer = await file.arrayBuffer();
  const probe = new TextDecoder('windows-1252').decode(buffer.slice(0,8192));
  if (!/<(?:html|head|table)\b/i.test(probe)) return XLSX.read(buffer, { type: 'array', cellDates: false });
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
  return workbook;
}
function dateValue(v: unknown, date1904: boolean): string {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(text(v))) {
    const d = XLSX.SSF.parse_date_code(Number(v), { date1904 });
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const s = text(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  throw new Error(`Unrecognised booking date: ${s}`);
}
function timeValue(v: unknown): string {
  if (v instanceof Date) return `${String(v.getHours()).padStart(2,'0')}:${String(v.getMinutes()).padStart(2,'0')}`;
  if (typeof v === 'number') {
    const n = Math.round((v % 1) * 1440);
    return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
  }
  const s = text(v);
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i.exec(s);
  if (!m) throw new Error(`Unrecognised booking time: ${s}`);
  let h = Number(m[1]);
  if (m[3]) h = h % 12 + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  return `${String(h).padStart(2,'0')}:${m[2]}`;
}
export async function parseBookingWorkbook(file: File, venue: ParsedVenueConfig): Promise<Booking[]> {
  const workbook = await readWorkbook(file);
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
      const activity = text(get('activity_name'));
      const jobNumber = venue.fields.job_number ? text(get('job_number')) : '';
      const booking: BoardBooking = {
        id: '',
        title,
        activity,
        notes: activity === title ? '' : activity,
        status,
        date: dateValue(get('event_date'), !!workbook.Workbook?.WBProps?.date1904),
        startTime: timeValue(get('start_time')),
        endTime: timeValue(get('end_time')),
        roomId: roomIds[0],
        roomIds
      };
      if (jobNumber) booking.jobNumber = jobNumber;
      booking.id = `booking-${stableHash(identityKey(booking, venue.name))}`;
      const existing = previousByIdentity.get(identityKey(booking, venue.name));
      if (existing?.id) booking.id = existing.id;
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
  writePreviousImport(result);
  return result;
}
