import { Booking, ContributorFile, ContributorSubmission, ImportHistoryEntry, SharedBoardFile } from '../types';

const SHARED_FILE_FORMAT = 'whiteboard-shared-board';
const CONTRIBUTOR_FILE_FORMAT = 'whiteboard-contributor-file';

export function createSubmission(booking: Booking, current: Booking, author: string): ContributorSubmission {
  const now = new Date().toISOString();
  return {
    id: `submission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bookingId: booking.id,
    author,
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
  history: ImportHistoryEntry[]
): SharedBoardFile {
  return {
    format: SHARED_FILE_FORMAT,
    version: 1,
    revision,
    exportedAt: new Date().toISOString(),
    bookings,
    submissions,
    processedSubmissionIds,
    history
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
    history: Array.isArray(parsed.history) ? parsed.history : []
  };
}

export function createContributorFile(
  contributor: string,
  revisionBase: number,
  submissions: ContributorSubmission[]
): ContributorFile {
  return {
    format: CONTRIBUTOR_FILE_FORMAT,
    version: 1,
    contributor,
    revisionBase,
    exportedAt: new Date().toISOString(),
    submissions
  };
}

export function parseContributorFile(text: string): ContributorFile {
  const parsed = JSON.parse(text) as ContributorFile;
  if (parsed?.format !== CONTRIBUTOR_FILE_FORMAT || parsed.version !== 1) {
    throw new Error('This file is not a compatible Whiteboard contributor file.');
  }
  if (!Array.isArray(parsed.submissions)) {
    throw new Error('The contributor file is missing submissions.');
  }
  return {
    ...parsed,
    revisionBase: typeof parsed.revisionBase === 'number' ? parsed.revisionBase : 1
  };
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

export function downloadContributorFile(file: ContributorFile) {
  const safeName = file.contributor.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'contributor';
  downloadJson(file, `whiteboard-contribution-${safeName}-rev${file.revisionBase}.json`);
}
