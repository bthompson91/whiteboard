// Weekend / overnight notes export: the template the overnight crew works
// from. A button on the top bar spits out an RTF file listing every setup
// (and pack-down) happening in the current overnight window, with an
// empty bullet list under each event to write in. Nothing here is
// invented: every item comes from a booking's timeline or a TimeTarget
// note on the board.
//
// The format follows Brendan's own weekend notes (Weekend_Notes_Oct_24-25
// .docx, Dec_12_to_Dec_14_Weekend_Notes_V1.pdf): Tahoma, a title line,
// the duty-manager header table, day sections, "Event/Room" headings
// (with PD after the event for a pack-down), and "- " bullets. The one
// deliberate difference: every day gets a heading, where his hand-written
// notes leave the first day unheaded.
//
// The window: on a non-Friday weekday it is 5pm today to 7am tomorrow;
// on a weekend it is 5pm Friday to 7am Monday. The date decides the
// window, not the time of day — opening it on a Saturday still gives
// that weekend's window.

import type { Booking, MarkupItem } from '../types';
import type { ParsedVenueConfig } from './venueConfig';

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
  rtf: string;
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
      filename: `Weekend Notes ${fmtShort(friday)} - ${fmtShort(sunday)}.rtf`,
    };
  }
  const tomorrow = addDays(now, 1);
  return {
    kind: 'weeknight',
    start: atTime(now, 17, 0),
    end: atTime(tomorrow, 7, 0),
    title: 'Overnight Notes',
    rangeLabel: `${fmtTitleDate(now)} - ${fmtTitleDate(tomorrow)}`,
    filename: `Overnight Notes ${fmtShort(now)} - ${fmtShort(tomorrow)}.rtf`,
  };
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

// The items in the order they print: by day, then by room in board
// order, then chronologically within the room.
export function collectOvernightItems(bookings: Booking[], markup: MarkupItem[], venue: ParsedVenueConfig, window: OvernightWindow): OvernightItem[] {
  const notes = purpleNotes(markup);
  const byBooking = new Map(bookings.map(b => [b.id, b]));
  const roomOrder = new Map(venue.rooms.map((r, i) => [r.id, i]));
  const roomName = (roomId: string) => venue.rooms.find(r => r.id === roomId)?.name ?? roomId;
  const allRooms = (b: Booking) => (b.roomIds && b.roomIds.length ? b.roomIds : [b.roomId]);
  const items: OvernightItem[] = [];
  const usedNotes = new Set<string>();
  const inWindow = (startMs: number, endMs: number) => startMs <= window.end.getTime() && endMs >= window.start.getTime();

  // A purple note belongs to the closest work entry of its booking in
  // that room (or, when the note has no booking, the closest entry of
  // any booking on that date and room). The note's time is the setup
  // time the export shows; the timeline entry is the work it belongs to.
  const noteFor = new Map<string, PurpleNote>();
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
    noteFor.set(`${best.booking.id}|${best.entryIndex}|${note.roomId}`, note);
  }

  for (const b of bookings) {
    const entries = (b.timeline ?? [])
      .map((entry, entryIndex) => ({ entry, entryIndex }))
      .filter(({ entry }) => isWorkLabel(entry.label));
    if (!entries.length) continue;
    for (const roomId of allRooms(b)) {
      for (const { entry, entryIndex } of entries) {
        const start = parseHhmm(entry.start);
        const end = parseHhmm(entry.end);
        if (start === null || end === null) continue;
        const note = noteFor.get(`${b.id}|${entryIndex}|${roomId}`);
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
        items.push({ roomId, roomName: roomName(roomId), date: b.date, startMs, title: b.title, timeLine: note ? note.text : `${entry.label} ${entry.start}`, functionLabel, isPackDown: isTeardownLabel(functionLabel), bookingId: b.id });
      }
    }
  }

  // A purple note with no timeline entry to belong to is a setup on its
  // own: the TimeTarget file is the only record of it.
  for (const note of notes) {
    if (usedNotes.has(note.id)) continue;
    if (note.startMs < window.start.getTime() || note.startMs > window.end.getTime()) continue;
    const booking = note.bookingId ? byBooking.get(note.bookingId) : undefined;
    items.push({ roomId: note.roomId, roomName: roomName(note.roomId), date: note.date, startMs: note.startMs, title: booking?.title ?? '', timeLine: note.text, functionLabel: note.functionLabel, isPackDown: isTeardownLabel(note.functionLabel), bookingId: note.bookingId });
  }

  const orderOf = (roomId: string) => (roomOrder.has(roomId) ? roomOrder.get(roomId)! : Number.MAX_SAFE_INTEGER);
  items.sort((a, b) => a.date.localeCompare(b.date) || orderOf(a.roomId) - orderOf(b.roomId) || a.startMs - b.startMs || a.title.localeCompare(b.title));
  return items;
}

const rtfEscape = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\n/g, ' ')
    .split('')
    .map(ch => {
      const code = ch.charCodeAt(0);
      if (code < 128) return ch;
      if (code < 256) return `\\'${code.toString(16).padStart(2, '0')}`;
      return `\\u${code}?`;
    })
    .join('');

// The RTF itself, in the samples' shape: Tahoma on A4, a title line,
// the duty-manager header table, then a section per day — "Event/Room"
// headings (PD after the event for a pack-down), the setup time on its
// own line, and three empty "- " bullets to write in. An empty window
// still produces a file, so the crew can see there is nothing overnight
// instead of wondering whether the export failed.
export function buildWeekendNotesRtf(bookings: Booking[], markup: MarkupItem[], venue: ParsedVenueConfig, now = new Date()): WeekendNotesResult {
  const window = overnightWindow(now);
  const items = collectOvernightItems(bookings, markup, venue, window);
  const days: { date: string; items: OvernightItem[] }[] = [];
  for (const item of items) {
    const last = days[days.length - 1];
    if (last && last.date === item.date) last.items.push(item);
    else days.push({ date: item.date, items: [item] });
  }
  const [day1, day2] = headerTableDays(window);
  const cellBorders = '\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10';
  const lines: string[] = [];
  lines.push('{\\rtf1\\ansi\\ansicpg1252\\deff0');
  lines.push('{\\fonttbl{\\f0 Tahoma;}}');
  lines.push('\\paperw11906\\paperh16838\\margl1440\\margr1440\\margt1440\\margb1440\\viewkind4\\uc1');
  lines.push('{\\footer\\pard\\qc\\fs22 Page {\\field{\\*\\fldinst PAGE}{\\fldrslt 1}} of {\\field{\\*\\fldinst NUMPAGES}{\\fldrslt 1}}\\par}');
  lines.push(`\\pard\\b\\fs36 ${rtfEscape(`${window.title} ${window.rangeLabel}`)}\\par`);
  lines.push('\\pard\\fs28\\par');
  // Duty Manager – ________________
  lines.push(`\\trowd\\trgaph108\\trleft0${cellBorders}\\cellx9016`);
  lines.push(`\\pard\\intbl\\qc\\b\\fs28 ${rtfEscape('Duty Manager – ________________')}\\cell`);
  lines.push('\\row');
  // Saturday | Sunday
  lines.push(`\\trowd\\trgaph108\\trleft0${cellBorders}\\cellx4508${cellBorders}\\cellx9016`);
  lines.push(`\\pard\\intbl\\qc\\b\\fs28 ${rtfEscape(weekdayLong(day1))}\\cell`);
  lines.push(`\\pard\\intbl\\qc\\b\\fs28 ${rtfEscape(weekdayLong(day2))}\\cell`);
  lines.push('\\row');
  // Start and end hours for each day — blank: the board does not know
  // the duty manager's hours, so the crew writes them in.
  lines.push(`\\trowd\\trgaph108\\trleft0${cellBorders}\\cellx2254${cellBorders}\\cellx4508${cellBorders}\\cellx6762${cellBorders}\\cellx9016`);
  for (let i = 0; i < 4; i++) lines.push('\\pard\\intbl\\qc\\b\\fs30\\cell');
  lines.push('\\row');
  // Out of hours (Crown On Call): 0427 421 821
  lines.push(`\\trowd\\trgaph108\\trleft0${cellBorders}\\cellx9016`);
  lines.push(`\\pard\\intbl\\qc\\b\\fs28 ${rtfEscape('Out of hours (Crown On Call): ')}\\b0\\fs28 0427 421 821\\cell`);
  lines.push('\\row');
  lines.push('\\pard\\fs28\\par');
  if (!items.length) {
    lines.push(`\\pard\\fs28 ${rtfEscape('No setups in this window.')}\\par`);
  }
  for (const [dayIndex, day] of days.entries()) {
    if (dayIndex > 0) lines.push('\\pard\\fs28\\par');
    lines.push(`\\pard\\b\\fs28 ${rtfEscape(weekdayLong(new Date(`${day.date}T12:00:00`)))}\\par`);
    for (const item of day.items) {
      const heading = item.title ? `${item.title}${item.isPackDown ? ' PD' : ''}/${item.roomName}` : `${item.functionLabel}/${item.roomName}`;
      lines.push(`\\pard\\b\\fs36 ${rtfEscape(heading)}\\par`);
      lines.push(`\\pard\\fs28 ${rtfEscape(item.timeLine)}\\par`);
      for (let i = 0; i < 3; i++) lines.push('\\pard\\fs28 - \\par');
    }
  }
  lines.push('}');
  return { rtf: lines.join('\n'), filename: window.filename, window, days: days.length, items: items.length };
}
