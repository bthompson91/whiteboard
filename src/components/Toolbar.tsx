import { ChangeEvent } from 'react';
import { Booking, VenueConfig } from '../types';

interface ToolbarProps {
  venue: VenueConfig | null;
  bookingCount: number;
  editingEnabled: boolean;
  markupMode: 'none' | 'text' | 'arrow';
  onToggleEditing: () => void;
  onSetMarkupMode: (mode: 'none' | 'text' | 'arrow') => void;
  onVenueLoaded: (venue: VenueConfig) => void;
  onBookingsLoaded: (bookings: Booking[]) => void;
  onMarkupChange: (markup: unknown[]) => void;
}

export default function Toolbar({
  venue,
  bookingCount,
  editingEnabled,
  markupMode,
  onToggleEditing,
  onSetMarkupMode,
  onVenueLoaded,
  onBookingsLoaded,
  onMarkupChange
}: ToolbarProps) {
  const handleVenueFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const yaml = await file.text();
    const { parseVenueConfig } = await import('../lib/venueConfig');
    onVenueLoaded(parseVenueConfig(yaml));
  };

  const handleBookingFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !venue) return;
    const { parseBookingWorkbook } = await import('../lib/bookingImport');
    const bookings = await parseBookingWorkbook(file, venue);
    onBookingsLoaded(bookings);
  };

  return (
    <header className="toolbar">
      <strong>{venue?.name ?? 'Venue Booking Whiteboard'}</strong>

      <label>
        Venue YAML
        <input type="file" accept=".yaml,.yml" onChange={handleVenueFile} />
      </label>

      <label>
        Booking XLS
        <input type="file" accept=".xls,.xlsx" onChange={handleBookingFile} disabled={!venue} />
      </label>

      <span>{bookingCount} bookings</span>

      <button onClick={onToggleEditing}>
        {editingEnabled ? 'Lock bookings' : 'Unlock bookings'}
      </button>

      <button
        className={markupMode === 'text' ? 'active' : ''}
        onClick={() => onSetMarkupMode(markupMode === 'text' ? 'none' : 'text')}
      >
        Text note
      </button>

      <button
        className={markupMode === 'arrow' ? 'active' : ''}
        onClick={() => onSetMarkupMode(markupMode === 'arrow' ? 'none' : 'arrow')}
      >
        Arrow
      </button>
    </header>
  );
}
