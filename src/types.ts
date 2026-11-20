export type BoardRole = 'viewer' | 'contributor' | 'master';

export interface VenueRoom {
  id: string;
  name: string;
  order: number;
}

export interface VenueConfig {
  name: string;
  rooms: VenueRoom[];
}

export interface Booking {
  id: string;
  date: string;
  roomId: string;
  roomIds: string[];
  startTime: string;
  endTime: string;
  title: string;
  jobNumber?: string;
  status?: string;
  notes?: string;
  colour?: string;
  salespersonId?: string;
  unavailable?: boolean;
  hidden?: boolean;
}

export interface BookingSnapshot {
  importedAt: string;
  bookings: Booking[];
}

export interface ImportSource {
  name: string;
  fingerprint: string;
  importedAt: string;
}

export interface ImportHistoryEntry extends ImportSource {
  id: string;
  bookings: Booking[];
}

export interface ContributorSubmission {
  id: string;
  bookingId: string;
  author: string;
  revisionBase?: number;
  createdAt: string;
  updatedAt: string;
  base: Booking;
  proposed: Booking;
}

export interface SharedBoardFile {
  format: 'whiteboard-shared-board';
  version: 1;
  revision: number;
  exportedAt: string;
  bookings: Booking[];
  submissions: ContributorSubmission[];
  processedSubmissionIds: string[];
  history: ImportHistoryEntry[];
}

export interface ContributorFile {
  format: 'whiteboard-contributor-file';
  version: 1;
  contributor: string;
  revisionBase: number;
  exportedAt: string;
  submissions: ContributorSubmission[];
}

export type MarkupItem =
  | {
      id: string;
      type: 'text';
      x: number;
      y: number;
      text: string;
      bookingId?: string;
    }
  | {
      id: string;
      type: 'arrow';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      bookingId?: string;
    };
