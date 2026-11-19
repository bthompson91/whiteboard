import { useEffect, useState } from 'react';
import BookingGrid from './components/BookingGrid';
import MarkupLayer from './components/MarkupLayer';
import Toolbar from './components/Toolbar';
import { Booking, MarkupItem, VenueConfig } from './types';
import { ParsedVenueConfig } from './lib/venueConfig';

const MARKUP_KEY = 'whiteboard-markup';

export default function App() {
  const [venue, setVenue] = useState<ParsedVenueConfig | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [markup, setMarkup] = useState<MarkupItem[]>([]);
  const [editingEnabled, setEditingEnabled] = useState(false);
  const [markupMode, setMarkupMode] = useState<'none' | 'text' | 'arrow'>('none');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(MARKUP_KEY);
    if (saved) {
      try {
        setMarkup(JSON.parse(saved) as MarkupItem[]);
      } catch {
        setMarkup([]);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(MARKUP_KEY, JSON.stringify(markup));
  }, [markup]);

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
        onVenueLoaded={(loadedVenue) => {
          setVenue(loadedVenue);
          setError(null);
        }}
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
