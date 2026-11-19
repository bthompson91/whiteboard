import { CSSProperties } from 'react';
import { Booking } from '../types';
import { ParsedVenueConfig } from '../lib/venueConfig';

interface BookingGridProps {
  venue: ParsedVenueConfig | null;
  bookings: Booking[];
  editingEnabled: boolean;
  onBookingsChange: (bookings: Booking[]) => void;
}

const DAY_HEIGHT = 720;

function timeToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return Math.min(24 * 60, Math.max(0, hours * 60 + minutes));
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
  const columnTemplate = `160px repeat(${venue.rooms.length}, minmax(220px, 1fr))`;
  const gridStyle = { '--columns': columnTemplate } as CSSProperties;

  return (
    <div className="booking-grid" style={gridStyle}>
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
                <div className="hour-lines">
                  {Array.from({ length: 24 }, (_, hour) => (
                    <div key={hour} className="hour-line" />
                  ))}
                </div>

                {roomBookings.map((booking) => {
                  const start = timeToMinutes(booking.startTime);
                  const end = timeToMinutes(booking.endTime);
                  const duration = Math.max(15, end - start);
                  const top = (start / (24 * 60)) * DAY_HEIGHT;
                  const height = (duration / (24 * 60)) * DAY_HEIGHT;

                  return (
                    <div
                      key={booking.id}
                      className={`booking-block ${editingEnabled ? 'editable' : 'locked'}`}
                      style={{ top: `${top}px`, height: `${height}px` }}
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
                      <div className="booking-title">{booking.title}</div>
                      {booking.notes && <div className="booking-subtitle">{booking.notes}</div>}
                      <div className="booking-time">{booking.startTime}–{booking.endTime}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
