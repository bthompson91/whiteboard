import { useEffect, useRef, useState, PointerEvent as PE } from 'react';
import { MarkupItem } from '../types';
import { AnchorLayout, anchorFromPoint, pointFromAnchor } from '../lib/markupAnchor';

interface Props {
  markup: MarkupItem[];
  mode: 'none' | 'text' | 'arrow';
  selectedBookingId: string | null;
  editingEnabled: boolean;
  onChange: (items: MarkupItem[]) => void;
  onClearSelectedBooking: () => void;
}

type Drag = {
  item: MarkupItem;
  x: number;
  y: number;
  part: 'move' | 'start' | 'end';
};

export default function MarkupLayer({ markup, mode, selectedBookingId, editingEnabled, onChange, onClearSelectedBooking }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [layout, setLayout] = useState<AnchorLayout | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<Extract<MarkupItem, { type: 'arrow' }> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editRef = useRef<HTMLTextAreaElement | null>(null);

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

  useEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;

    let board = parent.querySelector('.booking-grid') as HTMLElement | null;

    const measure = () => {
      setSize({
        width: Math.max(parent.clientWidth, board?.scrollWidth || 0),
        height: Math.max(parent.clientHeight, board?.scrollHeight || 0)
      });
      setLayout(buildLayout());
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
  const positions = new Map<string, { x: number; y: number; x2?: number; y2?: number }>();
  for (const item of markup) {
    if (item.type === 'text') {
      const pos = textPos(item);
      if (pos) positions.set(item.id, pos);
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
  const reanchorArrowMove = (item: Extract<MarkupItem, { type: 'arrow' }>, dx: number, dy: number) => {
    const next = { ...item, x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy };
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
      if (editingEnabled && selected && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        onChange(markup.filter((item) => item.id !== selected));
        setSelected(null);
        setEditing(null);
      }
      if (event.key === 'Escape') { setSelected(null); setEditing(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, markup, onChange, editingEnabled]);

  // Inline note editing: type straight into the note, no pop-up. The
  // box grows to fit what is typed.
  const startEdit = (item: Extract<MarkupItem, { type: 'text' }>) => {
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
  // button then removed it from their board.
  const begin = (event: PE, item: MarkupItem, part: Drag['part'] = 'move') => {
    if (!editingEnabled) return;
    event.stopPropagation();
    setSelected(item.id);
    setDrag({ item, ...point(event), part });
    capture(event);
  };

  const down = (event: PE<SVGSVGElement>) => {
    setSelected(null);
    setEditing(null);
    onClearSelectedBooking();
    if (!editingEnabled) return;
    const position = point(event);
    if (mode === 'text') {
      // A new note starts unhighlighted and opens straight into typing
      // in the box, so the user types into it rather than a pop-up.
      const id = crypto.randomUUID();
      const a = layout ? anchorFromPoint(layout, position.x, position.y) : null;
      const note: Extract<MarkupItem, { type: 'text' }> = {
        id,
        type: 'text',
        x: position.x,
        y: position.y,
        text: '',
        highlight: false,
        bookingId: selectedBookingId || undefined,
        ...(a ? { date: a.date, roomId: a.roomId, fx: a.fx, fy: a.fy } : {})
      };
      onChange([...markup, note]);
      setSelected(id);
      setEditing(id);
      setEditValue('');
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
    const item = drag.item;
    let next: MarkupItem;
    if (item.type === 'text') {
      next = reanchorText(item, item.x + deltaX, item.y + deltaY);
    } else if (drag.part === 'start') {
      next = reanchorArrowEnd(item, 'start', position.x, position.y);
    } else if (drag.part === 'end') {
      next = reanchorArrowEnd(item, 'end', position.x, position.y);
    } else {
      next = reanchorArrowMove(item, deltaX, deltaY);
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
            <g key={item.id}>
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
            className={`markup-note ${selected === item.id ? 'selected' : ''} ${item.highlight ? 'highlight' : ''}`}
            style={{ left: pos.x, top: pos.y }}
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
                style={{ width: 220, minHeight: 24, resize: 'none', overflow: 'hidden', font: 'inherit', color: 'inherit', background: 'transparent', border: 'none', outline: 'none', padding: 0, display: 'block' }}
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
