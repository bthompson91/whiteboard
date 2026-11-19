import * as XLSX from 'xlsx';
import { Booking, VenueConfig } from '../types';

export async function parseBookingWorkbook(
  file: File,
  venue: VenueConfig
): Promise<Booking[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: ''
  });

  return rows
    .map((row, index): Booking | null => {
      const date = String(row.Date ?? row.date ?? '').trim();
      const roomName = String(row.Room ?? row.room ?? row['Room Name'] ?? '').trim();
      const title = String(row.Event ?? row['Event Name'] ?? row.Title ?? '').trim();
      const startTime = String(row.Start ?? row['Start Time'] ?? '').trim();
      const endTime = String(row.Finish ?? row.End ?? row['End Time'] ?? '').trim();

      if (!date || !roomName || !title) return null;

      const room = venue.rooms.find(
        (candidate) =>
          candidate.name.toLowerCase() === roomName.toLowerCase() ||
          candidate.id.toLowerCase() === roomName.toLowerCase()
      );

      if (!room) return null;

      return {
        id: `imported-${index}-${crypto.randomUUID()}`,
        date,
        roomId: room.id,
        startTime,
        endTime,
        title
      };
    })
    .filter((booking): booking is Booking => booking !== null);
}
