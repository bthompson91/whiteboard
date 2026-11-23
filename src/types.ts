export type BoardRole = 'viewer' | 'editor';
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
  // A job number per room: a booking in several rooms can carry a
  // different number in each room (or NO AV in some). The booking's
  // own jobNumber is the number for every room without an entry.
  jobNumbers?: Record<string, string>;
  status?: string;
  notes?: string;
  colour?: string;
  salespersonId?: string;
  unavailable?: boolean;
  hidden?: boolean;
  // Rooms this booking is hidden in, when it is in several rooms at
  // once: hiding one block hides that room only, not the whole booking.
  // `hidden` still means hidden everywhere (older saves, and "hide in
  // all rooms" in the inspector).
  hiddenRooms?: string[];
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

export interface SharedBoardFile {
  format: 'whiteboard-shared-board';
  version: 1;
  revision: number;
  exportedAt: string;
  bookings: Booking[];
  markup: MarkupItem[];
  editorLock?: EditorLock | null;
  // The sales system's jobs list, imported with the 📋 Jobs button.
  // It lives in the board file so every editor sees the same list and
  // the inspector can offer possible matches without re-importing.
  // Re-importing replaces it; it is never written by a venue import.
  jobs?: JobEntry[];
  jobsImportedAt?: string;
}

// One row of the sales system's jobs export: the Order Id IS the job
// number, and the Description is "Area | Event" in the same format as
// the TimeTarget rows. The event is the text after the last bar; the
// area is what tells one job for a multi-room event from another.
export interface JobEntry {
  orderId: string;
  description: string;
  area: string;
  event: string;
  salesPerson: string;
  company: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
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
      // A note the TimeTarget import created: 'timetarget', with the key
      // (date|room|function|event) it is updated by on the next import.
      // A hand-typed note has neither, and the import never touches it.
      source?: 'timetarget';
      timetargetKey?: string;
      // The setup time the note marks, 24-hour HH:MM. The weekend notes
      // export reads it; the text above is the display form.
      time?: string;
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
