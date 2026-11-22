// Weekend / overnight notes export: the template the overnight crew works
// from. A button on the top bar spits out a Word document listing every
// setup (and pack-down) happening in the current overnight window, with
// an empty bullet list under each event to write in. Nothing here is
// invented, and nothing comes from the hotel's timings: every time is a
// purple TimeTarget note, imported from a TimeTarget export. A booking
// with no purple note is not listed at all.
//
// The format follows Brendan's own weekend notes (Weekend_Notes_Oct_24-25
// .docx, Dec_12_to_Dec_14_Weekend_Notes_V1.pdf): Calibri, the title in
// the header, the duty-manager header table, day sections, "Event/Room"
// headings, and "- " bullets. The one deliberate difference: every day
// gets a heading, where his hand-written notes leave the first day
// unheaded.
//
// The title follows the day of generation: Friday, Saturday or Sunday
// gives "Weekend Notes", Monday to Thursday gives "Overnight Notes".
//
// The window: on a non-Friday weekday it is 5pm today to 7am tomorrow;
// on a weekend it is 5pm Friday to 7am Monday. The date decides the
// window, not the time of day — opening it on a Saturday still gives
// that weekend's window.

import type { Booking, MarkupItem } from '../types';
import type { ParsedVenueConfig } from './venueConfig';
import { buildDocx } from './docx';
import type { DocxBlock, DocxParagraph } from './docx';

export interface OvernightWindow {
  kind: 'weekend' | 'weeknight';
  start: Date;
  end: Date;
  title: string;
  rangeLabel: string;
  filename: string;
}

export interface OvernightItem {
  roomId: string;
  roomName: string;
  date: string;
  startMs: number;
  title: string;
  // The times as shown, one line each, e.g. ["Set Up 07:00", "Pack Down 23:00"].
  // They come only from the purple TimeTarget notes — never from the
  // hotel's timeline.
  timeLines: string[];
  // The work of the earliest line, e.g. "Set Up" — only used for the
  // heading when the item has no title.
  functionLabel: string;
  bookingId?: string;
}

export interface WeekendNotesResult {
  bytes: Uint8Array;
  filename: string;
  window: OvernightWindow;
  days: number;
  items: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const atTime = (d: Date, hh: number, mm: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0);
// The samples write dates month first: "Friday Dec 12", "Sunday Dec 14".
const weekdayLong = (d: Date) => new Intl.DateTimeFormat('en-AU', { weekday: 'long' }).format(d);
const monthShort = (d: Date) => new Intl.DateTimeFormat('en-AU', { month: 'short' }).format(d);
const fmtTitleDate = (d: Date) => `${weekdayLong(d)} ${monthShort(d)} ${d.getDate()}`;
const fmtShort = (d: Date) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);

// The overnight window for a date. Friday, Saturday and Sunday all give
// the same weekend window (Friday 17:00 to Monday 07:00); Monday to
// Thursday give that night (17:00 to 07:00 tomorrow).
export function overnightWindow(now: Date): OvernightWindow {
  const day = now.getDay(); // 0 Sunday .. 6 Saturday
  if (day === 5 || day === 6 || day === 0) {
    const friday = addDays(now, day === 5 ? 0 : day === 6 ? -1 : -2);
    const monday = addDays(friday, 3);
    const sunday = addDays(friday, 2);
    return {
      kind: 'weekend',
      start: atTime(friday, 17, 0),
      end: atTime(monday, 7, 0),
      title: 'Weekend Notes',
      rangeLabel: `${fmtTitleDate(friday)} - ${fmtTitleDate(sunday)}`,
      filename: `Weekend Notes ${fmtShort(friday)} - ${fmtShort(sunday)}.docx`,
    };
  }
  const tomorrow = addDays(now, 1);
  return {
    kind: 'weeknight',
    start: atTime(now, 17, 0),
    end: atTime(tomorrow, 7, 0),
    title: 'Overnight Notes',
    rangeLabel: `${fmtTitleDate(now)} - ${fmtTitleDate(tomorrow)}`,
    filename: `Overnight Notes ${fmtShort(now)} - ${fmtShort(tomorrow)}.docx`,
  };
}

// The title as the header shows it: the samples' header uses the
// compact range ("October 24-25"), which fits on one line at 24pt.
export function headerRangeLabel(window: OvernightWindow): string {
  if (window.kind === 'weekend') return `${fmtShort(window.start)} - ${fmtShort(addDays(window.start, 2))}`;
  return `${fmtShort(window.start)} - ${fmtShort(window.end)}`;
}

// The two days the header table names. The samples name Saturday and
// Sunday for a weekend window; a weeknight names the two days its window
// spans.
export function headerTableDays(window: OvernightWindow): Date[] {
  if (window.kind === 'weekend') return [addDays(window.start, 1), addDays(window.start, 2)];
  return [window.start, window.end];
}

// "09:30" -> 570 (minutes after midnight), or null when it is not a time.
export function parseHhmm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

const toMs = (date: string, minutes: number) => {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(y, mo - 1, d, 0, 0, 0, 0).getTime() + minutes * 60_000;
};

const firstTimeInText = (text: string): string | null => {
  const m = /(\d{1,2}):(\d{2})/.exec(text);
  return m ? m[0] : null;
};

// The work a purple note records, from its text: "Set Up 06:30" is a
// "Set Up", "Pack Down 22:30" is a "Pack Down".
function functionFromNoteText(text: string): string {
  const stripped = text.replace(/\s*\d{1,2}:\d{2}\s*$/, '').trim();
  return stripped || text;
}

interface PurpleNote {
  id: string;
  date: string;
  roomId: string;
  time: string;
  startMs: number;
  text: string;
  functionLabel: string;
  bookingId?: string;
}

// The purple notation: the text notes the TimeTarget import made. They
// carry the rostered setup time, which is the time the notes show when
// one exists for a setup. A note made before the import recorded its
// time has none, so the time is read back out of its text instead.
function purpleNotes(markup: MarkupItem[]): PurpleNote[] {
  const notes: PurpleNote[] = [];
  for (const m of markup) {
    if (m.type !== 'text' || m.source !== 'timetarget' || !m.date || !m.roomId) continue;
    const time = m.time ?? firstTimeInText(m.text);
    if (!time) continue;
    const minutes = parseHhmm(time);
    if (minutes === null) continue;
    notes.push({ id: m.id, date: m.date, roomId: m.roomId, time, startMs: toMs(m.date, minutes), text: m.text, functionLabel: functionFromNoteText(m.text), bookingId: m.bookingId });
  }
  return notes;
}

// How a booking's rooms print in the heading. One event is one entry,
// however many rooms it spans — a merged Palladium block is "Palladium",
// not one line per room. A combined name from the venue's room mappings
// wins when the rooms match one exactly; otherwise the rooms are joined,
// and a long list is shortened to its first room.
export function roomDisplayName(venue: ParsedVenueConfig, roomIds: string[]): string {
  const nameOf = (roomId: string) => venue.rooms.find(r => r.id === roomId)?.name ?? roomId;
  if (roomIds.length === 0) return '';
  if (roomIds.length === 1) return nameOf(roomIds[0]);
  const sorted = [...roomIds].sort();
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  for (const [combined, rooms] of Object.entries(venue.mappings ?? {})) {
    if (same([...rooms].sort(), sorted)) return combined;
  }
  if (roomIds.length <= 3) return roomIds.map(nameOf).join(', ');
  return `${nameOf(roomIds[0])} + ${roomIds.length - 1} more`;
}

// The items in the order they print: by day, then by room in board
// order (the event's first room), then chronologically within the room.
//
// Only the purple TimeTarget notes make items. The hotel's timeline
// times are never used: a booking with no purple note is not listed at
// all, however many Setup/Teardown entries its timeline has. And one
// event is one item, however many functions it has — a setup and its
// pack-down are two time lines under one heading, not two entries.
export function collectOvernightItems(bookings: Booking[], markup: MarkupItem[], venue: ParsedVenueConfig, window: OvernightWindow): OvernightItem[] {
  const notes = purpleNotes(markup);
  const byBooking = new Map(bookings.map(b => [b.id, b]));
  const roomOrder = new Map(venue.rooms.map((r, i) => [r.id, i]));
  const roomName = (roomId: string) => venue.rooms.find(r => r.id === roomId)?.name ?? roomId;
  const allRooms = (b: Booking) => (b.roomIds && b.roomIds.length ? b.roomIds : [b.roomId]);
  const items: OvernightItem[] = [];
  const inWindow = (startMs: number) => startMs >= window.start.getTime() && startMs <= window.end.getTime();

  // Notes for one event on one day are one item, even when the board
  // holds the event as two bookings — a setup note and its pack-down
  // note can land on different bookings of the same title, and they
  // are still one entry. The event is its title, date and rooms. Each
  // distinct time becomes one line, earliest first. A note with no
  // booking is a setup on its own.
  const grouped = new Map<string, { booking?: Booking; notes: PurpleNote[] }>();
  for (const note of notes) {
    if (!inWindow(note.startMs)) continue;
    const booking = note.bookingId ? byBooking.get(note.bookingId) : undefined;
    const rooms = booking ? allRooms(booking) : [note.roomId];
    const title = booking?.title ?? '';
    const key = `${title}|${note.date}|${[...rooms].sort().join(',')}`;
    const entry = grouped.get(key) ?? { booking, notes: [] };
    entry.notes.push(note);
    if (!entry.booking) entry.booking = booking;
    grouped.set(key, entry);
  }
  const pushItem = (entry: { booking?: Booking; notes: PurpleNote[] }) => {
    const ordered = entry.notes.slice().sort((a, b) => a.startMs - b.startMs);
    const seen = new Set<string>();
    const timeLines = ordered.map(n => n.text).filter(t => (seen.has(t) ? false : (seen.add(t), true)));
    const first = ordered[0];
    const rooms = entry.booking ? allRooms(entry.booking) : [first.roomId];
    items.push({ roomId: rooms[0], roomName: entry.booking ? roomDisplayName(venue, rooms) : roomName(first.roomId), date: first.date, startMs: first.startMs, title: entry.booking?.title ?? '', timeLines, functionLabel: first.functionLabel, bookingId: entry.booking?.id ?? first.bookingId });
  };
  for (const entry of grouped.values()) pushItem(entry);

  const orderOf = (roomId: string) => (roomOrder.has(roomId) ? roomOrder.get(roomId)! : Number.MAX_SAFE_INTEGER);
  items.sort((a, b) => a.date.localeCompare(b.date) || orderOf(a.roomId) - orderOf(b.roomId) || a.startMs - b.startMs || a.title.localeCompare(b.title));
  return items;
}

// The document itself, in the samples' shape: Calibri on A4, the title
// in the header (24pt bold, centred — as in the samples, where the
// title lives in the header and the body starts with the table), the
// duty-manager header table, then a section per day — "Event/Room"
// headings, each of the event's times on its own line (a setup and its
// pack-down are two lines under one heading, not two entries), and
// three empty "- " bullets to write in. An empty window still produces
// a file, so the crew can see there is nothing overnight instead of
// wondering whether the export failed.
export function buildWeekendNotesDocx(bookings: Booking[], markup: MarkupItem[], venue: ParsedVenueConfig, now = new Date()): WeekendNotesResult {
  const window = overnightWindow(now);
  const items = collectOvernightItems(bookings, markup, venue, window);
  const days: { date: string; items: OvernightItem[] }[] = [];
  for (const item of items) {
    const last = days[days.length - 1];
    if (last && last.date === item.date) last.items.push(item);
    else days.push({ date: item.date, items: [item] });
  }
  const [day1, day2] = headerTableDays(window);
  const title = `${window.title} ${window.rangeLabel}`;
  const blank: DocxParagraph = { runs: [], size: 28 };
  const body: DocxBlock[] = [];
  body.push({
    type: 'table',
    table: {
      widths: [2254, 2254, 2254, 2254],
      rows: [
        [{ paragraphs: [{ runs: [{ text: 'Duty Manager – ________________' }], align: 'center', bold: true, size: 28 }], gridSpan: 4, width: 9016 }],
        [
          { paragraphs: [{ runs: [{ text: weekdayLong(day1) }], align: 'center', bold: true, size: 28 }], gridSpan: 2, width: 4508 },
          { paragraphs: [{ runs: [{ text: weekdayLong(day2) }], align: 'center', bold: true, size: 28 }], gridSpan: 2, width: 4508 },
        ],
        // Start and end hours for each day — blank: the board does not
        // know the duty manager's hours, so the crew writes them in.
        [2254, 2254, 2254, 2254].map(width => ({ paragraphs: [{ runs: [], align: 'center', bold: true, size: 30 }], width })),
        [{ paragraphs: [{ runs: [{ text: 'Out of hours (Crown On Call): ' }, { text: '0427 421 821' }], align: 'center', bold: true, size: 28 }], gridSpan: 4, width: 9016 }],
      ],
    },
  });
  body.push({ type: 'paragraph', paragraph: blank });
  if (!items.length) {
    body.push({ type: 'paragraph', paragraph: { runs: [{ text: 'No setups in this window.' }], size: 28 } });
  }
  for (const [dayIndex, day] of days.entries()) {
    if (dayIndex > 0) body.push({ type: 'paragraph', paragraph: blank });
    body.push({ type: 'paragraph', paragraph: { runs: [{ text: weekdayLong(new Date(`${day.date}T12:00:00`)) }], bold: true, size: 28 } });
    for (const item of day.items) {
      const heading = item.title ? `${item.title}/${item.roomName}` : `${item.functionLabel}/${item.roomName}`;
      body.push({ type: 'paragraph', paragraph: { runs: [{ text: heading }], bold: true, size: 36 } });
      for (const line of item.timeLines) body.push({ type: 'paragraph', paragraph: { runs: [{ text: line }], size: 28 } });
      for (let i = 0; i < 3; i++) body.push({ type: 'paragraph', paragraph: { runs: [{ text: '- ' }], size: 28 } });
    }
  }
  const bytes = buildDocx({
    title,
    header: [{ runs: [{ text: `${window.title} ${headerRangeLabel(window)}` }], align: 'center', bold: true, size: 48 }],
    footer: [
      { runs: [{ text: 'Crown On Call Phone: 0427 421 821' }], align: 'center', bold: true, size: 24 },
      { runs: [{ text: 'Page ' }, { field: 'PAGE' }, { text: ' of ' }, { field: 'NUMPAGES' }], align: 'center', bold: true, size: 24 },
    ],
    body,
  });
  return { bytes, filename: window.filename, window, days: days.length, items: items.length };
}
