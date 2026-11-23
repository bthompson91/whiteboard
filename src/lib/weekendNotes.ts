// Weekend / overnight notes export: the template the overnight crew works
// from. A button on the top bar spits out a Word document listing every
// setup (and pack-down) happening in the current overnight window, with
// an empty bullet list under each event to write in. Nothing here is
// invented, and no time comes from the hotel: every time shown is a
// purple TimeTarget note's own time, imported from a TimeTarget export.
// An event with no purple note is still listed — by its function, with
// no time, so the crew writes the time in.
//
// The format follows Brendan's own weekend notes (Weekend_Notes_Oct_24-25
// .docx, Dec_12_to_Dec_14_Weekend_Notes_V1.pdf): Calibri, the title in
// the header, the duty-manager header table, day sections, "Event/Room"
// headings, and "- " bullets. The table is in the weekend export only:
// a weeknight's overnight notes start straight at the day sections.
// The one deliberate difference: every day gets a heading, where his
// hand-written notes leave the first day unheaded.
//
// The title follows the day of generation: Friday, Saturday or Sunday
// gives "Weekend Notes", Monday to Thursday gives "Overnight Notes".
//
// The window: on a non-Friday weekday it is 5pm today to the end of
// tomorrow, so it lists ALL of tomorrow's events, not just the
// overnight work; on a weekend it is Friday to Monday 7am, so it lists
// ALL of the weekend's events. The date decides the window, not the
// time of day — opening it on a Saturday still gives that weekend's
// window. The events print by room in board order, then by date:
// all the Palladiums, then all the Rivers, then all the Gardens.

import type { Booking, MarkupItem } from '../types';
import type { ParsedVenueConfig } from './venueConfig';
import { buildDocx } from './docx';
import type { DocxBlock, DocxParagraph } from './docx';
import { shortFunctionName, eventMatchesEvent } from './timetargetImport';

export interface OvernightWindow {
  kind: 'weekend' | 'weeknight';
  start: Date;
  end: Date;
  title: string;
  rangeLabel: string;
  filename: string;
  // The days listed in full: every event on one of these days is
  // listed, even one with no setup or pack-down recorded. A weeknight
  // lists tomorrow; a weekend lists Friday, Saturday and Sunday.
  fullDays: string[];
}

export interface OvernightItem {
  roomId: string;
  roomName: string;
  date: string;
  startMs: number;
  title: string;
  // The lines as shown, one per function, e.g. ["Set Up 07:00", "Pack Down 23:00"].
  // A time on a line is always a purple TimeTarget note's own time —
  // never the hotel's. A function with no purple note in the window is
  // listed by its name alone, e.g. ["Set Up"].
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
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The overnight window for a date. Friday, Saturday and Sunday all give
// the same weekend window (Friday 00:00 to Monday 07:00); Monday to
// Thursday give that night plus the whole next day (17:00 to 23:59
// tomorrow). The notes list ALL the events in the window — the whole
// next day, or the whole weekend — not just the work in the overnight
// hours, so the crew coming on sees everything they are setting up
// for, including daytime setups. The weekend runs to Monday 07:00 so
// a Sunday event's pack-down past midnight is still in it.
export function overnightWindow(now: Date): OvernightWindow {
  const day = now.getDay(); // 0 Sunday .. 6 Saturday
  if (day === 5 || day === 6 || day === 0) {
    const friday = addDays(now, day === 5 ? 0 : day === 6 ? -1 : -2);
    const monday = addDays(friday, 3);
    const sunday = addDays(friday, 2);
    return {
      kind: 'weekend',
      start: atTime(friday, 0, 0),
      end: atTime(monday, 7, 0),
      title: 'Weekend Notes',
      rangeLabel: `${fmtTitleDate(friday)} - ${fmtTitleDate(sunday)}`,
      filename: `Weekend Notes ${fmtShort(friday)} - ${fmtShort(sunday)}.docx`,
      fullDays: [isoDate(friday), isoDate(addDays(friday, 1)), isoDate(sunday)],
    };
  }
  const tomorrow = addDays(now, 1);
  return {
    kind: 'weeknight',
    start: atTime(now, 17, 0),
    end: atTime(tomorrow, 23, 59),
    title: 'Overnight Notes',
    rangeLabel: `${fmtTitleDate(now)} - ${fmtTitleDate(tomorrow)}`,
    filename: `Overnight Notes ${fmtShort(now)} - ${fmtShort(tomorrow)}.docx`,
    fullDays: [isoDate(tomorrow)],
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
// spans. Only the weekend export prints the table — the overnight one
// starts straight at the day sections.
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

// Timeline labels that count as overnight work: the setup and the
// pack-down. Crown calls them Setup/Teardown, MCG calls them Bump In /
// Bump Out; the match is by label, not by venue. "Set Up" with a space
// counts the same as "Setup".
const isWorkLabel = (label: string) => /set\s?up|bump in|teardown|bump out|pack/i.test(label);

// The function as shown when there is no purple time for it: a setup
// is "SU" and a pack-down is "PD", whatever the venue called it. The
// purple notes read the same way, so an old "Set Up" note and a new
// "SU" note group under one function. Anything else is shown as written.
function functionDisplayName(label: string): string {
  return shortFunctionName(label);
}

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
  timetargetKey?: string;
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
    notes.push({ id: m.id, date: m.date, roomId: m.roomId, time, startMs: toMs(m.date, minutes), text: m.text, functionLabel: functionFromNoteText(m.text), bookingId: m.bookingId, timetargetKey: m.timetargetKey });
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

// The room a section is headed by: the combined name when the room
// belongs to one of the venue's room mappings (Palladium A, B, C1, C2,
// C3 are all "Palladium"), otherwise the room's own name. This is
// what groups the notes by room area — every Palladium event under
// one heading, however many of the Palladium rooms it uses.
export function roomGroupName(venue: ParsedVenueConfig, roomId: string): string {
  for (const [combined, rooms] of Object.entries(venue.mappings ?? {})) {
    if (rooms.includes(roomId)) return combined;
  }
  return venue.rooms.find(r => r.id === roomId)?.name ?? roomId;
}

// Every event in the window is listed — a booking with no purple note
// is still an item. But a time is only ever a purple TimeTarget note's
// own time: the hotel's timeline times are never shown. A function
// with no note in the window is listed by its name alone ("Set Up"),
// with no time, so the crew writes the time in. One event is one item,
// however many functions it has — a setup and its pack-down are two
// lines under one heading, not two entries.
export function collectOvernightItems(bookings: Booking[], markup: MarkupItem[], venue: ParsedVenueConfig, window: OvernightWindow): OvernightItem[] {
  const notes = purpleNotes(markup);
  const byBooking = new Map(bookings.map(b => [b.id, b]));
  const roomOrder = new Map(venue.rooms.map((r, i) => [r.id, i]));
  const roomName = (roomId: string) => venue.rooms.find(r => r.id === roomId)?.name ?? roomId;
  const allRooms = (b: Booking) => (b.roomIds && b.roomIds.length ? b.roomIds : [b.roomId]);
  const items: OvernightItem[] = [];
  const inWindow = (startMs: number) => startMs >= window.start.getTime() && startMs <= window.end.getTime();

  // The work of one event, grouped by function. An event is its title,
  // date and rooms — the board can hold it as two bookings (a setup
  // note and its pack-down note landing on different same-title
  // bookings), and it is still one entry. A function is in the window
  // when one of its purple notes falls inside it, or when its timeline
  // entry's range overlaps the window.
  interface EventWork {
    title: string;
    date: string;
    rooms: string[];
    bookingId?: string;
    // The earliest start of any booking in the event, for ordering an
    // event that has no lines (a full-day event with no work recorded).
    firstStartMs: number;
    functions: Map<string, { notes: PurpleNote[]; entries: { startMs: number; endMs: number }[] }>;
  }
  const events = new Map<string, EventWork>();
  const eventFor = (title: string, date: string, rooms: string[], bookingId?: string): EventWork => {
    const key = `${title}|${date}|${[...rooms].sort().join(',')}`;
    let ev = events.get(key);
    if (!ev) { ev = { title, date, rooms, bookingId, firstStartMs: Number.MAX_SAFE_INTEGER, functions: new Map() }; events.set(key, ev); }
    if (!ev.bookingId) ev.bookingId = bookingId;
    const booking = bookingId ? byBooking.get(bookingId) : undefined;
    if (booking) {
      const start = parseHhmm(booking.startTime);
      if (start !== null) ev.firstStartMs = Math.min(ev.firstStartMs, toMs(booking.date, start));
    }
    return ev;
  };
  const fnFor = (ev: EventWork, fn: string) => {
    let f = ev.functions.get(fn);
    if (!f) { f = { notes: [], entries: [] }; ev.functions.set(fn, f); }
    return f;
  };
  // The timeline entries: the work the venue's export records. Their
  // times are never shown — only whether the work is in the window.
  for (const b of bookings) {
    const rooms = allRooms(b);
    for (const entry of b.timeline ?? []) {
      if (!isWorkLabel(entry.label)) continue;
      const start = parseHhmm(entry.start);
      const end = parseHhmm(entry.end);
      if (start === null || end === null) continue;
      // The entry runs past midnight when its end is at or before its
      // start.
      let endMs = toMs(b.date, end);
      if (endMs <= toMs(b.date, start)) endMs += DAY_MS;
      fnFor(eventFor(b.title, b.date, rooms, b.id), functionDisplayName(entry.label)).entries.push({ startMs: toMs(b.date, start), endMs });
    }
  }
  // The purple notes: the only source of times. A note with no booking
  // is a setup on its own — unless it can be matched to one. A note
  // imported before its TimeTarget row matched a booking carries no
  // bookingId (the row's event had a job prefix and was cut short, so
  // the match failed), and without a booking the note exports with no
  // title and only its one room. So an orphaned note is matched back
  // to a booking on its date in its room: by the event name in its
  // TimeTarget key when there is one, and otherwise by the closest
  // session start after its time — a setup precedes its session.
  // The date and room already pin it down, so this cannot reach
  // across to another event.
  const eventOfNote = (note: PurpleNote): string => {
    const key = note.timetargetKey ?? '';
    if (!key) return '';
    const parts = key.split('|');
    if (parts.length < 5) return '';
    return parts.slice(3, -1).join('|');
  };
  const minutesOf = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const bookingForOrphanNote = (note: PurpleNote): Booking | undefined => {
    const sameDay = bookings.filter(b => b.date === note.date && (b.roomIds?.includes(note.roomId) || b.roomId === note.roomId));
    if (!sameDay.length) return undefined;
    const event = eventOfNote(note);
    const byEvent = event ? sameDay.filter(b => eventMatchesEvent(event, b.title)) : [];
    const pool = byEvent.length ? byEvent : sameDay;
    const noteMinutes = parseHhmm(note.time) ?? 0;
    return pool.reduce((best, b) => {
      const gap = (t: string) => minutesOf(t) - noteMinutes;
      const bestGap = gap(best.startTime);
      const thisGap = gap(b.startTime);
      // The closest session at or after the note's time wins; a session
      // before it only wins when nothing follows it.
      if (bestGap >= 0 && thisGap >= 0) return thisGap < bestGap ? b : best;
      if (bestGap >= 0) return best;
      if (thisGap >= 0) return b;
      return thisGap > bestGap ? b : best;
    });
  };
  for (const note of notes) {
    const booking = note.bookingId ? byBooking.get(note.bookingId) : undefined;
    const resolved = booking ?? bookingForOrphanNote(note);
    const rooms = resolved ? allRooms(resolved) : [note.roomId];
    const title = resolved?.title ?? '';
    fnFor(eventFor(title, note.date, rooms, resolved?.id), functionDisplayName(note.functionLabel)).notes.push(note);
  }
  // Every booking on a full day gets an event, even one with no
  // timeline entries and no purple notes — the notes list ALL the
  // events for the next day (or the weekend), not just the ones with
  // work recorded. An event with no functions is listed with no time
  // lines, so the crew writes the times in.
  for (const b of bookings) {
    if (window.fullDays.includes(b.date)) eventFor(b.title, b.date, allRooms(b), b.id);
  }
  for (const ev of events.values()) {
    const lines: { text: string; startMs: number }[] = [];
    for (const [fn, f] of ev.functions) {
      const notesIn = f.notes.filter(n => inWindow(n.startMs)).sort((a, b) => a.startMs - b.startMs);
      const entriesIn = f.entries.filter(e => e.startMs <= window.end.getTime() && e.endMs >= window.start.getTime()).sort((a, b) => a.startMs - b.startMs);
      if (notesIn.length) {
        const seen = new Set<string>();
        for (const n of notesIn) {
          if (seen.has(n.text)) continue;
          seen.add(n.text);
          lines.push({ text: n.text, startMs: n.startMs });
        }
      } else if (entriesIn.length) {
        lines.push({ text: fn, startMs: entriesIn[0].startMs });
      }
    }
    // An event with no lines in the window is only listed when it is
    // on a full day — a booking on the window's start day (or past
    // midnight on its end day) is listed only for work in the window.
    if (!lines.length && !window.fullDays.includes(ev.date)) continue;
    lines.sort((a, b) => a.startMs - b.startMs);
    const first = lines[0];
    const startMs = first ? first.startMs : ev.firstStartMs;
    const functionLabel = first ? functionDisplayName(functionFromNoteText(first.text)) : '';
    items.push({ roomId: ev.rooms[0], roomName: ev.title ? roomDisplayName(venue, ev.rooms) : roomName(ev.rooms[0]), date: ev.date, startMs, title: ev.title, timeLines: lines.map(l => l.text), functionLabel, bookingId: ev.bookingId });
  }

  // The items in the order they print: by room in board order, then by
  // day, then chronologically within the room — all the Palladiums by
  // date, then all the Rivers, then all the Gardens. The room is the
  // event's first room: rooms of one area sit next to each other in
  // the board order, so every event in that area sorts together.
  const orderOf = (roomId: string) => (roomOrder.has(roomId) ? roomOrder.get(roomId)! : Number.MAX_SAFE_INTEGER);
  items.sort((a, b) => orderOf(a.roomId) - orderOf(b.roomId) || a.date.localeCompare(b.date) || a.startMs - b.startMs || a.title.localeCompare(b.title));
  return items;
}

// The document itself, in the samples' shape: Calibri on A4, the title
// in the header (24pt bold, centred — as in the samples, where the
// title lives in the header and the body starts with the table), the
// duty-manager header table on a weekend window only, then a section
// per room — all the Palladiums by date, then all the Rivers, then
// all the Gardens — each event headed by its date and title, each of
// the event's functions on its own line (with its purple time when
// there is one, otherwise just the function name), and three empty
// "- " bullets to write in. An empty window still produces a file, so
// the crew can see there is nothing overnight instead of wondering
// whether the export failed. The footer names the after-hours contact
// from Configuration.
export function buildWeekendNotesDocx(bookings: Booking[], markup: MarkupItem[], venue: ParsedVenueConfig, now = new Date()): WeekendNotesResult {
  const window = overnightWindow(now);
  const items = collectOvernightItems(bookings, markup, venue, window);
  // Sections by room area, in the order the items already print in
  // (room, then date): consecutive items in one room area share a
  // heading, so every Palladium event is under "Palladium" however
  // many of the Palladium rooms it uses.
  const sections: { room: string; items: OvernightItem[] }[] = [];
  for (const item of items) {
    const room = roomGroupName(venue, item.roomId);
    const last = sections[sections.length - 1];
    if (last && last.room === room) last.items.push(item);
    else sections.push({ room, items: [item] });
  }
  const days = new Set(items.map(i => i.date)).size;
  const title = `${window.title} ${window.rangeLabel}`;
  const blank: DocxParagraph = { runs: [], size: 28 };
  const body: DocxBlock[] = [];
  // The duty-manager header table is a weekend thing: the overnight
  // notes for a weeknight start straight at the day sections. The
  // table's contact is the venue's After Hours Contact, not a
  // hard-coded number — same as the footer.
  if (window.kind === 'weekend') {
    const [day1, day2] = headerTableDays(window);
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
          [{ paragraphs: [{ runs: [{ text: `After Hours Contact: ${venue.afterHoursContact}` }], align: 'center', bold: true, size: 28 }], gridSpan: 4, width: 9016 }],
        ],
      },
    });
    body.push({ type: 'paragraph', paragraph: blank });
  }
  if (!items.length) {
    body.push({ type: 'paragraph', paragraph: { runs: [{ text: 'No setups in this window.' }], size: 28 } });
  }
  for (const [sectionIndex, section] of sections.entries()) {
    if (sectionIndex > 0) body.push({ type: 'paragraph', paragraph: blank });
    body.push({ type: 'paragraph', paragraph: { runs: [{ text: section.room }], bold: true, size: 28 } });
    for (const item of section.items) {
      // The room is the section heading now, so the event heading
      // carries its date instead: "Tue, 24 Nov — Title".
      const dateLabel = fmtShort(new Date(`${item.date}T12:00:00`));
      const heading = item.title ? `${dateLabel} — ${item.title}` : `${dateLabel} — ${item.functionLabel}`;
      body.push({ type: 'paragraph', paragraph: { runs: [{ text: heading }], bold: true, size: 36 } });
      for (const line of item.timeLines) body.push({ type: 'paragraph', paragraph: { runs: [{ text: line }], size: 28 } });
      for (let i = 0; i < 3; i++) body.push({ type: 'paragraph', paragraph: { runs: [{ text: '- ' }], size: 28 } });
    }
  }
  const bytes = buildDocx({
    title,
    header: [{ runs: [{ text: `${window.title} ${headerRangeLabel(window)}` }], align: 'center', bold: true, size: 48 }],
    footer: [
      { runs: [{ text: `After Hours Contact: ${venue.afterHoursContact}` }], align: 'center', bold: true, size: 24 },
      { runs: [{ text: 'Page ' }, { field: 'PAGE' }, { text: ' of ' }, { field: 'NUMPAGES' }], align: 'center', bold: true, size: 24 },
    ],
    body,
  });
  return { bytes, filename: window.filename, window, days, items: items.length };
}
