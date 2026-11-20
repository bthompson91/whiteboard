import { Booking, ContributorSubmission, ImportHistoryEntry, MarkupItem, SharedBoardFile } from '../types';

const SHARED_FILE_FORMAT = 'whiteboard-shared-board';

export function createSubmission(
  booking: Booking,
  current: Booking,
  author: string,
  revisionBase: number
): ContributorSubmission {
  const now = new Date().toISOString();
  return {
    id: `submission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bookingId: booking.id,
    author,
    revisionBase,
    createdAt: now,
    updatedAt: now,
    base: { ...current },
    proposed: { ...booking }
  };
}

export function hasConflict(submission: ContributorSubmission, current: Booking | undefined): boolean {
  if (!current) return true;
  return JSON.stringify(submission.base) !== JSON.stringify(current);
}

export function conflictingFields(submission: ContributorSubmission, current: Booking | undefined): string[] {
  if (!current) return ['booking'];
  const fields: Array<[string, (booking: Booking) => unknown]> = [
    ['title', booking => booking.title],
    ['date', booking => booking.date],
    ['job number', booking => booking.jobNumber || ''],
    ['start time', booking => booking.startTime],
    ['end time', booking => booking.endTime],
    ['rooms', booking => [...booking.roomIds].sort()],
    ['status', booking => booking.status || ''],
    ['salesperson', booking => booking.salespersonId || ''],
    ['colour', booking => booking.colour || ''],
    ['hidden', booking => booking.hidden ? 'hidden' : 'visible'],
    ['notes', booking => booking.notes || '']
  ];
  return fields
    .filter(([field, read]) => field && JSON.stringify(read(submission.base)) !== JSON.stringify(read(current)))
    .map(([field]) => field);
}

export function submissionChanges(submission: ContributorSubmission): string[] {
  const fields: Array<[string, (booking: Booking) => unknown]> = [
    ['title', booking => booking.title],
    ['date', booking => booking.date],
    ['job number', booking => booking.jobNumber || ''],
    ['start time', booking => booking.startTime],
    ['end time', booking => booking.endTime],
    ['rooms', booking => [...booking.roomIds].sort()],
    ['status', booking => booking.status || ''],
    ['salesperson', booking => booking.salespersonId || ''],
    ['colour', booking => booking.colour || ''],
    ['hidden', booking => booking.hidden ? 'hidden' : 'visible'],
    ['notes', booking => booking.notes || '']
  ];
  return fields
    .filter(([field, read]) => field && JSON.stringify(read(submission.base)) !== JSON.stringify(read(submission.proposed)))
    .map(([field]) => field);
}

export function createSharedFile(
  bookings: Booking[],
  submissions: ContributorSubmission[],
  revision: number,
  processedSubmissionIds: string[],
  history: ImportHistoryEntry[],
  markup: MarkupItem[]
): SharedBoardFile {
  return {
    format: SHARED_FILE_FORMAT,
    version: 1,
    revision,
    exportedAt: new Date().toISOString(),
    bookings,
    submissions,
    processedSubmissionIds,
    history,
    markup
  };
}

export function parseSharedFile(text: string): SharedBoardFile {
  const parsed = JSON.parse(text) as SharedBoardFile;
  if (parsed?.format !== SHARED_FILE_FORMAT || parsed.version !== 1) {
    throw new Error('This file is not a compatible Whiteboard published-board file.');
  }
  if (!Array.isArray(parsed.bookings) || !Array.isArray(parsed.submissions)) {
    throw new Error('The published-board file is missing bookings or contributor submissions.');
  }
  return {
    ...parsed,
    revision: typeof parsed.revision === 'number' ? parsed.revision : 1,
    processedSubmissionIds: Array.isArray(parsed.processedSubmissionIds) ? parsed.processedSubmissionIds : [],
    history: Array.isArray(parsed.history) ? parsed.history : [],
    markup: Array.isArray(parsed.markup) ? parsed.markup : []
  };
}

// changes.json — the ONE shared list of changes. Every contributor writes
// their changes to this single file (it sits in the same folder as the
// venue YAML and the events file), instead of each contributor having
// their own file. The master imports it and yes/no's each change. The
// list holds the pending submissions; a change the master has accepted
// or rejected is dropped from the list (its id is recorded as processed
// in the board file, so it never comes back).
const CHANGES_FILE_FORMAT = 'whiteboard-changes';
export interface ChangesFile { format: string; version: number; submissions: ContributorSubmission[] }
export function serializeChangesFile(submissions: ContributorSubmission[]): string {
  return JSON.stringify({ format: CHANGES_FILE_FORMAT, version: 1, submissions } as ChangesFile, null, 2);
}
export function parseChangesFile(text: string): ChangesFile {
  const parsed = JSON.parse(text) as ChangesFile;
  if (parsed?.format !== CHANGES_FILE_FORMAT || parsed.version !== 1) {
    throw new Error('This file is not a compatible Whiteboard changes file.');
  }
  if (!Array.isArray(parsed.submissions)) {
    throw new Error('The changes file is missing submissions.');
  }
  return { ...parsed, submissions: parsed.submissions };
}
export async function writeChangesFileToHandle(handle: LinkedFileHandle, submissions: ContributorSubmission[]): Promise<void> {
  await writeLinkedFile(handle, serializeChangesFile(submissions));
}
export async function readChangesFileFromHandle(handle: LinkedFileHandle): Promise<ChangesFile> {
  return parseChangesFile(await readLinkedFile(handle));
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadSharedFile(file: SharedBoardFile) {
  downloadJson(file, `whiteboard-published-rev${file.revision}-${new Date().toISOString().slice(0, 10)}.json`);
}

// The File System Access API (desktop Chrome/Edge) lets the app write
// back to the SAME file it opened, instead of downloading a new copy
// each time. A handle is kept in a ref in App.tsx; the three files the
// board links — the bookings export, the venue YAML and the board JSON —
// are written back through these helpers whenever they change, and the
// Save and refresh button writes then re-reads them.
export type LinkedFileHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
};
export function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function';
}
export async function pickLinkedFile(options: { types: { description: string; accept: Record<string, string[]> }[]; multiple?: boolean }): Promise<LinkedFileHandle | null> {
  const w = window as unknown as { showOpenFilePicker: (o: unknown) => Promise<LinkedFileHandle[]> };
  const [handle] = await w.showOpenFilePicker({ ...options, multiple: false });
  return handle || null;
}
export async function pickLinkedFileToSave(suggestedName: string, description: string): Promise<LinkedFileHandle | null> {
  const w = window as unknown as { showSaveFilePicker: (o: unknown) => Promise<LinkedFileHandle> };
  return await w.showSaveFilePicker({ suggestedName, types: [{ description, accept: { 'application/json': ['.json'] } }] });
}
export async function writeLinkedFile(handle: LinkedFileHandle, text: string, mime = 'application/json'): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(new Blob([text], { type: mime }));
  await writable.close();
}
export async function readLinkedFile(handle: LinkedFileHandle): Promise<string> {
  return await (await handle.getFile()).text();
}
export function serializeSharedFile(file: SharedBoardFile): string {
  return JSON.stringify(file, null, 2);
}
export async function writeSharedFileToHandle(handle: LinkedFileHandle, file: SharedBoardFile): Promise<void> {
  await writeLinkedFile(handle, serializeSharedFile(file));
}
export async function readSharedFileFromHandle(handle: LinkedFileHandle): Promise<SharedBoardFile> {
  return parseSharedFile(await readLinkedFile(handle));
}
