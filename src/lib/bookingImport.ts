import * as XLSX from 'xlsx';
import yaml from 'js-yaml';
import { addDays, format, parseISO } from 'date-fns';
import { Booking, BookingSnapshot, ImportSource } from '../types';
import { ImportComparison, compareImports } from './importComparison';
import { ParsedVenueConfig, resolveRooms } from './venueConfig';
import { dateValue, timeValue } from './dateTime';
// A multi-day event named the way the MCG writes it — "Project Control
// 2026 (1 Day Bump in + 2 Days)" — is one row for the whole span, so
// the board only showed it on the bump-in day. The parenthetical is the
// span: bump-in days + event days. parseMultiDayDays returns the total
// days (1 when the title carries no such span), so the import can make
// one booking per day. Only the explicit "N Day(s) Bump in + M Day(s)"
// form is expanded; a bare "(Day 2)" or "(Bump in)" is a single day.
export function parseMultiDayDays(title: string): number {
  const m = /\((\d+)\s+days?\s+bump\s+in\s*\+\s*(\d+)\s+days?\)/i.exec(title);
  if (!m) return 1;
  return Number(m[1]) + Number(m[2]);
}
export type BoardBooking = Booking & { activity?: string };
export interface ImportResult {
  bookings: Booking[];
  comparison: ImportComparison;
  source: ImportSource;
}
import { identityKey, bookingId } from './bookingIdentity';
const text = (v: unknown) => v == null ? '' : String(v).trim();
const PREVIOUS_IMPORT_KEY = 'whiteboard-previous-import';
const hashBytes = (bytes: Uint8Array) => {
  let hash = 5381;
  for (let i = 0; i < bytes.length; i++) hash = ((hash << 5) + hash + bytes[i]) >>> 0;
  return hash.toString(36);
};
export function readPreviousImport(): BookingSnapshot | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREVIOUS_IMPORT_KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.bookings)) return null;
    return { importedAt: typeof parsed.importedAt === 'string' ? parsed.importedAt : '', bookings: parsed.bookings };
  } catch {
    return null;
  }
}
// The live board, saved on every change. A re-import must carry colour,
// salesperson and other edits from the board as it is now, not from the
// snapshot taken at the last publish — otherwise re-importing the exact
// same file after colour-coding loses every colour, because that
// snapshot is stale. Prefer the board cache; fall back to the previous
// import when the board is empty.
const BOARD_CACHE_KEY = 'whiteboard-board-cache';
function readBoardCache(): Booking[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(BOARD_CACHE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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
export async function readWorkbook(file: File): Promise<{ workbook: XLSX.WorkBook; fingerprint: string }> {
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
// The sheet as plain records, using the venue's header row (1-based)
// for the column names instead of always the first row: some exports
// put a title row first, or group rows above the headers. Rows above
// the header row never become records; rows below it with no header
// name in a column lose that cell. A header name used twice keeps the
// later column's value.
export function sheetRecords(workbook: XLSX.WorkBook, headerRow = 1): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const sheetName of workbook.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
    if (!aoa.length) continue;
    const headerIndex = Math.min(Math.max(headerRow - 1, 0), aoa.length - 1);
    const headers = aoa[headerIndex].map(h => String(h ?? '').trim());
    for (let i = headerIndex + 1; i < aoa.length; i++) {
      const row: Record<string, unknown> = {};
      aoa[i].forEach((v, j) => { if (headers[j]) row[headers[j]] = v; });
      out.push(row);
    }
  }
  return out;
}
export interface ImportOptions {
  // Only import bookings dated inside this range, inclusive. The
  // setup wizard uses it for a first import; a plain re-import has
  // no range and takes everything, as before.
  dateRange?: { start: string; end: string } | null;
}
export async function parseBookingWorkbook(file: File, venue: ParsedVenueConfig, options: ImportOptions = {}): Promise<ImportResult> {
  const { workbook, fingerprint } = await readWorkbook(file);
  let labels: string[] = [];
  try {
    const config = yaml.load(localStorage.getItem('whiteboard-venue-yaml') || '') as { timeline_items?: string[] };
    labels = config?.timeline_items || [];
  } catch { /* Config was already validated by the venue loader. */ }
  const previous = readPreviousImport();
  const boardCache = readBoardCache();
  const previousBookings = boardCache.length ? boardCache : (previous?.bookings || []);
  const previousByIdentity = new Map<string, Booking>();
  for (const booking of previousBookings) {
    const identity = identityKey(booking as BoardBooking, venue.name);
    if (!previousByIdentity.has(identity)) previousByIdentity.set(identity, booking);
  }
  const rows: BoardBooking[] = [];
  const records = sheetRecords(workbook, venue.headerRow);
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
      // A first import can be limited to a date range, so a file that
      // spans years does not make a board four years tall. The range
      // is checked per day below, so a multi-day event that starts
      // before the range still shows its days inside it.
      if (jobNumber) booking.jobNumber = jobNumber;
      // Setup and teardown as columns, not rows: some venues give a
      // bump-in time and a bump-out time per event instead of separate
      // setup/teardown rows. The block spans them, as it does for
      // attached timeline rows. A column that cannot be read as a
      // time leaves the booking without that end instead of failing
      // the whole import. The setup belongs to the first day and the
      // teardown to the last day of a multi-day event, so they are
      // kept apart and attached per day below.
      let setupPart: { label: string; start: string; end: string } | null = null;
      let teardownPart: { label: string; start: string; end: string } | null = null;
      try {
        const setupStart = venue.fields.setup_start ? timeValue(get('setup_start')) : '';
        if (setupStart && setupStart < booking.startTime) setupPart = { label: labels[0] || 'Setup', start: setupStart, end: booking.startTime };
      } catch { /* An unreadable setup time leaves the booking without it. */ }
      try {
        const teardownEnd = venue.fields.teardown_end ? timeValue(get('teardown_end')) : '';
        if (teardownEnd && teardownEnd > booking.endTime) teardownPart = { label: labels[1] || labels[0] || 'Teardown', start: booking.endTime, end: teardownEnd };
      } catch { /* An unreadable teardown time leaves the booking without it. */ }
      // A multi-day event is one row for the whole span, so it gets one
      // booking per day (same title, times and rooms) instead of only
      // showing on the bump-in day. Each day carries over from its own
      // previous booking, so colour, salesperson and job number stay
      // per day.
      const totalDays = parseMultiDayDays(title);
      for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
        const dayBooking: BoardBooking = dayOffset === 0 ? booking : { ...booking };
        dayBooking.date = format(addDays(parseISO(booking.date), dayOffset), 'yyyy-MM-dd');
        if (options.dateRange && (dayBooking.date < options.dateRange.start || dayBooking.date > options.dateRange.end)) continue;
        const dayTimeline: { label: string; start: string; end: string }[] = [];
        if (dayOffset === 0 && setupPart) dayTimeline.push(setupPart);
        if (dayOffset === totalDays - 1 && teardownPart) dayTimeline.push(teardownPart);
        if (dayTimeline.length) dayBooking.timeline = dayTimeline; else delete dayBooking.timeline;
        dayBooking.id = bookingId(dayBooking, venue.name);
        const existing = previousByIdentity.get(identityKey(dayBooking, venue.name));
        if (existing) {
          // The id is not carried over: it is derived from the booking's
          // own time and activity, so it stays unique per row. Carrying
          // over the previous id would reintroduce the shared id that
          // let one save replace several bookings.
          if (existing.colour) dayBooking.colour = existing.colour;
          if (existing.salespersonId) dayBooking.salespersonId = existing.salespersonId;
          if (existing.unavailable !== undefined) dayBooking.unavailable = existing.unavailable;
          if (existing.hidden !== undefined) dayBooking.hidden = existing.hidden;
          if (existing.hiddenRooms?.length) dayBooking.hiddenRooms = existing.hiddenRooms;
          if (existing.jobNumber) dayBooking.jobNumber = existing.jobNumber;
          if (existing.jobNumbers && Object.keys(existing.jobNumbers).length) dayBooking.jobNumbers = existing.jobNumbers;
          if (existing.timeline?.length) dayBooking.timeline = existing.timeline;
        }
        rows.push(dayBooking);
      }
    });
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
  const comparison = compareImports(previousBookings.length ? previousBookings : null, result, venue.name);
  return {
    bookings: result,
    comparison,
    source: { name: file.name, fingerprint, importedAt: new Date().toISOString() }
  };
}
