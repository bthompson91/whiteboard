import { useEffect, useMemo, useState } from 'react';
import BookingGrid from './components/BookingGrid';
import MarkupLayer from './components/MarkupLayer';
import Toolbar from './components/Toolbar';
import ConfigurationPage from './components/ConfigurationPage';
import { Booking, MarkupItem } from './types';
import { ImportResult } from './lib/bookingImport';
import { parseVenueConfig } from './lib/venueConfig';
import { boardSettings, readConfiguration } from './lib/configuration';
const MARKUP_KEY='whiteboard-markup',VENUE_YAML_KEY='whiteboard-venue-yaml';
function startup(){try{const text=localStorage.getItem(VENUE_YAML_KEY)||'';if(text)readConfiguration(text);return {text,error:null as string|null};}catch(e){return {text:'',error:e instanceof Error?e.message:String(e)};}}
function storedMarkup():MarkupItem[]{try{const parsed=JSON.parse(localStorage.getItem(MARKUP_KEY)||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}}
export default function App(){
  const [initial]=useState(startup);
  const [yamlText,setYamlText]=useState(initial.text);
  const venue=useMemo(()=>yamlText?parseVenueConfig(yamlText):null,[yamlText]);
  const settings=useMemo(()=>yamlText?boardSettings(readConfiguration(yamlText)):null,[yamlText]);
  const roomBaseWidths=useMemo(()=>venue?.rooms.map(r=>settings?.room_widths[settings.room_types[r.id]||'other']||175),[venue,settings]);
  const [bookings,setBookings]=useState<Booking[]>([]);
  const [lastImport,setLastImport]=useState<ImportResult|null>(null);
  const [markup,setMarkup]=useState<MarkupItem[]>(storedMarkup);
  const [editingEnabled,setEditingEnabled]=useState(false);
  const [markupMode,setMarkupMode]=useState<'none'|'text'|'arrow'>('none');
  const [error,setError]=useState<string|null>(initial.error);
  const [configurationOpen,setConfigurationOpen]=useState(false);
  useEffect(()=>{try{localStorage.setItem(MARKUP_KEY,JSON.stringify(markup));}catch{setError('Markup could not be saved in this browser. It remains available until this page is closed.');}},[markup]);
  const saveConfiguration=(text:string)=>{readConfiguration(text);parseVenueConfig(text);localStorage.setItem(VENUE_YAML_KEY,text);setYamlText(text);setError(null);setConfigurationOpen(false);};
  const handleBookingsLoaded=(result:ImportResult)=>{setBookings(result.bookings);setLastImport(result);setError(null);};
  return <div className="app">
    <Toolbar venue={venue} bookingCount={bookings.length} editingEnabled={editingEnabled} markupMode={markupMode} error={error} onToggleEditing={()=>setEditingEnabled(v=>!v)} onSetMarkupMode={setMarkupMode} onOpenConfiguration={()=>{setMarkupMode('none');setConfigurationOpen(true);}} onBookingsLoaded={handleBookingsLoaded} onError={setError}/>
    <main className="board-container"><BookingGrid venue={venue} bookings={bookings} editingEnabled={editingEnabled} onBookingsChange={setBookings} roomBaseWidths={roomBaseWidths}/><MarkupLayer markup={markup} mode={markupMode} onChange={setMarkup}/></main>
    {configurationOpen&&<ConfigurationPage yamlText={yamlText} hasBookings={bookings.length>0} onSave={saveConfiguration} onClose={()=>setConfigurationOpen(false)}/>}
  </div>;
}
