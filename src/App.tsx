import { useState } from 'react';
import BookingGrid from './components/BookingGrid';
import MarkupLayer from './components/MarkupLayer';
import Toolbar from './components/Toolbar';
import { Booking, VenueConfig, MarkupItem } from './types';

export default function App() {
  const [venue, setVenue] = useState<VenueConfig | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [markup, setMarkup] = useState<MarkupItem[]>([]);
  const [editingEnabled, setEditingEnabled] = useState(false);
  const [markupMode, setMarkupMode] = useState<'none' | 'text' | 'arrow'>('none');

  return (
    <div className="app">
      <Toolbar
        venue={venue}
        bookingCount={bookings.length}
        editingEnabled={editingEnabled}
        markupMode={markupMode}
        onToggleEditing={() => setEditingEnabled((value) => !value)}
        onSetMarkupMode={setMarkupMode}
        onVenueLoaded={setVenue}
        onBookingsLoaded={setBookings}
        onMarkupChange={setMarkup}
      />

      <main className="board-container">
        <BookingGrid
          venue={venue}
          bookings={bookings}
          editingEnabled={editingEnabled}
          onBookingsChange={setBookings}
        />
        <MarkupLayer
          markup={markup}
          mode={markupMode}
          onChange={setMarkup}
        />
      </main>
    </div>
  );
}
