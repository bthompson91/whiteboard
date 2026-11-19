import yaml from 'js-yaml';
import { parseVenueConfig } from './venueConfig';

export type RoomType = 'large' | 'small' | 'other';
export interface Salesperson { id:string; name:string; colour:string }
export interface BoardSettings { room_types:Record<string,RoomType>; room_widths:Record<RoomType,number>; salespeople:Salesperson[] }
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
  if(d.rooms.exclude!==undefined&&!strings(d.rooms.exclude))throw new Error('rooms.exclude must be a list of room names.');
  for(const key of ['room_aliases','room_mappings'])if(d.rooms[key]!==undefined&&(!object(d.rooms[key])||!Object.values(d.rooms[key]).every(strings)))throw new Error(`rooms.${key} must map names to lists of names.`);
  if(d.timeline_items!==undefined&&!strings(d.timeline_items))throw new Error('timeline_items must be a text list.');
  if(d.display!==undefined&&!object(d.display))throw new Error('display must be a mapping.');
  if(d.display?.allowed_statuses!==undefined&&!strings(d.display.allowed_statuses))throw new Error('display.allowed_statuses must be a text list.');
  if(d.whiteboard!==undefined&&!object(d.whiteboard))throw new Error('whiteboard must be a mapping.');
  const w=d.whiteboard||{};
  if(w.room_types!==undefined&&(!object(w.room_types)||!Object.values(w.room_types).every(t=>['large','small','other'].includes(String(t)))))throw new Error('Room types must be large, small or other.');
  if(w.room_widths!==undefined&&!object(w.room_widths))throw new Error('Room widths must be a mapping.');
  for(const t of ['large','small','other']){const n=w.room_widths?.[t];if(n!==undefined&&(typeof n!=='number'||!Number.isFinite(n)||n<150||n>600))throw new Error('Room widths must be numbers from 150 to 600 pixels.');}
  if(w.salespeople!==undefined){
    if(!Array.isArray(w.salespeople))throw new Error('Salespeople must be a list.');
    const ids=new Set<string>();
    for(const p of w.salespeople){if(!object(p)||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.name!=='string'||(strict&&!p.name.trim())||typeof p.colour!=='string'||!/^#[0-9a-f]{6}$/i.test(p.colour))throw new Error('Each salesperson needs a unique ID, a name and a six-digit hex colour.');ids.add(p.id);}
  }
  parseVenueConfig(text);
  return d;
}
export function boardSettings(d:ConfigDocument):BoardSettings {
  const w=d.whiteboard||{};
  return {room_types:{...(w.room_types||{})},room_widths:{large:200,small:150,other:175,...(w.room_widths||{})},salespeople:(w.salespeople||[]).map((p:Salesperson)=>({...p}))};
}
export function writeConfiguration(d:ConfigDocument):string { return yaml.dump(d,{noRefs:true,lineWidth:120,sortKeys:false}); }
export const starterConfiguration=writeConfiguration({site:{name:'New venue'},fields:{booking_name:'Booking: Booking Post As',activity_name:'Booking Event: Name',event_date:'Start Date',start_time:'Start Time 24 Hour',end_time:'End Time 24 Hour',room_name:'Function Room',booking_status:'Booking: Status'},display:{primary_label:'booking_name',secondary_label:'activity_name',allowed_statuses:['Definite']},rooms:{order:['Room 1'],exclude:[],room_aliases:{},room_mappings:{}},timeline_items:['Setup','Teardown'],whiteboard:{room_types:{'Room 1':'other'},room_widths:{large:200,small:150,other:175},salespeople:[]}});
