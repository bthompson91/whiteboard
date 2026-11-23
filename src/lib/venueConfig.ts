import yaml from 'js-yaml';
import { VenueConfig, VenueRoom } from '../types';

interface RawVenue {
  site?: { name?: string; after_hours_contact?: string };
  file_input?: { date_format?: string; header_row?: number; room_separator?: string };
  fields?: Record<string, string>;
  display?: {
    primary_label?: string;
    secondary_label?: string;
    suppress_secondary_when_equal?: boolean;
    allowed_statuses?: string[];
  };
  rooms?: {
    order?: string[];
    exclude?: string[];
    room_aliases?: Record<string, string[]>;
    room_mappings?: Record<string, string[]>;
    timetarget_areas?: Record<string, string>;
    unassigned_room?: string;
  };
}

export interface ParsedVenueConfig extends VenueConfig {
  fields: Record<string, string>;
  dateFormat: string;
  // The row the header names sit on, 1-based (1 = the first row). Some
  // exports put a title row first, or group rows above the headers.
  headerRow: number;
  // How one cell can name several rooms, e.g. "Room A;  Room B" with a
  // ';' separator. Empty means one room per cell.
  roomSeparator: string;
  // The room events with no room at all go to, when the venue sets one.
  // Empty means they are skipped, as before.
  unassignedRoom: string;
  display: {
    primaryLabel: string;
    secondaryLabel: string;
    suppressSecondaryWhenEqual: boolean;
    allowedStatuses: string[];
  };
  excludedRooms: string[];
  aliases: Record<string, string[]>;
  mappings: Record<string, string[]>;
  // Board room → the name TimeTarget uses for that room (venue name on
  // the front). The TimeTarget import matches each row's area against
  // these values to find its board room.
  timetargetAreas: Record<string, string>;
  // The after-hours contact the overnight notes print in the footer.
  // Set in Configuration; the Crown on-call number is the default when
  // the venue has not set one.
  afterHoursContact: string;
}

const normalizeRoomName = (value: string) => value.trim().toLowerCase();

export function parseVenueConfig(yamlText: string): ParsedVenueConfig {
  const data = yaml.load(yamlText) as RawVenue;

  if (!data?.rooms?.order?.length) {
    throw new Error('Venue YAML does not contain rooms.order');
  }

  const rooms: VenueRoom[] = data.rooms.order.map((name, index) => ({
    id: name,
    name,
    order: index
  }));

  return {
    name: data.site?.name ?? 'Venue',
    rooms,
    fields: data.fields ?? {},
    dateFormat: data.file_input?.date_format ?? 'DD/MM/YYYY',
    headerRow: data.file_input?.header_row ?? 1,
    roomSeparator: data.file_input?.room_separator ?? '',
    unassignedRoom: data.rooms?.unassigned_room ?? '',
    display: {
      primaryLabel: data.display?.primary_label ?? 'booking_name',
      secondaryLabel: data.display?.secondary_label ?? 'activity_name',
      suppressSecondaryWhenEqual: data.display?.suppress_secondary_when_equal ?? true,
      allowedStatuses: data.display?.allowed_statuses ?? []
    },
    excludedRooms: data.rooms.exclude ?? [],
    aliases: data.rooms.room_aliases ?? {},
    mappings: data.rooms.room_mappings ?? {},
    timetargetAreas: data.rooms.timetarget_areas ?? {},
    afterHoursContact: data.site?.after_hours_contact?.trim() || '0400 123 456'
  };
}

export function resolveRooms(roomName: string, venue: ParsedVenueConfig): string[] {
  // An event with no room at all goes to the venue's unassigned room
  // when one is set, instead of being dropped from the board.
  if (!roomName.trim()) return venue.unassignedRoom ? [venue.unassignedRoom] : [];
  // One cell can name several rooms, separated the way the venue's
  // export separates them. Each part resolves on its own, so a
  // combined name still needs a mapping entry, and an excluded part
  // is dropped while the rest of the booking keeps its rooms.
  const parts = venue.roomSeparator
    ? roomName.split(venue.roomSeparator).map(p => p.trim()).filter(Boolean)
    : [roomName];
  const resolved: string[] = [];
  for (const part of parts) resolved.push(...resolveOneRoom(part, venue));
  return [...new Set(resolved)];
}

function resolveOneRoom(roomName: string, venue: ParsedVenueConfig): string[] {
  const normalized = normalizeRoomName(roomName);

  if (venue.excludedRooms.some((room) => normalizeRoomName(room) === normalized)) {
    return [];
  }

  const canonicalRoomId = (name: string) =>
    venue.rooms.find((room) => normalizeRoomName(room.id) === normalizeRoomName(name))?.id ??
    name.trim();

  const mappingEntry = Object.entries(venue.mappings).find(
    ([target]) => normalizeRoomName(target) === normalized
  );

  if (mappingEntry) {
    return mappingEntry[1].map(canonicalRoomId);
  }

  const aliasEntry = Object.entries(venue.aliases).find(
    ([target, aliases]) =>
      normalizeRoomName(target) === normalized ||
      aliases.some((alias) => normalizeRoomName(alias) === normalized)
  );

  if (aliasEntry) {
    return [canonicalRoomId(aliasEntry[0])];
  }

  const exactRoom = venue.rooms.find(
    (room) => normalizeRoomName(room.id) === normalized
  );

  return exactRoom ? [exactRoom.id] : [];
}
