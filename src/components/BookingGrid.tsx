import { CSSProperties } from 'react';
import { Booking } from '../types';
import { BoardBooking } from '../lib/bookingImport';
import { ParsedVenueConfig } from '../lib/venueConfig';
import '../board.css';
interface Props { venue: ParsedVenueConfig | null; bookings: Booking[]; editingEnabled: boolean; onBookingsChange: (bookings: Booking[]) => void }
const HEIGHT = 720;
function minutes(s: string) { const m = /^(\d{1,2}):(\d{2})/.exec(s); return m ? Number(m[1])*60+Number(m[2]) : 0; }
export default function BookingGrid({venue, bookings, editingEnabled, onBookingsChange}: Props) {
  if (!venue) return <div className="empty-state">Load a venue YAML file to begin.</div>;
  const dates = [...new Set(bookings.map(b => b.date))].sort();
  const style = { '--columns': `160px repeat(${venue.rooms.length}, 220px)`, width: 160 + venue.rooms.length * 220 } as CSSProperties;
  return <div className="booking-grid" style={style}>
    <div className="grid-header"><div className="corner">Date / time</div>{venue.rooms.map(r => <div className="room-header" key={r.id}>{r.name}</div>)}</div>
    {!dates.length && <div className="empty-state">Load a booking file to display bookings.</div>}
    {dates.map(date => <div className="grid-row" key={date}>
      <div className="date-cell"><div className="date-label">{date}</div>{Array.from({length:24},(_,h) => <span className="hour-label" key={h} style={{top:h*30+16}}>{String(h).padStart(2,'0')}:00</span>)}</div>
      {venue.rooms.map(r => <div className="room-cell" key={r.id} />)}
      {(bookings as BoardBooking[]).filter(b => b.date === date).map(b => {
        const indices = (b.roomIds || [b.roomId]).map(id => venue.rooms.findIndex(r => r.id === id)).filter(i => i >= 0).sort((a,c)=>a-c);
        if (!indices.length) return null;
        const timeline = b.timeline || [];
        const start = Math.min(minutes(b.startTime), ...timeline.map(t => minutes(t.start)));
        const end = Math.max(minutes(b.endTime), ...timeline.map(t => minutes(t.end)));
        const runs: number[][] = [];
        indices.forEach(i => { const run = runs[runs.length-1]; if (run && i === run[run.length-1]+1) run.push(i); else runs.push([i]); });
        return runs.map((run, n) => <div key={`${b.id}-${n}`} className={`booking-block ${editingEnabled ? 'editable' : 'locked'}`} style={{gridColumn:`${run[0]+2} / ${run[run.length-1]+3}`,gridRow:1,top:start/1440*HEIGHT,height:Math.max(2,(end-start)/1440*HEIGHT)}} title={`${b.title}\n${b.startTime}–${b.endTime}`}>
          <div className="booking-facts">
            {timeline.filter(t => /setup/i.test(t.label)).map((t,i) => <div key={`s${i}`}>{t.label} {t.start}–{t.end}</div>)}
            <div>{b.startTime}</div><div>{b.endTime}</div>
            {timeline.filter(t => !/setup/i.test(t.label)).map((t,i) => <div key={`t${i}`}>{t.label} {t.start}–{t.end}</div>)}
          </div>
          <div className="booking-title" contentEditable={editingEnabled} suppressContentEditableWarning onBlur={e => {if(editingEnabled) {const title=e.currentTarget.textContent || ''; onBookingsChange(bookings.map(x=>x.id===b.id?{...x,title}:x));}}}>{b.title}</div>
        </div>);
      })}
    </div>)}
  </div>;
}
