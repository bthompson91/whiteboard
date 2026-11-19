import { ChangeEvent } from 'react';
import { Booking, MarkupItem } from '../types';
import { ParsedVenueConfig } from '../lib/venueConfig';

interface ToolbarProps {
  venue: ParsedVenueConfig | null;
  bookingCount: number;
  editingEnabled: boolean;
  markupMode: 'none' | 'text' | 'arrow';
  error: string | null;
  onToggleEditing: () => void;
  onSetMarkupMode: (mode: 'none' | 'text' | 'arrow') => void;
  onVenueLoaded: (yamlText: string) => void;
  onBookingsLoaded: (bookings: Booking[]) => void;
  onError: (message: string) => void;
  onMarkupChange: (markup: MarkupItem[]) => void;
}

export default function Toolbar({
  venue,
  bookingCount,
  editingEnabled,
  markupMode,
  error,
  onToggleEditing,
  onSetMarkupMode,
  onVenueLoaded,
  onBookingsLoaded,
  onError
}: ToolbarProps) {
  const handleVenueFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const yamlText = await file.text();
      onVenueLoaded(yamlText);
    } catch (exception) {
      onError(exception instanceof Error ? exception.message : String(exception));
    }
  };

  const handleBookingFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !venue) return;

    try {
      const { parseBookingWorkbook } = await import('../lib/bookingImport');
      onBookingsLoaded(await parseBookingWorkbook(file, venue));
    } catch (exception) {
      onError(exception instanceof Error ? exception.message : String(exception));
    }
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

      {error && <div className="error">{error}</div>}
    </header>
  );
}
