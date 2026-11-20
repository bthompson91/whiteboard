import type { Booking } from '../types';
import type { BoardBooking } from './bookingImport';
import type { ParsedVenueConfig } from './venueConfig';
import type { Salesperson } from './configuration';
import { bookingColour } from './configuration';

export interface Block { date:string; title:string; ids:string[]; rooms:number[]; start:number; end:number; mainStart:number; mainEnd:number; facts:string[]; jobNumber?:string; colour?:string; hidden?:boolean }
function minutes(s:string) { const m=/^(\d{1,2}):(\d{2})/.exec(s); return m?Number(m[1])*60+Number(m[2]):0; }
function range(start:string,end:string) { const a=minutes(start),b=minutes(end); return [a,b<a?b+1440:b]; }
export function clock(n:number) { return `${String(Math.floor(n/60)%24).padStart(2,'0')}:${String(n%60).padStart(2,'0')}${n>=1440?' (+1 day)':''}`; }

export interface GroupEdges { strongAfter: boolean[]; dateEdge: boolean }
// Which room columns get a strong vertical divider after them: after the
// last room of each group, and before the first room of a group that does
// not start at the first column. dateEdge marks a strong divider between
// the date column and the first room when the first room is grouped.
export function groupEdges(roomIds: string[], groups: { name: string; rooms: string[] }[]): GroupEdges {
  const strongAfter = roomIds.map(() => false);
  let dateEdge = false;
  for (const group of groups) {
    const indices = group.rooms
      .map(name => roomIds.findIndex(id => id.trim().toLowerCase() === name.trim().toLowerCase()))
      .filter(i => i >= 0)
      .sort((a, b) => a - b);
    if (!indices.length) continue;
    strongAfter[indices[indices.length - 1]] = true;
    if (indices[0] === 0) dateEdge = true;
    else strongAfter[indices[0] - 1] = true;
  }
  return { strongAfter, dateEdge };
}

// Groups bookings into the blocks the grid renders. Bookings with the
// same title in the same room merge into one tall block spanning their
// combined times (a height merge); the same event in adjacent rooms at
// the same time merges into one wide block (a width merge), whether it
// is one booking spanning both rooms or a separate booking per room.
export function blocksFor(bookings:Booking[],venue:ParsedVenueConfig,salespeople:Salesperson[],showHidden:boolean):Block[] {
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
      const key=JSON.stringify([b.date,b.title,room]);
      const old=groups.get(key);
      if(old){old.ids.push(b.id);old.start=Math.min(old.start,start);old.end=Math.max(old.end,end);old.mainStart=Math.min(old.mainStart,mainStart);old.mainEnd=Math.max(old.mainEnd,mainEnd);old.facts.push(...facts);old.hidden=old.hidden&&!!b.hidden;}
      else groups.set(key,{date:b.date,title:b.title,ids:[b.id],rooms:[room],start,end,mainStart,mainEnd,facts:[...facts],jobNumber:b.jobNumber,colour:bookingColour(b,salespeople),hidden:!!b.hidden});
    }
  }
  const spans:Block[]=[];
  for(const b of [...groups.values()].sort((a,c)=>a.rooms[0]-c.rooms[0])) {
    b.ids=[...new Set(b.ids)].sort();b.facts=[...new Set(b.facts)];
    const previous=spans.find(p=>p.date===b.date&&p.title===b.title&&p.start===b.start&&p.end===b.end&&p.rooms[p.rooms.length-1]+1===b.rooms[0]);
    if(previous){
      previous.rooms.push(b.rooms[0]);
      previous.ids=[...new Set([...previous.ids,...b.ids])].sort();
      previous.facts=[...new Set([...previous.facts,...b.facts])];
      previous.mainStart=Math.min(previous.mainStart,b.mainStart);
      previous.mainEnd=Math.max(previous.mainEnd,b.mainEnd);
      previous.jobNumber=previous.jobNumber||b.jobNumber;
      previous.hidden=previous.hidden&&b.hidden;
    } else spans.push(b);
  }
  return spans;
}
