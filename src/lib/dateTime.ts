// Date and time parsing for venue export files. Kept dependency-free so
// it can be tested in plain node without pulling in the xlsx library.
const text = (v: unknown) => v == null ? '' : String(v).trim();

// Excel serial dates count days from 1899-12-30 (the 1900 system; the
// epoch absorbs Excel's imaginary 1900-02-29), or from 1904-01-01.
const excelSerialToDate = (serial: number, date1904: boolean): Date => {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.floor(serial) * 86400000);
};

// Past, today or future, for the date bar: past days are grey, today is
// yellow with red text, future days are green, like the Encore sheet.
// Dates are yyyy-MM-dd, so a plain string comparison is the date order.
export function dayKind(date: string, today: string): 'past' | 'today' | 'future' {
  return date < today ? 'past' : date > today ? 'future' : 'today';
}

// Weeks (Monday-Sunday) for the collapsible week rows. Dates are
// yyyy-MM-dd, so the weekday is computed from the UTC date.
function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
// The Monday of the week containing the date (weeks start Monday).
export function weekMonday(date: string): string {
  const d = parseDate(date);
  // getUTCDay: 0 = Sunday, 1 = Monday, ... 6 = Saturday.
  const offset = (d.getUTCDay() + 6) % 7; // days since Monday
  return formatDate(new Date(d.getTime() - offset * 86400000));
}
// Group sorted dates into Monday-Sunday weeks, in order.
export function groupWeeks(dates: string[]): { monday: string; dates: string[] }[] {
  const weeks: { monday: string; dates: string[] }[] = [];
  for (const d of dates) {
    const m = weekMonday(d);
    const last = weeks[weeks.length - 1];
    if (last && last.monday === m) last.dates.push(d);
    else weeks.push({ monday: m, dates: [d] });
  }
  return weeks;
}
// Whether a week starts collapsed: a week whose Monday is before the
// Monday of last week (the week containing today - 7 days) starts
// collapsed. So with today in the current week, last week and the
// current week start expanded, and everything before that collapses.
export function defaultCollapsedWeek(monday: string, today: string): boolean {
  const lastWeekMonday = weekMonday(formatDate(new Date(parseDate(today).getTime() - 7 * 86400000)));
  return monday < lastWeekMonday;
}

export function dateValue(v: unknown, date1904: boolean, format = 'DD/MM/YYYY'): string {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(text(v))) {
    const d = excelSerialToDate(Number(v), date1904);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  const s = text(v);
  // Reject impossible dates instead of passing an Invalid Date downstream,
  // where it crashes the grid with no error boundary.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error(`Unrecognised booking date: ${s}`);
    return s.slice(0,10);
  }
  const m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(s);
  if (m) {
    // The venue YAML declares the date order; day-first is the default.
    // Reading a month-first file as day-first silently turned 11/19/2026
    // into month 19, so the order is explicit, never guessed.
    const day = Number(format === 'MM/DD/YYYY' ? m[2] : m[1]);
    const month = Number(format === 'MM/DD/YYYY' ? m[1] : m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error(`Unrecognised booking date: ${s}`);
    return `${m[3]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  throw new Error(`Unrecognised booking date: ${s}`);
}

export function timeValue(v: unknown): string {
  if (v instanceof Date) return `${String(v.getHours()).padStart(2,'0')}:${String(v.getMinutes()).padStart(2,'0')}`;
  if (typeof v === 'number') {
    let n = Math.round((v % 1) * 1440);
    if (n >= 1440) n = 0;
    return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
  }
  const s = text(v);
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i.exec(s);
  if (!m) throw new Error(`Unrecognised booking time: ${s}`);
  let h = Number(m[1]);
  if (m[3]) h = h % 12 + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  if (h < 0 || h > 23 || Number(m[2]) > 59) throw new Error(`Unrecognised booking time: ${s}`);
  return `${String(h).padStart(2,'0')}:${m[2]}`;
}
