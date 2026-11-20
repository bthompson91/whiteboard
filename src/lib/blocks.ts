import type { Booking } from '../types';
import type { BoardBooking } from './bookingImport';
import type { ParsedVenueConfig } from './venueConfig';
import type { Salesperson } from './configuration';
import { bookingColour, isNoAv, resolveSalesperson, salespersonInitials, UNAVAILABLE_SALESPERSON } from './configuration';

export interface Block { date:string; title:string; ids:string[]; rooms:number[]; start:number; end:number; mainStart:number; mainEnd:number; facts:string[]; jobNumber?:string; colour?:string; salespersonColour?:string; initials?:string; unavailable?:boolean; hidden?:boolean; mergeRoom:boolean; mergeGroup?:string }
function minutes(s:string) { const m=/^(\d{1,2}):(\d{2})/.exec(s); return m?Number(m[1])*60+Number(m[2]):0; }
function range(start:string,end:string) { const a=minutes(start),b=minutes(end); return [a,b<a?b+1440:b]; }
export function clock(n:number) { return `${String(Math.floor(n/60)%24).padStart(2,'0')}:${String(n%60).padStart(2,'0')}${n>=1440?' (+1 day)':''}`; }

// The largest font size that fits every text in its own width. Each
// text is measured at a reference size and scaled to its available
// width; the smallest fitting size across all of them wins, so the
// tightest one decides the size for all of them (the room names are
// normalised this way, so the shortest/narrowest room sets the size).
export function fitFontSize(textWidths: number[], availableWidths: number[], refSize = 13, maxSize = 24, minSize = 8): number {
  let size = maxSize;
  for (let i = 0; i < textWidths.length; i++) {
    if (textWidths[i] <= 0) continue;
    size = Math.min(size, refSize * (Math.max(1, availableWidths[i]) / textWidths[i]));
  }
  return Math.max(minSize, Math.min(maxSize, Math.floor(size)));
}

// Fraction of the day's height for a minute of the day. 00:00–06:00 is
// compressed to 75% height per hour so daytime bookings read bigger:
// the 6 night hours take 4.5 units, the 18 day hours take 18 units,
// 22.5 units total. A day hour is 1/22.5 of the day height, a night
// hour 1/30.
export function timeFraction(minutesOfDay: number): number {
  const m = Math.max(0, Math.min(1440, minutesOfDay));
  if (m <= 360) return m / 1800;
  return (4.5 + (m - 360) / 60) / 22.5;
}

// Which room columns get a strong vertical divider after them: exactly
// the rooms named in the list, so a border is placed after a room rather
// than around a named group of rooms. The date column always gets one —
// it separates the dates from the rooms, like the strong line in the
// Encore sheet.
export function strongBorders(roomIds: string[], borders: string[]): boolean[] {
  const wanted = new Set(borders.map(b => b.trim().toLowerCase()).filter(Boolean));
  return roomIds.map(id => wanted.has(id.trim().toLowerCase()));
}

// Bookings with the exact same title as the given one (any room, any
// day), excluding the booking itself: the "like bookings" a colour can
// be applied to as a group. Only those whose salesperson differs from
// the one being applied are returned, so the count is the bookings
// that would actually change.
export function likeBookings(bookings: Booking[], title: string, excludeId: string, salespersonId?: string): Booking[] {
  return bookings.filter(b => b.id !== excludeId && b.title === title && b.salespersonId !== salespersonId);
}

// How many blocks a set of bookings renders as. Bookings that merge
// into one block (a Setup, a Dinner and a Crew Meals for one event, or
// the same event in rooms next to each other) count as one, because
// that is what the board shows. Used by the apply-to-all prompt, so it
// counts the blocks the user sees, not the rows behind them. A booking
// that is not in any block (hidden, board locked) counts as itself.
export function blockCountForBookings(blocks: Block[], bookings: Booking[]): number {
  const seen = new Set<string>();
  for (const booking of bookings) {
    const block = blocks.find(b => b.ids.includes(booking.id));
    seen.add(block ? `${block.date}|${block.title}|${block.rooms.join(',')}|${block.ids.join(',')}` : `booking:${booking.id}`);
  }
  return seen.size;
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
// Merging is per booking and manual: a booking with mergeTime false
// never height-merges, and one with mergeRoom false never width-merges,
// so a block keeps its original size unless the user merges it.
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
      // A booking that opted out of merging by time gets its own group
      // (its id in the key), so it never height-merges with like bookings.
      const key=b.mergeTime===false?JSON.stringify([b.date,mergeTitle(b.title),room,b.id]):JSON.stringify([b.date,mergeTitle(b.title),room]);
      const old=groups.get(key);
      if(old){old.ids.push(b.id);old.start=Math.min(old.start,start);old.end=Math.max(old.end,end);old.mainStart=Math.min(old.mainStart,mainStart);old.mainEnd=Math.max(old.mainEnd,mainEnd);old.facts.push(...facts);old.hidden=old.hidden&&!!b.hidden;old.mergeRoom=old.mergeRoom&&b.mergeRoom!==false;if(!old.mergeGroup)old.mergeGroup=b.mergeGroup;if(!old.jobNumber)old.jobNumber=b.jobNumber;}
      else {
        // The initials follow the same booking as the colour: the first
        // booking in the group. An unavailable booking has no salesperson
        // tag, even though it keeps its salesperson assignment. A NO AV
        // booking does keep its tag: it has a salesperson working it,
        // so its initials show alongside NO AV as the job number.
        // salespersonColour is the assigned salesperson's colour even for
        // an unavailable booking (whose block colour is grey): the render
        // uses it for the left strip while the body stays grey.
        const noAv=isNoAv(b.jobNumber);
        const unavailable=!!b.unavailable||b.salespersonId===UNAVAILABLE_SALESPERSON.id||noAv;
        const person=resolveSalesperson(salespeople,b.salespersonId);
        groups.set(key,{date:b.date,title:b.title,ids:[b.id],rooms:[room],start,end,mainStart,mainEnd,facts:[...facts],jobNumber:b.jobNumber,colour:bookingColour(b,salespeople),salespersonColour:person&&person.id!==UNAVAILABLE_SALESPERSON.id?person.colour:undefined,initials:(unavailable&&!noAv)||!person?undefined:salespersonInitials(person),unavailable,hidden:!!b.hidden,mergeRoom:b.mergeRoom!==false,mergeGroup:b.mergeGroup});
      }
    }
  }
  // A width merge joins on the event times, not on the span including
  // setup and teardown: a setup in one room must not stop the event
  // joining across rooms, and the joined block covers both rooms' spans.
  // A manual merge (the same merge group on both bookings) joins
  // regardless of title or times, but never across a strong border:
  // the border is a hard separator, and Merge left / Merge right are
  // greyed out next to one.
  const borderAfter=strongBorders(venue.rooms.map(r=>r.id),borders);
  const spans:Block[]=[];
  for(const b of [...groups.values()].sort((a,c)=>a.rooms[0]-c.rooms[0])) {
    b.ids=[...new Set(b.ids)].sort();b.facts=[...new Set(b.facts)];
    const manualMerge=!!(b.mergeGroup&&b.mergeGroup.length);
    const previous=spans.find(p=>p.date===b.date&&p.rooms[p.rooms.length-1]+1===b.rooms[0]&&!borderAfter[p.rooms[p.rooms.length-1]]&&((manualMerge&&!!p.mergeGroup&&p.mergeGroup===b.mergeGroup)||(mergeTitle(p.title)===mergeTitle(b.title)&&p.mainStart===b.mainStart&&p.mainEnd===b.mainEnd&&p.mergeRoom&&b.mergeRoom)));
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
      previous.mergeRoom=previous.mergeRoom&&b.mergeRoom;
    } else spans.push(b);
  }
  // Blocks render at their exact times: start_time and end_time are
  // hard times on the board. The 2-hour snap used to round them to the
  // nearest frame, which expanded back-to-back blocks into each other
  // — on 1 Dec the AICC (span 10:30-15:00) and the Gala (span
  // 15:00-21:00) share Garden Room 2 and meet at 15:00, exactly
  // halfway between two frames, so the snap rounded the AICC's end up
  // to 16:00 and the Gala's start down to 14:00 and they overlapped
  // 14:00-16:00. The exact times are kept in mainStart/mainEnd and
  // shown in the facts column and the tooltip.
  return spans;
}
