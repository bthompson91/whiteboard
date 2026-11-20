import type { Booking } from '../types';
import type { BoardBooking } from './bookingImport';
import type { ParsedVenueConfig } from './venueConfig';
import type { Salesperson } from './configuration';
import { bookingColour, resolveSalesperson, salespersonInitials, UNAVAILABLE_SALESPERSON } from './configuration';

export interface Block { date:string; title:string; ids:string[]; rooms:number[]; start:number; end:number; mainStart:number; mainEnd:number; facts:string[]; jobNumber?:string; colour?:string; initials?:string; unavailable?:boolean; hidden?:boolean }
function minutes(s:string) { const m=/^(\d{1,2}):(\d{2})/.exec(s); return m?Number(m[1])*60+Number(m[2]):0; }
function range(start:string,end:string) { const a=minutes(start),b=minutes(end); return [a,b<a?b+1440:b]; }
export function clock(n:number) { return `${String(Math.floor(n/60)%24).padStart(2,'0')}:${String(n%60).padStart(2,'0')}${n>=1440?' (+1 day)':''}`; }

// Which room columns get a strong vertical divider after them: exactly
// the rooms named in the list, so a border is placed after a room rather
// than around a named group of rooms. The date column always gets one —
// it separates the dates from the rooms, like the strong line in the
// Encore sheet.
export function strongBorders(roomIds: string[], borders: string[]): boolean[] {
  const wanted = new Set(borders.map(b => b.trim().toLowerCase()).filter(Boolean));
  return roomIds.map(id => wanted.has(id.trim().toLowerCase()));
}

// Groups bookings into the blocks the grid renders. Bookings with the
// same title in the same room merge into one tall block spanning their
// combined times (a height merge); the same event in adjacent rooms at
// the same time merges into one wide block (a width merge), whether it
// is one booking spanning both rooms or a separate booking per room.
// Titles match loosely for merging (case and spacing are ignored), so
// the same event written two ways in the export still joins; the block
// keeps the first booking's title as written. A merge never crosses a
// strong border: the rooms named in `borders` divide the board, and a
// block stops at the border even when the event continues next door.
function mergeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}
export function blocksFor(bookings:Booking[],venue:ParsedVenueConfig,salespeople:Salesperson[],showHidden:boolean,borders:string[]=[]):Block[] {
  const groups=new Map<string,Block>();
  for(const b of bookings as BoardBooking[]) {
    // Hidden bookings are skipped entirely, unless the board is unlocked —
    // then they still render (faded, dashed) so they can be opened and
    // made visible again from the inspector.
    if(b.hidden&&!showHidden)continue;
    const [mainStart,mainEnd]=range(b.startTime,b.endTime);
    const timeline=(b.timeline||[]).map(t=>({label:t.label,times:range(t.start,t.end)}));
    const start=Math.min(mainStart,...timeline.map(t=>t.times[0]));
    const end=Math.max(mainEnd,...timeline.map(t=>t.times[1]));
    const facts=timeline.map(t=>`${t.label} ${clock(t.times[0])}–${clock(t.times[1])}`);
    for(const roomId of new Set(b.roomIds||[b.roomId])) {
      const room=venue.rooms.findIndex(r=>r.id===roomId);
      if(room<0)continue;
      const key=JSON.stringify([b.date,mergeTitle(b.title),room]);
      const old=groups.get(key);
      if(old){old.ids.push(b.id);old.start=Math.min(old.start,start);old.end=Math.max(old.end,end);old.mainStart=Math.min(old.mainStart,mainStart);old.mainEnd=Math.max(old.mainEnd,mainEnd);old.facts.push(...facts);old.hidden=old.hidden&&!!b.hidden;}
      else {
        // The initials follow the same booking as the colour: the first
        // booking in the group. An unavailable booking has no salesperson
        // tag, even though it keeps its salesperson assignment.
        const unavailable=!!b.unavailable||b.salespersonId===UNAVAILABLE_SALESPERSON.id;
        const person=resolveSalesperson(salespeople,b.salespersonId);
        groups.set(key,{date:b.date,title:b.title,ids:[b.id],rooms:[room],start,end,mainStart,mainEnd,facts:[...facts],jobNumber:b.jobNumber,colour:bookingColour(b,salespeople),initials:unavailable||!person?undefined:salespersonInitials(person.name),unavailable,hidden:!!b.hidden});
      }
    }
  }
  // A width merge joins on the event times, not on the span including
  // setup and teardown: a setup in one room must not stop the event
  // joining across rooms, and the joined block covers both rooms' spans.
  const borderAfter=strongBorders(venue.rooms.map(r=>r.id),borders);
  const spans:Block[]=[];
  for(const b of [...groups.values()].sort((a,c)=>a.rooms[0]-c.rooms[0])) {
    b.ids=[...new Set(b.ids)].sort();b.facts=[...new Set(b.facts)];
    const previous=spans.find(p=>p.date===b.date&&mergeTitle(p.title)===mergeTitle(b.title)&&p.mainStart===b.mainStart&&p.mainEnd===b.mainEnd&&p.rooms[p.rooms.length-1]+1===b.rooms[0]&&!borderAfter[p.rooms[p.rooms.length-1]]);
    if(previous){
      previous.rooms.push(b.rooms[0]);
      previous.ids=[...new Set([...previous.ids,...b.ids])].sort();
      previous.facts=[...new Set([...previous.facts,...b.facts])];
      previous.start=Math.min(previous.start,b.start);
      previous.end=Math.max(previous.end,b.end);
      previous.mainStart=Math.min(previous.mainStart,b.mainStart);
      previous.mainEnd=Math.max(previous.mainEnd,b.mainEnd);
      previous.jobNumber=previous.jobNumber||b.jobNumber;
      previous.hidden=previous.hidden&&b.hidden;
    } else spans.push(b);
  }
  // Blocks render snapped to the nearest 2-hour frame: 18:30-22:12 renders
  // as 18:00-22:00, so blocks line up in general time frames instead of
  // ragged exact times. A tie rounds outward so the block still covers
  // its real span, and a block that would collapse to nothing gets one
  // full frame. The exact times are kept in mainStart/mainEnd and shown
  // in the facts column and the tooltip, so the snap is visual only.
  const SNAP_MINUTES = 120;
  for (const b of spans) {
    const startRemainder = b.start % SNAP_MINUTES;
    b.start = startRemainder <= SNAP_MINUTES / 2 ? b.start - startRemainder : b.start + (SNAP_MINUTES - startRemainder);
    const endRemainder = b.end % SNAP_MINUTES;
    b.end = endRemainder < SNAP_MINUTES / 2 ? b.end - endRemainder : b.end + (SNAP_MINUTES - endRemainder);
    if (b.end <= b.start) b.end = b.start + SNAP_MINUTES;
  }
  return spans;
}
