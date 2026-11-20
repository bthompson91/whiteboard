import { ChangeEvent, useState } from 'react';
import { boardSettings, ConfigDocument, normalizeConfigDoc, readConfiguration, RoomType, Salesperson, starterConfiguration, writeConfiguration } from '../lib/configuration';
import '../configuration.css';
interface Props { yamlText:string; hasBookings:boolean; onSave:(text:string)=>void; onClose:()=>void }
type TimeSlot = { label:string; start:string; end:string };
const FIELD_KEYS: Array<{ key:string; label:string; optional?:boolean }> = [
  { key:'booking_name', label:'Booking name' },
  { key:'activity_name', label:'Activity / event name' },
  { key:'event_date', label:'Event date' },
  { key:'start_time', label:'Start time' },
  { key:'end_time', label:'End time' },
  { key:'room_name', label:'Room' },
  { key:'booking_status', label:'Booking status' },
  { key:'job_number', label:'Job number', optional:true }
];
const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
function StringList({ values, onChange, label }: { values:string[]; onChange:(next:string[])=>void; label:string }) {
  return <div>{values.map((value,i)=><div key={i} style={{display:'flex',gap:8,marginBottom:6}}>
    <input aria-label={`${label} ${i+1}`} value={value} onChange={e=>{const next=[...values];next[i]=e.target.value;onChange(next);}} />
    <button onClick={()=>onChange(values.filter((_,j)=>j!==i))}>Remove</button>
  </div>)}
  <button onClick={()=>onChange([...values,''])}>Add</button></div>;
}
function MappingEditor({ map, onChange, keyLabel, valueLabel }: { map:Record<string,string[]>; onChange:(next:Record<string,string[]>)=>void; keyLabel:string; valueLabel:string }) {
  const rows = Object.entries(map);
  return <div>{rows.map(([key,values])=><div key={key} style={{display:'flex',gap:8,marginBottom:6,flexWrap:'wrap'}}>
    <input aria-label={keyLabel} value={key} onChange={e=>{const next:Record<string,string[]>={};for(const [k,v] of rows)next[k===key?e.target.value:k]=v;onChange(next);}} />
    <input aria-label={valueLabel} value={values.join(', ')} onChange={e=>{const next:Record<string,string[]>={};for(const [k,v] of rows)next[k]=k===key?e.target.value.split(',').map(s=>s.trim()).filter(Boolean):v;onChange(next);}} />
    <button onClick={()=>{const next:Record<string,string[]>={};for(const [k,v] of rows)if(k!==key)next[k]=v;onChange(next);}}>Remove</button>
  </div>)}
  <button onClick={()=>onChange({ ...map, '': [] })}>Add</button></div>;
}
export default function ConfigurationPage({yamlText,hasBookings,onSave,onClose}:Props){
  const initial=yamlText||starterConfiguration;
  const [text,setText]=useState(initial);
  const [message,setMessage]=useState('');
  const [newRoom,setNewRoom]=useState('');
  let doc:ConfigDocument|null=null,validation='';
  try{doc=readConfiguration(text,false);}catch(e){validation=e instanceof Error?e.message:String(e);}
  const settings=doc?boardSettings(doc):null;
  const change=(fn:(d:ConfigDocument)=>void)=>{if(!doc)return;const next=structuredClone(doc);fn(next);setText(writeConfiguration(next));setMessage('');};
  const updateSettings=(fn:(s:ReturnType<typeof boardSettings>)=>void)=>change(d=>{const s=boardSettings(d);fn(s);d.whiteboard={...(d.whiteboard||{}),...s};});
  const importFile=async(e:ChangeEvent<HTMLInputElement>)=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(!file)return;try{const next=await file.text();readConfiguration(next);setText(next);setMessage('YAML loaded into draft. Apply it to update the board.');}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  // Save trims stray whitespace from names and mappings, then validates
  // strictly: an empty field mapping fails here with a message instead of
  // silently dropping every row on the next import.
  const save=()=>{if(!doc)return;try{const next=normalizeConfigDoc(structuredClone(doc));const nextText=writeConfiguration(next);readConfiguration(nextText);onSave(nextText);}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const exportFile=()=>{try{const d=readConfiguration(text);const blob=new Blob([text],{type:'text/yaml;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${String(d.site?.name||'venue').toLowerCase().replace(/[^a-z0-9]+/g,'_')}.yaml`;document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('Exported this draft. Export does not apply changes to the board.');}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const close=()=>{if(text!==initial&&!window.confirm('Discard unapplied configuration changes?'))return;onClose();};
  const move=(i:number,delta:number)=>change(d=>{const list=d.rooms.order as string[];const j=i+delta;if(j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];});
  const addRoom=()=>{const name=newRoom.trim();if(!name)return;change(d=>{const list=d.rooms.order as string[];if(!list.some(r=>r.toLowerCase()===name.toLowerCase()))list.push(name);});setNewRoom('');};
  const removeRoom=(room:string)=>change(d=>{d.rooms.order=(d.rooms.order as string[]).filter(r=>r!==room);updateSettingsInPlace(d,room);});
  function updateSettingsInPlace(d:ConfigDocument,room:string){const s=boardSettings(d);delete s.room_types[room];d.whiteboard={...(d.whiteboard||{}),...s};}
  const fields:Record<string,string>=(doc?.fields as Record<string,string>)||{};
  const timeSlots:TimeSlot[]=Array.isArray(doc?.time_slots)?(doc.time_slots as TimeSlot[]):[];
  return <section className="configuration-page" aria-label="Venue configuration">
    <header className="configuration-header"><h1>Configuration</h1><button onClick={close}>Back to board</button><button onClick={save} disabled={!!validation}>Apply and save</button><button onClick={exportFile} disabled={!!validation}>Export YAML</button></header>
    <div className="configuration-content">
      <p>Import and edit venue configuration here. Open event/forecast files from the main board. Changes apply only when you select Apply and save. Every section of the YAML can be edited below — the YAML is what tells the reader how to read a venue&apos;s export file, so a new venue is set up here, not in code.</p>
      <label>Import venue YAML <input type="file" accept=".yaml,.yml" onChange={importFile}/></label>
      {(validation||message)&&<p role="status" className={validation?'configuration-error':''}>{validation||message}</p>}
      {doc&&settings&&<>
        <section><h2>Venue</h2><label>Venue name <input value={doc.site?.name||''} onChange={e=>{const value=e.target.value;change(d=>{d.site={...(d.site||{}),name:value};});}}/></label></section>
        <section><h2>Event file</h2><p>How the venue&apos;s export file is laid out.</p>
          <label>Format <select value={doc.file_input?.format||'csv'} onChange={e=>change(d=>{d.file_input={...(d.file_input||{}),format:e.target.value};})}><option value="csv">csv</option><option value="xls">xls</option><option value="xlsx">xlsx</option><option value="html">html</option></select></label>{' '}
          <label><input type="checkbox" checked={doc.file_input?.has_header!==false} onChange={e=>change(d=>{d.file_input={...(d.file_input||{}),has_header:e.target.checked};})} /> First row is a header</label>{' '}
          <label>Date format <select value={doc.file_input?.date_format||'DD/MM/YYYY'} onChange={e=>change(d=>{d.file_input={...(d.file_input||{}),date_format:e.target.value};})}>{DATE_FORMATS.map(f=><option key={f} value={f}>{f}</option>)}</select></label>
          <p>One venue&apos;s 11/19/2026 is another&apos;s 19/11/2026. The date format tells the reader which it is — it is never guessed.</p>
        </section>
        <section><h2>Field mappings</h2><p>Each row names the column header in this venue&apos;s export file. Change a header here when the venue renames a column; nothing in the app hard-codes a column name.</p>
          <table><thead><tr><th>Field</th><th>Column header in the export file</th></tr></thead><tbody>{FIELD_KEYS.map(({key,label,optional})=><tr key={key}><td>{label}{optional?' (optional)':''}</td><td><input aria-label={`${label} column header`} placeholder={optional?'Not mapped':''} value={fields[key]||''} onChange={e=>{const value=e.target.value;change(d=>{d.fields={...(d.fields||{})};if(!value.trim()&&optional)delete d.fields[key];else d.fields[key]=value;});}}/></td></tr>)}</tbody></table>
        </section>
        <section><h2>Display</h2>
          <label>Primary label <select value={doc.display?.primary_label||'booking_name'} onChange={e=>change(d=>{d.display={...(d.display||{}),primary_label:e.target.value};})}>{Object.keys(fields).map(k=><option key={k} value={k}>{k}</option>)}</select></label>{' '}
          <label>Secondary label <select value={doc.display?.secondary_label||'activity_name'} onChange={e=>change(d=>{d.display={...(d.display||{}),secondary_label:e.target.value};})}>{Object.keys(fields).map(k=><option key={k} value={k}>{k}</option>)}</select></label>{' '}
          <label><input type="checkbox" checked={doc.display?.suppress_secondary_when_equal!==false} onChange={e=>change(d=>{d.display={...(d.display||{}),suppress_secondary_when_equal:e.target.checked};})} /> Hide the secondary label when it matches the primary</label>
          <p>Allowed statuses</p>
          <StringList label="Allowed status" values={Array.isArray(doc.display?.allowed_statuses)?(doc.display.allowed_statuses as string[]):[]} onChange={next=>change(d=>{d.display={...(d.display||{}),allowed_statuses:next};})} />
        </section>
        <section><h2>Room configuration</h2><p>Large rooms use wider columns; small rooms use narrower columns. Base widths are minimums; columns expand proportionally if the screen has spare space.</p>
          <div className="configuration-widths">{(['small','other','large'] as RoomType[]).map(type=><label key={type}>{type==='other'?'Medium':type==='small'?'Small':'Large'} width (px) <input type="number" min={150} max={600} defaultValue={settings.room_widths[type]} key={`${type}-${settings.room_widths[type]}`} onBlur={e=>{const n=Number(e.target.value);if(!Number.isFinite(n)||n<150||n>600){e.target.value=String(settings.room_widths[type]);setMessage('Use a width from 150 to 600 pixels.');return;}updateSettings(s=>{s.room_widths[type]=n;});}}/></label>)}</div>
          <table><thead><tr><th>Order</th><th>Room</th><th>Type</th><th>Base width</th><th>Reorder</th><th>Remove</th></tr></thead><tbody>{(doc.rooms.order as string[]).map((room,i)=>{const type=settings.room_types[room]||'other';return <tr key={room}><td>{i+1}</td><td>{room}</td><td><select aria-label={`${room} type`} value={type} onChange={e=>{const value=e.target.value as RoomType;updateSettings(s=>{s.room_types[room]=value;});}}><option value="small">Small</option><option value="other">Medium</option><option value="large">Large</option></select></td><td>{settings.room_widths[type]} px</td><td><button disabled={i===0} onClick={()=>move(i,-1)} aria-label={`Move ${room} up`}>Up</button><button disabled={i===doc!.rooms.order.length-1} onClick={()=>move(i,1)} aria-label={`Move ${room} down`}>Down</button></td><td><button onClick={()=>removeRoom(room)} aria-label={`Remove ${room}`}>Remove</button></td></tr>;})}</tbody></table>
          <div style={{display:'flex',gap:8,marginTop:10}}><input aria-label="New room name" placeholder="New room name" value={newRoom} onChange={e=>setNewRoom(e.target.value)} /><button onClick={addRoom}>Add room</button></div>
          <p>Medium uses the legacy YAML type key other for compatibility with saved configurations.</p>
        </section>
        <section><h2>Room lists</h2>
          <p>Excluded rooms (bookings in these rooms are ignored)</p>
          <StringList label="Excluded room" values={Array.isArray(doc.rooms.exclude)?(doc.rooms.exclude as string[]):[]} onChange={next=>change(d=>{d.rooms.exclude=next;})} />
          <p>Room aliases (each alias reads as the room on its left)</p>
          <MappingEditor map={(doc.rooms.room_aliases as Record<string,string[]>)||{}} keyLabel="Room" valueLabel="Aliases, comma separated" onChange={next=>change(d=>{d.rooms.room_aliases=next;})} />
          <p>Combined rooms (each name on the left expands to the rooms on its right)</p>
          <MappingEditor map={(doc.rooms.room_mappings as Record<string,string[]>)||{}} keyLabel="Combined room" valueLabel="Rooms, comma separated" onChange={next=>change(d=>{d.rooms.room_mappings=next;})} />
        </section>
        <section><h2>Time slots</h2><p>Named blocks of the day, used by the original planner output.</p>
          {timeSlots.map((slot,i)=><div key={i} style={{display:'flex',gap:8,marginBottom:6,flexWrap:'wrap'}}>
            <input aria-label={`Time slot ${i+1} label`} value={slot.label} onChange={e=>change(d=>{const list=[...(d.time_slots as TimeSlot[])];list[i]={...list[i],label:e.target.value};d.time_slots=list;})} />
            <input aria-label={`Time slot ${i+1} start`} value={slot.start} onChange={e=>change(d=>{const list=[...(d.time_slots as TimeSlot[])];list[i]={...list[i],start:e.target.value};d.time_slots=list;})} />
            <input aria-label={`Time slot ${i+1} end`} value={slot.end} onChange={e=>change(d=>{const list=[...(d.time_slots as TimeSlot[])];list[i]={...list[i],end:e.target.value};d.time_slots=list;})} />
            <button onClick={()=>change(d=>{d.time_slots=(d.time_slots as TimeSlot[]).filter((_,j)=>j!==i);})}>Remove</button>
          </div>)}
          <button onClick={()=>change(d=>{d.time_slots=[...(Array.isArray(d.time_slots)?d.time_slots:[]),{label:'',start:'',end:''}];})}>Add time slot</button>
        </section>
        <section><h2>Timeline items</h2><p>Rows such as Setup and Teardown are folded into their booking instead of shown as bookings of their own.</p>
          <StringList label="Timeline item" values={Array.isArray(doc.timeline_items)?(doc.timeline_items as string[]):[]} onChange={next=>change(d=>{d.timeline_items=next;})} />
        </section>
        <section><h2>Planner output</h2><p>Settings for the original planner output file. The board does not use these, but they are part of the venue YAML and are kept when saving.</p>
          <label>Filename prefix <input value={doc.output?.filename_prefix||''} onChange={e=>change(d=>{d.output={...(d.output||{}),filename_prefix:e.target.value};})} /></label>{' '}
          <label>Title <input value={doc.output?.title||''} onChange={e=>change(d=>{d.output={...(d.output||{}),title:e.target.value};})} /></label>{' '}
          <label>Worksheet name <input value={doc.output?.worksheet_name||''} onChange={e=>change(d=>{d.output={...(d.output||{}),worksheet_name:e.target.value};})} /></label>{' '}
          <label><input type="checkbox" checked={doc.output?.show_timeline_panel!==false} onChange={e=>change(d=>{d.output={...(d.output||{}),show_timeline_panel:e.target.checked};})} /> Show timeline panel</label>
        </section>
        <section><h2>Salesperson colour palette</h2><p>Set up the palette here. Assign a salesperson to a booking from its inspector (Unlock bookings, then click a block) — the block takes that salesperson&apos;s colour, and the assignment survives a forecast re-import. Pick Unavai in the inspector to mark a booking grey.</p>
          <table><thead><tr><th>Name</th><th>Colour</th><th>Preview</th><th>Remove</th></tr></thead><tbody>{settings.salespeople.map((person:Salesperson)=><tr key={person.id}><td><input aria-label="Salesperson name" value={person.name} onChange={e=>{const value=e.target.value;updateSettings(s=>{s.salespeople=s.salespeople.map(p=>p.id===person.id?{...p,name:value}:p);});}}/></td><td><input type="color" aria-label={`${person.name||'Salesperson'} colour`} value={person.colour} onChange={e=>{const value=e.target.value;updateSettings(s=>{s.salespeople=s.salespeople.map(p=>p.id===person.id?{...p,colour:value}:p);});}}/> <code>{person.colour}</code></td><td><span className="configuration-swatch" style={{background:person.colour}} aria-label={person.colour}/></td><td><button onClick={()=>updateSettings(s=>{s.salespeople=s.salespeople.filter(p=>p.id!==person.id);})}>Remove</button></td></tr>)}</tbody></table>
          <button onClick={()=>updateSettings(s=>{s.salespeople.push({id:crypto.randomUUID(),name:'',colour:'#87b5e5'});})}>Add salesperson</button>
        </section>
      </>}
      <section><h2>Full YAML editor</h2><p>Use the tables above for everyday edits; the full YAML is here for anything else. Table edits preserve settings the tables do not show, but YAML comments/formatting are reformatted. Export includes room types and the palette.</p>{hasBookings&&<p>After changing room names, field mappings or filters, re-open the forecast on the board to re-parse it. Type/width/order changes apply without re-importing.</p>}<textarea aria-label="Venue YAML editor" spellCheck={false} value={text} onChange={e=>{setText(e.target.value);setMessage('');}}/></section>
      <p>Saved locally in this browser. Export YAML for backup or transfer to another computer.</p>
    </div>
  </section>;
}
