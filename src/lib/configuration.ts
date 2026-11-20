import yaml from 'js-yaml';
import { parseVenueConfig } from './venueConfig';

export type RoomType = 'large' | 'small' | 'other';
export interface Salesperson { id:string; name:string; colour:string }
// Built-in grey option for the booking inspector: a booking that is not
// available to sell, shown in grey rather than a salesperson's colour.
export const UNAVAILABLE_SALESPERSON: Salesperson = { id: 'unavailable', name: 'Unavailable', colour: '#9aa0a6' };
// The two-letter tag shown on a block next to the job number: the first
// letters of the first and last names ("Alex Lee" -> "AL"), or the first
// two letters when there is only one name ("Alex" -> "AL").
export function salespersonInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
export function resolveSalesperson(salespeople: Salesperson[], salespersonId?: string): Salesperson | undefined {
  if (!salespersonId) return undefined;
  if (salespersonId === UNAVAILABLE_SALESPERSON.id) return UNAVAILABLE_SALESPERSON;
  return salespeople.find(person => person.id === salespersonId);
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
export interface BoardSettings { room_types:Record<string,RoomType>; room_widths:Record<RoomType,number>; salespeople:Salesperson[]; room_borders:string[] }
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
  if(strict&&d.fields!==undefined&&Object.values(d.fields).some(v=>!(v as string).trim()))throw new Error('Field mappings must name a column header; leave job_number out instead of blank.');
  if(d.file_input!==undefined&&(!object(d.file_input)||(d.file_input.format!==undefined&&typeof d.file_input.format!=='string')||(d.file_input.has_header!==undefined&&typeof d.file_input.has_header!=='boolean')))throw new Error('file_input must map format to text and has_header to true/false.');
  if(d.file_input?.date_format!==undefined&&!['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD'].includes(String(d.file_input.date_format)))throw new Error('file_input.date_format must be DD/MM/YYYY, MM/DD/YYYY or YYYY-MM-DD.');
  if(d.time_slots!==undefined&&(!Array.isArray(d.time_slots)||d.time_slots.some(s=>!object(s)||typeof s.label!=='string'||typeof s.start!=='string'||typeof s.end!=='string')))throw new Error('time_slots must be a list of label/start/end entries.');
  if(d.output!==undefined&&(!object(d.output)||['filename_prefix','title','worksheet_name'].some(k=>d.output[k]!==undefined&&typeof d.output[k]!=='string')||(d.output.show_timeline_panel!==undefined&&typeof d.output.show_timeline_panel!=='boolean')))throw new Error('output must map filename_prefix, title and worksheet_name to text and show_timeline_panel to true/false.');
  if(d.rooms.exclude!==undefined&&!strings(d.rooms.exclude))throw new Error('rooms.exclude must be a list of room names.');
  for(const key of ['room_aliases','room_mappings'])if(d.rooms[key]!==undefined&&(!object(d.rooms[key])||!Object.values(d.rooms[key]).every(strings)))throw new Error(`rooms.${key} must map names to lists of names.`);
  if(d.timeline_items!==undefined&&!strings(d.timeline_items))throw new Error('timeline_items must be a text list.');
  if(d.display!==undefined&&!object(d.display))throw new Error('display must be a mapping.');
  if(d.display?.allowed_statuses!==undefined&&!strings(d.display.allowed_statuses))throw new Error('display.allowed_statuses must be a text list.');
  if(d.whiteboard!==undefined&&!object(d.whiteboard))throw new Error('whiteboard must be a mapping.');
  const w=d.whiteboard||{};
  if(w.room_types!==undefined&&(!object(w.room_types)||!Object.values(w.room_types).every(t=>['large','small','other'].includes(String(t)))))throw new Error('Room types must be large, small or other.');
  if(w.room_widths!==undefined&&!object(w.room_widths))throw new Error('Room widths must be a mapping.');
  for(const t of ['large','small','other']){const n=w.room_widths?.[t];if(n!==undefined&&(typeof n!=='number'||!Number.isFinite(n)||n<125||n>600))throw new Error('Room widths must be numbers from 125 to 600 pixels.');}
  if(w.salespeople!==undefined){
    if(!Array.isArray(w.salespeople))throw new Error('Salespeople must be a list.');
    const ids=new Set<string>();
    for(const p of w.salespeople){if(!object(p)||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.name!=='string'||(strict&&!p.name.trim())||typeof p.colour!=='string'||!/^#[0-9a-f]{6}$/i.test(p.colour))throw new Error('Each salesperson needs a unique ID, a name and a six-digit hex colour.');ids.add(p.id);}
  }
  if(w.room_borders!==undefined){
    if(!Array.isArray(w.room_borders)||!w.room_borders.every((r:unknown)=>typeof r==='string'))throw new Error('Room borders must be a list of room names.');
  }
  parseVenueConfig(text);
  return d;
}
export function boardSettings(d:ConfigDocument):BoardSettings {
  const w=d.whiteboard||{};
  return {room_types:{...(w.room_types||{})},room_widths:{large:200,small:125,other:150,...(w.room_widths||{})},salespeople:(w.salespeople||[]).map((p:Salesperson)=>({...p})),room_borders:[...(w.room_borders||[])]};
}
export function writeConfiguration(d:ConfigDocument):string { return yaml.dump(d,{noRefs:true,lineWidth:120,sortKeys:false}); }
// Tidy a configuration document before saving: trim stray whitespace
// (export files and hand-edited YAML both carry trailing spaces, e.g.
// "Promenade " as a mapping key) so lookups stop depending on it.
export function normalizeConfigDoc(d:ConfigDocument):ConfigDocument {
  const trimList = (v: unknown) => Array.isArray(v) ? v.map(x => typeof x === 'string' ? x.trim() : x).filter(x => typeof x === 'string' && x) : v;
  if (d.site && typeof d.site.name === 'string') d.site.name = d.site.name.trim();
  if (object(d.fields)) for (const k of Object.keys(d.fields)) { const v = d.fields[k]; if (typeof v === 'string') d.fields[k] = v.trim(); }
  if (object(d.rooms)) {
    if (Array.isArray(d.rooms.order)) d.rooms.order = [...new Set((d.rooms.order as unknown[]).map(s => typeof s === 'string' ? s.trim() : s).filter((s): s is string => typeof s === 'string' && !!s))];
    if (Array.isArray(d.rooms.exclude)) d.rooms.exclude = trimList(d.rooms.exclude);
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
  }
  if (object(d.display) && Array.isArray(d.display.allowed_statuses)) d.display.allowed_statuses = trimList(d.display.allowed_statuses);
  if (Array.isArray(d.time_slots)) d.time_slots = d.time_slots.map(s => object(s) ? { ...s, label: typeof s.label === 'string' ? s.label.trim() : s.label, start: typeof s.start === 'string' ? s.start.trim() : s.start, end: typeof s.end === 'string' ? s.end.trim() : s.end } : s);
  return d;
}
export const starterConfiguration=writeConfiguration({site:{name:'New venue'},fields:{booking_name:'Booking: Booking Post As',activity_name:'Booking Event: Name',event_date:'Start Date',start_time:'Start Time 24 Hour',end_time:'End Time 24 Hour',room_name:'Function Room',booking_status:'Booking: Status'},display:{primary_label:'booking_name',secondary_label:'activity_name',allowed_statuses:['Definite']},rooms:{order:['Room 1'],exclude:[],room_aliases:{},room_mappings:{}},timeline_items:['Setup','Teardown'],whiteboard:{room_types:{'Room 1':'other'},room_widths:{large:200,small:125,other:150},salespeople:[],room_borders:[]}});
