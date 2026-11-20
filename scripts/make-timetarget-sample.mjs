// Make the fake TimeTarget export the import is built against:
// test-data/timetarget-sample.xlsx, columns Date, Start Time, Function,
// Area, Event (row 1 is the header). Rows are real Crown bookings from
// Brendan's export, with setup times taken from the export's Setup rows
// where one exists (else two hours before the event starts). Run from
// the repo root: node scripts/make-timetarget-sample.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const yaml = require('js-yaml');

const CROWN_XLS = '/home/hatch/workspace/user/files/30_day_forecast-2026-11-20-11-52-18.xls';
const CROWN_YAML = '/home/hatch/workspace/user/files/crown_melb.yaml';
const OUT = path.join(process.cwd(), 'test-data', 'timetarget-sample.xlsx');

const crown = yaml.load(fs.readFileSync(CROWN_YAML, 'utf8'));
const rooms = new Set((crown.rooms?.order || []).map(r => String(r).trim()));
// The Crown export is an HTML table saved as .xls: read it as text and
// take the cell text, the same way the app's readWorkbook does, so the
// dates stay DD/MM/YYYY strings instead of SheetJS guessing them into
// Excel serials.
const html = fs.readFileSync(CROWN_XLS, 'utf8');
const strip = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).trim();
const tableRows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => strip(c[1])));
const headers = tableRows[0];
const col = name => headers.indexOf(name);
const rows = tableRows.slice(1).map(r => ({
  start: String(r[col('Start Time 24 Hour')] || '').trim(),
  end: String(r[col('End Time 24 Hour')] || '').trim(),
  activity: String(r[col('Booking Event: Name')] || '').trim(),
  room: String(r[col('Function Room')] || '').trim(),
  date: String(r[col('Start Date')] || '').trim(),
  title: String(r[col('Booking: Booking Post As')] || '').trim()
})).filter(r => r.title && r.date && r.room && rooms.has(r.room));

const main = rows.filter(r => r.activity !== 'Setup' && r.activity !== 'Teardown');
const setupFor = r => {
  const setup = rows.find(s => s.activity === 'Setup' && s.title === r.title && s.date === r.date && s.room === r.room);
  if (setup?.start) return setup.start;
  const [h, m] = r.start.split(':').map(Number);
  const t = (h * 60 + m - 120 + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const teardownFor = r => {
  const td = rows.find(s => s.activity === 'Teardown' && s.title === r.title && s.date === r.date && s.room === r.room);
  return td?.start || r.end;
};
// A room with two events on one day: both get a setup note, told apart
// by their event names.
const byDayRoom = new Map();
for (const r of main) {
  const key = `${r.date}|${r.room}`;
  byDayRoom.set(key, [...(byDayRoom.get(key) || []), r]);
}
const doubleKey = [...byDayRoom.entries()].find(([, list]) => list.length >= 2)?.[0];
const double = doubleKey ? byDayRoom.get(doubleKey).slice(0, 2) : [];
// Spread the sample across days: one booking per distinct date, so the
// fixture is not all on the first day of the export.
const picked = [];
const seenDates = new Set();
for (const r of main) {
  if (picked.length >= 7) break;
  if (double.some(d => d === r)) continue;
  if (seenDates.has(r.date)) continue;
  if (picked.some(p => p.date === r.date && p.room === r.room)) continue;
  seenDates.add(r.date);
  picked.push(r);
}
const out = [];
const add = (r, fn, start, event) => out.push({
  Date: r.date,
  'Start Time': start,
  Function: fn,
  Area: `Crown Melbourne - ${r.room}`,
  Event: event
});
// Six setups with their event names; the first one's event name is
// longer than the board title, so the import must match it loosely.
for (const [i, r] of picked.slice(0, 6).entries()) {
  const event = i === 0 ? `${r.title} Dinner`.replace(' Dinner Dinner', ' Dinner') : r.title;
  add(r, 'Set Up', setupFor(r), event);
}
// One setup with no event name at all: it still imports, keyed by date,
// room and function alone.
add(picked[6], 'Set Up', setupFor(picked[6]), '');
// The two-setups-one-room-day pair: two sessions of one event.
for (const r of double) add(r, 'Set Up', setupFor(r), r.title);
// One Pack Down for an event that also has a setup note.
add(picked[2], 'Pack Down', teardownFor(picked[2]), picked[2].title);
out.push({ Date: picked[3].date, 'Start Time': '07:00', Function: 'Set Up', Area: 'Crown Melbourne - Imaginary Room', Event: 'Ghost Event' });

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const outWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(outWb, XLSX.utils.json_to_sheet(out), 'TimeTarget');
XLSX.writeFile(outWb, OUT);
console.log(JSON.stringify({ file: OUT, rows: out.length, sample: out }, null, 2));
