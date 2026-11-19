import { CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import { addDays, eachDayOfInterval, format, parseISO } from 'date-fns';
import { Booking } from '../types';
import { BoardBooking } from '../lib/bookingImport';
import { ParsedVenueConfig } from '../lib/venueConfig';
import '../board.css';
interface Props { venue: ParsedVenueConfig | null; bookings: Booking[]; editingEnabled: boolean; onBookingsChange: (bookings: Booking[]) => void; roomBaseWidths?:number[] }
interface Block { date:string; title:string; ids:string[]; rooms:number[]; start:number; end:number; mainStart:number; mainEnd:number; facts:string[]; jobNumber?:string }
function minutes(s:string) { const m=/^(\d{1,2}):(\d{2})/.exec(s); return m?Number(m[1])*60+Number(m[2]):0; }
function range(start:string,end:string) { const a=minutes(start),b=minutes(end); return [a,b<a?b+1440:b]; }
function clock(n:number) { return `${String(Math.floor(n/60)%24).padStart(2,'0')}:${String(n%60).padStart(2,'0')}${n>=1440?' (+1 day)':''}`; }
function normalizeJobNumber(value:string){const trimmed=value.trim();if(!trimmed)return '';return /^\d+$/.test(trimmed)?trimmed.replace(/^0+(?=\d)/,''):trimmed;}
function blocksFor(bookings:Booking[],venue:ParsedVenueConfig):Block[] {
  const groups=new Map<string,Block>();
  for(const b of bookings as BoardBooking[]) {
    const [mainStart,mainEnd]=range(b.startTime,b.endTime);
    const timeline=(b.timeline||[]).map(t=>({label:t.label,times:range(t.start,t.end)}));
    const start=Math.min(mainStart,...timeline.map(t=>t.times[0]));
    const end=Math.max(mainEnd,...timeline.map(t=>t.times[1]));
    const facts=timeline.map(t=>`${t.label} ${clock(t.times[0])}–${clock(t.times[1])}`);
    for(const roomId of new Set(b.roomIds||[b.roomId])) {
      const room=venue.rooms.findIndex(r=>r.id===roomId);
      if(room<0)continue;
      const key=JSON.stringify([b.date,b.title,room]);
      const old=groups.get(key);
      if(old){old.ids.push(b.id);old.start=Math.min(old.start,start);old.end=Math.max(old.end,end);old.mainStart=Math.min(old.mainStart,mainStart);old.mainEnd=Math.max(old.mainEnd,mainEnd);old.facts.push(...facts);}
      else groups.set(key,{date:b.date,title:b.title,ids:[b.id],rooms:[room],start,end,mainStart,mainEnd,facts:[...facts],jobNumber:b.jobNumber});
    }
  }
  const spans:Block[]=[];
  for(const b of [...groups.values()].sort((a,c)=>a.rooms[0]-c.rooms[0])) {
    b.ids=[...new Set(b.ids)].sort();b.facts=[...new Set(b.facts)];
    const previous=spans.find(p=>p.date===b.date&&p.title===b.title&&p.start===b.start&&p.end===b.end&&JSON.stringify(p.ids)===JSON.stringify(b.ids)&&p.rooms[p.rooms.length-1]+1===b.rooms[0]);
    if(previous)previous.rooms.push(b.rooms[0]);else spans.push(b);
  }
  return spans;
}
export default function BookingGrid({venue,bookings,editingEnabled,onBookingsChange,roomBaseWidths}:Props) {
  const root=useRef<HTMLDivElement>(null),header=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({day:100,availableWidth:0});
  useLayoutEffect(()=>{
    const parent=root.current?.parentElement;if(!parent||!venue)return;
    const measure=()=>{const day=Math.max(1,(parent.clientHeight-(header.current?.offsetHeight||0))/7);const availableWidth=Math.max(0,parent.clientWidth-160);setSize(old=>old.day===day&&old.availableWidth===availableWidth?old:{day,availableWidth});};
    measure();const observer=new ResizeObserver(measure);observer.observe(parent);if(header.current)observer.observe(header.current);return()=>observer.disconnect();
  },[venue]);
  if(!venue)return <div className="empty-state">Open Configuration to load a venue YAML file.</div>;
  const baseWidths=venue.rooms.map((_,i)=>Math.max(150,roomBaseWidths?.[i]||175));
  const total=baseWidths.reduce((sum,width)=>sum+width,0);
  const scale=Math.max(1,size.availableWidth/Math.max(1,total));
  const widths=baseWidths.map(width=>width*scale);
  const blocks=blocksFor(bookings,venue);
  const segments=blocks.flatMap(b=>{const result:{block:Block;date:string;start:number;end:number;continuation:boolean}[]=[];for(let offset=0;offset<=Math.floor(Math.max(b.start,b.end-1)/1440);offset++){const start=Math.max(0,b.start-offset*1440),end=Math.min(1440,b.end-offset*1440);if(end>=start)result.push({block:b,date:format(addDays(parseISO(b.date),offset),'yyyy-MM-dd'),start,end,continuation:offset>0});}return result;});
  const sourceDates=[...new Set(segments.map(s=>s.date))].sort();
  const dates=sourceDates.length?eachDayOfInterval({start:parseISO(sourceDates[0]),end:parseISO(sourceDates[sourceDates.length-1])}).map(d=>format(d,'yyyy-MM-dd')):[];
  const columns=`160px ${widths.map(width=>`${width}px`).join(' ')}`;
  const style={'--columns':columns,'--day-height':`${size.day}px`,width:160+widths.reduce((sum,width)=>sum+width,0)} as CSSProperties;
  const today=format(new Date(),'yyyy-MM-dd'),hourStep=size.day>=360?1:size.day>=180?3:6;
  return <div className="booking-grid" ref={root} style={style}>
    <div className="grid-header" ref={header} style={{gridTemplateColumns:columns}}><div className="corner">Date / time</div>{venue.rooms.map(r=><div className="room-header" key={r.id}>{r.name}</div>)}</div>
    {!dates.length&&<div className="empty-state">Load a booking file to display bookings.</div>}
    {dates.map(date=><div className={`grid-row${date===today?' today':''}`} key={date} style={{gridTemplateColumns:columns}}>
      <div className={`date-cell${date===today?' today':''}`}><div className="date-label">{format(parseISO(date),'EEE dd MMM')}</div>{Array.from({length:24/hourStep},(_,i)=>i*hourStep).map(h=><span className="hour-label" key={h} style={{top:h/24*size.day,fontSize:9,lineHeight:'10px'}}>{String(h).padStart(2,'0')}:00</span>)}</div>
      {venue.rooms.map(r=><div className="room-cell" key={r.id}/>)}
      {segments.filter(s=>s.date===date).map(({block:b,start,end,continuation})=><div key={JSON.stringify([b.date,b.title,b.rooms,b.ids])} className={`booking-block ${editingEnabled?'editable':'locked'}`} style={{gridColumn:`${b.rooms[0]+2} / ${b.rooms[b.rooms.length-1]+3}`,gridRow:1,top:start/1440*size.day,height:Math.max(1,(end-start)/1440*size.day)}} title={[b.title,`${b.date} ${clock(b.mainStart)}–${clock(b.mainEnd)}`,...b.facts].join('\n')}>
        <div className="booking-facts">{b.facts.filter(t=>/setup/i.test(t)).map(t=><div key={t}>{t}</div>)}<div>{clock(b.mainStart)}</div><div>{clock(b.mainEnd)}</div>{b.facts.filter(t=>!/setup/i.test(t)).map(t=><div key={t}>{t}</div>)}</div>
        <div className="booking-title" contentEditable={editingEnabled} suppressContentEditableWarning onBlur={e=>{if(editingEnabled){const title=e.currentTarget.textContent||'';onBookingsChange(bookings.map(x=>b.ids.includes(x.id)?{...x,title}:x));}}}>{b.title}</div>
        <div className="booking-job-number" contentEditable={editingEnabled} suppressContentEditableWarning onBlur={e=>{if(editingEnabled){const jobNumber=normalizeJobNumber(e.currentTarget.textContent||'');onBookingsChange(bookings.map(x=>b.ids.includes(x.id)?(jobNumber?{...x,jobNumber}:{...x,jobNumber:undefined}):x));}}}>{b.jobNumber||''}</div>
        {continuation&&<span style={{position:'absolute',right:2,bottom:0,fontSize:8,pointerEvents:'none'}}>continued</span>}
      </div>)}
    </div>)}
  </div>;
}
