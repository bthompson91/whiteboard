import yaml from 'js-yaml';
import { parseVenueConfig } from './venueConfig';

export type RoomType = 'large' | 'small' | 'other';
export interface Salesperson { id:string; name:string; colour:string; shortName?:string }
// Built-in grey option for the booking inspector: a booking that is not
// available to sell, shown in grey rather than a salesperson's colour.
export const UNAVAILABLE_SALESPERSON: Salesperson = { id: 'unavailable', name: 'Unavailable', colour: '#9aa0a6' };
// The two-letter tag shown on a block next to the job number. It is the
// salesperson's short name when one is set (so two people who would
// otherwise derive the same initials can be told apart — M Carrasco
// and Cara Coughey would both be "CC"), and otherwise the first
// letters of the first and last names ("Alex Lee" -> "AL"), or the
// first two letters when there is only one name ("Alex" -> "AL").
export function salespersonInitials(person: Salesperson): string {
  const short = person.shortName?.trim();
  if (short) return short.toUpperCase();
  const words = person.name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
export function resolveSalesperson(salespeople: Salesperson[], salespersonId?: string): Salesperson | undefined {
  if (!salespersonId) return undefined;
  if (salespersonId === UNAVAILABLE_SALESPERSON.id) return UNAVAILABLE_SALESPERSON;
  return salespeople.find(person => person.id === salespersonId);
}
// Readable text on a coloured background (white on dark colours, dark
// on light ones). Used for the coloured options in the salesperson
// dropdowns, in the inspector and in the top-bar paint picker.
export function readableText(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 140 ? '#ffffff' : '#18202a';
}
// The colour a booking block shows: its salesperson's current palette
// colour when one is assigned (so recolouring the palette recolours the
// block), otherwise the colour stored on the booking itself.
// A booking whose job number is the marker "NO AV" (no audio-visual):
// it is displayed with NO AV as its job number and renders like an
// unavailable booking with a salesperson (salesperson colour on the
// left strip, grey body).
export function isNoAv(jobNumber?: string): boolean {
  return jobNumber?.trim().toUpperCase() === 'NO AV';
}
export function bookingColour(booking: { colour?: string; salespersonId?: string; unavailable?: boolean; jobNumber?: string }, salespeople: Salesperson[]): string | undefined {
  // Unavailable is its own tick box now, not a salesperson: it always
  // renders grey, whichever salesperson the booking belongs to. A booking
  // whose salespersonId is still the legacy 'unavailable' resolves grey
  // through resolveSalesperson below. A NO AV booking renders grey too.
  if (booking.unavailable || isNoAv(booking.jobNumber)) return UNAVAILABLE_SALESPERSON.colour;
  return resolveSalesperson(salespeople, booking.salespersonId)?.colour ?? booking.colour;
}
export interface BoardSettings { room_types:Record<string,RoomType>; room_widths:Record<RoomType,number>; room_width_min:number; room_width_max:number; salespeople:Salesperson[]; room_borders:string[]; operable_walls:string[] }
export type ConfigDocument = Record<string, any>;
const object = (v:any):boolean => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v:any):boolean => Array.isArray(v) && v.every(x=>typeof x==='string');
export function readConfiguration(text:string, strict=true):ConfigDocument {
  const d=yaml.load(text) as ConfigDocument;
  if(!object(d)||!object(d.rooms)||!strings(d.rooms.order)||!d.rooms.order.length)throw new Error('YAML must contain a non-empty rooms.order list.');
  const names=d.rooms.order as string[];
  if(names.some(n=>!n.trim())||new Set(names.map(n=>n.trim().toLowerCase())).size!==names.length)throw new Error('Room names must be non-empty and unique.');
  if(d.site!==undefined&&(!object(d.site)||typeof d.site.name!=='string'))throw new Error('site.name must be text.');
  if(d.fields!==undefined&&(!object(d.fields)||!Object.values(d.fields).every(v=>typeof v==='string')))throw new Error('fields must map names to text column headers.');
  if(strict&&d.fields!==undefined&&Object.values(d.fields).some(v=>!(v as string).trim()))throw new Error('Field mappings must name a column header; leave a mapping out instead of blank.');
  if(d.file_input!==undefined&&(!object(d.file_input)||(d.file_input.format!==undefined&&typeof d.file_input.format!=='string')||(d.file_input.has_header!==undefined&&typeof d.file_input.has_header!=='boolean')))throw new Error('file_input must map format to text and has_header to true/false.');
  if(d.file_input?.date_format!==undefined&&!['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD'].includes(String(d.file_input.date_format)))throw new Error('file_input.date_format must be DD/MM/YYYY, MM/DD/YYYY or YYYY-MM-DD.');
  if(d.time_slots!==undefined&&(!Array.isArray(d.time_slots)||d.time_slots.some(s=>!object(s)||typeof s.label!=='string'||typeof s.start!=='string'||typeof s.end!=='string')))throw new Error('time_slots must be a list of label/start/end entries.');
  // The original planner's output settings (filename prefix, title,
  // worksheet name, timeline panel) are dead: the board never reads
  // them, and the Configuration page no longer shows them. Drop the
  // key when a config is read, so a YAML that still carries it stops
  // carrying it on the next save instead of erroring on it.
  if ('output' in d) delete d.output;
  if(d.rooms.exclude!==undefined&&!strings(d.rooms.exclude))throw new Error('rooms.exclude must be a list of room names.');
  for(const key of ['room_aliases','room_mappings'])if(d.rooms[key]!==undefined&&(!object(d.rooms[key])||!Object.values(d.rooms[key]).every(strings)))throw new Error(`rooms.${key} must map names to lists of names.`);
  // TimeTarget area name per room: the rostering area the room belongs
  // to, for the TimeTarget import. One area name per room, plain text.
  if(d.rooms.timetarget_areas!==undefined&&(!object(d.rooms.timetarget_areas)||!Object.values(d.rooms.timetarget_areas).every(v=>typeof v==='string')))throw new Error('rooms.timetarget_areas must map room names to TimeTarget area names.');
  if(d.timeline_items!==undefined&&!strings(d.timeline_items))throw new Error('timeline_items must be a text list.');
  if(d.display!==undefined&&!object(d.display))throw new Error('display must be a mapping.');
  if(d.display?.allowed_statuses!==undefined&&!strings(d.display.allowed_statuses))throw new Error('display.allowed_statuses must be a text list.');
  if(d.whiteboard!==undefined&&!object(d.whiteboard))throw new Error('whiteboard must be a mapping.');
  const w=d.whiteboard||{};
  if(w.room_types!==undefined&&(!object(w.room_types)||!Object.values(w.room_types).every(t=>['large','small','other'].includes(String(t)))))throw new Error('Room types must be large, small or other.');
  if(w.room_widths!==undefined&&!object(w.room_widths))throw new Error('Room widths must be a mapping.');
  // The width limits are settable, not hard-coded: a venue can have a
  // room narrower than 125px or wider than 600px. The limits themselves
  // live in the same whiteboard section, defaulting to 125 and 600.
  const widthMin=typeof w.room_width_min==='number'?w.room_width_min:125;
  const widthMax=typeof w.room_width_max==='number'?w.room_width_max:600;
  if(w.room_width_min!==undefined&&(typeof w.room_width_min!=='number'||!Number.isFinite(w.room_width_min)||w.room_width_min<1||w.room_width_min>2000))throw new Error('The minimum room width must be a number from 1 to 2000 pixels.');
  if(w.room_width_max!==undefined&&(typeof w.room_width_max!=='number'||!Number.isFinite(w.room_width_max)||w.room_width_max<1||w.room_width_max>5000))throw new Error('The maximum room width must be a number from 1 to 5000 pixels.');
  if(widthMax<widthMin)throw new Error('The maximum room width must not be less than the minimum.');
  for(const t of ['large','small','other']){const n=w.room_widths?.[t];if(n!==undefined&&(typeof n!=='number'||!Number.isFinite(n)||n<widthMin||n>widthMax))throw new Error(`Room widths must be numbers from ${widthMin} to ${widthMax} pixels.`);}
  if(w.salespeople!==undefined){
    if(!Array.isArray(w.salespeople))throw new Error('Salespeople must be a list.');
    const ids=new Set<string>();
    for(const p of w.salespeople){if(!object(p)||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.name!=='string'||(strict&&!p.name.trim())||typeof p.colour!=='string'||!/^#[0-9a-f]{6}$/i.test(p.colour)||(p.shortName!==undefined&&typeof p.shortName!=='string'))throw new Error('Each salesperson needs a unique ID, a name and a six-digit hex colour.');ids.add(p.id);}
  }
  if(w.room_borders!==undefined){
    if(!Array.isArray(w.room_borders)||!w.room_borders.every((r:unknown)=>typeof r==='string'))throw new Error('Room borders must be a list of room names.');
  }
  // Operable walls: the rooms after which the wall to the next room can
  // be opened, so bookings may merge across them. A wall that is not
  // listed here is fixed, and no merge crosses it. Stored as room
  // names, mirroring room_borders.
  if(w.operable_walls!==undefined){
    if(!Array.isArray(w.operable_walls)||!w.operable_walls.every((r:unknown)=>typeof r==='string'))throw new Error('Operable walls must be a list of room names.');
  }
  parseVenueConfig(text);
  return d;
}
export function boardSettings(d:ConfigDocument):BoardSettings {
  const w=d.whiteboard||{};
  // Room type keys are room names; trim them so a stray space in the
  // YAML cannot silently make a room fall back to Medium and ignore
  // the width set for its type.
  const room_types:Record<string,RoomType>={};
  for(const [k,v] of Object.entries((w.room_types||{}) as Record<string,RoomType>)) {
    const key=k.trim();
    if(key)room_types[key]=v;
  }
  return {room_types,room_widths:{large:200,small:125,other:150,...(w.room_widths||{})},room_width_min:typeof w.room_width_min==='number'?w.room_width_min:125,room_width_max:typeof w.room_width_max==='number'?w.room_width_max:600,salespeople:(w.salespeople||[]).map((p:Salesperson)=>({...p})),room_borders:[...(w.room_borders||[])],operable_walls:[...(w.operable_walls||[])]};
}
export function writeConfiguration(d:ConfigDocument):string { return yaml.dump(d,{noRefs:true,lineWidth:120,sortKeys:false}); }
// Tidy a configuration document before saving: trim stray whitespace
// (export files and hand-edited YAML both carry trailing spaces, e.g.
// "Promenade " as a mapping key) so lookups stop depending on it.
export function normalizeConfigDoc(d:ConfigDocument):ConfigDocument {
  // The original planner's output settings are dead (see
  // readConfiguration); drop the key when the configuration is next saved.
  if ('output' in d) delete d.output;
  const trimList = (v: unknown) => Array.isArray(v) ? v.map(x => typeof x === 'string' ? x.trim() : x).filter(x => typeof x === 'string' && x) : v;
  if (d.site && typeof d.site.name === 'string') d.site.name = d.site.name.trim();
  if (object(d.fields)) for (const k of Object.keys(d.fields)) { const v = d.fields[k]; if (typeof v === 'string') d.fields[k] = v.trim(); }
  if (object(d.rooms)) {
    if (Array.isArray(d.rooms.order)) d.rooms.order = [...new Set((d.rooms.order as unknown[]).map(s => typeof s === 'string' ? s.trim() : s).filter((s): s is string => typeof s === 'string' && !!s))];
    if (Array.isArray(d.rooms.exclude)) d.rooms.exclude = trimList(d.rooms.exclude);
    if (object(d.rooms.timetarget_areas)) {
      const next: Record<string,string> = {};
      for (const [k,v] of Object.entries(d.rooms.timetarget_areas as Record<string, unknown>)) {
        const nk = k.trim();
        if (!nk) continue;
        const nv = typeof v === 'string' ? v.trim() : '';
        if (nv) next[nk] = nv;
      }
      d.rooms.timetarget_areas = next;
    }
    for (const key of ['room_aliases','room_mappings']) if (object(d.rooms[key])) {
      const next: Record<string,string[]> = {};
      for (const [k,v] of Object.entries(d.rooms[key] as Record<string, unknown>)) {
        const nk = k.trim();
        if (!nk) continue;
        next[nk] = Array.isArray(v) ? (v as unknown[]).map(s => typeof s === 'string' ? s.trim() : s).filter((s): s is string => typeof s === 'string' && !!s) : [];
      }
      d.rooms[key] = next;
    }
  }
  if (Array.isArray(d.timeline_items)) d.timeline_items = trimList(d.timeline_items);
  if (object(d.whiteboard)) {
    // room_groups was replaced by a plain list of rooms to put a strong
    // border after; drop the dead key when the configuration is next saved.
    if ('room_groups' in d.whiteboard) delete d.whiteboard.room_groups;
    if (Array.isArray(d.whiteboard.room_borders)) d.whiteboard.room_borders = trimList(d.whiteboard.room_borders);
    if (Array.isArray(d.whiteboard.operable_walls)) d.whiteboard.operable_walls = trimList(d.whiteboard.operable_walls);
  }
  if (object(d.display) && Array.isArray(d.display.allowed_statuses)) d.display.allowed_statuses = trimList(d.display.allowed_statuses);
  if (Array.isArray(d.time_slots)) d.time_slots = d.time_slots.map(s => object(s) ? { ...s, label: typeof s.label === 'string' ? s.label.trim() : s.label, start: typeof s.start === 'string' ? s.start.trim() : s.start, end: typeof s.end === 'string' ? s.end.trim() : s.end } : s);
  return d;
}
// Rename a room everywhere the configuration references it by name:
// the room order, the room-type keys, the strong-border and
// operable-wall lists, the alias and TimeTarget-area keys, the
// combined-room keys and values, and the exclude list. Returns false
// when the new name is blank, unchanged, or already taken by another
// room, so the caller can leave the draft alone. It does not touch
// bookings or markup — the caller follows the rename there, since room
// names are the ids bookings and anchors carry.
export function renameRoomInConfig(d: ConfigDocument, oldName: string, nextName: string): boolean {
  const old = oldName.trim();
  const next = nextName.trim();
  if (!old || !next || old.toLowerCase() === next.toLowerCase()) return false;
  const order = d.rooms?.order as unknown;
  if (!Array.isArray(order)) return false;
  if (!order.some(r => typeof r === 'string' && r.trim().toLowerCase() === old.toLowerCase())) return false;
  if (order.some(r => typeof r === 'string' && r.trim().toLowerCase() === next.toLowerCase())) return false;
  const same = (v: unknown) => typeof v === 'string' && v.trim().toLowerCase() === old.toLowerCase();
  const renameList = (list: unknown) => Array.isArray(list) ? list.map(x => same(x) ? next : x) : list;
  const renameKey = (map: unknown) => {
    if (!object(map)) return map;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(map as Record<string, unknown>)) out[same(k) ? next : k] = v;
    return out;
  };
  d.rooms.order = (order as unknown[]).map(r => same(r) ? next : r);
  if (Array.isArray(d.rooms.exclude)) d.rooms.exclude = renameList(d.rooms.exclude);
  if (object(d.rooms.room_aliases)) d.rooms.room_aliases = renameKey(d.rooms.room_aliases);
  if (object(d.rooms.timetarget_areas)) d.rooms.timetarget_areas = renameKey(d.rooms.timetarget_areas);
  if (object(d.rooms.room_mappings)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d.rooms.room_mappings as Record<string, unknown>)) out[same(k) ? next : k] = renameList(v);
    d.rooms.room_mappings = out;
  }
  if (object(d.whiteboard)) {
    if (object(d.whiteboard.room_types)) d.whiteboard.room_types = renameKey(d.whiteboard.room_types);
    if (Array.isArray(d.whiteboard.room_borders)) d.whiteboard.room_borders = renameList(d.whiteboard.room_borders);
    if (Array.isArray(d.whiteboard.operable_walls)) d.whiteboard.operable_walls = renameList(d.whiteboard.operable_walls);
  }
  return true;
}
export const starterConfiguration=writeConfiguration({site:{name:'New venue'},fields:{booking_name:'Booking: Booking Post As',activity_name:'Booking Event: Name',event_date:'Start Date',start_time:'Start Time 24 Hour',end_time:'End Time 24 Hour',room_name:'Function Room',booking_status:'Booking: Status'},display:{primary_label:'booking_name',secondary_label:'activity_name',allowed_statuses:['Definite']},rooms:{order:['Room 1'],exclude:[],room_aliases:{},room_mappings:{}},timeline_items:['Setup','Teardown'],whiteboard:{room_types:{'Room 1':'other'},room_widths:{large:200,small:125,other:150},salespeople:[],room_borders:[],operable_walls:[]}});
