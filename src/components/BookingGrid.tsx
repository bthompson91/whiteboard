import { CSSProperties, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { addDays, eachDayOfInterval, format, parseISO } from 'date-fns';
import { Booking } from '../types';
import { ParsedVenueConfig } from '../lib/venueConfig';
import { bookingColour, isNoAv, resolveSalesperson, Salesperson, UNAVAILABLE_SALESPERSON } from '../lib/configuration';
import { Block, blocksFor, clock, likeBookings, strongBorders } from '../lib/blocks';
import { dayKind } from '../lib/dateTime';
import '../board.css';
import './bookingInspector.css';
interface Props {
  venue: ParsedVenueConfig | null;
  bookings: Booking[];
  salespeople: Salesperson[];
  roomBorders: string[];
  editingEnabled: boolean;
  selectedBookingId: string | null;
  onBookingsChange: (bookings: Booking[]) => void;
  onSelectedBookingChange: (bookingId: string | null) => void;
  roomBaseWidths?: number[];
}
function normalizeJobNumber(value:string){const trimmed=value.trim();if(!trimmed)return '';return /^\d+$/.test(trimmed)?trimmed.replace(/^0+(?=\d)/,''):trimmed;}
// The times strip shows only the first time of each entry: a setup that
// runs 06:00-08:00 reads as 06:00. The full range stays in the tooltip.
function firstTime(fact:string){return fact.match(/\d{2}:\d{2}/)?.[0]??fact;}
// Dark palette colours need light text so the name stays readable on its
// colour sample in the salesperson dropdown.
function readableText(hex:string){const n=parseInt(hex.slice(1),16);const lum=0.2126*((n>>16)&255)+0.7152*((n>>8)&255)+0.0722*(n&255);return lum<140?'#ffffff':'#18202a';}
// The block title grows to fill its block: the largest font (8-64px)
// that still fits without cutting any text off, re-measured when the
// text or the block size changes.
function FitTitle({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(11);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    let lo = 8, hi = 64, best = 8;
    const fits = (size: number) => {
      el.style.fontSize = `${size}px`;
      return el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1;
    };
    if (fits(hi)) best = hi;
    else {
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (fits(mid)) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
    }
    el.style.fontSize = `${best}px`;
    setFontSize((prev) => (prev === best ? prev : best));
  }, []);
  useLayoutEffect(() => {
    fit();
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit, text]);
  return <div ref={ref} className="booking-title" style={{ fontSize }}>{text}</div>;
}
export default function BookingGrid({venue,bookings,salespeople,roomBorders,editingEnabled,selectedBookingId,onBookingsChange,onSelectedBookingChange,roomBaseWidths}:Props) {
  const root=useRef<HTMLDivElement>(null),header=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({day:100,availableWidth:0});
  const selected=bookings.find(booking=>booking.id===selectedBookingId)||null;
  const [draft,setDraft]=useState<Booking|null>(null);
  const [applyAllPrompt,setApplyAllPrompt]=useState<{salespersonId:string;colour?:string;name:string;like:Booking[]}|null>(null);
  const openInspector=(booking:Booking)=>{onSelectedBookingChange(booking.id);setDraft({...booking});};
  const closeInspector=()=>{setDraft(null);setApplyAllPrompt(null);};
  const commitSave=(applyAll:boolean)=>{
    if(!draft)return;
    const saved={...draft,jobNumber:draft.jobNumber?normalizeJobNumber(draft.jobNumber):undefined};
    onBookingsChange(bookings.map(booking=>{
      if(booking.id===draft.id)return saved;
      if(applyAll&&applyAllPrompt&&applyAllPrompt.like.some(like=>like.id===booking.id))return {...booking,salespersonId:applyAllPrompt.salespersonId,colour:applyAllPrompt.colour};
      return booking;
    }));
    setApplyAllPrompt(null);
    closeInspector();
  };
  const saveInspector=()=>{
    if(!draft)return;
    // Colour-coding a booking that shares its exact title with others
    // in other rooms or on other days asks first: apply the same
    // salesperson to all like bookings, or just this one?
    const original=bookings.find(booking=>booking.id===draft.id);
    const salespersonId=draft.salespersonId;
    const person=salespersonId?resolveSalesperson(salespeople,salespersonId):undefined;
    const like=salespersonId&&salespersonId!==original?.salespersonId?likeBookings(bookings,draft.title,draft.id,salespersonId):[];
    if(person&&like.length&&salespersonId){
      setApplyAllPrompt({salespersonId,colour:person.colour,name:person.name,like});
      return;
    }
    commitSave(false);
  };
  useLayoutEffect(()=>{
    const parent=root.current?.parentElement;if(!parent||!venue)return;
    const measure=()=>{const day=Math.max(1,(parent.clientHeight-(header.current?.offsetHeight||0))/7);const availableWidth=Math.max(0,parent.clientWidth-160);setSize(old=>old.day===day&&old.availableWidth===availableWidth?old:{day,availableWidth});};
    measure();const observer=new ResizeObserver(measure);observer.observe(parent);if(header.current)observer.observe(header.current);return()=>observer.disconnect();
  },[venue]);
  if(!venue)return <div className="empty-state">Open Configuration to load a venue YAML file.</div>;
  const baseWidths=venue.rooms.map((_,i)=>Math.max(125,roomBaseWidths?.[i]||150));
  const total=baseWidths.reduce((sum,width)=>sum+width,0);
  const scale=Math.max(1,size.availableWidth/Math.max(1,total));
  const widths=baseWidths.map(width=>width*scale);
  const blocks=blocksFor(bookings,venue,salespeople,editingEnabled,roomBorders);
  const strongAfter=strongBorders(venue.rooms.map(r=>r.id),roomBorders);
  const segments=blocks.flatMap(b=>{const result:{block:Block;date:string;start:number;end:number;continuation:boolean}[]=[];for(let offset=0;offset<=Math.floor(Math.max(b.start,b.end-1)/1440);offset++){const start=Math.max(0,b.start-offset*1440),end=Math.min(1440,b.end-offset*1440);if(end>=start)result.push({block:b,date:format(addDays(parseISO(b.date),offset),'yyyy-MM-dd'),start,end,continuation:offset>0});}return result;});
  const sourceDates=[...new Set(segments.map(s=>s.date))].sort();
  const dates=sourceDates.length?eachDayOfInterval({start:parseISO(sourceDates[0]),end:parseISO(sourceDates[sourceDates.length-1])}).map(d=>format(d,'yyyy-MM-dd')):[];
  const columns=`160px ${widths.map(width=>`${width}px`).join(' ')}`;
  const style={'--columns':columns,'--day-height':`${size.day}px`,width:160+widths.reduce((sum,width)=>sum+width,0)} as CSSProperties;
  const today=format(new Date(),'yyyy-MM-dd');
  const jobNumberInvalid=!!draft?.jobNumber&&!/^\d+$/.test(draft.jobNumber.trim())&&!isNoAv(draft.jobNumber);
  return <div className="booking-grid" ref={root} style={style}>
    <div className="grid-header" ref={header} style={{gridTemplateColumns:columns}}><div className="corner group-edge">Date / time</div>{venue.rooms.map((r,i)=><div className={`room-header${strongAfter[i]?' group-edge':''}`} key={r.id} data-room={r.id}>{r.name}</div>)}</div>
    {!dates.length&&<div className="empty-state">Load a booking file to display bookings.</div>}
    {dates.map(date=><div className={`grid-row${date===today?' today':''}`} key={date} data-date={date} style={{gridTemplateColumns:columns}}>
      <div className={`date-cell ${dayKind(date, today)} group-edge day-edge`}><div className="date-label">{format(parseISO(date),'EEE dd MMM')}</div></div>
      {venue.rooms.map((r,i)=><div className={`room-cell${strongAfter[i]?' group-edge':''} day-edge`} key={r.id}/>)}
      {segments.filter(s=>s.date===date).map(({block:b,start,end,continuation})=><div key={JSON.stringify([b.date,b.title,b.rooms,b.ids])} className={`booking-block ${editingEnabled?'editable':'locked'}${selectedBookingId&&b.ids.includes(selectedBookingId)?' selected':''}`} style={{gridColumn:`${b.rooms[0]+2} / ${b.rooms[b.rooms.length-1]+3}`,gridRow:1,top:start/1440*size.day,height:Math.max(1,(end-start)/1440*size.day),backgroundColor:b.unavailable?'#9aa0a6':(b.colour||'var(--paper)'),opacity:b.hidden?0.45:undefined,borderStyle:b.hidden?'dashed':undefined}} title={[b.title,`${b.date} ${clock(b.mainStart)}–${clock(b.mainEnd)}`,...b.facts].join('\n')} onClick={()=>{if(editingEnabled){const booking=bookings.find(item=>item.id===b.ids[0]);if(booking)openInspector(booking);}}}>
        <div className="booking-facts" style={{backgroundColor:b.unavailable?(b.salespersonColour||'#9aa0a6'):(b.colour||undefined)}}>{b.facts.filter(t=>/setup/i.test(t)).map(t=><div key={t}>{firstTime(t)}</div>)}<div>{clock(b.mainStart).slice(0,5)}</div><div>{clock(b.mainEnd).slice(0,5)}</div>{b.facts.filter(t=>!/setup/i.test(t)).map(t=><div key={t}>{firstTime(t)}</div>)}</div>
        <FitTitle text={[b.title,[b.initials,b.jobNumber].filter(Boolean).join(' ')].filter(Boolean).join(' | ') + (b.hidden ? ' — hidden' : '')} />
        {continuation&&<span style={{position:'absolute',right:2,bottom:0,fontSize:8,pointerEvents:'none'}}>continued</span>}
      </div>)}
    </div>)}
    {draft&&(
      <div className="inspector-overlay" onClick={closeInspector}>
        <section className="inspector-panel" onClick={event=>event.stopPropagation()} aria-label="Booking details">
          <header><h3>Booking details</h3><button onClick={closeInspector}>Close</button></header>
          <label>Title<input value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label>
          <div style={{display:'flex',alignItems:'flex-end'}}>
            <label style={{flex:1,paddingRight:0}}>Job number<input value={draft.jobNumber||''} onChange={event=>setDraft({...draft,jobNumber:event.target.value})}/></label>
            <label className="checkbox" style={{paddingLeft:12}}><input type="checkbox" checked={isNoAv(draft.jobNumber)} onChange={event=>setDraft({...draft,jobNumber:event.target.checked?'NO AV':''})}/>NO AV</label>
          </div>
          {jobNumberInvalid&&<p className="field-warning">Job number must be numeric. It will be retained unchanged until corrected.</p>}
          <label>Notes<textarea value={draft.notes||''} onChange={event=>setDraft({...draft,notes:event.target.value})}/></label>
          <label>Salesperson
            <span style={{display:'flex',gap:8,alignItems:'center'}}>
              <select aria-label="Salesperson" value={draft.salespersonId||''} onChange={event=>{
                const salespersonId=event.target.value;
                if(!salespersonId){setDraft({...draft,salespersonId:undefined,colour:undefined});return;}
                const person=resolveSalesperson(salespeople,salespersonId);
                setDraft({...draft,salespersonId,colour:person?.colour});
              }}>
                <option value="">No salesperson</option>
                {salespeople.map(person=><option key={person.id} value={person.id} style={{backgroundColor:person.colour,color:readableText(person.colour)}}>{person.name}</option>)}
              </select>
              <span style={{display:'inline-block',width:60,height:24,border:'1px solid #18202a',background:bookingColour(draft,salespeople)||'#e7e1d8'}} aria-label={bookingColour(draft,salespeople)||'no colour'} />
            </span>
          </label>
          <label className="checkbox"><input type="checkbox" checked={draft.unavailable===true||draft.salespersonId===UNAVAILABLE_SALESPERSON.id} onChange={event=>{const on=event.target.checked;setDraft({...draft,unavailable:on,salespersonId:draft.salespersonId===UNAVAILABLE_SALESPERSON.id?'':draft.salespersonId});}}/>Unavailable</label>
          <label className="checkbox"><input type="checkbox" checked={!!draft.hidden} onChange={event=>setDraft({...draft,hidden:event.target.checked})}/>Hide from board</label>
          <label className="checkbox"><input type="checkbox" checked={draft.mergeTime!==false} onChange={event=>setDraft({...draft,mergeTime:event.target.checked})}/>Merge with the same booking at other times</label>
          <label className="checkbox"><input type="checkbox" checked={draft.mergeRoom!==false} onChange={event=>setDraft({...draft,mergeRoom:event.target.checked})}/>Merge with the same booking in other rooms</label>
          {applyAllPrompt&&(
            <div style={{margin:'0 20px 10px',padding:'12px',border:'1px solid #1d4e89',borderRadius:7,background:'#eef4fb',fontSize:13}}>
              <p style={{margin:'0 0 10px'}}>{applyAllPrompt.name} is also on {applyAllPrompt.like.length} other booking{applyAllPrompt.like.length===1?'':'s'} titled “{draft.title}”. Apply {applyAllPrompt.name} to all of them?</p>
              <div style={{display:'flex',gap:8}}>
                <button className="primary" onClick={()=>commitSave(true)}>Apply to all {applyAllPrompt.like.length+1}</button>
                <button onClick={()=>commitSave(false)}>Just this one</button>
              </div>
            </div>
          )}
          <footer><button onClick={closeInspector}>Cancel</button><button className="primary" onClick={saveInspector} disabled={jobNumberInvalid||!!applyAllPrompt}>Save booking</button></footer>
        </section>
      </div>
    )}
  </div>;
}
