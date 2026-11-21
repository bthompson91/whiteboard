// Weekend / overnight notes export: the template the overnight crew works
// from. A button on the top bar spits out a Word document listing every
// setup (and pack-down) happening in the current overnight window, with
// an empty bullet list under each event to write in. Nothing here is
// invented: every item comes from a booking's timeline or a TimeTarget
// note on the board.
//
// The format follows Brendan's own weekend notes (Weekend_Notes_Oct_24-25
// .docx, Dec_12_to_Dec_14_Weekend_Notes_V1.pdf): Calibri, the title in
// the header, the duty-manager header table, day sections, "Event/Room"
// headings (with PD after the event for a pack-down), and "- " bullets.
// The one deliberate difference: every day gets a heading, where his
// hand-written notes leave the first day unheaded.
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
  // The setup time as shown, e.g. "Set Up 06:30" or "Setup 09:00".
  timeLine: string;
  // The work itself, e.g. "Set Up", "Pack Down", "Setup", "Teardown".
  functionLabel: string;
  isPackDown: boolean;
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

// Timeline labels that count as overnight work: the setup and the
// pack-down. Crown calls them Setup/Teardown, MCG calls them Bump In /
// Bump Out; the match is by label, not by venue.
const isSetupLabel = (label: string) => /setup|bump in/i.test(label);
const isTeardownLabel = (label: string) => /teardown|bump out|pack/i.test(label);
const isWorkLabel = (label: string) => isSetupLabel(label) || isTeardownLabel(label);

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
export function collectOvernightItems(bookings: Booking[], markup: MarkupItem[], venue: ParsedVenueConfig, window: OvernightWindow): OvernightItem[] {
  const notes = purpleNotes(markup);
  const byBooking = new Map(bookings.map(b => [b.id, b]));
  const roomOrder = new Map(venue.rooms.map((r, i) => [r.id, i]));
  const roomName = (roomId: string) => venue.rooms.find(r => r.id === roomId)?.name ?? roomId;
  const allRooms = (b: Booking) => (b.roomIds && b.roomIds.length ? b.roomIds : [b.roomId]);
  const items: OvernightItem[] = [];
  const usedNotes = new Set<string>();
  const inWindow = (startMs: number, endMs: number) => startMs <= window.end.getTime() && endMs >= window.start.getTime();

  // A purple note belongs to the closest work entry of its booking (or,
  // when the note has no booking, the closest entry of any booking on
  // that date in that room). Several notes can belong to one entry — a
  // TimeTarget row per room of a merged block — and the earliest is the
  // time the export shows. The note's time is the setup time; the
  // timeline entry is the work it belongs to.
  const notesForEntry = new Map<string, PurpleNote[]>();
  for (const note of notes) {
    const candidates: { booking: Booking; entryIndex: number; diff: number }[] = [];
    const consider = (b: Booking) => {
      if (b.date !== note.date || !allRooms(b).includes(note.roomId)) return;
      (b.timeline ?? []).forEach((entry, entryIndex) => {
        if (!isWorkLabel(entry.label)) return;
        const start = parseHhmm(entry.start);
        if (start === null) return;
        candidates.push({ booking: b, entryIndex, diff: Math.abs(toMs(b.date, start) - note.startMs) });
      });
    };
    if (note.bookingId && byBooking.has(note.bookingId)) consider(byBooking.get(note.bookingId)!);
    else bookings.forEach(consider);
    if (!candidates.length) continue;
    candidates.sort((a, b) => a.diff - b.diff);
    const best = candidates[0];
    usedNotes.add(note.id);
    const key = `${best.booking.id}|${best.entryIndex}`;
    const list = notesForEntry.get(key) ?? [];
    list.push(note);
    notesForEntry.set(key, list);
  }

  for (const b of bookings) {
    const entries = (b.timeline ?? [])
      .map((entry, entryIndex) => ({ entry, entryIndex }))
      .filter(({ entry }) => isWorkLabel(entry.label));
    if (!entries.length) continue;
    const rooms = allRooms(b);
    for (const { entry, entryIndex } of entries) {
      const start = parseHhmm(entry.start);
      const end = parseHhmm(entry.end);
      if (start === null || end === null) continue;
      const entryNotes = (notesForEntry.get(`${b.id}|${entryIndex}`) ?? []).sort((a, c) => a.startMs - c.startMs);
      const note = entryNotes[0];
      const startMs = note ? note.startMs : toMs(b.date, start);
      // The entry runs past midnight when its end is at or before its
      // start. When the note's time is past the entry's end, the two
      // disagree and the setup is a point at the note's time, not a
      // range.
      let endMs = toMs(b.date, end);
      if (endMs <= toMs(b.date, start)) endMs += DAY_MS;
      if (endMs <= startMs) endMs = startMs;
      if (!inWindow(startMs, endMs)) continue;
      const functionLabel = note ? note.functionLabel : entry.label;
      items.push({ roomId: rooms[0], roomName: roomDisplayName(venue, rooms), date: b.date, startMs, title: b.title, timeLine: note ? note.text : `${entry.label} ${entry.start}`, functionLabel, isPackDown: isTeardownLabel(functionLabel), bookingId: b.id });
    }
  }

  // A purple note with no timeline entry to belong to is a setup on its
  // own: the TimeTarget file is the only record of it. Notes for the
  // same booking are one setup, not one per room.
  const noteOnlyByBooking = new Map<string, PurpleNote[]>();
  const standaloneNotes: PurpleNote[] = [];
  for (const note of notes) {
    if (usedNotes.has(note.id)) continue;
    if (note.startMs < window.start.getTime() || note.startMs > window.end.getTime()) continue;
    if (note.bookingId) {
      const list = noteOnlyByBooking.get(note.bookingId) ?? [];
      list.push(note);
      noteOnlyByBooking.set(note.bookingId, list);
    } else standaloneNotes.push(note);
  }
  const pushNoteOnly = (note: PurpleNote, booking?: Booking) => {
    const rooms = booking ? allRooms(booking) : [note.roomId];
    items.push({ roomId: rooms[0], roomName: booking ? roomDisplayName(venue, rooms) : roomName(note.roomId), date: note.date, startMs: note.startMs, title: booking?.title ?? '', timeLine: note.text, functionLabel: note.functionLabel, isPackDown: isTeardownLabel(note.functionLabel), bookingId: note.bookingId });
  };
  for (const [bookingId, list] of noteOnlyByBooking) {
    const note = list.sort((a, b) => a.startMs - b.startMs)[0];
    pushNoteOnly(note, byBooking.get(bookingId));
  }
  for (const note of standaloneNotes) pushNoteOnly(note);

  const orderOf = (roomId: string) => (roomOrder.has(roomId) ? roomOrder.get(roomId)! : Number.MAX_SAFE_INTEGER);
  items.sort((a, b) => a.date.localeCompare(b.date) || orderOf(a.roomId) - orderOf(b.roomId) || a.startMs - b.startMs || a.title.localeCompare(b.title));
  return items;
}

// The document itself, in the samples' shape: Calibri on A4, the title
// in the header (24pt bold, centred — as in the samples, where the
// title lives in the header and the body starts with the table), the
// duty-manager header table, then a section per day — "Event/Room"
// headings (PD after the event for a pack-down), the setup time on its
// own line, and three empty "- " bullets to write in. An empty window
// still produces a file, so the crew can see there is nothing overnight
// instead of wondering whether the export failed.
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
      const heading = item.title ? `${item.title}${item.isPackDown ? ' PD' : ''}/${item.roomName}` : `${item.functionLabel}/${item.roomName}`;
      body.push({ type: 'paragraph', paragraph: { runs: [{ text: heading }], bold: true, size: 36 } });
      body.push({ type: 'paragraph', paragraph: { runs: [{ text: item.timeLine }], size: 28 } });
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
