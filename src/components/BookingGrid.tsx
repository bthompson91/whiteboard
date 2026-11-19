import { CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import { eachDayOfInterval, format, parseISO } from 'date-fns';
import { Booking } from '../types';
import { BoardBooking } from '../lib/bookingImport';
import { ParsedVenueConfig } from '../lib/venueConfig';
import '../board.css';
interface Props { venue: ParsedVenueConfig | null; bookings: Booking[]; editingEnabled: boolean; onBookingsChange: (bookings: Booking[]) => void }
function minutes(s: string) { const m = /^(\d{1,2}):(\d{2})/.exec(s); return m ? Number(m[1])*60+Number(m[2]) : 0; }
export default function BookingGrid({venue, bookings, editingEnabled, onBookingsChange}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({day:100, room:150});
  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent || !venue) return;
    const measure = () => {
      const day = Math.max(1, (parent.clientHeight - (header.current?.offsetHeight || 0))/7);
      const room = Math.max(150, Math.min(200, (parent.clientWidth-160)/Math.max(1,venue.rooms.length)));
      setSize(old => old.day === day && old.room === room ? old : {day,room});
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    if (header.current) observer.observe(header.current);
    return () => observer.disconnect();
  }, [venue]);
  if (!venue) return <div className="empty-state">Load a venue YAML file to begin.</div>;
  const sourceDates = [...new Set(bookings.map(b=>b.date))].sort();
  const dates = sourceDates.length ? eachDayOfInterval({start:parseISO(sourceDates[0]),end:parseISO(sourceDates[sourceDates.length-1])}).map(d=>format(d,'yyyy-MM-dd')) : [];
  const columns = `160px repeat(${venue.rooms.length}, ${size.room}px)`;
  const style = {'--columns':columns,'--day-height':`${size.day}px`,width:160+venue.rooms.length*size.room} as CSSProperties;
  const today = format(new Date(),'yyyy-MM-dd');
  const hourStep = size.day >= 360 ? 1 : size.day >= 180 ? 3 : 6;
  return <div className="booking-grid" ref={root} style={style}>
    <div className="grid-header" ref={header} style={{gridTemplateColumns:columns}}><div className="corner">Date / time</div>{venue.rooms.map(r=><div className="room-header" key={r.id}>{r.name}</div>)}</div>
    {!dates.length && <div className="empty-state">Load a booking file to display bookings.</div>}
    {dates.map(date=><div className={`grid-row${date===today?' today':''}`} key={date} style={{gridTemplateColumns:columns}}>
      <div className={`date-cell${date===today?' today':''}`}><div className="date-label">{format(parseISO(date),'EEE dd MMM')}</div>{Array.from({length:24/hourStep},(_,i)=>i*hourStep).map(h=><span className="hour-label" key={h} style={{top:h/24*size.day,fontSize:9,lineHeight:'10px'}}>{String(h).padStart(2,'0')}:00</span>)}</div>
      {venue.rooms.map(r=><div className="room-cell" key={r.id}/>)}
      {(bookings as BoardBooking[]).filter(b=>b.date===date).map(b=>{
        const indices = [...new Set((b.roomIds || [b.roomId]).map(id=>venue.rooms.findIndex(r=>r.id===id)).filter(i=>i>=0))].sort((a,c)=>a-c);
        if (!indices.length) return null;
        const timeline = b.timeline || [];
        const start = Math.min(minutes(b.startTime),...timeline.map(t=>minutes(t.start)));
        const end = Math.max(minutes(b.endTime),...timeline.map(t=>minutes(t.end)));
        const runs:number[][]=[];
        indices.forEach(i=>{const run=runs[runs.length-1];if(run && i===run[run.length-1]+1)run.push(i);else runs.push([i]);});
        return runs.map((run,n)=><div key={`${b.id}-${n}`} className={`booking-block ${editingEnabled?'editable':'locked'}`} style={{gridColumn:`${run[0]+2} / ${run[run.length-1]+3}`,gridRow:1,top:start/1440*size.day,height:Math.max(1,(end-start)/1440*size.day)}} title={`${b.title}\n${b.startTime}–${b.endTime}`}>
          <div className="booking-facts">{timeline.filter(t=>/setup/i.test(t.label)).map((t,i)=><div key={`s${i}`}>{t.label} {t.start}–{t.end}</div>)}<div>{b.startTime}</div><div>{b.endTime}</div>{timeline.filter(t=>!/setup/i.test(t.label)).map((t,i)=><div key={`t${i}`}>{t.label} {t.start}–{t.end}</div>)}</div>
          <div className="booking-title" contentEditable={editingEnabled} suppressContentEditableWarning onBlur={e=>{if(editingEnabled){const title=e.currentTarget.textContent || '';onBookingsChange(bookings.map(x=>x.id===b.id?{...x,title}:x));}}}>{b.title}</div>
        </div>);
      })}
    </div>)}
  </div>;
}
