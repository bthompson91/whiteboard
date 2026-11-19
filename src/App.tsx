import { useEffect, useState } from 'react';
import BookingGrid from './components/BookingGrid';
import MarkupLayer from './components/MarkupLayer';
import Toolbar from './components/Toolbar';
import { Booking, MarkupItem, VenueConfig } from './types';
import { ParsedVenueConfig, parseVenueConfig } from './lib/venueConfig';

const MARKUP_KEY = 'whiteboard-markup';
const VENUE_YAML_KEY = 'whiteboard-venue-yaml';

function readStoredMarkup(): MarkupItem[] {
  try {
    const stored = localStorage.getItem(MARKUP_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as MarkupItem[]) : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [venue, setVenue] = useState<ParsedVenueConfig | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [markup, setMarkup] = useState<MarkupItem[]>(readStoredMarkup);
  const [editingEnabled, setEditingEnabled] = useState(false);
  const [markupMode, setMarkupMode] = useState<'none' | 'text' | 'arrow'>('none');
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const savedYaml = localStorage.getItem(VENUE_YAML_KEY);

    if (savedYaml) {
      try {
        const parsedVenue = parseVenueConfig(savedYaml);
        if (!cancelled) setVenue(parsedVenue);
      } catch (exception) {
        if (!cancelled) {
          setError(exception instanceof Error ? exception.message : String(exception));
        }
      }
    }

    if (!cancelled) setHydrated(true);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    try {
      localStorage.setItem(MARKUP_KEY, JSON.stringify(markup));
    } catch {
      // Storage may be unavailable or full; retain the in-memory markup.
    }
  }, [markup, hydrated]);

  const handleVenueLoaded = (yamlText: string) => {
    try {
      const parsedVenue = parseVenueConfig(yamlText);
      localStorage.setItem(VENUE_YAML_KEY, yamlText);
      setVenue(parsedVenue);
      setError(null);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : String(exception));
    }
  };

  return (
    <div className="app">
      <Toolbar
        venue={venue}
        bookingCount={bookings.length}
        editingEnabled={editingEnabled}
        markupMode={markupMode}
        error={error}
        onToggleEditing={() => setEditingEnabled((value) => !value)}
        onSetMarkupMode={setMarkupMode}
        onVenueLoaded={handleVenueLoaded}
        onBookingsLoaded={(loadedBookings) => {
          setBookings(loadedBookings);
          setError(null);
        }}
        onError={setError}
        onMarkupChange={setMarkup}
      />

      <main className="board-container">
        <BookingGrid
          venue={venue}
          bookings={bookings}
          editingEnabled={editingEnabled}
          onBookingsChange={setBookings}
        />
        <MarkupLayer markup={markup} mode={markupMode} onChange={setMarkup} />
      </main>
    </div>
  );
}
