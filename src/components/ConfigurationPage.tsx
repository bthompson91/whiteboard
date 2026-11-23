import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { boardSettings, ConfigDocument, normalizeConfigDoc, readConfiguration, renameRoomInConfig, RoomType, Salesperson, starterConfiguration, writeConfiguration } from '../lib/configuration';
import '../configuration.css';
interface Props { yamlText:string; hasBookings:boolean; onSave:(text:string, renames?:Record<string,string>)=>void; onClose:()=>void }
const FIELD_KEYS: Array<{ key:string; label:string; optional?:boolean }> = [
  { key:'booking_name', label:'Booking name' },
  { key:'activity_name', label:'Activity / event name' },
  { key:'event_date', label:'Event date' },
  { key:'start_time', label:'Start time' },
  { key:'end_time', label:'End time' },
  { key:'room_name', label:'Room' },
  { key:'booking_status', label:'Booking status' },
  { key:'setup_start', label:'Setup start', optional:true },
  { key:'teardown_end', label:'Teardown end', optional:true }
];
// Job numbers are Encore data, not hotel data: they never come in on
// the venue's export file, so there is no job-number mapping to offer
// here. Job numbers are added to bookings later, in the inspector.
const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
// A width field that commits as you type, so clicking "Apply and save"
// while the field still has focus can never lose the value (the old
// defaultValue + onBlur field only committed when it lost focus). The
// key is the type only: keying it on the value remounted the input on
// every commit, which dropped focus mid-typing and made the Large and
// Small fields look as if they never took. The text syncs from the
// value when it changes from outside (another edit, Apply and save).
function WidthInput({type,value,min,max,onCommit,onInvalid}:{type:RoomType;value:number;min:number;max:number;onCommit:(n:number)=>void;onInvalid:()=>void}){
  const [text,setText]=useState(String(value));
  useEffect(()=>{setText(String(value));},[value]);
  const label=type==='other'?'Medium':type==='small'?'Small':'Large';
  return <label>{label} width (px) <input type="number" min={min} max={max} value={text} onChange={e=>{
    const next=e.target.value;setText(next);
    const n=Number(next);
    if(next.trim()!==''&&Number.isFinite(n)&&n>=min&&n<=max)onCommit(n);
  }} onBlur={()=>{
    const n=Number(text);
    if(text.trim()===''||!Number.isFinite(n)||n<min||n>max){setText(String(value));onInvalid();}
  }} /></label>;
}
// A min/max limit field for the room widths. The limits are settable so
// a venue is not stuck with the 125-600 defaults: a room can be narrower
// or wider than that. Changing a limit re-clamps the three widths to it.
function LimitInput({label,value,min,max,onCommit,onInvalid}:{label:string;value:number;min:number;max:number;onCommit:(n:number)=>void;onInvalid:()=>void}){
  const [text,setText]=useState(String(value));
  useEffect(()=>{setText(String(value));},[value]);
  return <label>{label} (px) <input type="number" min={min} max={max} value={text} onChange={e=>{
    const next=e.target.value;setText(next);
    const n=Number(next);
    if(next.trim()!==''&&Number.isFinite(n)&&n>=min&&n<=max)onCommit(n);
  }} onBlur={()=>{
    const n=Number(text);
    if(text.trim()===''||!Number.isFinite(n)||n<min||n>max){setText(String(value));onInvalid();}
  }} /></label>;
}
// A room-name field that commits on blur (or Enter), not per keystroke:
// the row is keyed by the room name, so committing mid-typing would
// remount the row and drop focus after the first character. A blank or
// unchanged name resets silently; a name another room already has is
// rejected by onRename, which returns false and resets the field.
function RoomNameInput({value,onRename}:{value:string;onRename:(next:string)=>boolean}){
  const [text,setText]=useState(value);
  useEffect(()=>{setText(value);},[value]);
  const commit=()=>{
    const next=text.trim();
    if(next===value||!next){setText(value);return;}
    if(!onRename(next))setText(value);
  };
  return <input aria-label={`Room name for ${value}`} title="Rename this room — every reference in the configuration is renamed with it, and its bookings and notes follow it" value={text} onChange={e=>setText(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}} />;
}
function StringList({ values, onChange, label }: { values:string[]; onChange:(next:string[])=>void; label:string }) {
  return <div>{values.map((value,i)=><div key={i} style={{display:'flex',gap:8,marginBottom:6}}>
    <input aria-label={`${label} ${i+1}`} value={value} onChange={e=>{const next=[...values];next[i]=e.target.value;onChange(next);}} />
    <button onClick={()=>onChange(values.filter((_,j)=>j!==i))}>Remove</button>
  </div>)}
  <button onClick={()=>onChange([...values,''])}>Add</button></div>;
}
// A key -> list editor, with an optional third column: one extra text
// value per row. The Combined rooms section uses it for the TimeTarget
// area of a combined room, so a combination has its own rostering area
// the same way a single room does. Renaming a key moves its extra value
// with it, and removing a row drops it.
function MappingEditor({ map, onChange, keyLabel, valueLabel, extraLabel, extra, onExtraChange }: { map:Record<string,string[]>; onChange:(next:Record<string,string[]>)=>void; keyLabel:string; valueLabel:string; extraLabel?:string; extra?:Record<string,string>; onExtraChange?:(next:Record<string,string>)=>void }) {
  const rows = Object.entries(map);
  const renameExtra = (oldKey: string, newKey: string) => {
    if (!extra || !onExtraChange) return;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(extra)) next[k === oldKey ? newKey : k] = v;
    onExtraChange(next);
  };
  const dropExtra = (key: string) => {
    if (!extra || !onExtraChange) return;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(extra)) if (k !== key) next[k] = v;
    onExtraChange(next);
  };
  return <div>{rows.map(([key,values])=><div key={key} style={{display:'flex',gap:8,marginBottom:6,flexWrap:'wrap'}}>
    <input aria-label={keyLabel} value={key} onChange={e=>{const next:Record<string,string[]>={};for(const [k,v] of rows)next[k===key?e.target.value:k]=v;onChange(next);renameExtra(key,e.target.value);}} />
    <input aria-label={valueLabel} value={values.join(', ')} onChange={e=>{const next:Record<string,string[]>={};for(const [k,v] of rows)next[k]=k===key?e.target.value.split(',').map(s=>s.trim()).filter(Boolean):v;onChange(next);}} />
    {extraLabel && extra && onExtraChange && <input aria-label={`${extraLabel} for ${key}`} placeholder={extraLabel} title={`${extraLabel} for this combined room, for the TimeTarget import`} value={extra[key] || ''} onChange={e=>{const value=e.target.value;const next={...extra};if(value.trim())next[key]=value;else delete next[key];onExtraChange(next);}} />}
    <button onClick={()=>{const next:Record<string,string[]>={};for(const [k,v] of rows)if(k!==key)next[k]=v;onChange(next);dropExtra(key);}}>Remove</button>
  </div>)}
  <button onClick={()=>onChange({ ...map, '': [] })}>Add</button></div>;
}
export default function ConfigurationPage({yamlText,hasBookings,onSave,onClose}:Props){
  const initial=yamlText||starterConfiguration;
  const [text,setText]=useState(initial);
  const [message,setMessage]=useState('');
  const [newRoom,setNewRoom]=useState('');
  // Rooms renamed in this editing session, as old name -> new name, so
  // Apply and save can carry the rename through to bookings and notes
  // (room names are the ids those carry). Chained renames compose:
  // A->B then B->C records A->C.
  const renamesRef=useRef<Record<string,string>>({});
  let doc:ConfigDocument|null=null,validation='';
  try{doc=readConfiguration(text,false);}catch(e){validation=e instanceof Error?e.message:String(e);}
  const settings=doc?boardSettings(doc):null;
  const change=(fn:(d:ConfigDocument)=>void)=>{if(!doc)return;const next=structuredClone(doc);fn(next);setText(writeConfiguration(next));setMessage('');};
  const updateSettings=(fn:(s:ReturnType<typeof boardSettings>)=>void)=>change(d=>{const s=boardSettings(d);fn(s);d.whiteboard={...(d.whiteboard||{}),...s};});
  const importFile=async(e:ChangeEvent<HTMLInputElement>)=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(!file)return;try{const next=await file.text();readConfiguration(next);renamesRef.current={};setText(next);setMessage('YAML loaded into draft. Apply it to update the board.');}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  // Save trims stray whitespace from names and mappings, then validates
  // strictly: an empty field mapping fails here with a message instead of
  // silently dropping every row on the next import.
  const save=()=>{if(!doc)return;try{const next=normalizeConfigDoc(structuredClone(doc));const nextText=writeConfiguration(next);readConfiguration(nextText);onSave(nextText,{...renamesRef.current});renamesRef.current={};}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const exportFile=()=>{try{const d=readConfiguration(text);const blob=new Blob([text],{type:'text/yaml;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${String(d.site?.name||'venue').toLowerCase().replace(/[^a-z0-9]+/g,'_')}.yaml`;document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('Exported this draft. Export does not apply changes to the board.');}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const close=()=>{if(text!==initial&&!window.confirm('Discard unapplied configuration changes?'))return;onClose();};
  const move=(i:number,delta:number)=>change(d=>{const list=d.rooms.order as string[];const j=i+delta;if(j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];});
  const addRoom=()=>{const name=newRoom.trim();if(!name)return;change(d=>{const list=d.rooms.order as string[];if(!list.some(r=>r.toLowerCase()===name.toLowerCase()))list.push(name);});setNewRoom('');};
  const removeRoom=(room:string)=>change(d=>{d.rooms.order=(d.rooms.order as string[]).filter(r=>r!==room);updateSettingsInPlace(d,room);});
  // Rename a room in the draft, recording the rename so Apply and save
  // can carry it through to bookings and notes. A name another room
  // already has is refused with a message and the field resets.
  const renameRoom=(oldName:string,nextName:string):boolean=>{if(!doc)return false;const next=structuredClone(doc);if(!renameRoomInConfig(next,oldName,nextName)){setMessage(`A room called "${nextName.trim()}" already exists.`);return false;}for(const k of Object.keys(renamesRef.current))if(renamesRef.current[k]===oldName)renamesRef.current[k]=nextName.trim();renamesRef.current[oldName]=nextName.trim();setText(writeConfiguration(next));setMessage('');return true;};
  function updateSettingsInPlace(d:ConfigDocument,room:string){const s=boardSettings(d);delete s.room_types[room.trim()];d.whiteboard={...(d.whiteboard||{}),...s};}
  const fields:Record<string,string>=(doc?.fields as Record<string,string>)||{};
  return <section className="configuration-page" aria-label="Venue configuration">
    <header className="configuration-header"><h1>Configuration</h1><button onClick={close}>Back to board</button><button onClick={save} disabled={!!validation}>Apply and save</button><button onClick={exportFile} disabled={!!validation}>Export YAML</button></header>
    <div className="configuration-content">
      <p>Import and edit venue configuration here. Open event/forecast files from the main board. Changes apply only when you select Apply and save. Every section of the YAML can be edited below — the YAML is what tells the reader how to read a venue&apos;s export file, so a new venue is set up here, not in code.</p>
      <label>Import venue YAML <input type="file" accept=".yaml,.yml" onChange={importFile}/></label>
      {(validation||message)&&<p role="status" className={validation?'configuration-error':''}>{validation||message}</p>}
      {doc&&settings&&<>
        <section><h2>Venue</h2><label>Venue name <input value={doc.site?.name||''} onChange={e=>{const value=e.target.value;change(d=>{d.site={...(d.site||{}),name:value};});}}/></label>{' '}
          <label>After Hours Contact <input aria-label="After Hours Contact" placeholder="0427 421 821" title="The number the overnight notes print in the footer as the after-hours contact. Left blank, they use 0427 421 821." value={doc.site?.after_hours_contact||''} onChange={e=>{const value=e.target.value;change(d=>{d.site={...(d.site||{})};if(value.trim())d.site.after_hours_contact=value;else delete d.site.after_hours_contact;});}} /></label>
          <p>The number the overnight notes print in the footer as the after-hours contact. Left blank, they use 0427 421 821.</p></section>
        <section><h2>Event file</h2><p>How the venue&apos;s export file is laid out.</p>
          <label>Format <select value={doc.file_input?.format||'csv'} onChange={e=>change(d=>{d.file_input={...(d.file_input||{}),format:e.target.value};})}><option value="csv">csv</option><option value="xls">xls</option><option value="xlsx">xlsx</option><option value="html">html</option></select></label>{' '}
          <label><input type="checkbox" checked={doc.file_input?.has_header!==false} onChange={e=>change(d=>{d.file_input={...(d.file_input||{}),has_header:e.target.checked};})} /> First row is a header</label>{' '}
          <label>Date format <select value={doc.file_input?.date_format||'DD/MM/YYYY'} onChange={e=>change(d=>{d.file_input={...(d.file_input||{}),date_format:e.target.value};})}>{DATE_FORMATS.map(f=><option key={f} value={f}>{f}</option>)}</select></label>{' '}
          <label>Header row <input aria-label="Header row" type="number" min={1} value={doc.file_input?.header_row ?? 1} onChange={e=>{const value=e.target.value;change(d=>{const n=parseInt(value,10);if(!value.trim()||isNaN(n)||n<=1){if(d.file_input)delete d.file_input.header_row;}else d.file_input={...(d.file_input||{}),header_row:n};});}} /></label>{' '}
          <label>Room separator <input aria-label="Room separator" value={doc.file_input?.room_separator ?? ''} placeholder="e.g. ;" onChange={e=>{const value=e.target.value;change(d=>{if(!value.trim()){if(d.file_input)delete d.file_input.room_separator;}else d.file_input={...(d.file_input||{}),room_separator:value};});}} /></label>
          <p>One venue&apos;s 11/19/2026 is another&apos;s 19/11/2026. The date format tells the reader which it is — it is never guessed.</p>
          <p>One cell can name several rooms: the separator is how the file separates them, so one booking lands on the grid in every room it names. The header row is the row the column names sit on — some exports put a title row first.</p>
        </section>
        <section><h2>Field mappings</h2><p>Each row names the column header in this venue&apos;s export file. Change a header here when the venue renames a column; nothing in the app hard-codes a column name. Job numbers are not mapped here: they are Encore data, not hotel data, and are added to bookings later in the inspector.</p>
          <table><thead><tr><th>Field</th><th>Column header in the export file</th></tr></thead><tbody>{FIELD_KEYS.map(({key,label,optional})=><tr key={key}><td>{label}{optional?' (optional)':''}</td><td><input aria-label={`${label} column header`} placeholder={optional?'Not mapped':''} value={fields[key]||''} onChange={e=>{const value=e.target.value;change(d=>{d.fields={...(d.fields||{})};if(!value.trim()&&optional)delete d.fields[key];else d.fields[key]=value;});}}/></td></tr>)}</tbody></table>
        </section>
        <section><h2>Display</h2>
          <label>Primary label <select value={doc.display?.primary_label||'booking_name'} onChange={e=>change(d=>{d.display={...(d.display||{}),primary_label:e.target.value};})}>{Object.keys(fields).map(k=><option key={k} value={k}>{k}</option>)}</select></label>{' '}
          <label>Secondary label <select value={doc.display?.secondary_label||'activity_name'} onChange={e=>change(d=>{d.display={...(d.display||{}),secondary_label:e.target.value};})}>{Object.keys(fields).map(k=><option key={k} value={k}>{k}</option>)}</select></label>{' '}
          <label><input type="checkbox" checked={doc.display?.suppress_secondary_when_equal!==false} onChange={e=>change(d=>{d.display={...(d.display||{}),suppress_secondary_when_equal:e.target.checked};})} /> Hide the secondary label when it matches the primary</label>
          <p>Allowed statuses</p>
          <StringList label="Allowed status" values={Array.isArray(doc.display?.allowed_statuses)?(doc.display.allowed_statuses as string[]):[]} onChange={next=>change(d=>{d.display={...(d.display||{}),allowed_statuses:next};})} />
        </section>
        <section><h2>Room configuration</h2><p>Large rooms use wider columns; small rooms use narrower columns. Base widths are minimums; columns expand proportionally if the screen has spare space. The room name itself is editable: renaming a room renames it everywhere in the configuration, and its bookings and notes follow it. Tick “Strong Border After” to draw a strong border after a room, so a block of rooms reads as one section — Palladium C3, for example, puts a strong border between Palladium and River Room. Days are separated by the same strong border. The “Alias” column holds the other names a room is called in the export file, comma separated — each alias reads as that room. The “Timetarget Area Name” column holds the TimeTarget area a room belongs to, for the rostering import. The “Operable wall” tick box sits on the border between two rooms: tick it when the wall between this room and the next can be opened, so bookings can merge across them. A wall that is not ticked is fixed, and no booking merges across it.</p>
          <div className="configuration-widths">
            <LimitInput label="Minimum width" value={settings.room_width_min} min={1} max={2000} onCommit={n=>updateSettings(s=>{s.room_width_min=n;if(s.room_width_max<n)s.room_width_max=n;for(const t of ['large','small','other'] as RoomType[])s.room_widths[t]=Math.max(n,Math.min(s.room_width_max,s.room_widths[t]));})} onInvalid={()=>setMessage('Use a minimum width from 1 to 2000 pixels.')} />
            <LimitInput label="Maximum width" value={settings.room_width_max} min={1} max={5000} onCommit={n=>updateSettings(s=>{s.room_width_max=n;if(s.room_width_min>n)s.room_width_min=n;for(const t of ['large','small','other'] as RoomType[])s.room_widths[t]=Math.max(s.room_width_min,Math.min(n,s.room_widths[t]));})} onInvalid={()=>setMessage('Use a maximum width from 1 to 5000 pixels.')} />
          </div>
          <div className="configuration-widths">{(['small','other','large'] as RoomType[]).map(type=><WidthInput key={type} type={type} value={settings.room_widths[type]} min={settings.room_width_min} max={settings.room_width_max} onCommit={n=>updateSettings(s=>{s.room_widths[type]=n;})} onInvalid={()=>setMessage(`Use a width from ${settings.room_width_min} to ${settings.room_width_max} pixels.`)} />)}</div>
          <div aria-label="Room width preview" style={{display:'flex',gap:12,alignItems:'flex-end',marginTop:12}}>{(['small','other','large'] as RoomType[]).map(type=>{const w=settings.room_widths[type];const total=settings.room_widths.small+settings.room_widths.other+settings.room_widths.large;const scale=420/Math.max(total,1);const label=type==='other'?'Medium':type==='small'?'Small':'Large';return <div key={type} style={{textAlign:'center'}}><div style={{width:Math.max(28,Math.round(w*scale)),height:44,background:'#fff',border:'1px solid #141414',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,overflow:'hidden'}}>{w}</div><div style={{fontSize:12,marginTop:4}}>{label} {w}px</div></div>;})}</div>
          <p>Preview: the three columns at their set widths, scaled to fit — the numbers are the real pixel widths.</p>
          <table><thead><tr><th>Order</th><th>Room</th><th>Alias</th><th>Timetarget Area Name</th><th>Type</th><th>Strong Border After</th><th>Operable wall</th><th>Reorder</th><th>Remove</th></tr></thead><tbody>{(doc.rooms.order as string[]).map((room,i)=>{const name=room.trim();const type=settings.room_types[name]||'other';const aliases=((doc.rooms.room_aliases as Record<string,string[]>)||{})[name]||[];const timetarget=((doc.rooms.timetarget_areas as Record<string,string>)||{})[name]||'';const last=i===doc!.rooms.order.length-1;return <tr key={room} className={settings.room_borders.includes(name)?'strong-border-after':undefined}><td>{i+1}</td><td><RoomNameInput value={name} onRename={next=>renameRoom(name,next)} /></td><td><input aria-label={`Aliases for ${name}`} title="Other names this room is called in the export file, comma separated — each alias reads as this room" placeholder="Aliases, comma separated" value={aliases.join(', ')} onChange={e=>{const value=e.target.value;change(d=>{const map={...((d.rooms.room_aliases as Record<string,string[]>)||{})};const next=value.split(',').map(s=>s.trim()).filter(Boolean);if(next.length)map[name]=next;else delete map[name];d.rooms.room_aliases=map;});}} /></td><td><input aria-label={`TimeTarget area name for ${name}`} title="The TimeTarget area this room belongs to, for the rostering import" placeholder="TimeTarget area" value={timetarget} onChange={e=>{const value=e.target.value;change(d=>{const map={...((d.rooms.timetarget_areas as Record<string,string>)||{})};if(value.trim())map[name]=value;else delete map[name];d.rooms.timetarget_areas=map;});}} /></td><td><select aria-label={`${name} type`} value={type} onChange={e=>{const value=e.target.value as RoomType;updateSettings(s=>{s.room_types[name]=value;});}}><option value="small">Small</option><option value="other">Medium</option><option value="large">Large</option></select></td><td><input type="checkbox" aria-label={`Strong border after ${name}`} checked={settings.room_borders.includes(name)} onChange={e=>{const on=e.target.checked;updateSettings(s=>{s.room_borders=on?[...s.room_borders,name]:s.room_borders.filter(r=>r!==name);});}} /></td><td className="operable-wall">{last?null:<span className="operable-wall-box"><input type="checkbox" aria-label={`Operable wall after ${name}`} title="Tick when the wall between this room and the next can be opened, so bookings can merge across them" checked={settings.operable_walls.includes(name)} onChange={e=>{const on=e.target.checked;updateSettings(s=>{s.operable_walls=on?[...s.operable_walls,name]:s.operable_walls.filter(r=>r!==name);});}} /></span>}</td><td><button disabled={i===0} onClick={()=>move(i,-1)} aria-label={`Move ${room} up`}>Up</button><button disabled={i===doc!.rooms.order.length-1} onClick={()=>move(i,1)} aria-label={`Move ${room} down`}>Down</button></td><td><button onClick={()=>removeRoom(room)} aria-label={`Remove ${room}`}>Remove</button></td></tr>;})}</tbody></table>
          <div style={{display:'flex',gap:8,marginTop:10}}><input aria-label="New room name" placeholder="New room name" value={newRoom} onChange={e=>setNewRoom(e.target.value)} /><button onClick={addRoom}>Add room</button></div>
          <p>Medium uses the legacy YAML type key other for compatibility with saved configurations.</p>
        </section>
        <section><h2>Combined rooms</h2><p>Each name on the left is a name the venue&apos;s export file uses for a combination of rooms; it expands to the rooms on its right. Add one entry per spelling the venue uses — “Palladium A &amp; B”, “Palladium AB” and “Palladium A and B” are three different names, so each needs its own entry. The walls between the rooms in each combination are filled in as operable, so a combined booking renders as one wide block — untick a wall in the room table above if two rooms in a combination should never merge. The TimeTarget area column holds the area name TimeTarget uses for the whole combination — the rostering import matches it the same way it matches a single room&apos;s area, so a “Palladium” row lands on the merged block instead of being skipped. Excluded rooms are not edited here: they stay in the YAML (<code>rooms.exclude</code>) and still skip rooms at import.</p>
          <MappingEditor map={(doc.rooms.room_mappings as Record<string,string[]>)||{}} keyLabel="Combined room" valueLabel="Rooms, comma separated" extraLabel="TimeTarget area" extra={(doc.rooms.timetarget_areas as Record<string,string>)||{}} onExtraChange={next=>change(d=>{d.rooms.timetarget_areas=next;})} onChange={next=>change(d=>{d.rooms.room_mappings=next;})} />
        </section>
        <section><h2>Timeline items</h2><p>Rows such as Setup and Teardown are folded into their booking instead of shown as bookings of their own.</p>
          <StringList label="Timeline item" values={Array.isArray(doc.timeline_items)?(doc.timeline_items as string[]):[]} onChange={next=>change(d=>{d.timeline_items=next;})} />
        </section>
        <section><h2>Salesperson colour palette</h2><p>Set up the palette here. Assign a salesperson to a booking from its inspector (Unlock bookings, then click a block) — the whole block takes that salesperson&apos;s colour, and the assignment survives a forecast re-import. Tick Unavailable in the inspector to mark a booking grey: only the left side, where the times are, turns grey.</p>
          <label className="checkbox"><input type="checkbox" aria-label="Random colours per event" checked={settings.random_event_colours} onChange={e=>updateSettings(s=>{s.random_event_colours=e.target.checked;})} /> Random colours per event</label>
          <p>Each event gets its own colour, so all blocks with the same name match — including one event spread across several rooms. Salespeople can still be assigned, but their colours won&apos;t show while this is on.</p>
          <table><thead><tr><th>Name</th><th>Short name</th><th>Colour</th><th>Preview</th><th>Remove</th></tr></thead><tbody>{settings.salespeople.map((person:Salesperson)=><tr key={person.id}><td><input aria-label="Salesperson name" value={person.name} onChange={e=>{const value=e.target.value;updateSettings(s=>{s.salespeople=s.salespeople.map(p=>p.id===person.id?{...p,name:value}:p);});}}/></td><td><input aria-label={`Short name for ${person.name||'salesperson'}`} title="The two-letter tag shown on a block next to the job number — set it here when two people would otherwise show the same initials." value={person.shortName||''} onChange={e=>{const value=e.target.value;updateSettings(s=>{s.salespeople=s.salespeople.map(p=>p.id===person.id?{...p,shortName:value}:p);});}}/></td><td><input type="color" aria-label={`${person.name||'Salesperson'} colour`} value={person.colour} onChange={e=>{const value=e.target.value;updateSettings(s=>{s.salespeople=s.salespeople.map(p=>p.id===person.id?{...p,colour:value}:p);});}}/> <code>{person.colour}</code></td><td><span className="configuration-swatch" style={{background:person.colour}} aria-label={person.colour}/></td><td><button onClick={()=>updateSettings(s=>{s.salespeople=s.salespeople.filter(p=>p.id!==person.id);})}>Remove</button></td></tr>)}</tbody></table>
          <button onClick={()=>updateSettings(s=>{s.salespeople.push({id:crypto.randomUUID(),name:'',colour:'#87b5e5'});})}>Add salesperson</button>
        </section>
      </>}
      <section><h2>Full YAML editor</h2><p>Use the tables above for everyday edits; the full YAML is here for anything else. Table edits preserve settings the tables do not show, but YAML comments/formatting are reformatted. Export includes room types and the palette.</p>{hasBookings&&<p>After changing room names, field mappings or filters, re-open the forecast on the board to re-parse it. Type/width/order changes apply without re-importing.</p>}<textarea aria-label="Venue YAML editor" spellCheck={false} value={text} onChange={e=>{setText(e.target.value);setMessage('');}}/></section>
      <p>Saved locally in this browser. Export YAML for backup or transfer to another computer.</p>
    </div>
  </section>;
}
