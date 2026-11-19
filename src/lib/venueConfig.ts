import yaml from 'js-yaml';
import { VenueConfig } from '../types';

export function parseVenueConfig(yamlText: string): VenueConfig {
  const data = yaml.load(yamlText) as Record<string, unknown>;
  const rawRooms = (data.rooms ?? []) as Array<Record<string, unknown>>;

  return {
    name: String(data.name ?? data.venue ?? 'Venue'),
    rooms: rawRooms.map((room, index) => ({
      id: String(room.id ?? room.name ?? index),
      name: String(room.name ?? room.id ?? `Room ${index + 1}`),
      order: Number(room.order ?? index)
    })).sort((a, b) => a.order - b.order)
  };
}
