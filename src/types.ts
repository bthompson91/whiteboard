export type BoardRole = 'viewer' | 'contributor' | 'editor';
// The editor lock: only one editor at a time. It lives in the shared
// board file so every device that reads the board can see who holds
// it. `id` is the browser session that holds it, `name` is the
// editor's name, `at` is when it was last refreshed (epoch ms); a
// lock older than the TTL is stale and can be taken over, so a
// browser that closed without releasing does not lock everyone out.
export interface EditorLock { name: string; id: string; at: number }

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
  // Manual merge control: a booking merges with like bookings by time
  // (same title, same room, other times — a tall block) and by room
  // (same title, adjacent rooms, same time — a wide block) unless the
  // corresponding flag is false. Undefined means merge, as before.
  mergeTime?: boolean;
  mergeRoom?: boolean;
  // An explicit manual merge: bookings sharing a merge group render as
  // one block (across rooms), even when their titles, times or a strong
  // border would stop the automatic merge. Set by Merge left / Merge
  // right in the inspector; cleared by Unmerge.
  mergeGroup?: string;
  timeline?: { label: string; start: string; end: string }[];
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
  markup: MarkupItem[];
  editorLock?: EditorLock | null;
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
      highlight?: boolean;
      bookingId?: string;
      // Anchor: the day and room the note sits in, plus its position
      // within that day/room cell as a fraction (0-1). The note renders
      // from the anchor, so it stays on the same day and room when the
      // date range changes. x/y are the legacy absolute position, used
      // when there is no anchor yet.
      date?: string;
      roomId?: string;
      fx?: number;
      fy?: number;
    }
  | {
      id: string;
      type: 'arrow';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      bookingId?: string;
      // Anchors for each end: the day and room that end sits in, plus
      // its position within that day/room cell as a fraction (0-1).
      // Each end renders from its anchor, so the arrow stays on the
      // same days and rooms when the date range changes. x1/y1/x2/y2
      // are the legacy absolute positions, used when there is no anchor.
      date1?: string;
      roomId1?: string;
      fx1?: number;
      fy1?: number;
      date2?: string;
      roomId2?: string;
      fx2?: number;
      fy2?: number;
    };
