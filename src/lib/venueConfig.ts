import yaml from 'js-yaml';
import { VenueConfig, VenueRoom } from '../types';

interface RawVenue {
  site?: { name?: string };
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
  };
}

export interface ParsedVenueConfig extends VenueConfig {
  fields: Record<string, string>;
  display: {
    primaryLabel: string;
    secondaryLabel: string;
    suppressSecondaryWhenEqual: boolean;
    allowedStatuses: string[];
  };
  excludedRooms: string[];
  aliases: Record<string, string[]>;
  mappings: Record<string, string[]>;
}

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
    display: {
      primaryLabel: data.display?.primary_label ?? 'booking_name',
      secondaryLabel: data.display?.secondary_label ?? 'activity_name',
      suppressSecondaryWhenEqual: data.display?.suppress_secondary_when_equal ?? true,
      allowedStatuses: data.display?.allowed_statuses ?? []
    },
    excludedRooms: data.rooms.exclude ?? [],
    aliases: data.rooms.room_aliases ?? {},
    mappings: data.rooms.room_mappings ?? {}
  };
}

export function resolveRooms(
  roomName: string,
  venue: ParsedVenueConfig
): string[] {
  const normalized = roomName.trim();

  if (venue.excludedRooms.includes(normalized)) {
    return [];
  }

  if (venue.mappings[normalized]) {
    return venue.mappings[normalized].map((room) => room.trim());
  }

  for (const [target, aliases] of Object.entries(venue.aliases)) {
    if (aliases.includes(normalized)) {
      return [target];
    }
  }

  if (venue.rooms.some((room) => room.name === normalized)) {
    return [normalized];
  }

  return [];
}
