import { Booking, ContributorSubmission, SharedBoardFile } from '../types';

const SHARED_FILE_FORMAT = 'whiteboard-shared-board';

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

export function createSharedFile(bookings: Booking[], submissions: ContributorSubmission[]): SharedBoardFile {
  return {
    format: SHARED_FILE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    bookings,
    submissions
  };
}

export function parseSharedFile(text: string): SharedBoardFile {
  const parsed = JSON.parse(text) as SharedBoardFile;
  if (parsed?.format !== SHARED_FILE_FORMAT || parsed.version !== 1) {
    throw new Error('This file is not a compatible Whiteboard shared-board file.');
  }
  if (!Array.isArray(parsed.bookings) || !Array.isArray(parsed.submissions)) {
    throw new Error('The shared-board file is missing bookings or contributor submissions.');
  }
  return parsed;
}

export function downloadSharedFile(file: SharedBoardFile) {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `whiteboard-shared-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
