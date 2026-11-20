import * as XLSX from 'xlsx';
import { readWorkbook, sheetRecords } from './bookingImport';
import { writeConfiguration, normalizeConfigDoc, Salesperson } from './configuration';
import { dateValue, timeValue } from './dateTime';

// Pure helpers for the first-time setup wizard: reading a venue's
// booking file, guessing how it is laid out, and building the venue
// YAML from the wizard's choices. Nothing here touches the DOM or
// localStorage, so it is all testable in node.

// --- Reading the file -------------------------------------------------

// The row the header names sit on, 1-based: the first row with at
// least three non-empty text cells. A title row ("NMD Current
// Events") has one; the real header row has a cell per column.
export function detectHeaderRow(aoa: unknown[][]): number {
  for (let i = 0; i < aoa.length; i++) {
    const texts = aoa[i].filter(v => typeof v === 'string' && v.trim()).length;
    if (texts >= 3) return i + 1;
  }
  return 1;
}
// Rows that could be the header row, for the dropdown: rows with at
// least two non-empty text cells, with the first few words as a label.
export function headerCandidates(aoa: unknown[][]): { row: number; preview: string }[] {
  const out: { row: number; preview: string }[] = [];
  for (let i = 0; i < aoa.length && out.length < 10; i++) {
    const texts = aoa[i].filter(v => typeof v === 'string' && v.trim()).map(v => String(v).trim());
    if (texts.length >= 2) out.push({ row: i + 1, preview: texts.slice(0, 4).join(' | ') });
  }
  return out;
}
export function headersFromAoA(aoa: unknown[][], headerRow: number): string[] {
  const row = aoa[Math.min(Math.max(headerRow - 1, 0), aoa.length - 1)] || [];
  return row.map(h => String(h ?? '').trim()).filter(Boolean);
}
// Read a booking file the way the wizard does: the workbook, its rows
// as arrays, and the detected header row. Reuses the import reader,
// so a file the wizard accepts is a file the import can read.
export async function readWizardFile(file: File): Promise<{ workbook: XLSX.WorkBook; aoa: unknown[][]; headerRow: number; sheetNames: string[] }> {
  const { workbook } = await readWorkbook(file);
  const aoa: unknown[][] = [];
  for (const sheetName of workbook.SheetNames) {
    aoa.push(...XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true }));
  }
  return { workbook, aoa, headerRow: detectHeaderRow(aoa), sheetNames: workbook.SheetNames };
}

// --- Guessing the column mapping --------------------------------------

export type FieldKey = 'booking_name' | 'activity_name' | 'event_date' | 'start_time' | 'end_time' | 'room_name' | 'booking_status' | 'salesperson' | 'setup_start' | 'teardown_end';
export const WIZARD_FIELDS: { key: FieldKey; label: string; required: boolean }[] = [
  { key: 'booking_name', label: 'Title', required: true },
  { key: 'activity_name', label: 'Activity', required: false },
  { key: 'event_date', label: 'Date', required: true },
  { key: 'start_time', label: 'Start time', required: true },
  { key: 'end_time', label: 'End time', required: true },
  { key: 'room_name', label: 'Room', required: true },
  { key: 'booking_status', label: 'Status', required: false },
  { key: 'salesperson', label: 'Salesperson', required: false },
  { key: 'setup_start', label: 'Setup start', required: false },
  { key: 'teardown_end', label: 'Teardown end', required: false },
];
// What each app field is called in the wild, best guess first. A
// header is claimed by the first field that matches it, so the order
// matters: 'Booking Event: Name' is the activity, not the title.
const FIELD_HINTS: Record<FieldKey, string[]> = {
  booking_name: ['booking post as', 'description', 'event title', 'title'],
  activity_name: ['activity', 'event name', 'booking event', 'type'],
  event_date: ['bump in', 'start date', 'date'],
  start_time: ['start time'],
  end_time: ['end time'],
  room_name: ['booked spaces', 'function room', 'room', 'space'],
  booking_status: ['status'],
  salesperson: ['salesperson', 'sales', 'event manager'],
  setup_start: ['bump in'],
  teardown_end: ['bump out'],
};
export function suggestFieldMapping(headers: string[]): Record<FieldKey, string> {
  const lower = headers.map(h => h.toLowerCase());
  const claimed = new Set<number>();
  const out = {} as Record<FieldKey, string>;
  // Setup and teardown may reuse a column another field already
  // claimed: Bump In is both the date and the setup start.
  const primary: FieldKey[] = ['booking_name', 'activity_name', 'event_date', 'start_time', 'end_time', 'room_name', 'booking_status', 'salesperson'];
  for (const key of primary) {
    out[key] = '';
    for (const hint of FIELD_HINTS[key]) {
      const i = lower.findIndex((h, j) => !claimed.has(j) && h.includes(hint));
      if (i >= 0) { out[key] = headers[i]; claimed.add(i); break; }
    }
  }
  for (const key of ['setup_start', 'teardown_end'] as const) {
    out[key] = '';
    for (const hint of FIELD_HINTS[key]) {
      const i = lower.findIndex(h => h.includes(hint));
      if (i >= 0) { out[key] = headers[i]; break; }
    }
  }
  return out;
}

// --- Rooms ------------------------------------------------------------

// How one cell can name several rooms. ';' is what MCG uses
// ("Room A;  Room B"); a comma is never a separator, because names
// themselves contain commas ("Santimano, Agneeta").
export function detectRoomSeparator(values: string[]): string {
  return values.some(v => v.includes(';')) ? ';' : '';
}
export function splitRoomValue(value: string, separator: string): string[] {
  if (!value.trim()) return [];
  return (separator ? value.split(separator) : [value]).map(p => p.trim()).filter(Boolean);
}
// Every distinct room part in the file, with how many events use it,
// most-used first. The wizard lists these for the user to exclude
// the ones that are not rooms.
export function roomParts(records: Record<string, unknown>[], roomColumn: string, separator: string): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of records) {
    const v = row[roomColumn];
    if (v == null) continue;
    for (const part of splitRoomValue(String(v), separator)) counts.set(part, (counts.get(part) || 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
// Only rows with a title are events: the rows below the header also
// hold the file's total and day-group rows, which have no title and
// no room, and would otherwise inflate the counts.
export function dataRecords(records: Record<string, unknown>[], titleColumn: string): Record<string, unknown>[] {
  if (!titleColumn) return records;
  return records.filter(r => String(r[titleColumn] ?? '').trim());
}
// Distinct values of one column, with counts, most-used first.
export function columnValues(records: Record<string, unknown>[], column: string): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of records) {
    const v = row[column];
    if (v == null || String(v).trim() === '') continue;
    const s = String(v).trim();
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
// How many data rows a date range holds, counting by the mapped date
// column. A row whose date cannot be read is not counted.
export function countInRange(records: Record<string, unknown>[], dateColumn: string, dateFormat: string, range: { start: string; end: string } | null): number {
  if (!range) return records.length;
  let n = 0;
  for (const row of records) {
    try {
      const d = dateValue(row[dateColumn], false, dateFormat);
      if (d >= range.start && d <= range.end) n++;
    } catch { /* Unreadable dates are not counted. */ }
  }
  return n;
}

// --- Salespeople ------------------------------------------------------

// The two-letter tag for a salesperson made from a column value.
// "Anderson, Ruby" is Ruby Anderson, so the tag is RA; "Alex Lee"
// is AL; a single name gives its first two letters.
export function salespersonShortName(name: string): string {
  const trimmed = name.trim();
  const comma = trimmed.split(',').map(s => s.trim()).filter(Boolean);
  if (comma.length >= 2) return (comma[1][0] + comma[0][0]).toUpperCase();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  if (!words.length) return '';
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
export const SALESPERSON_PALETTE = ['#d32f2f', '#7b1fa2', '#1565c0', '#00695c', '#558b2f', '#f9a825', '#ef6c00', '#4e342e', '#00838f', '#ad1457', '#2e7d32', '#5d4037'];
export function salespeopleFromNames(names: string[]): Salesperson[] {
  return names.map((name, i) => ({
    id: `sp-${i + 1}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || i + 1}`,
    name,
    colour: SALESPERSON_PALETTE[i % SALESPERSON_PALETTE.length],
    shortName: salespersonShortName(name)
  }));
}

// --- Building the venue YAML ------------------------------------------

export interface WizardChoices {
  venueName: string;
  headerRow: number;
  roomSeparator: string;
  mapping: Record<FieldKey, string>;
  dateFormat: string;
  rooms: string[];
  excludedRooms: string[];
  unassignedRoom: boolean;
  allowedStatuses: string[];
  salespeople: Salesperson[];
  setupLabel: string;
  teardownLabel: string;
  date1904?: boolean;
}
// The venue YAML for the wizard's choices, ready to save. Only mapped
// fields are written; a field left unmapped is left out, never blank.
export function buildVenueDoc(choices: WizardChoices): Record<string, any> {
  const fields: Record<string, string> = {};
  for (const { key } of WIZARD_FIELDS) {
    const header = choices.mapping[key]?.trim();
    if (header) fields[key] = header;
  }
  const doc: Record<string, any> = {
    site: { name: choices.venueName.trim() || 'New venue' },
    file_input: { date_format: choices.dateFormat },
    fields,
    display: {
      primary_label: 'booking_name',
      secondary_label: 'activity_name',
      allowed_statuses: [...choices.allowedStatuses]
    },
    rooms: {
      order: [...choices.rooms],
      exclude: [...choices.excludedRooms],
      room_aliases: {},
      room_mappings: {}
    },
    timeline_items: [choices.setupLabel, choices.teardownLabel].filter(Boolean),
    whiteboard: {
      room_types: Object.fromEntries(choices.rooms.map(r => [r, 'other'])),
      room_widths: { large: 200, small: 125, other: 150 },
      salespeople: choices.salespeople,
      room_borders: [],
      operable_walls: []
    }
  };
  if (choices.headerRow > 1) doc.file_input.header_row = choices.headerRow;
  if (choices.roomSeparator) doc.file_input.room_separator = choices.roomSeparator;
  if (choices.unassignedRoom) {
    doc.rooms.order = [...choices.rooms, 'Unassigned'];
    doc.whiteboard.room_types['Unassigned'] = 'other';
    doc.rooms.unassigned_room = 'Unassigned';
  }
  return doc;
}
export function buildVenueYaml(choices: WizardChoices): string {
  return writeConfiguration(normalizeConfigDoc(buildVenueDoc(choices)));
}
// A first data row rendered with the current mapping, for the preview:
// the title, date, times and rooms as the import will read them, or
// the error that stops the row.
export function previewRow(row: Record<string, unknown>, mapping: Record<FieldKey, string>, dateFormat: string, roomSeparator: string): { title: string; date: string; start: string; end: string; rooms: string; error: string } {
  const get = (key: FieldKey) => mapping[key] ? row[mapping[key]] : '';
  const title = String(get('booking_name') ?? '').trim();
  try {
    const date = dateValue(get('event_date'), false, dateFormat);
    const start = timeValue(get('start_time'));
    const end = timeValue(get('end_time'));
    const rooms = splitRoomValue(String(get('room_name') ?? ''), roomSeparator).join(', ');
    return { title, date, start, end, rooms, error: !title ? 'No title' : !rooms ? 'No room' : '' };
  } catch (e) {
    return { title, date: '', start: '', end: '', rooms: '', error: e instanceof Error ? e.message : String(e) };
  }
}
export { sheetRecords };
