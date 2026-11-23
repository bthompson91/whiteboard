// TimeTarget setup-time import: a one-off import (not a linked file) of
// a rostering export with columns Date, Start Time, Function, Area and
// (last) Event. Each row becomes a text notation on the grid at that
// time in that room, editable like any other note afterwards. The event
// name may not match the board title exactly, so it is matched loosely.
import * as XLSX from 'xlsx';
import { Booking, MarkupItem } from '../types';
import { ParsedVenueConfig, resolveRooms } from './venueConfig';
import { readWorkbook, sheetRecords } from './bookingImport';
import { dateValue, timeValue } from './dateTime';
import { normalizeIdentity } from './bookingIdentity';
import { timeFraction } from './blocks';

export interface TimetargetRow {
  date: string; // YYYY-MM-DD
  startMinutes: number;
  startTime: string; // HH:MM, 24-hour
  function: string;
  area: string;
  event: string;
  roomId: string;
  bookingId?: string;
}

export interface TimetargetSkipped {
  row: number; // 1-based sheet row
  reason: string;
}

export interface TimetargetParsed {
  rows: TimetargetRow[];
  skipped: TimetargetSkipped[];
}

// Header names, matched case-insensitively after normalising. The
// event column is optional; the other four are required.
const COLUMN_ALIASES: Record<string, string[]> = {
  date: ['date'],
  startTime: ['start time', 'start', 'time'],
  function: ['function'],
  area: ['area', 'room'],
  event: ['event', 'event name', 'title']
};

export function findTimetargetColumns(headers: string[]): { date: string; startTime: string; function: string; area: string; event: string | null } {
  const norm = headers.map(h => ({ raw: h, key: normalizeIdentity(h) }));
  const find = (field: string) => {
    const hit = norm.find(h => COLUMN_ALIASES[field].includes(h.key));
    return hit ? hit.raw : null;
  };
  const date = find('date');
  const startTime = find('startTime');
  const fn = find('function');
  const area = find('area');
  const event = find('event');
  const missing = [['Date', date], ['Start Time', startTime], ['Function', fn], ['Area', area]].filter(([, v]) => !v).map(([n]) => n);
  if (missing.length) throw new Error(`TimeTarget file is missing columns: ${missing.join(', ')}. Expected Date, Start Time, Function, Area, Event.`);
  return { date: date!, startTime: startTime!, function: fn!, area: area!, event };
}

// The short form the board shows for a function: a setup is "SU" and
// a pack-down is "PD". The purple notes and the overnight notes both
// use it, so the two read the same. Anything else is shown as written.
export function shortFunctionName(fn: string): string {
  if (/teardown|bump out|pack/i.test(fn)) return 'PD';
  if (/set\s?up|bump in/i.test(fn)) return 'SU';
  return fn;
}

// A TimeTarget area is the name TimeTarget uses for a room, with the
// venue name on the front. It matches a board room through
// timetarget_areas first, then a board room name itself, then an alias.
// A combined room's area is set in the Combined rooms section of
// Configuration, and it expands to the combination's rooms — a
// "Palladium" row lands on the merged block instead of being skipped.
export function resolveTimetargetRooms(area: string, venue: ParsedVenueConfig): string[] {
  const key = normalizeIdentity(area);
  if (!key) return [];
  for (const [name, areaName] of Object.entries(venue.timetargetAreas || {})) {
    if (normalizeIdentity(areaName) === key) return resolveRooms(name, venue);
  }
  const room = venue.rooms.find(r => normalizeIdentity(r.name) === key);
  if (room) return [room.id];
  for (const [roomId, aliases] of Object.entries(venue.aliases || {})) {
    if ((aliases || []).some(a => normalizeIdentity(a) === key)) return [roomId];
  }
  return [];
}

export function resolveTimetargetRoom(area: string, venue: ParsedVenueConfig): string | null {
  return resolveTimetargetRooms(area, venue)[0] ?? null;
}

// The event name in TimeTarget may not match the board title exactly
// ("Enchanted Ball Dinner" against "Enchanted Ball"), so the match is
// loose: one name contains the other once both are normalised. The
// date and room already pin the booking down, so this cannot reach
// across to another event.
//
// The event may also carry a job/area prefix ("999999 - Sample | Test
// Staff Christmas Lunch 2026") and may be cut short by
// the export's field length, so the prefix is stripped first and the
// match then allows either name to be a prefix of the other — a
// truncated event is still a prefix of the full title. Without the
// strip, the prefix and the missing tail both break the contains
// check, the row matches no booking, and the note is orphaned (no
// booking, no title in the overnight notes).
function eventCore(eventName: string): string {
  let e = normalizeIdentity(eventName);
  // "job - area | event name" — the event name is after the last bar.
  const bar = e.lastIndexOf('|');
  if (bar >= 0) e = e.slice(bar + 1).trim();
  else e = e.replace(/^\d+\s*[-–]\s*/, '').trim();
  return e;
}

export function eventMatchesEvent(eventName: string, title: string): boolean {
  const e = eventCore(eventName);
  const t = normalizeIdentity(title);
  if (!e || !t) return false;
  return e === t || e.includes(t) || t.includes(e);
}

// The key a TimeTarget note is updated by: date, room, function, event
// and the booking it belongs to, normalised. The event is part of it so
// two setups in one room on one day get two notes, and the booking is
// part of it so two sessions of one event in one room on one day —
// "Exhibitor Storage Room" and "Overnight Hold" for the same conference
// — get two notes as well.
export function timetargetNoteKey(date: string, roomId: string, fn: string, event: string, bookingId?: string): string {
  return [date, roomId, normalizeIdentity(fn), normalizeIdentity(event), bookingId || ''].join('|');
}

export function timetargetNoteText(row: Pick<TimetargetRow, 'function' | 'startTime'>): string {
  return `${shortFunctionName(row.function)} ${row.startTime}`;
}

export async function parseTimetargetWorkbook(file: File, venue: ParsedVenueConfig, bookings: Booking[]): Promise<TimetargetParsed> {
  const { workbook } = await readWorkbook(file);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('TimeTarget file has no sheets.');
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true }) as unknown[][];
  const headers = (aoa[0] || []).map(v => String(v ?? '').trim()).filter(Boolean);
  const columns = findTimetargetColumns(headers);
  const records = sheetRecords(workbook, 1);
  const rows: TimetargetRow[] = [];
  const skipped: TimetargetSkipped[] = [];
  // The bookings, grouped by date once: matching a row used to scan
  // all 1,540 bookings for every row, so a 20,000-row file spent two
  // seconds just on the lookup. A row only ever matches its own date.
  const byDate = new Map<string, Booking[]>();
  for (const b of bookings) {
    const list = byDate.get(b.date);
    if (list) list.push(b);
    else byDate.set(b.date, [b]);
  }
  records.forEach((record, i) => {
    const sheetRow = i + 2; // row 1 is the header
    const get = (col: string | null) => (col === null ? '' : String(record[col] ?? '').trim());
    const area = get(columns.area);
    const fn = get(columns.function);
    if (!area && !fn && !get(columns.date) && !get(columns.startTime)) return; // blank row
    try {
      const date = dateValue(record[columns.date], false, 'DD/MM/YYYY');
      if (!date) throw new Error('no date');
      const startTime = timeValue(record[columns.startTime]);
      if (!fn) throw new Error('no function');
      if (!area) throw new Error('no area');
      const roomIds = resolveTimetargetRooms(area, venue);
      if (!roomIds.length) {
        skipped.push({ row: sheetRow, reason: `no board room matches area "${area}"` });
        return;
      }
      const roomId = roomIds[0];
      const event = get(columns.event);
      const [hh, mm] = startTime.split(':').map(Number);
      const startMinutes = hh * 60 + mm;
      // The booking this setup belongs to: the same date and room, with
      // a title the event name loosely matches. When several sessions of
      // one event share the room and day, the closest start time wins —
      // a setup precedes its session, so the 13:00 setup belongs to the
      // 15:00 session, not the 22:00 one. A combined area matches any
      // booking in one of its rooms.
      const minutesOf = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
      };
      const matches = event
        ? (byDate.get(date) || []).filter(b => (b.roomIds?.some(r => roomIds.includes(r)) || roomIds.includes(b.roomId)) && eventMatchesEvent(event, b.title))
        : [];
      const bookingId = matches.length
        ? matches.reduce((best, b) => (Math.abs(minutesOf(b.startTime) - startMinutes) < Math.abs(minutesOf(best.startTime) - startMinutes) ? b : best)).id
        : undefined;
      rows.push({ date, startMinutes, startTime, function: fn, area, event, roomId, bookingId });
    } catch (e) {
      skipped.push({ row: sheetRow, reason: e instanceof Error ? e.message : String(e) });
    }
  });
  return { rows, skipped };
}

export interface TimetargetApplied {
  markup: MarkupItem[];
  added: number;
  updated: number;
}

// Add the parsed rows as text notations. A row updates the note for
// its setup instead of duplicating it: the exact key first (same date,
// room, function and event), then the only note for that date, room
// and function when the event name was tweaked between exports. A
// hand-typed note has no TimeTarget key and is never touched, and
// nothing here deletes a note — a setup that drops off the export
// keeps its note until someone deletes it.
export function applyTimetargetRows(markup: MarkupItem[], rows: TimetargetRow[]): TimetargetApplied {
  let added = 0;
  let updated = 0;
  const next = [...markup];
  // The existing TimeTarget notes, indexed once: the exact key, and the
  // date+room+function+booking setup key with how many notes share it.
  // Rescanning the whole board for every row made a big import
  // quadratic — 20,000 rows took 55 seconds of main-thread time and
  // hung the page. Now each row is a map lookup and an in-place update.
  const byKey = new Map<string, number>();
  const setupCount = new Map<string, number>();
  const setupIndex = new Map<string, number>();
  const setupKeyOf = (m: Extract<MarkupItem, { type: 'text' }>) => {
    const parts = (m.timetargetKey || '').split('|');
    return [parts[0], parts[1], parts[2], parts[4] || ''].join('|');
  };
  next.forEach((m, i) => {
    if (m.type !== 'text' || m.source !== 'timetarget' || !m.timetargetKey) return;
    byKey.set(m.timetargetKey, i);
    const sk = setupKeyOf(m);
    setupCount.set(sk, (setupCount.get(sk) || 0) + 1);
    if (!setupIndex.has(sk)) setupIndex.set(sk, i);
  });
  for (const row of rows) {
    const key = timetargetNoteKey(row.date, row.roomId, row.function, row.event, row.bookingId);
    const text = timetargetNoteText(row);
    const fy = timeFraction(row.startMinutes);
    let idx = byKey.get(key);
    if (idx === undefined) {
      // The event name was tweaked between exports: the only note for
      // this date, room, function AND booking is the same setup under a
      // new name. The booking is part of the test on purpose — two
      // sessions of one event in one room on one day share date, room,
      // function and event, and only their bookings tell them apart,
      // so a looser fallback would merge their notes into one.
      const sk = [row.date, row.roomId, normalizeIdentity(row.function), row.bookingId || ''].join('|');
      if ((setupCount.get(sk) || 0) === 1) idx = setupIndex.get(sk);
    }
    if (idx !== undefined) {
      const existing = next[idx] as Extract<MarkupItem, { type: 'text' }>;
      // A fallback update renames the note's key (the event name
      // changed), so the old key must stop pointing at it.
      if (existing.timetargetKey !== key) {
        if (existing.timetargetKey) byKey.delete(existing.timetargetKey);
        byKey.set(key, idx);
      }
      next[idx] = { ...existing, text, fy, time: row.startTime, bookingId: row.bookingId ?? existing.bookingId, timetargetKey: key };
      updated++;
    } else {
      const id = `timetarget-${key.replace(/[^a-z0-9]+/gi, '-')}`;
      const at = next.length;
      next.push({ id, type: 'text', x: 0, y: 0, text, time: row.startTime, bookingId: row.bookingId, date: row.date, roomId: row.roomId, fx: 0.5, fy, source: 'timetarget', timetargetKey: key });
      byKey.set(key, at);
      const sk = [row.date, row.roomId, normalizeIdentity(row.function), row.bookingId || ''].join('|');
      setupCount.set(sk, (setupCount.get(sk) || 0) + 1);
      if (!setupIndex.has(sk)) setupIndex.set(sk, at);
      added++;
    }
  }
  return { markup: next, added, updated };
}
