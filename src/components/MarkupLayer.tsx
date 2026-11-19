import { useEffect, useRef, useState, PointerEvent as PE } from 'react';
import { MarkupItem } from '../types';
interface Props { markup: MarkupItem[]; mode: 'none'|'text'|'arrow'; onChange: (items: MarkupItem[]) => void }
type Drag = { item: MarkupItem; x:number; y:number; part:'move'|'start'|'end' };
export default function MarkupLayer({markup,mode,onChange}:Props){
 const root=useRef<HTMLDivElement>(null);
 const [size,setSize]=useState({width:1,height:1});
 const [selected,setSelected]=useState<string|null>(null);
 const [drag,setDrag]=useState<Drag|null>(null);
 const [draft,setDraft]=useState<Extract<MarkupItem,{type:'arrow'}>|null>(null);
 useEffect(()=>{const parent=root.current?.parentElement;const board=parent?.querySelector('.booking-grid');if(!parent)return;const measure=()=>setSize({width:Math.max(parent.clientWidth,board?.scrollWidth||0),height:Math.max(parent.clientHeight,board?.scrollHeight||0)});const observer=new ResizeObserver(measure);observer.observe(parent);if(board)observer.observe(board);measure();return()=>observer.disconnect();},[]);
 const remove=()=>{onChange(markup.filter(i=>i.id!==selected));setSelected(null);};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{const t=e.target as HTMLElement;if(t.isContentEditable||/INPUT|TEXTAREA|SELECT/.test(t.tagName))return;if(selected&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();onChange(markup.filter(i=>i.id!==selected));setSelected(null);}if(e.key==='Escape')setSelected(null);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[selected,markup,onChange]);
 const point=(e:PE)=>{const r=root.current!.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
 const capture=(e:PE)=>{root.current?.querySelector('svg')?.setPointerCapture(e.pointerId);};
 const begin=(e:PE,item:MarkupItem,part:Drag['part']='move')=>{e.stopPropagation();setSelected(item.id);setDrag({item,...point(e),part});capture(e);};
 const edit=(item:MarkupItem)=>{if(item.type!=='text')return;const text=window.prompt('Edit note',item.text);if(text!==null)onChange(markup.map(i=>i.id===item.id?{...item,text}:i));};
 const down=(e:PE<SVGSVGElement>)=>{setSelected(null);const p=point(e);if(mode==='text'){const text=window.prompt('Note text');if(text)onChange([...markup,{id:crypto.randomUUID(),type:'text',...p,text}]);}if(mode==='arrow'){setDraft({id:crypto.randomUUID(),type:'arrow',x1:p.x,y1:p.y,x2:p.x,y2:p.y});capture(e);}};
 const move=(e:PE)=>{const p=point(e);if(draft){setDraft({...draft,x2:p.x,y2:p.y});return;}if(!drag)return;const dx=p.x-drag.x,dy=p.y-drag.y;const item=drag.item;let next:MarkupItem;if(item.type==='text')next={...item,x:item.x+dx,y:item.y+dy};else if(drag.part==='start')next={...item,x1:p.x,y1:p.y};else if(drag.part==='end')next={...item,x2:p.x,y2:p.y};else next={...item,x1:item.x1+dx,y1:item.y1+dy,x2:item.x2+dx,y2:item.y2+dy};onChange(markup.map(i=>i.id===item.id?next:i));};
 const up=()=>{if(draft&&Math.hypot(draft.x2-draft.x1,draft.y2-draft.y1)>5)onChange([...markup,draft]);setDraft(null);setDrag(null);};
 const active=markup.find(i=>i.id===selected);
 const ax=active?(active.type==='text'?active.x:(active.x1+active.x2)/2):0;
 const ay=active?(active.type==='text'?Math.max(0,active.y-26):(active.y1+active.y2)/2):0;
 return <div ref={root} className={`markup-layer ${mode}`} style={size}><svg className="markup-svg" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{setDrag(null);setDraft(null);}}>
 <defs><marker id="markup-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#e33"/></marker></defs>
 {markup.map(item=>item.type==='text'?<foreignObject key={item.id} x={item.x} y={item.y} width={220} height={180}><div className={`markup-note ${selected===item.id?'selected':''}`} onPointerDown={e=>begin(e,item)} onDoubleClick={e=>{e.stopPropagation();edit(item);}}>{item.text}</div></foreignObject>:<g key={item.id}><line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} stroke="#e33" strokeWidth={3} markerEnd="url(#markup-arrow)"/><line className="markup-hit" x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} stroke="transparent" strokeWidth={16} onPointerDown={e=>begin(e,item)}/>{selected===item.id&&<><circle className="markup-handle" cx={item.x1} cy={item.y1} r={6} fill="white" stroke="#1d4e89" onPointerDown={e=>begin(e,item,'start')}/><circle className="markup-handle" cx={item.x2} cy={item.y2} r={6} fill="white" stroke="#1d4e89" onPointerDown={e=>begin(e,item,'end')}/></>}</g>)}
 {draft&&<line x1={draft.x1} y1={draft.y1} x2={draft.x2} y2={draft.y2} stroke="#e33" strokeWidth={3}/>}
 {active&&<foreignObject x={ax} y={ay} width={180} height={26}><div className="markup-actions" onPointerDown={e=>e.stopPropagation()}>{active.type==='text'&&<button onClick={()=>edit(active)}>Edit</button>}<button onClick={remove}>Delete</button><button onClick={()=>setSelected(null)}>Done</button></div></foreignObject>}
 </svg></div>;
}
