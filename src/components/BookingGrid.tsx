import { Booking } from '../types';
import { ParsedVenueConfig } from '../lib/venueConfig';

interface BookingGridProps {
  venue: ParsedVenueConfig | null;
  bookings: Booking[];
  editingEnabled: boolean;
  onBookingsChange: (bookings: Booking[]) => void;
}

export default function BookingGrid({
  venue,
  bookings,
  editingEnabled,
  onBookingsChange
}: BookingGridProps) {
  if (!venue) {
    return <div className="empty-state">Load a venue YAML file to begin.</div>;
  }

  const dates = Array.from(new Set(bookings.map((booking) => booking.date))).sort();

  return (
    <div className="booking-grid">
      <div className="grid-header">
        <div className="corner">Date</div>
        {venue.rooms.map((room) => (
          <div key={room.id} className="room-header">
            {room.name}
          </div>
        ))}
      </div>

      {dates.length === 0 && (
        <div className="empty-state">Load a booking XLS file to display bookings.</div>
      )}

      {dates.map((date) => (
        <div key={date} className="grid-row">
          <div className="date-cell">{date}</div>
          {venue.rooms.map((room) => {
            const roomBookings = bookings.filter(
              (booking) => booking.date === date && booking.roomId === room.id
            );

            return (
              <div key={room.id} className="room-cell">
                {roomBookings.map((booking) => (
                  <div
                    key={booking.id}
                    className={`booking-block ${editingEnabled ? 'editable' : 'locked'}`}
                    contentEditable={editingEnabled}
                    suppressContentEditableWarning
                    onBlur={(event) => {
                      const title = event.currentTarget.textContent ?? '';
                      onBookingsChange(
                        bookings.map((item) =>
                          item.id === booking.id ? { ...item, title } : item
                        )
                      );
                    }}
                  >
                    <strong>{booking.title}</strong>
                    {booking.notes && <div>{booking.notes}</div>}
                    <div>
                      {booking.startTime}–{booking.endTime}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
