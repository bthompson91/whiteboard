import { CSSProperties, MutableRefObject, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { addDays, eachDayOfInterval, format, parseISO } from 'date-fns';
import { Booking, JobEntry } from '../types';
import { ParsedVenueConfig } from '../lib/venueConfig';
import { bookingColour, isNoAv, readableText, resolveSalesperson, Salesperson, UNAVAILABLE_SALESPERSON } from '../lib/configuration';
import { Block, blocksFor, blockJobNumber, blockSegments, clock, eventColour, fitFontSize, isBlockHidden, likeBookings, relatedBookings, blockCountForBookings, setBlockHidden, strongBorders, operableWallAfter, timeFraction } from '../lib/blocks';
import { applyJobNumberEdits } from '../lib/reviewApply';
import { findJobCandidates, jobSalesperson, salesPersonMatches, JobCandidate } from '../lib/jobsImport';
import { dayKind } from '../lib/dateTime';
import '../board.css';
import './bookingInspector.css';
interface Props {
  venue: ParsedVenueConfig | null;
  bookings: Booking[];
  // The sales system's jobs list (imported with 📋 Jobs), for the
  // inspector's possible-matches list. Empty when no list is loaded.
  jobs?: JobEntry[];
  salespeople: Salesperson[];
  roomBorders: string[];
  // Operable walls: the rooms after which the wall to the next room can
  // be opened. Merging across rooms is only allowed over an operable
  // wall, so this list is what decides which rooms can combine.
  operableWalls: string[];
  editingEnabled: boolean;
  selectedBookingId: string | null;
  onBookingsChange: (bookings: Booking[]) => void;
  onSelectedBookingChange: (bookingId: string | null) => void;
  roomBaseWidths?: number[];
  roomWidthMin?: number;
  showHidden?: boolean;
  // Paint mode: the editor picks a salesperson in the top bar, then
  // clicks blocks to paint them in that salesperson's colour (with
  // their initials) instead of opening them. paintApplyAll paints the
  // same job in other rooms too, like the inspector's "Apply to all".
  paintMode?: boolean;
  paintSalespersonId?: string;
  paintApplyAll?: boolean;
  // Salesperson filter: when one is picked, every other block dims to
  // 25% opacity so that salesperson's blocks stand out. Available in
  // viewer and editor mode alike.
  filterSalespersonId?: string;
  // Random colours per event: every block with the same name gets the
  // same colour, and the salesperson's colour does not apply.
  randomEventColours?: boolean;
  // The Today button lives in the Toolbar (in App), but the scroll
  // itself lives here, where the rows are. App holds this ref and
  // BookingGrid assigns the scroll function to it.
  scrollToTodayRef?: MutableRefObject<(() => void) | null>;
}
// Each room name gets its own font size: the biggest size that fits
// that name in its own column. Each name is measured at a reference
// size and scaled to its column width, so a short name in a wide room
// renders larger than a long name in a narrow room. The header does
// not wrap, so a name that fits at the computed size stays on one line.
function roomNameFontSizes(names: string[], widths: number[]): number[] {
  if (typeof document === 'undefined') return names.map(() => 13);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return names.map(() => 13);
  const ref = 13;
  ctx.font = `700 ${ref}px 'Fira Sans', Calibri, 'Segoe UI', sans-serif`;
  return names.map((name, i) => {
    const textWidth = ctx.measureText(name).width;
    const available = Math.max(1, (widths[i] || 150) - 20);
    return fitFontSize([textWidth], [available], ref);
  });
}
// Each date label gets its own font size: the biggest size that fits
// that date in the 160px date column. Each label is measured at a
// reference size and scaled to the column width, so a short date
// renders larger than a long one. The label does not wrap.
function dateFontSizes(labels: string[], columnWidth: number): number[] {
  if (typeof document === 'undefined') return labels.map(() => 23);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return labels.map(() => 23);
  const ref = 23;
  ctx.font = `700 ${ref}px 'Fira Sans', Calibri, 'Segoe UI', sans-serif`;
  return labels.map(label => {
    const textWidth = ctx.measureText(label).width;
    const available = Math.max(1, columnWidth - 8);
    return fitFontSize([textWidth], [available], ref, 48, 12);
  });
}
function normalizeJobNumber(value:string){const trimmed=value.trim();if(!trimmed)return '';return /^\d+$/.test(trimmed)?trimmed.replace(/^0+(?=\d)/,''):trimmed;}
// The times strip shows only the first time of each entry: a setup that
// runs 06:00-08:00 reads as 06:00. The full range stays in the tooltip.
function firstTime(fact:string){return fact.match(/\d{2}:\d{2}/)?.[0]??fact;}
// The horizontal inset for a block that shares its room with
// overlapping blocks: each block takes 1/laneCount of the width, in
// its lane. A block on its own fills the full width (left 0, right 0,
// or 3px where it meets a strong border, so the border stays visible).
function laneInsets(block: Block, strongAfter: boolean[]): { left: number | string; right: number | string } {
  const laneCount = block.laneCount ?? 1;
  const lane = block.lane ?? 0;
  const lastRoom = block.rooms[block.rooms.length - 1];
  if (laneCount <= 1) return { left: 0, right: strongAfter[lastRoom] ? 3 : 0 };
  const left = `${(lane / laneCount) * 100}%`;
  const right = lane === laneCount - 1
    ? (strongAfter[lastRoom] ? 3 : 0)
    : `${((laneCount - 1 - lane) / laneCount) * 100}%`;
  return { left, right };
}
// The block title grows to fill its block: the largest font (8-64px)
// that still fits without cutting any text off, re-measured when the
// text or the block size changes. The font size is capped at 80% of
// the block's height, and the text itself must fit inside the block:
// a multi-line title at a large font can be taller than the font size,
// so capping the font size alone still let titles spill over the block
// and overlap the block below. (Capping the text itself at 80% of the
// block forced every title to the 8px minimum, because a day is only
// ~100px tall and the title's padding and line height already fill
// most of a short block — the padding is gone and the text now fits
// the block instead.)
function FitTitle({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(11);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const cap = Math.max(8, Math.floor(el.clientHeight * 0.8));
    let lo = 8, hi = Math.min(64, cap), best = 8;
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
export default function BookingGrid({venue,bookings,jobs=[],salespeople,roomBorders,operableWalls,editingEnabled,selectedBookingId,onBookingsChange,onSelectedBookingChange,roomBaseWidths,roomWidthMin=125,scrollToTodayRef,showHidden=false,paintMode=false,paintSalespersonId='',paintApplyAll=false,filterSalespersonId='',randomEventColours=false}:Props) {
  const root=useRef<HTMLDivElement>(null),header=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({day:100,availableWidth:0});
  const selected=bookings.find(booking=>booking.id===selectedBookingId)||null;
  const [draft,setDraft]=useState<Booking|null>(null);
  const [applyAllPrompt,setApplyAllPrompt]=useState<{salespersonId:string;colour?:string;name:string;like:Booking[];likeBlockCount:number}|null>(null);
  const [mergeMessage,setMergeMessage]=useState<string|null>(null);
  // The rooms of the block the inspector was opened from: hiding hides
  // this block only, not every room the booking is in.
  const [inspectorRooms,setInspectorRooms]=useState<string[]>([]);
  // Job numbers are per room — jobs differ per room, only the colour is
  // shared across the whole event — so the inspector edits the number
  // for the block clicked. There is no one-shot for one number in every
  // room: it is never needed. Related bookings get their numbers from
  // the collapsed list below instead, staged here until Save.
  const [relatedJobNumbers,setRelatedJobNumbers]=useState<Record<string,string>>({});
  const openInspector=(booking:Booking,blockRooms:string[])=>{onSelectedBookingChange(booking.id);setDraft({...booking});setInspectorRooms(blockRooms);setRelatedJobNumbers({});setMergeMessage(null);};
  const closeInspector=()=>{setDraft(null);setInspectorRooms([]);setRelatedJobNumbers({});setApplyAllPrompt(null);setMergeMessage(null);};
  const commitSave=(applyAll:boolean)=>{
    if(!draft)return;
    // A job number is per room: the number set for the block clicked.
    // Overrides only store numbers that differ from the booking's own
    // number — clearing a room's number drops its override, so the room
    // falls back to the booking's number.
    const saved={...draft};
    const level=normalizeJobNumber(draft.jobNumber||'');
    saved.jobNumber=level||undefined;
    const jobNumbers:Record<string,string>={};
    for(const [room,value] of Object.entries(draft.jobNumbers||{})){
      const n=normalizeJobNumber(value);
      if(n&&n!==level)jobNumbers[room]=n;
    }
    saved.jobNumbers=Object.keys(jobNumbers).length?jobNumbers:undefined;
    // The block this booking belongs to: a merged block is one booking
    // to the user, so "Just this one" colours the whole block, not just
    // the one row the inspector happened to open (the inspector opens
    // the first booking id in the block, which need not be the one that
    // sets the block's colour — so colouring just that row left the
    // block showing the old colour, which is why "Just this one" looked
    // broken). The same holds for the job number: the block shows the
    // job number of whichever row set it, so an edit that only touched
    // the opened row left some blocks showing the old number. The other
    // rows in the block keep their own times and titles; only their
    // salesperson, colour and job number change.
    const block=blocks.find(b=>b.ids.includes(draft.id));
    const blockIds=new Set(block?block.ids:[draft.id]);
    // Related bookings staged in the inspector get their numbers here
    // too (applyJobNumberEdits skips the block's own bookings, which
    // share the block's number already).
    onBookingsChange(applyJobNumberEdits(bookings.map(booking=>{
      if(booking.id===draft.id)return saved;
      if(blockIds.has(booking.id))return {...booking,salespersonId:saved.salespersonId,colour:saved.colour,jobNumber:saved.jobNumber,jobNumbers:saved.jobNumbers};
      if(applyAll&&applyAllPrompt&&applyAllPrompt.like.some(like=>like.id===booking.id))return {...booking,salespersonId:applyAllPrompt.salespersonId,colour:applyAllPrompt.colour};
      return booking;
    }),relatedJobNumbers,blockIds));
    setApplyAllPrompt(null);
    closeInspector();
  };
  // Paint mode: colour a whole block in a salesperson's colour (with
  // their initials) without opening it. With "Apply to all" on, the
  // same job in other rooms gets the same colour too, using the same
  // like-bookings rule as the inspector. An empty salesperson clears
  // the colour from the clicked block only.
  const paintBlock=(block:Block,salespersonId:string,applyAll:boolean)=>{
    const person=salespersonId?resolveSalesperson(salespeople,salespersonId):undefined;
    if(salespersonId&&!person)return;
    const blockIds=new Set(block.ids);
    const like=applyAll&&salespersonId?likeBookings(bookings,block.title,block.ids[0],salespersonId).filter(like=>!blockIds.has(like.id)):[];
    const likeIds=new Set(like.map(like=>like.id));
    onBookingsChange(bookings.map(booking=>{
      if(blockIds.has(booking.id)||likeIds.has(booking.id))return {...booking,salespersonId:salespersonId||undefined,colour:person?.colour};
      return booking;
    }));
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
      setApplyAllPrompt({salespersonId,colour:person.colour,name:person.name,like,likeBlockCount:blockCountForBookings(blocks,like)});
      return;
    }
    commitSave(false);
  };
  // Find the booking in the room immediately beside this one, on the
  // same day, whose time overlaps this booking's time. Prefer one with
  // the same title; otherwise the greatest overlap. Null when there is
  // no room that way or no booking in it to merge with.
  const mergeTarget=(direction:'left'|'right'):Booking|null=>{
    if(!venue||!draft)return null;
    const toMinutes=(t:string)=>{const m=/^(\d{1,2}):(\d{2})/.exec(t);return m?Number(m[1])*60+Number(m[2]):0;};
    const roomIds=draft.roomIds&&draft.roomIds.length?draft.roomIds:[draft.roomId];
    const indices=roomIds.map(id=>venue.rooms.findIndex(r=>r.id===id)).filter(i=>i>=0);
    if(!indices.length)return null;
    const targetIndex=direction==='right'?Math.max(...indices)+1:Math.min(...indices)-1;
    if(targetIndex<0||targetIndex>=venue.rooms.length)return null;
    // A strong border is a hard separator, and a fixed wall is too:
    // a manual merge never crosses either one, and the Merge buttons
    // are greyed out next to both.
    if(direction==='right'&&strongAfter[Math.max(...indices)])return null;
    if(direction==='left'&&strongAfter[targetIndex])return null;
    if(direction==='right'&&!wallOperable[Math.max(...indices)])return null;
    if(direction==='left'&&!wallOperable[targetIndex])return null;
    const targetRoom=venue.rooms[targetIndex].id;
    const start=toMinutes(draft.startTime),end=toMinutes(draft.endTime);
    const overlap=(b:Booking)=>{const s=toMinutes(b.startTime),e=toMinutes(b.endTime);return Math.max(0,Math.min(end,e)-Math.max(start,s));};
    const sameTitle=(a:string,b:string)=>a.trim().replace(/\s+/g,' ').toLowerCase()===b.trim().replace(/\s+/g,' ').toLowerCase();
    const candidates=bookings.filter(b=>b.id!==draft.id&&b.date===draft.date&&(b.roomIds||[b.roomId]).includes(targetRoom)&&overlap(b)>0);
    if(!candidates.length)return null;
    const titled=candidates.filter(b=>sameTitle(b.title,draft.title));
    const pool=titled.length?titled:candidates;
    return pool.sort((a,b)=>overlap(b)-overlap(a))[0]||null;
  };
  // Merge this booking with the one in the room immediately to the left
  // or right, as one wide block, even when their titles, times or a
  // strong border would stop the automatic merge. Applies at once: both
  // bookings get the same merge group, and the draft is updated to match
  // so saving does not undo it. Unmerge splits the whole group apart.
  const mergeNeighbour=(direction:'left'|'right')=>{
    if(!draft)return;
    const target=mergeTarget(direction);
    if(!target){setMergeMessage(`No booking in the room to the ${direction} to merge with.`);return;}
    const group=draft.mergeGroup||crypto.randomUUID();
    onBookingsChange(bookings.map(b=>b.id===draft.id||b.id===target.id?{...b,mergeGroup:group}:b));
    setDraft({...draft,mergeGroup:group});
    setMergeMessage(`Merged with “${target.title}”.`);
  };
  const unmergeGroup=()=>{
    if(!draft||!draft.mergeGroup)return;
    const group=draft.mergeGroup;
    onBookingsChange(bookings.map(b=>b.mergeGroup===group?{...b,mergeGroup:undefined}:b));
    setDraft({...draft,mergeGroup:undefined});
    setMergeMessage('Unmerged.');
  };
  useLayoutEffect(()=>{
    const parent=root.current?.parentElement;if(!parent||!venue)return;
    const measure=()=>{const day=Math.max(1,(parent.clientHeight-(header.current?.offsetHeight||0))/7);const availableWidth=Math.max(0,parent.clientWidth-160);setSize(old=>old.day===day&&old.availableWidth===availableWidth?old:{day,availableWidth});};
    measure();const observer=new ResizeObserver(measure);observer.observe(parent);if(header.current)observer.observe(header.current);return()=>observer.disconnect();
  },[venue]);
  if(!venue)return <div className="empty-state">Open Configuration to load a venue YAML file.</div>;
  const baseWidths=venue.rooms.map((_,i)=>Math.max(roomWidthMin,roomBaseWidths?.[i]||150));
  const total=baseWidths.reduce((sum,width)=>sum+width,0);
  const scale=Math.max(1,size.availableWidth/Math.max(1,total));
  const widths=baseWidths.map(width=>width*scale);
  const blocks=blocksFor(bookings,venue,salespeople,editingEnabled||showHidden,roomBorders,operableWalls,randomEventColours);
  const strongAfter=strongBorders(venue.rooms.map(r=>r.id),roomBorders);
  const wallOperable=operableWallAfter(venue.rooms.map(r=>r.id),operableWalls);
  const segments=blocks.flatMap(b=>blockSegments(b).map(s=>({block:b,...s})));
  const sourceDates=[...new Set(segments.map(s=>s.date))].sort();
  const dates=sourceDates.length?eachDayOfInterval({start:parseISO(sourceDates[0]),end:parseISO(sourceDates[sourceDates.length-1])}).map(d=>format(d,'yyyy-MM-dd')):[];
  const columns=`160px ${widths.map(width=>`${width}px`).join(' ')}`;
  const style={'--columns':columns,'--day-height':`${size.day}px`,width:160+widths.reduce((sum,width)=>sum+width,0)} as CSSProperties;
  const roomFontSizes=roomNameFontSizes(venue.rooms.map(r=>r.name),widths);
  const today=format(new Date(),'yyyy-MM-dd');
  // The salesperson filter's focus window starts at the previous day:
  // only the filtered salesperson's blocks from yesterday onward stay
  // full; older blocks dim too, even when they are that person's.
  const yesterday=format(addDays(parseISO(today),-1),'yyyy-MM-dd');
  // The job number field shows the number for the block the inspector
  // was opened from. Writing it sets that block's rooms: the booking's
  // own number when the booking is in one room, a per-room number when
  // it is in several. Clearing a room's number drops its override, so
  // the room falls back to the booking's number.
  const setRoomJobNumber=(room:string,value:string)=>{
    if(!draft)return;
    const jobNumbers={...(draft.jobNumbers||{})};
    if(value)jobNumbers[room]=value;else delete jobNumbers[room];
    setDraft({...draft,jobNumbers});
  };
  // Setting the job number. The optional salesperson is set in the same
  // draft update, so selecting a job never clobbers the number (or the
  // salesperson) with a stale draft — both land in one setDraft.
  const setJobField=(value:string, salesperson?:Salesperson)=>{
    if(!draft)return;
    const base={...draft,...(salesperson?{salespersonId:salesperson.id,colour:salesperson.colour}:{})};
    if((draft.roomIds?.length||0)<=1){setDraft({...base,jobNumber:value});return;}
    const jobNumbers={...(draft.jobNumbers||{})};
    for(const room of inspectorRooms){if(value)jobNumbers[room]=value;else delete jobNumbers[room];}
    setDraft({...base,jobNumbers});
  };
  // Selecting a job from Possible jobs sets the job number and, when
  // the job's salesperson matches someone in the palette, that
  // salesperson too. The same name matching as the ✓, so a ticked
  // candidate always resolves; a job with no salesperson, or one the
  // palette does not have, leaves the salesperson alone.
  const selectJob=(c:JobCandidate)=>{
    setJobField(c.job.orderId,jobSalesperson(c.job,salespeople));
  };
  const jobField=draft?((inspectorRooms.length?blockJobNumber(draft,inspectorRooms):draft.jobNumber)||''):'';
  // Possible jobs for the booking being edited: the jobs list filtered
  // to this booking's title and dates, best first, with the
  // salesperson lifting a match. Recomputed from the draft, so picking
  // a salesperson in the inspector re-ranks the list.
  const draftSalespersonName=draft?resolveSalesperson(salespeople,draft.salespersonId)?.name:undefined;
  const jobCandidates=draft?findJobCandidates(jobs,draft,draftSalespersonName):[];  const jobNumberInvalid=!!draft&&[jobField,...Object.values(draft.jobNumbers||{}),...Object.values(relatedJobNumbers)].some(v=>!!v&&!/^\d+$/.test(v.trim())&&!isNoAv(v));
  // Related bookings: the same event on other days, or in other rooms
  // as its own booking. Bookings in this block are left out — they
  // share the block's number already. Staged here until Save.
  const inspectorBlock=draft?blocks.find(b=>b.ids.includes(draft.id)):undefined;
  const related=draft?relatedBookings(bookings,draft.title,draft.id).filter(b=>!(inspectorBlock&&inspectorBlock.ids.includes(b.id))):[];
  const setRelatedJobNumber=(id:string,value:string)=>{setRelatedJobNumbers(current=>({...current,[id]:value}));};
  // The colour swatch beside the salesperson dropdown shows what the
  // block will look like: the event colour while random colours are on.
  const draftColour=draft?(draft.unavailable||isNoAv(jobField)?bookingColour({...draft,jobNumber:jobField||undefined},salespeople):randomEventColours?eventColour(draft.title):bookingColour({...draft,jobNumber:jobField||undefined},salespeople)):undefined;
  // Merge left / Merge right are greyed out when the room beside this
  // booking is across a strong border or a fixed wall (or there is no
  // room that way): a strong border is a hard separator, and merging
  // is only allowed over an operable wall, so a manual merge cannot
  // cross either one.
  const draftRoomIndices=draft?((draft.roomIds&&draft.roomIds.length?draft.roomIds:[draft.roomId]).map(id=>venue.rooms.findIndex(r=>r.id===id)).filter(i=>i>=0)):[];
  const mergeLeftBlocked=!draftRoomIndices.length||Math.min(...draftRoomIndices)===0||!!strongAfter[Math.min(...draftRoomIndices)-1]||!wallOperable[Math.min(...draftRoomIndices)-1];
  const mergeRightBlocked=!draftRoomIndices.length||Math.max(...draftRoomIndices)>=venue.rooms.length-1||!!strongAfter[Math.max(...draftRoomIndices)]||!wallOperable[Math.max(...draftRoomIndices)];
  const mergeLeftTitle=!draftRoomIndices.length||Math.min(...draftRoomIndices)===0?undefined:strongAfter[Math.min(...draftRoomIndices)-1]?'A strong border separates this room from the one to the left.':'The wall between these rooms is not operable, so they cannot merge.';
  const mergeRightTitle=!draftRoomIndices.length||Math.max(...draftRoomIndices)>=venue.rooms.length-1?undefined:strongAfter[Math.max(...draftRoomIndices)]?'A strong border separates this room from the one to the right.':'The wall between these rooms is not operable, so they cannot merge.';
  // The date labels share one fitted size that fills the 160px date
  // column, the same way the room names fill theirs.
  const dateFontSizesValue=dateFontSizes(dates.map(d=>format(parseISO(d),'EEE dd MMM')),160);
  // Snap to today: scroll so today's row (or the next date after it,
  // when today is not on the board) sits just below the sticky header.
  // This is what the Today button calls, and what the board does on
  // load. The Today button scrolls smoothly; the initial load jumps
  // straight there, so the board does not animate down on every load.
  const scrollToToday=(smooth=true)=>{
    const target=dates.find(d=>d>=today)??dates[dates.length-1];
    if(!target)return;
    const container=root.current?.parentElement;
    if(!container)return;
    const row=root.current?.querySelector(`[data-date="${target}"]`) as HTMLElement|null;
    if(!row)return;
    const headerHeight=header.current?.offsetHeight||0;
    const top=row.offsetTop-headerHeight;
    if(smooth)container.scrollTo({top,behavior:'smooth'});
    else container.scrollTop=top;
  };
  useLayoutEffect(()=>{ if(scrollToTodayRef)scrollToTodayRef.current=()=>scrollToToday(true); });
  // The board opens scrolled to the current day: on load, and whenever
  // a new import changes the date range. It only runs when the range
  // changes, so resizing or editing a booking never yanks the scroll
  // position.
  const scrolledRangeRef=useRef<string>('');
  useLayoutEffect(()=>{
    if(!dates.length)return;
    const rangeKey=`${dates[0]}|${dates[dates.length-1]}`;
    if(scrolledRangeRef.current===rangeKey)return;
    scrolledRangeRef.current=rangeKey;
    scrollToToday(false);
  },[dates[0],dates[dates.length-1],today]);
  return <div className="booking-grid" ref={root} style={style}>
    <div className="grid-header" ref={header} style={{gridTemplateColumns:columns}}><div className="corner group-edge">Date / time</div>{venue.rooms.map((r,i)=><div className={`room-header${strongAfter[i]?' group-edge':''}`} key={r.id} data-room={r.id} style={{fontSize:roomFontSizes[i]}}>{r.name}</div>)}</div>
    {!dates.length&&<div className="empty-state">Load a booking file to display bookings.</div>}
    {dates.map((date,dateIndex)=><div className={`grid-row${date===today?' today':''}`} key={date} data-date={date} style={{gridTemplateColumns:columns}}>
      <div className={`date-cell ${dayKind(date, today)} group-edge day-edge`}><div className="date-label" style={{fontSize:dateFontSizesValue[dateIndex]}}>{format(parseISO(date),'EEE dd MMM')}</div></div>
      {venue.rooms.map((r,i)=><div className={`room-cell${strongAfter[i]?' group-edge':''} day-edge`} key={r.id}/>)}
      {segments.filter(s=>s.date===date).map(({block:b,start,end,continuation})=><div key={JSON.stringify([b.date,b.title,b.rooms,b.ids])} className={`booking-block ${editingEnabled?'editable':'locked'}${selectedBookingId&&b.ids.includes(selectedBookingId)?' selected':''}${paintMode?' painting':''}`} style={{gridColumn:`${b.rooms[0]+2} / ${b.rooms[b.rooms.length-1]+3}`,gridRow:1,...laneInsets(b,strongAfter),top:timeFraction(start)*size.day,height:Math.max(1,(timeFraction(end)-timeFraction(start))*size.day),backgroundColor:b.unavailable?'#9aa0a6':(b.colour||'var(--paper)'),opacity:filterSalespersonId?(b.salespersonId===filterSalespersonId&&b.date>=yesterday?(b.hidden?0.45:undefined):0.25):(b.hidden?0.45:undefined),borderStyle:b.hidden?'dashed':undefined,zIndex:draft&&b.ids.includes(draft.id)?3001:undefined,cursor:paintMode?'copy':undefined}} title={[b.title,`${b.date} ${clock(b.mainStart)}–${clock(b.mainEnd)}`,...b.facts].join('\n')} onClick={()=>{
          if(draft)return;
          // Paint mode: a click paints the block instead of opening it.
          // It works in editor role even while the board is locked, so
          // colour-coding is one click, not unlock-then-click.
          if(paintMode){paintBlock(b,paintSalespersonId,paintApplyAll);return;}
          if(editingEnabled){const booking=bookings.find(item=>item.id===b.ids[0]);if(booking)openInspector(booking,b.rooms.map(i=>venue.rooms[i].id));}
        }}>
        <div className="booking-facts" style={{backgroundColor:b.unavailable?(b.salespersonColour||'#9aa0a6'):(b.colour||undefined)}}>{b.facts.filter(t=>/setup/i.test(t)).map(t=><div key={t}>{firstTime(t)}</div>)}<div>{clock(b.mainStart).slice(0,5)}</div><div>{clock(b.mainEnd).slice(0,5)}</div>{b.facts.filter(t=>!/setup/i.test(t)).map(t=><div key={t}>{firstTime(t)}</div>)}</div>
        <FitTitle text={[b.title,[b.initials,b.jobNumber].filter(Boolean).join(' ')].filter(Boolean).join(' | ') + (b.hidden ? ' — hidden' : '')} />
        {continuation&&<span style={{position:'absolute',right:2,bottom:0,fontSize:8,pointerEvents:'none'}}>continued</span>}
      </div>)}
    </div>)}
    {draft&&(
      <>
        <div className="inspector-overlay" onClick={closeInspector} />
        <section className="inspector-panel" aria-label="Booking details">
          <header><h3>Booking details</h3><button onClick={closeInspector}>Close</button></header>
          <label>Title<input value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label>
          <div style={{display:'flex',alignItems:'flex-end'}}>
            <label style={{flex:1,paddingRight:0}}>Job number<input value={jobField} onChange={event=>setJobField(event.target.value)}/></label>
            <label className="checkbox" style={{paddingLeft:12}}><input type="checkbox" checked={isNoAv(jobField)} onChange={event=>setJobField(event.target.checked?'NO AV':'')}/>NO AV</label>
          </div>
          {jobs.length>0&&(
            <div style={{margin:'0 20px 10px'}}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:6}}>Possible jobs</div>
              {jobCandidates.length===0?(
                <p style={{fontSize:13,margin:0,color:'#666'}}>No jobs in the list match this booking.</p>
              ):(
                <div style={{maxHeight:180,overflow:'auto',border:'1px solid #d9d9d9',borderRadius:7,padding:'8px 10px'}}>
                  {jobCandidates.map(c=>{
                    const selected=normalizeJobNumber(jobField)===normalizeJobNumber(c.job.orderId);
                    const start=format(parseISO(c.job.startDate),'d MMM');
                    const end=format(parseISO(c.job.endDate),'d MMM');
                    return (
                      <div key={c.job.orderId} style={{display:'flex',alignItems:'flex-start',gap:8,marginBottom:6,padding:'4px 6px',borderRadius:5,background:selected?'#eef4fb':undefined}}>
                        <span style={{flex:1,minWidth:0}}>
                          <span style={{fontSize:13}}><strong>{c.job.orderId}</strong>{c.job.area?` · ${c.job.area}`:''}</span>
                          <span style={{display:'block',fontSize:12,color:'#555',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={`${c.job.description}${c.job.salesPerson?` — ${c.job.salesPerson}`:''} — ${c.job.startDate} to ${c.job.endDate}`}>
                            {c.job.event}{c.job.salesPerson?` — ${c.job.salesPerson}`:''}{c.salesPersonMatch?' ✓':''}{c.dateOffset!==0?` · job ${start}${start===end?'':`–${end}`}`:''}
                          </span>
                        </span>
                        <button onClick={()=>selectJob(c)} disabled={selected} style={{flexShrink:0}}>{selected?'Selected':'Select'}</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {jobs.length===0&&(
            <p style={{margin:'0 20px 10px',fontSize:13,color:'#666'}}>No jobs list imported — use 📋 Jobs in the top bar to import one, and possible matches will show here.</p>
          )}
          {(draft.roomIds?.length||0)>1&&(
            <div style={{margin:'0 20px 10px',maxHeight:180,overflow:'auto',border:'1px solid #d9d9d9',borderRadius:7,padding:'8px 10px'}}>
              {(draft.roomIds||[]).map(roomId=>{
                const name=venue?.rooms.find(r=>r.id===roomId)?.name||roomId;
                const value=draft.jobNumbers?.[roomId]??draft.jobNumber??'';
                return <div key={roomId} style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                  <span style={{flex:1,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{name}</span>
                  <input aria-label={`Job number for ${name}`} value={value} onChange={event=>setRoomJobNumber(roomId,event.target.value)} style={{width:110}} />
                  <label className="checkbox" style={{padding:0}}><input type="checkbox" aria-label={`NO AV for ${name}`} checked={isNoAv(value)} onChange={event=>setRoomJobNumber(roomId,event.target.checked?'NO AV':'')}/>NO AV</label>
                </div>;
              })}
            </div>
          )}
          {related.length>0&&(
            <details style={{margin:'0 20px 10px'}}>
              <summary style={{fontSize:13,cursor:'pointer'}}>Related bookings ({related.length})</summary>
              <div style={{maxHeight:180,overflow:'auto',border:'1px solid #d9d9d9',borderRadius:7,padding:'8px 10px',marginTop:6}}>
                {related.map(b=>{
                  const value=relatedJobNumbers[b.id]??b.jobNumber??'';
                  const roomNames=(b.roomIds&&b.roomIds.length?b.roomIds:[b.roomId]).map(id=>venue?.rooms.find(r=>r.id===id)?.name||id).join(', ');
                  return <div key={b.id} style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                    <span style={{flex:1,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={`${b.title} — ${roomNames}`}>{format(parseISO(b.date),'EEE d MMM yyyy')} · {roomNames}</span>
                    <input aria-label={`Job number for ${b.title} on ${b.date}`} value={value} onChange={event=>setRelatedJobNumber(b.id,event.target.value)} style={{width:110}} />
                    <label className="checkbox" style={{padding:0}}><input type="checkbox" aria-label={`NO AV for ${b.title} on ${b.date}`} checked={isNoAv(value)} onChange={event=>setRelatedJobNumber(b.id,event.target.checked?'NO AV':'')}/>NO AV</label>
                  </div>;
                })}
              </div>
            </details>
          )}
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
              <span style={{display:'inline-block',width:60,height:24,border:'1px solid #18202a',background:draftColour||'#e7e1d8'}} aria-label={draftColour||'no colour'} />
            </span>
          </label>
          <label className="checkbox"><input type="checkbox" checked={draft.unavailable===true||draft.salespersonId===UNAVAILABLE_SALESPERSON.id} onChange={event=>{const on=event.target.checked;setDraft({...draft,unavailable:on,salespersonId:draft.salespersonId===UNAVAILABLE_SALESPERSON.id?'':draft.salespersonId});}}/>Unavailable</label>
          <label className="checkbox"><input type="checkbox" checked={isBlockHidden(draft,inspectorRooms)} onChange={event=>setDraft(setBlockHidden(draft,inspectorRooms,event.target.checked))}/>Hide from board</label>
          {(draft.roomIds?.length||0)>1&&<label className="checkbox"><input type="checkbox" checked={draft.hidden===true} onChange={event=>setDraft({...draft,hidden:event.target.checked,hiddenRooms:event.target.checked?[]:draft.hiddenRooms})}/>Hide in all {draft.roomIds?.length} rooms</label>}
          <label className="checkbox"><input type="checkbox" checked={draft.mergeTime!==false} onChange={event=>setDraft({...draft,mergeTime:event.target.checked})}/>Merge with the same booking at other times</label>
          <label className="checkbox"><input type="checkbox" checked={draft.mergeRoom!==false} onChange={event=>setDraft({...draft,mergeRoom:event.target.checked})}/>Merge with the same booking in other rooms</label>
          <div style={{margin:'0 20px 10px',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
            <span style={{fontSize:13}}>Merge with the next room:</span>
            <button onClick={()=>mergeNeighbour('left')} disabled={mergeLeftBlocked} title={mergeLeftBlocked?mergeLeftTitle:undefined}>Merge left</button>
            <button onClick={()=>mergeNeighbour('right')} disabled={mergeRightBlocked} title={mergeRightBlocked?mergeRightTitle:undefined}>Merge right</button>
            {draft.mergeGroup&&<button onClick={unmergeGroup}>Unmerge</button>}
          </div>
          {mergeMessage&&<p style={{margin:'0 20px 10px',fontSize:13}}>{mergeMessage}</p>}
          {applyAllPrompt&&(
            <div style={{margin:'0 20px 10px',padding:'12px',border:'1px solid #1d4e89',borderRadius:7,background:'#eef4fb',fontSize:13}}>
              <p style={{margin:'0 0 10px'}}>{applyAllPrompt.name} is also on {applyAllPrompt.likeBlockCount} other booking{applyAllPrompt.likeBlockCount===1?'':'s'} titled “{draft.title}”. Apply {applyAllPrompt.name} to all of them?</p>
              <div style={{display:'flex',gap:8}}>
                <button className="primary" onClick={()=>commitSave(true)}>Apply to all {applyAllPrompt.likeBlockCount+1}</button>
                <button onClick={()=>commitSave(false)}>Just this one</button>
              </div>
            </div>
          )}
          <footer><button onClick={closeInspector}>Cancel</button><button className="primary" onClick={saveInspector} disabled={jobNumberInvalid||!!applyAllPrompt}>Save booking</button></footer>
        </section>
      </>
    )}
  </div>;
}
