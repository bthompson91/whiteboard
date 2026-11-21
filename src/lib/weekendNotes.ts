// Weekend / overnight notes export: the template the overnight crew works
// from. A button on the top bar spits out an RTF file listing every setup
// (and pack-down) happening in the current overnight window, grouped by
// room and then chronologically, with the setup time on each event and an
// empty bullet list under it to write in. Nothing here is invented: every
// item comes from a booking's timeline or a TimeTarget note on the board.
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
  bookingId?: string;
}

export interface WeekendNotesResult {
  rtf: string;
  filename: string;
  window: OvernightWindow;
  rooms: number;
  items: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const atTime = (d: Date, hh: number, mm: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0);
const fmtLong = (d: Date) => new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'short' }).format(d);
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
      rangeLabel: `${fmtLong(friday)} – ${fmtLong(sunday)}`,
      filename: `Weekend Notes ${fmtShort(friday)} - ${fmtShort(sunday)}.rtf`,
    };
  }
  const tomorrow = addDays(now, 1);
  return {
    kind: 'weeknight',
    start: atTime(now, 17, 0),
    end: atTime(tomorrow, 7, 0),
    title: 'Overnight Notes',
    rangeLabel: `${fmtLong(now)} – ${fmtLong(tomorrow)}`,
    filename: `Overnight Notes ${fmtShort(now)} - ${fmtShort(tomorrow)}.rtf`,
  };
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
    notes.push({ id: m.id, date: m.date, roomId: m.roomId, time, startMs: toMs(m.date, minutes), text: m.text, bookingId: m.bookingId });
  }
  return notes;
}

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
        items.push({ roomId, roomName: roomName(roomId), date: b.date, startMs, title: b.title, timeLine: note ? note.text : `${entry.label} ${entry.start}`, bookingId: b.id });
      }
    }
  }

  // A purple note with no timeline entry to belong to is a setup on its
  // own: the TimeTarget file is the only record of it.
  for (const note of notes) {
    if (usedNotes.has(note.id)) continue;
    if (note.startMs < window.start.getTime() || note.startMs > window.end.getTime()) continue;
    const booking = note.bookingId ? byBooking.get(note.bookingId) : undefined;
    items.push({ roomId: note.roomId, roomName: roomName(note.roomId), date: note.date, startMs: note.startMs, title: booking?.title ?? '', timeLine: note.text, bookingId: note.bookingId });
  }

  const orderOf = (roomId: string) => (roomOrder.has(roomId) ? roomOrder.get(roomId)! : Number.MAX_SAFE_INTEGER);
  items.sort((a, b) => orderOf(a.roomId) - orderOf(b.roomId) || a.date.localeCompare(b.date) || a.startMs - b.startMs || a.title.localeCompare(b.title));
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

// The RTF itself: title and date range, then a section per room (in
// board order), each event with its date and setup time and three empty
// bullets to write in. An empty window still produces a file, so the
// crew can see there is nothing overnight instead of wondering whether
// the export failed.
export function buildWeekendNotesRtf(bookings: Booking[], markup: MarkupItem[], venue: ParsedVenueConfig, now = new Date()): WeekendNotesResult {
  const window = overnightWindow(now);
  const items = collectOvernightItems(bookings, markup, venue, window);
  const rooms: { id: string; name: string; items: OvernightItem[] }[] = [];
  for (const item of items) {
    const last = rooms[rooms.length - 1];
    if (last && last.id === item.roomId) last.items.push(item);
    else rooms.push({ id: item.roomId, name: item.roomName, items: [item] });
  }
  const lines: string[] = [];
  lines.push('{\\rtf1\\ansi\\ansicpg1252\\deff0');
  lines.push('{\\fonttbl{\\f0 Arial;}}');
  lines.push('\\viewkind4\\uc1');
  lines.push(`\\pard\\qc\\b\\fs32 ${rtfEscape(window.title)}\\par`);
  lines.push(`\\pard\\qc\\fs24 ${rtfEscape(window.rangeLabel)}\\par`);
  lines.push('\\pard\\fs22\\par');
  if (!items.length) {
    lines.push(`\\pard\\fs22 ${rtfEscape('No setups in this window.')}\\par`);
  }
  for (const room of rooms) {
    lines.push(`\\pard\\b\\fs28 ${rtfEscape(room.name)}\\par`);
    for (const item of room.items) {
      const dateLabel = fmtShort(new Date(`${item.date}T12:00:00`));
      lines.push(`\\pard\\b\\fs24 ${rtfEscape(item.title || item.timeLine)}\\par`);
      if (item.title) lines.push(`\\pard\\fs22 ${rtfEscape(`${dateLabel} · ${item.timeLine}`)}\\par`);
      else lines.push(`\\pard\\fs22 ${rtfEscape(dateLabel)}\\par`);
      for (let i = 0; i < 3; i++) lines.push(`\\pard\\li360\\fi-360\\fs22 \\'95 \\par`);
    }
    lines.push('\\pard\\fs22\\par');
  }
  lines.push('}');
  return { rtf: lines.join('\n'), filename: window.filename, window, rooms: rooms.length, items: items.length };
}
