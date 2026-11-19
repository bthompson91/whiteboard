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
}

export interface BookingSnapshot {
  importedAt: string;
  bookings: Booking[];
}

export interface ContributorSubmission {
  id: string;
  bookingId: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  base: Booking;
  proposed: Booking;
}

export interface SharedBoardFile {
  format: 'whiteboard-shared-board';
  version: 1;
  exportedAt: string;
  bookings: Booking[];
  submissions: ContributorSubmission[];
}

export type MarkupItem =
  | {
      id: string;
      type: 'text';
      x: number;
      y: number;
      text: string;
    }
  | {
      id: string;
      type: 'arrow';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    };
