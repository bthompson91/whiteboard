import { CSSProperties, useEffect, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Booking } from '../types';
import { BoardBooking } from '../lib/bookingImport';
import { ParsedVenueConfig } from '../lib/venueConfig';
import '../board.css';

interface Props {
  venue: ParsedVenueConfig | null;
  bookings: Booking[];
  editingEnabled: boolean;
  onBookingsChange: (bookings: Booking[]) => void;
}

const MIN_DAY_HEIGHT = 160;
const DAYS_ON_SCREEN = 7;

function minutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

export default function BookingGrid({ venue, bookings, editingEnabled, onBookingsChange }: Props) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [dayHeight, setDayHeight] = useState(720);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const container = grid.parentElement;
    if (!container) return;

    const measure = () => {
      const headerHeight = headerRef.current?.offsetHeight ?? 0;
      const availableHeight = container.clientHeight - headerHeight;
      setDayHeight(Math.max(MIN_DAY_HEIGHT, availableHeight / DAYS_ON_SCREEN));
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (headerRef.current) observer.observe(headerRef.current);

    return () => observer.disconnect();
  }, []);

  if (!venue) return <div className="empty-state">Load a venue YAML file to begin.</div>;

  const dates = [...new Set(bookings.map((booking) => booking.date))].sort();
  const today = format(new Date(), 'yyyy-MM-dd');
  const style = {
    '--columns': `160px repeat(${venue.rooms.length}, 220px)`,
    '--day-height': `${dayHeight}px`,
    width: 160 + venue.rooms.length * 220
  } as CSSProperties;

  return (
    <div className="booking-grid" ref={gridRef} style={style}>
      <div className="grid-header" ref={headerRef}>
        <div className="corner">Date / time</div>
        {venue.rooms.map((room) => (
          <div className="room-header" key={room.id}>{room.name}</div>
        ))}
      </div>

      {!dates.length && <div className="empty-state">Load a booking file to display bookings.</div>}

      {dates.map((date) => {
        const isToday = date === today;

        return (
          <div className={`grid-row${isToday ? ' today' : ''}`} key={date}>
            <div className={`date-cell${isToday ? ' today' : ''}`}>
              <div className="date-label">{format(parseISO(date), 'EEE dd MMM')}</div>
              {Array.from({ length: 24 }, (_, hour) => (
                <span
                  className="hour-label"
                  key={hour}
                  style={{ top: `calc(var(--day-height) * ${hour / 24})` }}
                >
                  {String(hour).padStart(2, '0')}:00
                </span>
              ))}
            </div>

            {venue.rooms.map((room) => (
              <div className="room-cell" key={room.id} />
            ))}

            {(bookings as BoardBooking[])
              .filter((booking) => booking.date === date)
              .map((booking) => {
                const indices = (booking.roomIds || [booking.roomId])
                  .map((roomId) => venue.rooms.findIndex((room) => room.id === roomId))
                  .filter((index) => index >= 0)
                  .sort((a, b) => a - b);

                if (!indices.length) return null;

                const timeline = booking.timeline || [];
                const start = Math.min(
                  minutes(booking.startTime),
                  ...timeline.map((item) => minutes(item.start))
                );
                const end = Math.max(
                  minutes(booking.endTime),
                  ...timeline.map((item) => minutes(item.end))
                );

                const runs: number[][] = [];
                indices.forEach((index) => {
                  const run = runs[runs.length - 1];
                  if (run && index === run[run.length - 1] + 1) {
                    run.push(index);
                  } else {
                    runs.push([index]);
                  }
                });

                return runs.map((run, runIndex) => (
                  <div
                    key={`${booking.id}-${runIndex}`}
                    className={`booking-block ${editingEnabled ? 'editable' : 'locked'}`}
                    style={{
                      gridColumn: `${run[0] + 2} / ${run[run.length - 1] + 3}`,
                      gridRow: 1,
                      top: `calc(var(--day-height) * ${start / 1440})`,
                      height: `max(2px, calc(var(--day-height) * ${(end - start) / 1440}))`
                    }}
                    title={`${booking.title}\n${booking.startTime}–${booking.endTime}`}
                  >
                    <div className="booking-facts">
                      {timeline
                        .filter((item) => /setup/i.test(item.label))
                        .map((item, index) => (
                          <div key={`setup-${index}`}>{item.label} {item.start}–{item.end}</div>
                        ))}
                      <div>{booking.startTime}</div>
                      <div>{booking.endTime}</div>
                      {timeline
                        .filter((item) => !/setup/i.test(item.label))
                        .map((item, index) => (
                          <div key={`teardown-${index}`}>{item.label} {item.start}–{item.end}</div>
                        ))}
                    </div>
                    <div
                      className="booking-title"
                      contentEditable={editingEnabled}
                      suppressContentEditableWarning
                      onBlur={(event) => {
                        if (!editingEnabled) return;
                        const title = event.currentTarget.textContent || '';
                        onBookingsChange(
                          bookings.map((item) =>
                            item.id === booking.id ? { ...item, title } : item
                          )
                        );
                      }}
                    >
                      {booking.title}
                    </div>
                  </div>
                ));
              })}
          </div>
        );
      })}
    </div>
  );
}
