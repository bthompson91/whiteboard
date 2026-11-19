import { ChangeEvent, useState } from 'react';
import { boardSettings, ConfigDocument, readConfiguration, RoomType, Salesperson, starterConfiguration, writeConfiguration } from '../lib/configuration';
import '../configuration.css';
interface Props { yamlText:string; hasBookings:boolean; onSave:(text:string)=>void; onClose:()=>void }
export default function ConfigurationPage({yamlText,hasBookings,onSave,onClose}:Props){
  const initial=yamlText||starterConfiguration;
  const [text,setText]=useState(initial);
  const [message,setMessage]=useState('');
  let doc:ConfigDocument|null=null,validation='';
  try{doc=readConfiguration(text,false);}catch(e){validation=e instanceof Error?e.message:String(e);}
  const settings=doc?boardSettings(doc):null;
  const change=(fn:(d:ConfigDocument)=>void)=>{if(!doc)return;const next=structuredClone(doc);fn(next);setText(writeConfiguration(next));setMessage('');};
  const updateSettings=(fn:(s:ReturnType<typeof boardSettings>)=>void)=>change(d=>{const s=boardSettings(d);fn(s);d.whiteboard={...(d.whiteboard||{}),...s};});
  const importFile=async(e:ChangeEvent<HTMLInputElement>)=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(!file)return;try{const next=await file.text();readConfiguration(next);setText(next);setMessage('YAML loaded into draft. Apply it to update the board.');}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const save=()=>{try{readConfiguration(text);onSave(text);}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const exportFile=()=>{try{const d=readConfiguration(text);const blob=new Blob([text],{type:'text/yaml;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${String(d.site?.name||'venue').toLowerCase().replace(/[^a-z0-9]+/g,'_')}.yaml`;document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('Exported this draft. Export does not apply changes to the board.');}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const close=()=>{if(text!==initial&&!window.confirm('Discard unapplied configuration changes?'))return;onClose();};
  const move=(i:number,delta:number)=>change(d=>{const list=d.rooms.order as string[];const j=i+delta;if(j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];});
  return <section className="configuration-page" aria-label="Venue configuration">
    <header className="configuration-header"><h1>Configuration</h1><button onClick={close}>Back to board</button><button onClick={save} disabled={!!validation}>Apply and save</button><button onClick={exportFile} disabled={!!validation}>Export YAML</button></header>
    <div className="configuration-content">
      <p>Import and edit venue configuration here. Open event/forecast files from the main board. Changes apply only when you select Apply and save.</p>
      <label>Import venue YAML <input type="file" accept=".yaml,.yml" onChange={importFile}/></label>
      {(validation||message)&&<p role="status" className={validation?'configuration-error':''}>{validation||message}</p>}
      {doc&&settings&&<>
        <section><h2>Venue</h2><label>Venue name <input value={doc.site?.name||''} onChange={e=>{const value=e.target.value;change(d=>{d.site={...(d.site||{}),name:value};});}}/></label></section>
        <section><h2>Room configuration</h2><p>Large rooms use wider columns; small rooms use narrower columns. Base widths are minimums; columns expand proportionally if the screen has spare space.</p>
          <div className="configuration-widths">{(['small','other','large'] as RoomType[]).map(type=><label key={type}>{type} width (px) <input type="number" min={150} max={600} defaultValue={settings.room_widths[type]} key={`${type}-${settings.room_widths[type]}`} onBlur={e=>{const n=Number(e.target.value);if(!Number.isFinite(n)||n<150||n>600){e.target.value=String(settings.room_widths[type]);setMessage('Use a width from 150 to 600 pixels.');return;}updateSettings(s=>{s.room_widths[type]=n;});}}/></label>)}</div>
          <table><thead><tr><th>Order</th><th>Room</th><th>Type</th><th>Base width</th><th>Reorder</th></tr></thead><tbody>{(doc.rooms.order as string[]).map((room,i)=>{const type=settings.room_types[room]||'other';return <tr key={room}><td>{i+1}</td><td>{room}</td><td><select aria-label={`${room} type`} value={type} onChange={e=>{const value=e.target.value as RoomType;updateSettings(s=>{s.room_types[room]=value;});}}><option value="large">Large</option><option value="small">Small</option><option value="other">Other</option></select></td><td>{settings.room_widths[type]} px</td><td><button disabled={i===0} onClick={()=>move(i,-1)} aria-label={`Move ${room} up`}>Up</button><button disabled={i===doc!.rooms.order.length-1} onClick={()=>move(i,1)} aria-label={`Move ${room} down`}>Down</button></td></tr>;})}</tbody></table>
          <p>Room names, additions/removals, aliases and combined-room links can be edited in the full YAML below. Existing settings are retained when using these tables.</p>
        </section>
        <section><h2>Salesperson colour palette</h2><p>Set up the palette here. Assigning salespeople to booking blocks and retaining those assignments across forecast imports is a separate pending feature.</p>
          <table><thead><tr><th>Name</th><th>Colour</th><th>Preview</th><th>Remove</th></tr></thead><tbody>{settings.salespeople.map((person:Salesperson)=><tr key={person.id}><td><input aria-label="Salesperson name" value={person.name} onChange={e=>{const value=e.target.value;updateSettings(s=>{s.salespeople=s.salespeople.map(p=>p.id===person.id?{...p,name:value}:p);});}}/></td><td><input type="color" aria-label={`${person.name||'Salesperson'} colour`} value={person.colour} onChange={e=>{const value=e.target.value;updateSettings(s=>{s.salespeople=s.salespeople.map(p=>p.id===person.id?{...p,colour:value}:p);});}}/> <code>{person.colour}</code></td><td><span className="configuration-swatch" style={{background:person.colour}} aria-label={person.colour}/></td><td><button onClick={()=>updateSettings(s=>{s.salespeople=s.salespeople.filter(p=>p.id!==person.id);})}>Remove</button></td></tr>)}</tbody></table>
          <button onClick={()=>updateSettings(s=>{s.salespeople.push({id:crypto.randomUUID(),name:'',colour:'#87b5e5'});})}>Add salesperson</button>
        </section>
      </>}
      <section><h2>Full YAML editor</h2><p>Includes field mappings, allowed statuses, exclusions, room links, timeline items and other settings. Table edits preserve unknown settings but YAML comments/formatting are reformatted. Export includes room types and the palette.</p>{hasBookings&&<p>After changing room names, field mappings or filters, re-open the forecast on the board to re-parse it. Type/width/order changes apply without re-importing.</p>}<textarea aria-label="Venue YAML editor" spellCheck={false} value={text} onChange={e=>{setText(e.target.value);setMessage('');}}/></section>
      <p>Saved locally in this browser. Export YAML for backup or transfer to another computer.</p>
    </div>
  </section>;
}
