import type { Booking } from '../types';
import type { BoardBooking } from './bookingImport';
import type { ParsedVenueConfig } from './venueConfig';
import type { Salesperson } from './configuration';
import { bookingColour, isNoAv, resolveSalesperson, salespersonInitials, UNAVAILABLE_SALESPERSON } from './configuration';

export interface Block { date:string; title:string; ids:string[]; rooms:number[]; start:number; end:number; mainStart:number; mainEnd:number; facts:string[]; jobNumber?:string; colour?:string; salespersonId?:string; salespersonColour?:string; initials?:string; unavailable?:boolean; hidden?:boolean; mergeRoom:boolean; mergeGroup?:string; lane?:number; laneCount?:number }
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

// A block's per-day segments: a block that runs past midnight is one
// segment per day it touches, so a note or a print row can place it on
// the day it falls on. The same split BookingGrid renders.
export function blockSegments(block: Block): { date: string; start: number; end: number; continuation: boolean }[] {
  const result: { date: string; start: number; end: number; continuation: boolean }[] = [];
  const [y, mo, d] = block.date.split('-').map(Number);
  for (let offset = 0; offset <= Math.floor(Math.max(block.start, block.end - 1) / 1440); offset++) {
    const start = Math.max(0, block.start - offset * 1440);
    const end = Math.min(1440, block.end - offset * 1440);
    if (end >= start) {
      const dt = new Date(y, mo - 1, d + offset);
      const date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      result.push({ date, start, end, continuation: offset > 0 });
    }
  }
  return result;
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

// Which walls between rooms can be opened, so bookings may merge
// across them: exactly the rooms named in the list, where the named
// room is the one above the operable wall. A wall that is not listed
// is fixed, and no merge crosses it — merging is only allowed across
// mergeable rooms, never by guessing from similar titles.
export function operableWallAfter(roomIds: string[], walls: string[]): boolean[] {
  const wanted = new Set(walls.map(b => b.trim().toLowerCase()).filter(Boolean));
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

// Bookings with the same title as the one being edited, for the
// inspector's related list: the same event on other days, or in other
// rooms as its own booking. The booking being edited is excluded.
// Sorted by date, so the list reads in the order the events happen.
export function relatedBookings(bookings: Booking[], title: string, excludeId: string): Booking[] {
  return bookings.filter(b => b.id !== excludeId && b.title === title).sort((a, c) => a.date.localeCompare(c.date) || a.startTime.localeCompare(c.startTime));
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

// Hiding is per room: a booking in several rooms can be hidden in one
// of them and stay on the board in the rest. `hidden` means hidden
// everywhere; `hiddenRooms` names the rooms it is hidden in.
export function isHiddenInRoom(b: Booking, roomId: string): boolean {
  return b.hidden === true || (b.hiddenRooms ?? []).includes(roomId);
}
// Whether a whole block (its rooms) is hidden.
export function isBlockHidden(b: Booking, blockRooms: string[]): boolean {
  return blockRooms.length > 0 && blockRooms.every(r => isHiddenInRoom(b, r));
}
// Hide (or unhide) one block of a booking: the block's rooms join (or
// leave) hiddenRooms. Unhiding one block of a booking hidden everywhere
// keeps the other rooms hidden.
export function setBlockHidden(b: Booking, blockRooms: string[], hide: boolean): Booking {
  const allRooms = b.roomIds && b.roomIds.length ? b.roomIds : [b.roomId];
  if (hide) {
    if (b.hidden === true) return b;
    return { ...b, hiddenRooms: [...new Set([...(b.hiddenRooms ?? []), ...blockRooms])] };
  }
  const remaining = (b.hidden === true ? allRooms : (b.hiddenRooms ?? [])).filter(r => !blockRooms.includes(r));
  return { ...b, hidden: false, hiddenRooms: remaining };
}

// A stable colour for an event name, so all blocks with the same name
// match — the same event in several rooms, or the same title on other
// days. The hash keeps it stable across reloads and re-imports, and the
// pastel lightness keeps the dark block text readable.
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
export function eventColour(title: string): string {
  const key = mergeTitle(title);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return hslToHex((h >>> 0) % 360, 0.65, 0.8);
}

// Groups bookings into the blocks the grid renders. Bookings with the
// same title in the same room merge into one tall block spanning their
// combined times (a height merge); the same event in adjacent rooms at
// the same time merges into one wide block (a width merge), whether it
// is one booking spanning both rooms or a separate booking per room.
// A width merge only crosses a wall that is operable: the rooms named
// in `operableWalls` are the ones above an openable wall, and a merge
// never crosses a fixed wall. Titles must match exactly for a width
// merge — there is no fuzzy matching across rooms, so the same event
// written two ways does not join; the block keeps the first booking's
// title as written. A merge never crosses a strong border either: the
// rooms named in `borders` divide the board, and a block stops at the
// border even when the event continues next door.
// Merging is per booking and manual: a booking with mergeTime false
// never height-merges, and one with mergeRoom false never width-merges,
// so a block keeps its original size unless the user merges it.
// The job number a block shows: the per-room number when one is set
// for a room in the block, else the booking's own number. A wide block
// spanning several rooms is one big room with one event and one job
// number, so when its rooms disagree it shows the booking's number.
export function blockJobNumber(b: Booking, rooms: string[]): string | undefined {
  const values = rooms.map(r => b.jobNumbers?.[r] ?? b.jobNumber);
  if (values.every(v => v === values[0])) return values[0];
  return b.jobNumber ?? values[0];
}

function mergeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}
export function blocksFor(bookings:Booking[],venue:ParsedVenueConfig,salespeople:Salesperson[],showHidden:boolean,borders:string[]=[],operableWalls:string[]=[],randomEventColours=false):Block[] {
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
      // Hidden is per room: a booking in several rooms can be hidden
      // in one of them and stay on the board in the rest — hiding one
      // block must not hide the lot. Hidden bookings are skipped
      // entirely, unless the board is unlocked or Show hidden is on —
      // then they still render (faded, dashed) so they can be opened
      // and made visible again from the inspector.
      const roomHidden=isHiddenInRoom(b,roomId);
      if(roomHidden&&!showHidden)continue;
      // A booking that opted out of merging by time gets its own group
      // (its id in the key), so it never height-merges with like bookings.
      const key=b.mergeTime===false?JSON.stringify([b.date,mergeTitle(b.title),room,b.id]):JSON.stringify([b.date,mergeTitle(b.title),room]);
      const old=groups.get(key);
      if(old){old.ids.push(b.id);old.start=Math.min(old.start,start);old.end=Math.max(old.end,end);old.mainStart=Math.min(old.mainStart,mainStart);old.mainEnd=Math.max(old.mainEnd,mainEnd);old.facts.push(...facts);old.hidden=old.hidden&&roomHidden;old.mergeRoom=old.mergeRoom&&b.mergeRoom!==false;if(!old.mergeGroup)old.mergeGroup=b.mergeGroup;if(!old.jobNumber)old.jobNumber=b.jobNumbers?.[roomId]??b.jobNumber;}
      else {
        // The initials follow the same booking as the colour: the first
        // booking in the group. An unavailable booking has no salesperson
        // tag, even though it keeps its salesperson assignment. A NO AV
        // booking does keep its tag: it has a salesperson working it,
        // so its initials show alongside NO AV as the job number.
        // salespersonColour is the assigned salesperson's colour even for
        // an unavailable booking (whose block colour is grey): the render
        // uses it for the left strip while the body stays grey.
        // The job number is per room: this group is one room of the
        // booking, so it shows that room's number (or the booking's
        // own when the room has none). NO AV is per room too.
        const roomJobNumber=b.jobNumbers?.[roomId]??b.jobNumber;
        const noAv=isNoAv(roomJobNumber);
        const unavailable=!!b.unavailable||b.salespersonId===UNAVAILABLE_SALESPERSON.id||noAv;
        const person=resolveSalesperson(salespeople,b.salespersonId);
        // Random colours per event: every block with the same name gets
        // the same colour, and the salesperson's colour does not apply —
        // the person is still assigned (initials and filter still work),
        // only their colour is set aside. Unavailable stays grey.
        const colour=unavailable?bookingColour({...b,jobNumber:roomJobNumber},salespeople):randomEventColours?eventColour(b.title):bookingColour({...b,jobNumber:roomJobNumber},salespeople);
        const salespersonColour=randomEventColours?undefined:(person&&person.id!==UNAVAILABLE_SALESPERSON.id?person.colour:undefined);
        groups.set(key,{date:b.date,title:b.title,ids:[b.id],rooms:[room],start,end,mainStart,mainEnd,facts:[...facts],jobNumber:roomJobNumber,colour,salespersonId:b.salespersonId,salespersonColour,initials:(unavailable&&!noAv)||!person?undefined:salespersonInitials(person),unavailable,hidden:roomHidden,mergeRoom:b.mergeRoom!==false,mergeGroup:b.mergeGroup});
      }
    }
  }
  // A width merge joins on the event times, not on the span including
  // setup and teardown: a setup in one room must not stop the event
  // joining across rooms, and the joined block covers both rooms' spans.
  // A manual merge (the same merge group on both bookings) joins
  // regardless of title or times, but never across a strong border or
  // a fixed wall: the border is a hard separator, and only an operable
  // wall lets two rooms combine. Merge left / Merge right are greyed
  // out next to either one.
  const borderAfter=strongBorders(venue.rooms.map(r=>r.id),borders);
  const wallOperable=operableWallAfter(venue.rooms.map(r=>r.id),operableWalls);
  const spans:Block[]=[];
  for(const b of [...groups.values()].sort((a,c)=>a.rooms[0]-c.rooms[0])) {
    b.ids=[...new Set(b.ids)].sort();b.facts=[...new Set(b.facts)];
    const manualMerge=!!(b.mergeGroup&&b.mergeGroup.length);
    const previous=spans.find(p=>p.date===b.date&&p.rooms[p.rooms.length-1]+1===b.rooms[0]&&!borderAfter[p.rooms[p.rooms.length-1]]&&wallOperable[p.rooms[p.rooms.length-1]]&&((manualMerge&&!!p.mergeGroup&&p.mergeGroup===b.mergeGroup)||(p.title===b.title&&p.mainStart===b.mainStart&&p.mainEnd===b.mainEnd&&p.mergeRoom&&b.mergeRoom)));
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
  // A block's job number is per room: when one booking spans several
  // rooms and they merge wide, the wide block is one big room with one
  // event and one job number, so it shows the booking's number (see
  // blockJobNumber) — and its grey/NO AV rendering follows that
  // number, not the first room's.
  for (const block of spans) {
    if (block.ids.length !== 1) continue;
    const sole = bookings.find(b => b.id === block.ids[0]);
    if (!sole) continue;
    block.jobNumber = blockJobNumber(sole, block.rooms.map(i => venue.rooms[i].id));
    const noAv = isNoAv(block.jobNumber);
    block.unavailable = !!sole.unavailable || sole.salespersonId === UNAVAILABLE_SALESPERSON.id || noAv;
    const person = resolveSalesperson(salespeople, sole.salespersonId);
    block.colour = block.unavailable ? bookingColour({ ...sole, jobNumber: block.jobNumber }, salespeople) : randomEventColours ? eventColour(block.title) : bookingColour({ ...sole, jobNumber: block.jobNumber }, salespeople);
    block.initials = (block.unavailable && !noAv) || !person ? undefined : salespersonInitials(person);
  }
  assignLanes(spans);
  return spans;
}

// Overlapping blocks in the same room render side-by-side instead of
// on top of each other. Each block gets a lane (its column within the
// overlap) and a laneCount (how many blocks share the room at the
// busiest moment during it). The lanes are assigned per date and room
// by a greedy interval colouring, and the lane count is the maximum
// number of blocks active at once during the block, so a block that
// only ever overlaps one other block takes half the width even when a
// different pair elsewhere in the same room needs three lanes. A
// block in several rooms takes the lane and count from its most
// crowded room. A block that never overlaps keeps no lane and fills
// the full width.
export function assignLanes(blocks: Block[]): void {
  const byDate = new Map<string, Block[]>();
  for (const b of blocks) {
    const list = byDate.get(b.date) || [];
    list.push(b);
    byDate.set(b.date, list);
  }
  for (const dayBlocks of byDate.values()) {
    const byRoom = new Map<number, Block[]>();
    for (const b of dayBlocks) {
      for (const room of b.rooms) {
        const list = byRoom.get(room) || [];
        list.push(b);
        byRoom.set(room, list);
      }
    }
    const best = new Map<Block, { lane: number; laneCount: number }>();
    for (const roomBlocks of byRoom.values()) {
      const sorted = [...roomBlocks].sort((a, c) => a.start - c.start || a.end - c.end);
      // Greedy lane assignment: the lowest lane free at the block's start.
      const laneEnds: number[] = [];
      const laneOf = new Map<Block, number>();
      for (const b of sorted) {
        let lane = laneEnds.findIndex(end => end <= b.start);
        if (lane < 0) { lane = laneEnds.length; laneEnds.push(b.end); }
        else laneEnds[lane] = b.end;
        laneOf.set(b, lane);
      }
      // Lane count: the most blocks active at once during this block.
      // Concurrency only changes at a block's start, so checking the
      // block's own start and the start of every block that begins
      // inside it is enough. A block's lane is always below its count:
      // it only takes lane k when k other blocks are active at its start.
      for (const b of sorted) {
        const times = [b.start, ...sorted.filter(o => o !== b && o.start > b.start && o.start < b.end).map(o => o.start)];
        let count = 1;
        for (const t of times) {
          const active = sorted.filter(o => o.start <= t && t < o.end).length;
          if (active > count) count = active;
        }
        const prev = best.get(b);
        if (!prev || count > prev.laneCount) best.set(b, { lane: laneOf.get(b) ?? 0, laneCount: count });
      }
    }
    for (const [b, v] of best) {
      if (v.laneCount > 1) { b.lane = v.lane; b.laneCount = v.laneCount; }
    }
  }
}
