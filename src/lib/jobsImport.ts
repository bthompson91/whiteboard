// Jobs import: a one-off import (not a linked file) of the sales
// system's jobs export with columns Order Id, Description, Sales
// Person, Start Date and End Date. The list is kept in the shared
// board file, and the inspector shows the jobs that could match the
// booking being edited — the editor picks one, nothing is
// auto-assigned. A job is a candidate when its event name overlaps
// the booking title and its dates cover the booking (a day either
// side, because the two systems can disagree by a day). The
// salesperson is a second signal: it breaks ties between jobs with
// the same name score, which is how a multi-room event's one job per
// room gets told apart.
import * as XLSX from 'xlsx';
import { Booking, JobEntry } from '../types';
import type { Salesperson } from './configuration';
import { readWorkbook, sheetRecords } from './bookingImport';
import { dateValue } from './dateTime';
import { normalizeIdentity } from './bookingIdentity';

export interface JobsSkipped {
  row: number; // 1-based sheet row
  reason: string;
}

export interface JobsParsed {
  jobs: JobEntry[];
  skipped: JobsSkipped[];
}

// Header names, matched case-insensitively after normalising. The
// Sales Person column is optional; the other four are required.
const COLUMN_ALIASES: Record<string, string[]> = {
  orderId: ['order id', 'order', 'order no', 'id'],
  description: ['description', 'desc'],
  salesPerson: ['sales person', 'salesperson', 'sales rep', 'sales'],
  company: ['company', 'client', 'customer'],
  startDate: ['start date', 'start'],
  endDate: ['end date', 'end']
};

export function findJobsColumns(headers: string[]): { orderId: string; description: string; salesPerson: string | null; company: string | null; startDate: string; endDate: string } {
  const norm = headers.map(h => ({ raw: h, key: normalizeIdentity(h) }));
  const find = (field: string) => {
    const hit = norm.find(h => COLUMN_ALIASES[field].includes(h.key));
    return hit ? hit.raw : null;
  };
  const orderId = find('orderId');
  const description = find('description');
  const salesPerson = find('salesPerson');
  const company = find('company');
  const startDate = find('startDate');
  const endDate = find('endDate');
  const missing = [['Order Id', orderId], ['Description', description], ['Start Date', startDate], ['End Date', endDate]].filter(([, v]) => !v).map(([n]) => n);
  if (missing.length) throw new Error(`Jobs file is missing columns: ${missing.join(', ')}. Expected Order Id, Description, Sales Person, Start Date, End Date.`);
  return { orderId: orderId!, description: description!, salesPerson, company, startDate: startDate!, endDate: endDate! };
}

// The event name is the text after the last bar ("Sample | Test Staff
// Christmas Lunch 2026" -> "Test Staff Christmas Lunch 2026"), with a
// leading dash stripped. The area is
// everything before it — it is what tells one job for a multi-room
// event from another ("Prom 1 & 2" vs "M1&2" vs "Prom 3").
export function jobEvent(description: string): string {
  const s = String(description || '').trim().replace(/^[-–—\s]+/, '');
  const bar = s.lastIndexOf('|');
  const event = (bar >= 0 ? s.slice(bar + 1) : s).trim().replace(/^[-–—\s]+/, '');
  return event;
}
export function jobArea(description: string): string {
  const s = String(description || '').trim().replace(/^[-–—\s]+/, '');
  const bar = s.lastIndexOf('|');
  return (bar >= 0 ? s.slice(0, bar) : '').trim();
}

export async function parseJobsWorkbook(file: File): Promise<JobsParsed> {
  const { workbook } = await readWorkbook(file);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('Jobs file has no sheets.');
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true }) as unknown[][];
  const headers = (aoa[0] || []).map(v => String(v ?? '').trim()).filter(Boolean);
  const columns = findJobsColumns(headers);
  const records = sheetRecords(workbook, 1);
  const jobs: JobEntry[] = [];
  const skipped: JobsSkipped[] = [];
  records.forEach((record, i) => {
    const sheetRow = i + 2; // row 1 is the header
    const get = (col: string | null) => (col === null ? '' : String(record[col] ?? '').trim());
    const orderId = get(columns.orderId);
    const description = get(columns.description);
    if (!orderId && !description && !get(columns.startDate) && !get(columns.endDate)) return; // blank row
    try {
      if (!orderId) throw new Error('no Order Id');
      if (!description) throw new Error('no Description');
      const startDate = dateValue(record[columns.startDate], false);
      if (!startDate) throw new Error('no Start Date');
      const endDate = dateValue(record[columns.endDate], false);
      if (!endDate) throw new Error('no End Date');
      jobs.push({
        orderId,
        description,
        area: jobArea(description),
        event: jobEvent(description),
        salesPerson: get(columns.salesPerson),
        company: get(columns.company),
        startDate,
        endDate
      });
    } catch (e) {
      skipped.push({ row: sheetRow, reason: e instanceof Error ? e.message : String(e) });
    }
  });
  return { jobs, skipped };
}

// The name score: how much of the shorter name's meaningful words the
// longer one shares. Generic words (dinner, lunch, christmas, 2026)
// carry no signal, so they are dropped before comparing — otherwise
// "Beta Health Dinner" and "Sample Storage - North/Beta" look
// like a match on "Beta" alone. A score of 1 means every meaningful
// word of one name is in the other; 0.5 is the weakest score the
// inspector will show.
const STOP_WORDS = new Set(['the', 'and', 'of', 'for', 'a', 'an', 'in', 'on', 'to', 'with', '2026', '2027', 'dinner', 'lunch', 'breakfast', 'conference', 'event', 'events', 'function', 'party', 'celebration', 'ceremony', 'reception', 'meeting', 'awards', 'award', 'night', 'day', 'christmas', 'xmas', 'annual', 'end', 'year', 'new', 'member', 'members']);
function nameTokens(s: string): Set<string> {
  const words = String(s || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(w => w && !STOP_WORDS.has(w) && w.length > 1);
  return new Set(words);
}
export function jobNameScore(jobEventName: string, title: string): number {
  const A = nameTokens(jobEventName);
  const B = nameTokens(title);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}

// Two salesperson names are the same person when the full names agree
// after normalising, or when the last names agree and the first names
// agree (or one side is only a first initial that matches the other's
// first letter, or only a last name). "Cora Carter" matches "Cora
// Carter" and "C. Carter"; "M Cole" does not match "Cecilia
// Cole", because the initial contradicts the first name.
export function salesPersonMatches(a: string, b: string): boolean {
  const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const A = norm(a);
  const B = norm(b);
  if (!A.length || !B.length) return false;
  if (A.join(' ') === B.join(' ')) return true;
  const lastA = A[A.length - 1];
  const lastB = B[B.length - 1];
  if (lastA !== lastB) return false;
  if (A.length === 1 || B.length === 1) return true; // last name only
  const firstA = A[0];
  const firstB = B[0];
  if (firstA === firstB) return true;
  if (firstA.length === 1 && firstB.startsWith(firstA)) return true;
  if (firstB.length === 1 && firstA.startsWith(firstB)) return true;
  return false;
}

// A day as an ISO date, shifted by n days. The two systems can
// disagree by a day (a dinner dated the 28th in the sales system and
// the 29th on the board), so a candidate is allowed a day either side
// of its range — and the inspector shows when it is a day out, so the
// editor can see it and decide.
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The board salesperson a job belongs to, by name — or undefined when
// the job has no salesperson or the palette does not have them. The
// same name matching as the candidate ✓, so a ticked candidate always
// resolves, and a job whose salesperson is not in the palette resolves
// to nothing instead of inventing one.
export function jobSalesperson(job: JobEntry, salespeople: Salesperson[]): Salesperson | undefined {
  if (!job.salesPerson) return undefined;
  return salespeople.find(p => salesPersonMatches(p.name, job.salesPerson));
}

export interface JobCandidate {
  job: JobEntry;
  score: number; // name score, plus 0.1 when the salesperson matches
  nameScore: number;
  salesPersonMatch: boolean;
  // 0 when the booking date is inside the job's range, -1 when it is
  // the day before, +1 when it is the day after.
  dateOffset: number;
}

// The jobs that could be this booking's, best first. A candidate must
// clear the name bar (score >= 0.5) and fall within a day of the job's
// dates; the salesperson then lifts it by 0.1 and breaks ties, so a
// multi-room event's several jobs sort with the booking's salesperson
// on top. Nothing here assigns a number — the inspector shows the
// list and the editor picks.
export function findJobCandidates(jobs: JobEntry[], booking: Booking, salespersonName?: string): JobCandidate[] {
  const results: JobCandidate[] = [];
  for (const job of jobs) {
    const nameScore = jobNameScore(job.event, booking.title);
    if (nameScore < 0.5) continue;
    const lo = addDaysIso(job.startDate, -1);
    const hi = addDaysIso(job.endDate, 1);
    if (booking.date < lo || booking.date > hi) continue;
    const dateOffset = booking.date < job.startDate ? -1 : booking.date > job.endDate ? 1 : 0;
    const salesPersonMatch = salespersonName ? salesPersonMatches(salespersonName, job.salesPerson) : false;
    const score = Math.min(1, nameScore + (salesPersonMatch ? 0.1 : 0));
    results.push({ job, score, nameScore, salesPersonMatch, dateOffset });
  }
  results.sort((a, b) => b.score - a.score || (a.salesPersonMatch === b.salesPersonMatch ? 0 : a.salesPersonMatch ? -1 : 1) || a.job.orderId.localeCompare(b.job.orderId));
  return results;
}
