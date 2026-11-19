import { ChangeEvent, useState } from 'react';
import { Booking } from '../types';
import { ParsedVenueConfig } from '../lib/venueConfig';
interface Props { venue:ParsedVenueConfig|null; bookingCount:number; editingEnabled:boolean; markupMode:'none'|'text'|'arrow'; error:string|null; onToggleEditing:()=>void; onSetMarkupMode:(mode:'none'|'text'|'arrow')=>void; onOpenConfiguration:()=>void; onBookingsLoaded:(bookings:Booking[])=>void; onError:(message:string)=>void }
export default function Toolbar({venue,bookingCount,editingEnabled,markupMode,error,onToggleEditing,onSetMarkupMode,onOpenConfiguration,onBookingsLoaded,onError}:Props){
  const [loading,setLoading]=useState(false);
  const handleBookingFile=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(!file||!venue)return;setLoading(true);
    try{const {parseBookingWorkbook}=await import('../lib/bookingImport');onBookingsLoaded(await parseBookingWorkbook(file,venue));}catch(e){onError(e instanceof Error?e.message:String(e));}finally{setLoading(false);}
  };
  return <header className="toolbar"><strong>{venue?.name||'Venue Booking Whiteboard'}</strong><button onClick={onOpenConfiguration}>Configuration</button><label>Open events <input type="file" accept=".xls,.xlsx" onChange={handleBookingFile} disabled={!venue||loading}/></label><span>{loading?'Importing…':`${bookingCount} bookings`}</span><button onClick={onToggleEditing}>{editingEnabled?'Lock bookings':'Unlock bookings'}</button><button className={markupMode==='text'?'active':''} onClick={()=>onSetMarkupMode(markupMode==='text'?'none':'text')}>Text note</button><button className={markupMode==='arrow'?'active':''} onClick={()=>onSetMarkupMode(markupMode==='arrow'?'none':'arrow')}>Arrow</button>{error&&<div className="error" role="alert">{error}</div>}</header>;
}
