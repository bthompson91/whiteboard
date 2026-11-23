import { useEffect, useLayoutEffect, useMemo, useRef, useState, PointerEvent as PE } from 'react';
import { Booking, MarkupItem } from '../types';
import { AnchorLayout, anchorFromPoint, pointFromAnchor } from '../lib/markupAnchor';
import { blocksFor, blockSegments, timeFraction } from '../lib/blocks';
import { BlockSpan, NOTE_HEIGHT_ESTIMATE_PX, placeNote } from '../lib/notePlacement';
import { ParsedVenueConfig } from '../lib/venueConfig';
import { Salesperson } from '../lib/configuration';

interface Props {
  markup: MarkupItem[];
  mode: 'none' | 'text' | 'arrow';
  selectedBookingId: string | null;
  editingEnabled: boolean;
  // The salesperson filter's highlighted cells ("date|roomId"): when
  // non-empty, only annotations anchored to one of these cells stay
  // full; everything else dims to 25%, the same as a filtered-out
  // block. Empty means no filter, so nothing dims.
  highlightedCells?: Set<string>;
  // The board's blocks, for placing notes above them: the bookings and
  // the settings the grid renders them with. A note is centred above
  // the block it belongs to, moved up when it would overlap that block,
  // and centred between two blocks with a highlight when it would
  // overlap the block above too.
  bookings?: Booking[];
  venue?: ParsedVenueConfig | null;
  salespeople?: Salesperson[];
  roomBorders?: string[];
  operableWalls?: string[];
  randomEventColours?: boolean;
  // Whether hidden blocks are on the board (the grid's editing-or-
  // show-hidden flag): a note moves above exactly the blocks the grid
  // shows, hidden ones included only when they are visible.
  showHiddenBlocks?: boolean;
  onChange: (items: MarkupItem[]) => void;
  onClearSelectedBooking: () => void;
}

type Drag = {
  item: MarkupItem;
  x: number;
  y: number;
  part: 'move' | 'start' | 'end';
  // The item's rendered position when the drag started. The stored x/y
  // is not the rendered position for an anchored item — an imported
  // note stores 0,0 and renders from its anchor — so dragging from the
  // stored position teleports the note to the top-left corner, where it
  // looks like it vanished. The drag is always from where the item
  // renders, plus the pointer's movement since the drag started.
  baseX: number;
  baseY: number;
  baseX2?: number;
  baseY2?: number;
};

export default function MarkupLayer({ markup, mode, selectedBookingId, editingEnabled, highlightedCells, bookings, venue, salespeople, roomBorders, operableWalls, randomEventColours, showHiddenBlocks, onChange, onClearSelectedBooking }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [layout, setLayout] = useState<AnchorLayout | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // An annotation stays full when it is anchored to a highlighted
  // cell — a date and room where the filtered salesperson has a block
  // from yesterday onward — so a note or arrow above one of their
  // blocks stays visible. An arrow counts when either end is in a
  // highlighted cell. With no filter, or an unanchored item, nothing
  // is highlighted; unanchored items dim when a filter is on, because
  // they cannot be shown to sit above one of their blocks.
  const isHighlighted = (item: MarkupItem): boolean => {
    if (!highlightedCells || highlightedCells.size === 0) return true;
    if (item.type === 'text') {
      return !!(item.date && item.roomId && highlightedCells.has(`${item.date}|${item.roomId}`));
    }
    return !!(
      (item.date1 && item.roomId1 && highlightedCells.has(`${item.date1}|${item.roomId1}`)) ||
      (item.date2 && item.roomId2 && highlightedCells.has(`${item.date2}|${item.roomId2}`))
    );
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<Extract<MarkupItem, { type: 'arrow' }> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  // The edit box's width, measured from the note when editing starts:
  // the note is centred on its anchor, so a box of a different width
  // shifts the text sideways. Giving the box the note's own width
  // keeps the text exactly where it was.
  const [editWidth, setEditWidth] = useState<number | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  // Switching tools drops any selection: a note selected in text mode
  // is not still selected (and deletable, or showing its Edit button)
  // after switching to arrows, or to no tool.
  useEffect(() => {
    setSelected(null);
    setEditing(null);
    setEditWidth(null);
  }, [mode]);

  // The anchor layout, read from the rendered grid: the days shown
  // (data-date rows) and the rooms shown (data-room headers), with their
  // positions in board coordinates. Rebuilt whenever the board changes,
  // so a different date range re-anchors every note and arrow to the
  // day and room it belongs to.
  const buildLayout = (): AnchorLayout | null => {
    const board = root.current?.parentElement?.querySelector('.booking-grid') as HTMLElement | null;
    if (!board) return null;
    const rows = Array.from(board.querySelectorAll<HTMLElement>('.grid-row'));
    const headers = Array.from(board.querySelectorAll<HTMLElement>('.room-header'));
    if (!rows.length || !headers.length) return null;
    return {
      dates: rows.map(row => row.dataset.date || ''),
      rowTops: rows.map(row => row.offsetTop),
      dayHeight: rows[0].offsetHeight,
      roomIds: headers.map(h => h.dataset.room || ''),
      roomLefts: headers.map(h => h.offsetLeft),
      roomWidths: headers.map(h => h.offsetWidth)
    };
  };

  // Two layouts are the same when every number that anchors a note
  // matches. buildLayout() returns fresh arrays on every call, so
  // handing its result straight to setLayout re-renders even when
  // nothing moved — and the MutationObserver below fires on every DOM
  // change, so an unconditional set re-renders on every one of its own
  // updates and the page never settles. Comparing first breaks that
  // loop: measure() only re-renders when the board actually moved.
  const sameValues = <T,>(a: T[] | undefined, b: T[] | undefined): boolean =>
    a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));
  const layoutsEqual = (a: AnchorLayout | null, b: AnchorLayout | null): boolean => {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.dayHeight === b.dayHeight
      && sameValues(a.dates, b.dates)
      && sameValues(a.rowTops, b.rowTops)
      && sameValues(a.roomIds, b.roomIds)
      && sameValues(a.roomLefts, b.roomLefts)
      && sameValues(a.roomWidths, b.roomWidths);
  };

  useEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;

    let board = parent.querySelector('.booking-grid') as HTMLElement | null;

    const measure = () => {
      const width = Math.max(parent.clientWidth, board?.scrollWidth || 0);
      const height = Math.max(parent.clientHeight, board?.scrollHeight || 0);
      // Return the previous state object when nothing changed, so
      // React skips the re-render. A fresh object would re-render on
      // every observer callback even with identical numbers.
      setSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
      const nextLayout = buildLayout();
      setLayout(prev => (layoutsEqual(prev, nextLayout) ? prev : nextLayout));
    };
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(parent);
    if (board) resizeObserver.observe(board);

    const mutationObserver = new MutationObserver(() => {
      const nextBoard = parent.querySelector('.booking-grid') as HTMLElement | null;
      if (nextBoard !== board) {
        if (board) resizeObserver.unobserve(board);
        board = nextBoard;
        if (board) resizeObserver.observe(board);
      }
      measure();
    });
    mutationObserver.observe(parent, { childList: true, subtree: true });
    measure();

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  // Where an item renders: from its anchor when it has one (hidden when
  // the anchor's day or room is not on the board), otherwise its legacy
  // absolute position.
  const textPos = (item: Extract<MarkupItem, { type: 'text' }>): { x: number; y: number } | null => {
    if (item.date && item.roomId && item.fx !== undefined && item.fy !== undefined && layout) {
      return pointFromAnchor(layout, { date: item.date, roomId: item.roomId, fx: item.fx, fy: item.fy });
    }
    return { x: item.x, y: item.y };
  };
  const arrowPos = (item: Extract<MarkupItem, { type: 'arrow' }>): { x1: number; y1: number; x2: number; y2: number } | null => {
    let p1 = { x: item.x1, y: item.y1 }, p2 = { x: item.x2, y: item.y2 };
    if (layout) {
      if (item.date1 && item.roomId1 && item.fx1 !== undefined && item.fy1 !== undefined) {
        const p = pointFromAnchor(layout, { date: item.date1, roomId: item.roomId1, fx: item.fx1, fy: item.fy1 });
        if (!p) return null;
        p1 = p;
      }
      if (item.date2 && item.roomId2 && item.fx2 !== undefined && item.fy2 !== undefined) {
        const p = pointFromAnchor(layout, { date: item.date2, roomId: item.roomId2, fx: item.fx2, fy: item.fy2 });
        if (!p) return null;
        p2 = p;
      }
    }
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  };
  // The blocks' spans, in board pixels, per day and room: where a note
  // may not sit. Rebuilt with the layout, from the same blocks the grid
  // renders, so a note moves above exactly the block it would overlap.
  // A merged block contributes one span per room it covers, with the
  // whole block's span, so a note centres on the merged block. The
  // span uses the event's own times (mainStart/mainEnd), not the
  // timeline-extended span: a setup note at 07:00 sits clear of an
  // 18:30 event and must stay at its anchor, not be flung above a
  // block that only reaches 07:00 because its setup does.
  const spansByCell = useMemo(() => {
    const map = new Map<string, BlockSpan[]>();
    if (!layout || !venue || !bookings) return map;
    const blocks = blocksFor(bookings, venue, salespeople || [], showHiddenBlocks ?? false, roomBorders || [], operableWalls || [], randomEventColours ?? false);
    for (const block of blocks) {
      const left = layout.roomLefts[block.rooms[0]];
      const right = layout.roomLefts[block.rooms[block.rooms.length - 1]] + layout.roomWidths[block.rooms[block.rooms.length - 1]];
      if (left === undefined || right === undefined) continue;
      for (const seg of blockSegments({...block, start: block.mainStart, end: block.mainEnd})) {
        const day = layout.dates.indexOf(seg.date);
        if (day < 0) continue;
        const top = layout.rowTops[day] + timeFraction(seg.start) * layout.dayHeight;
        const bottom = layout.rowTops[day] + timeFraction(seg.end) * layout.dayHeight;
        for (const roomIdx of block.rooms) {
          const roomId = layout.roomIds[roomIdx];
          if (!roomId) continue;
          const key = `${seg.date}|${roomId}`;
          const list = map.get(key) || [];
          list.push({ top, bottom, left, right, block });
          map.set(key, list);
        }
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.top - b.top);
    return map;
  }, [layout, venue, bookings, salespeople, roomBorders, operableWalls, randomEventColours, showHiddenBlocks]);

  // A note's height, measured from the board: the placement needs it to
  // know whether the note overlaps the block below it. Measured after
  // every render, so a note that grows while being edited is placed by
  // its real height; the first render uses the single-line estimate.
  const [noteHeights, setNoteHeights] = useState<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const els = root.current?.querySelectorAll<HTMLElement>('[data-note-id]');
    if (!els) return;
    setNoteHeights(prev => {
      let next: Map<string, number> | null = null;
      for (const el of els) {
        const id = el.dataset.noteId;
        const h = el.offsetHeight;
        if (!id || !h) continue;
        if (prev.get(id) !== h) {
          if (!next) next = new Map(prev);
          next.set(id, h);
        }
      }
      return next ?? prev;
    });
  });

  // Where a text note renders: centred above the block it belongs to,
  // moved up when it would overlap that block, centred between two
  // blocks with a highlight when it would overlap the block above too.
  // A note with no block keeps its anchor. The x it returns is the
  // note's centre, which the CSS centres on with a translate.
  const notePlacement = (item: Extract<MarkupItem, { type: 'text' }>): { x: number; y: number; squeezed: boolean } | null => {
    const anchor = textPos(item);
    if (!anchor) return null;
    const height = noteHeights.get(item.id) ?? NOTE_HEIGHT_ESTIMATE_PX;
    if (!item.date || !item.roomId || !layout) return { x: anchor.x, y: anchor.y, squeezed: false };
    const spans = spansByCell.get(`${item.date}|${item.roomId}`) || [];
    return placeNote(anchor, height, spans, item.bookingId);
  };

  const positions = new Map<string, { x: number; y: number; x2?: number; y2?: number }>();
  // A note squeezed between two blocks renders highlighted: a
  // render-time state, not a stored one, so it follows the board as
  // bookings change instead of sticking to the note.
  const squeezed = new Map<string, boolean>();
  for (const item of markup) {
    if (item.type === 'text') {
      const placed = notePlacement(item);
      if (placed) {
        positions.set(item.id, { x: placed.x, y: placed.y });
        if (placed.squeezed) squeezed.set(item.id, true);
      }
    } else {
      const pos = arrowPos(item);
      if (pos) positions.set(item.id, { x: pos.x1, y: pos.y1, x2: pos.x2, y2: pos.y2 });
    }
  }

  // Re-anchor an item to the day and room its new position sits in.
  // Dragging outside every day/room cell clears the anchor, so the item
  // renders where it was put instead of snapping back.
  const reanchorText = (item: Extract<MarkupItem, { type: 'text' }>, x: number, y: number) => {
    const a = layout ? anchorFromPoint(layout, x, y) : null;
    return { ...item, x, y, date: a?.date, roomId: a?.roomId, fx: a?.fx, fy: a?.fy };
  };
  const reanchorArrowEnd = (item: Extract<MarkupItem, { type: 'arrow' }>, end: 'start' | 'end', x: number, y: number) => {
    const a = layout ? anchorFromPoint(layout, x, y) : null;
    if (end === 'start') return { ...item, x1: x, y1: y, date1: a?.date, roomId1: a?.roomId, fx1: a?.fx, fy1: a?.fy };
    return { ...item, x2: x, y2: y, date2: a?.date, roomId2: a?.roomId, fx2: a?.fx, fy2: a?.fy };
  };
  const reanchorArrowMove = (item: Extract<MarkupItem, { type: 'arrow' }>, dx: number, dy: number, baseX1: number, baseY1: number, baseX2: number, baseY2: number) => {
    const next = { ...item, x1: baseX1 + dx, y1: baseY1 + dy, x2: baseX2 + dx, y2: baseY2 + dy };
    const a1 = layout ? anchorFromPoint(layout, next.x1, next.y1) : null;
    const a2 = layout ? anchorFromPoint(layout, next.x2, next.y2) : null;
    return { ...next, date1: a1?.date, roomId1: a1?.roomId, fx1: a1?.fx, fy1: a1?.fy, date2: a2?.date, roomId2: a2?.roomId, fx2: a2?.fx, fy2: a2?.fy };
  };

  const remove = () => {
    onChange(markup.filter((item) => item.id !== selected));
    setSelected(null);
    setEditing(null);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      // Delete only removes a selected item whose own tool is active:
      // a text note selected in text mode is not deleted after the
      // user has switched to arrows.
      const selectedItem = selected ? markup.find(m => m.id === selected) : undefined;
      const toolFor = selectedItem?.type === 'text' ? 'text' : selectedItem?.type === 'arrow' ? 'arrow' : null;
      if (editingEnabled && selected && toolFor && mode === toolFor && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        onChange(markup.filter((item) => item.id !== selected));
        setSelected(null);
        setEditing(null);
      }
      if (event.key === 'Escape') { setSelected(null); setEditing(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, markup, onChange, editingEnabled, mode]);

  // Inline note editing: type straight into the note, no pop-up. The
  // box grows to fit what is typed. Only in text-notes mode: a note
  // is not editable while arrows (or no tool) is selected.
  const startEdit = (item: Extract<MarkupItem, { type: 'text' }>) => {
    if (!editingEnabled || mode !== 'text') return;
    // Measure the note's rendered width first: the note is centred on
    // its anchor (translateX(-50%)), so an edit box of a different
    // width shifts the text sideways the moment editing starts. The
    // box is given the note's own content width (its width less the
    // 2px padding each side), so the text stays exactly where it was.
    const el = root.current?.querySelector<HTMLElement>(`[data-note-id="${item.id}"]`);
    const rect = el?.getBoundingClientRect();
    setEditWidth(rect ? Math.max(24, rect.width - 4) : null);
    setSelected(item.id);
    setEditing(item.id);
    setEditValue(item.text);
  };
  const saveEdit = () => {
    if (!editing) return;
    const item = markup.find(m => m.id === editing);
    if (item && item.type === 'text') {
      const text = editValue.trim();
      if (!text) {
        onChange(markup.filter(m => m.id !== editing));
      } else if (text !== item.text) {
        onChange(markup.map(m => (m.id === editing && m.type === 'text' ? { ...m, text } : m)));
      }
    }
    setEditing(null);
  };
  const cancelEdit = () => {
    const item = markup.find(m => m.id === editing);
    if (item && item.type === 'text' && !item.text.trim()) {
      onChange(markup.filter(m => m.id !== editing));
    }
    setEditing(null);
  };
  useEffect(() => {
    const el = editRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editValue, editing]);

  const point = (event: PE) => {
    const rect = root.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const capture = (event: PE) => {
    root.current?.querySelector('svg')?.setPointerCapture(event.pointerId);
  };

  // A viewer is read-only: markup is visible but cannot be selected,
  // dragged, edited, created or deleted. Without this gate a viewer
  // clicking a note selected it, and Delete, Backspace or the Delete
  // button then removed it from their board. The gate is the role,
  // not the board lock: the editor can annotate without unlocking
  // the board for booking edits.
  //
  // A note or arrow is also only editable when its own tool is
  // selected in the top bar: a text box with arrows (or no tool)
  // selected is inert, and an arrow with text notes selected is
  // inert — it cannot be dragged, edited or deleted. The pointer
  // event is still stopped, so the background handler does not
  // create a new note or arrow on top of the one just clicked.
  const begin = (event: PE, item: MarkupItem, part: Drag['part'] = 'move') => {
    if (!editingEnabled) return;
    const toolFor = item.type === 'text' ? 'text' : 'arrow';
    if (mode !== toolFor) {
      event.stopPropagation();
      return;
    }
    event.stopPropagation();
    setSelected(item.id);
    // The drag starts from where the item renders, not from its stored
    // position: an imported note stores 0,0 and renders from its
    // anchor, so the stored position is not where it is.
    const pos = positions.get(item.id);
    const baseX = pos?.x ?? (item.type === 'text' ? item.x : item.x1);
    const baseY = pos?.y ?? (item.type === 'text' ? item.y : item.y1);
    const baseX2 = pos?.x2 ?? (item.type === 'arrow' ? item.x2 : undefined);
    const baseY2 = pos?.y2 ?? (item.type === 'arrow' ? item.y2 : undefined);
    setDrag({ item, ...point(event), part, baseX, baseY, baseX2, baseY2 });
    capture(event);
  };

  const down = (event: PE<SVGSVGElement>) => {
    setSelected(null);
    setEditing(null);
    onClearSelectedBooking();
    if (!editingEnabled) return;
    const position = point(event);
    if (mode === 'text') {
      // A new note prompts for its text in a pop-up. The inline box
      // that opened straight into typing stopped working reliably, so
      // creation is back on the prompt; editing an existing note still
      // types straight into the box. Cancel or an empty answer creates
      // nothing.
      const text = window.prompt('Note text:');
      if (!text || !text.trim()) return;
      const id = crypto.randomUUID();
      const a = layout ? anchorFromPoint(layout, position.x, position.y) : null;
      const note: Extract<MarkupItem, { type: 'text' }> = {
        id,
        type: 'text',
        x: position.x,
        y: position.y,
        text: text.trim(),
        highlight: false,
        bookingId: selectedBookingId || undefined,
        ...(a ? { date: a.date, roomId: a.roomId, fx: a.fx, fy: a.fy } : {})
      };
      onChange([...markup, note]);
      setSelected(id);
    }
    if (mode === 'arrow') {
      setDraft({
        id: crypto.randomUUID(),
        type: 'arrow',
        x1: position.x,
        y1: position.y,
        x2: position.x,
        y2: position.y,
        bookingId: selectedBookingId || undefined
      });
      capture(event);
    }
  };

  const move = (event: PE) => {
    const position = point(event);
    if (draft) {
      setDraft({ ...draft, x2: position.x, y2: position.y });
      return;
    }
    if (!drag) return;
    const deltaX = position.x - drag.x;
    const deltaY = position.y - drag.y;
    // A click jitters a pixel or two: ignore it, so clicking a note
    // selects it without moving it — and without writing the board
    // back for a move that never happened.
    if (Math.hypot(deltaX, deltaY) < 3) return;
    const item = drag.item;
    let next: MarkupItem;
    if (item.type === 'text') {
      next = reanchorText(item, drag.baseX + deltaX, drag.baseY + deltaY);
    } else if (drag.part === 'start') {
      next = reanchorArrowEnd(item, 'start', position.x, position.y);
    } else if (drag.part === 'end') {
      next = reanchorArrowEnd(item, 'end', position.x, position.y);
    } else {
      next = reanchorArrowMove(item, deltaX, deltaY, drag.baseX, drag.baseY, drag.baseX2 ?? item.x2, drag.baseY2 ?? item.y2);
    }
    onChange(markup.map((item2) => (item2.id === item.id ? next : item2)));
  };

  const up = () => {
    if (draft && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 5) {
      const a1 = layout ? anchorFromPoint(layout, draft.x1, draft.y1) : null;
      const a2 = layout ? anchorFromPoint(layout, draft.x2, draft.y2) : null;
      onChange([...markup, {
        ...draft,
        ...(a1 ? { date1: a1.date, roomId1: a1.roomId, fx1: a1.fx, fy1: a1.fy } : {}),
        ...(a2 ? { date2: a2.date, roomId2: a2.roomId, fx2: a2.fx, fy2: a2.fy } : {})
      }]);
    }
    setDraft(null);
    setDrag(null);
  };

  const active = markup.find((item) => item.id === selected);
  const activePos = active ? positions.get(active.id) : undefined;
  const arrowActionX = active && active.type === 'arrow' && activePos && activePos.x2 !== undefined ? (activePos.x + activePos.x2) / 2 : 0;
  const arrowActionY = active && active.type === 'arrow' && activePos && activePos.y2 !== undefined ? (activePos.y + activePos.y2) / 2 : 0;

  return (
    <div ref={root} className={`markup-layer ${mode}`} style={size}>
      <svg
        className="markup-svg"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          setDrag(null);
          setDraft(null);
        }}
      >
        <defs>
          <marker id="markup-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0 0L8 4L0 8Z" fill="#6a3fb5" />
          </marker>
        </defs>
        {markup.map((item) => {
          if (item.type !== 'arrow') return null;
          const pos = positions.get(item.id);
          if (!pos || pos.x2 === undefined || pos.y2 === undefined) return null;
          return (
            <g key={item.id} opacity={isHighlighted(item) ? undefined : 0.25}>
              <line x1={pos.x} y1={pos.y} x2={pos.x2} y2={pos.y2} stroke="#6a3fb5" strokeWidth={3} markerEnd="url(#markup-arrow)" />
              <line className="markup-hit" x1={pos.x} y1={pos.y} x2={pos.x2} y2={pos.y2} stroke="transparent" strokeWidth={16} onPointerDown={(event) => begin(event, item)} />
              {editingEnabled && selected === item.id && (
                <>
                  <circle className="markup-handle" cx={pos.x} cy={pos.y} r={6} fill="white" stroke="#6a3fb5" onPointerDown={(event) => begin(event, item, 'start')} />
                  <circle className="markup-handle" cx={pos.x2} cy={pos.y2} r={6} fill="white" stroke="#6a3fb5" onPointerDown={(event) => begin(event, item, 'end')} />
                </>
              )}
            </g>
          );
        })}
        {draft && <line x1={draft.x1} y1={draft.y1} x2={draft.x2} y2={draft.y2} stroke="#6a3fb5" strokeWidth={3} />}
        {editingEnabled && active && active.type === 'arrow' && activePos && (
          <foreignObject x={arrowActionX} y={arrowActionY} width={180} height={26}>
            <div className="markup-actions" onPointerDown={(event) => event.stopPropagation()}>
              <button onClick={remove}>Delete</button>
              <button onClick={() => setSelected(null)}>Done</button>
            </div>
          </foreignObject>
        )}
      </svg>
      {markup.map((item) => {
        if (item.type !== 'text') return null;
        const pos = positions.get(item.id);
        if (!pos) return null;
        return (
          <div
            key={item.id}
            data-note-id={item.id}
            className={`markup-note ${selected === item.id ? 'selected' : ''} ${item.highlight || squeezed.get(item.id) ? 'highlight' : ''} ${item.source === 'timetarget' ? 'timetarget' : ''}`}
            style={{ left: pos.x, top: pos.y, opacity: isHighlighted(item) ? undefined : 0.25 }}
            onPointerDown={(event) => begin(event, item)}
            onDoubleClick={(event) => {
              if (!editingEnabled) return;
              event.stopPropagation();
              startEdit(item);
            }}
          >
            {editing === item.id ? (
              <textarea
                ref={editRef}
                value={editValue}
                onChange={(event) => setEditValue(event.target.value)}
                onBlur={saveEdit}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    cancelEdit();
                  }
                }}
                onPointerDown={(event) => event.stopPropagation()}
                autoFocus
                rows={1}
                aria-label="Note text"
                style={{ width: editWidth ?? 220, minHeight: 24, resize: 'none', overflow: 'hidden', font: 'inherit', color: 'inherit', background: 'transparent', border: 'none', outline: 'none', padding: 0, display: 'block' }}
              />
            ) : (
              item.text
            )}
            {editingEnabled && selected === item.id && (
              <div className="markup-actions" onPointerDown={(event) => event.stopPropagation()}>
                <button onClick={() => startEdit(item)}>Edit</button>
                <button onClick={() => onChange(markup.map((item2) => (item2.type === 'text' && item2.id === item.id ? { ...item2, highlight: !item2.highlight } : item2)))}>{item.highlight ? 'Unhighlight' : 'Highlight'}</button>
                <button onClick={remove}>Delete</button>
                <button onClick={() => { saveEdit(); setSelected(null); }}>Done</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
