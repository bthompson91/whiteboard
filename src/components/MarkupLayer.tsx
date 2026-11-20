import { useEffect, useRef, useState, PointerEvent as PE } from 'react';
import { MarkupItem } from '../types';

interface Props {
  markup: MarkupItem[];
  mode: 'none' | 'text' | 'arrow';
  selectedBookingId: string | null;
  onChange: (items: MarkupItem[]) => void;
  onClearSelectedBooking: () => void;
}

type Drag = {
  item: MarkupItem;
  x: number;
  y: number;
  part: 'move' | 'start' | 'end';
};

export default function MarkupLayer({ markup, mode, selectedBookingId, onChange, onClearSelectedBooking }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<Extract<MarkupItem, { type: 'arrow' }> | null>(null);

  useEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;

    let board = parent.querySelector('.booking-grid') as HTMLElement | null;

    const measure = () => {
      setSize({
        width: Math.max(parent.clientWidth, board?.scrollWidth || 0),
        height: Math.max(parent.clientHeight, board?.scrollHeight || 0)
      });
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
        measure();
      }
    });
    mutationObserver.observe(parent, { childList: true, subtree: true });
    measure();

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  const remove = () => {
    onChange(markup.filter((item) => item.id !== selected));
    setSelected(null);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      if (selected && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        onChange(markup.filter((item) => item.id !== selected));
        setSelected(null);
      }
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, markup, onChange]);

  const point = (event: PE) => {
    const rect = root.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const capture = (event: PE) => {
    root.current?.querySelector('svg')?.setPointerCapture(event.pointerId);
  };

  const begin = (event: PE, item: MarkupItem, part: Drag['part'] = 'move') => {
    event.stopPropagation();
    setSelected(item.id);
    setDrag({ item, ...point(event), part });
    capture(event);
  };

  const edit = (item: MarkupItem) => {
    if (item.type !== 'text') return;
    const text = window.prompt('Edit note', item.text);
    if (text !== null) {
      onChange(markup.map((item2) => (item2.id === item.id ? { ...item2, text } : item2)));
    }
  };

  const down = (event: PE<SVGSVGElement>) => {
    setSelected(null);
    onClearSelectedBooking();
    const position = point(event);
    if (mode === 'text') {
      const text = window.prompt('Note text');
      if (text) {
        onChange([
          ...markup,
          { id: crypto.randomUUID(), type: 'text', ...position, text, highlight: true, bookingId: selectedBookingId || undefined }
        ]);
      }
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
      next = { ...item, x: item.x + deltaX, y: item.y + deltaY };
    } else if (drag.part === 'start') {
      next = { ...item, x1: position.x, y1: position.y };
    } else if (drag.part === 'end') {
      next = { ...item, x2: position.x, y2: position.y };
    } else {
      next = {
        ...item,
        x1: item.x1 + deltaX,
        y1: item.y1 + deltaY,
        x2: item.x2 + deltaX,
        y2: item.y2 + deltaY
      };
    }
    onChange(markup.map((item2) => (item2.id === item.id ? next : item2)));
  };

  const up = () => {
    if (draft && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 5) {
      onChange([...markup, draft]);
    }
    setDraft(null);
    setDrag(null);
  };

  const active = markup.find((item) => item.id === selected);
  const arrowActionX = active && active.type === 'arrow' ? (active.x1 + active.x2) / 2 : 0;
  const arrowActionY = active && active.type === 'arrow' ? (active.y1 + active.y2) / 2 : 0;

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
          <marker id="markup-arrow" markerWidth="18" markerHeight="18" refX="16" refY="9" orient="auto">
            <path d="M0 0L18 9L0 18Z" fill="#6a3fb5" />
          </marker>
        </defs>
        {markup.map((item) =>
          item.type === 'arrow' ? (
            <g key={item.id}>
              <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} stroke="#6a3fb5" strokeWidth={7} markerEnd="url(#markup-arrow)" />
              <line className="markup-hit" x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} stroke="transparent" strokeWidth={16} onPointerDown={(event) => begin(event, item)} />
              {selected === item.id && (
                <>
                  <circle className="markup-handle" cx={item.x1} cy={item.y1} r={6} fill="white" stroke="#6a3fb5" onPointerDown={(event) => begin(event, item, 'start')} />
                  <circle className="markup-handle" cx={item.x2} cy={item.y2} r={6} fill="white" stroke="#6a3fb5" onPointerDown={(event) => begin(event, item, 'end')} />
                </>
              )}
            </g>
          ) : null
        )}
        {draft && <line x1={draft.x1} y1={draft.y1} x2={draft.x2} y2={draft.y2} stroke="#6a3fb5" strokeWidth={7} />}
        {active && active.type === 'arrow' && (
          <foreignObject x={arrowActionX} y={arrowActionY} width={180} height={26}>
            <div className="markup-actions" onPointerDown={(event) => event.stopPropagation()}>
              <button onClick={remove}>Delete</button>
              <button onClick={() => setSelected(null)}>Done</button>
            </div>
          </foreignObject>
        )}
      </svg>
      {markup.map((item) =>
        item.type === 'text' ? (
          <div
            key={item.id}
            className={`markup-note ${selected === item.id ? 'selected' : ''} ${item.highlight ? 'highlight' : ''}`}
            style={{ left: item.x, top: item.y }}
            onPointerDown={(event) => begin(event, item)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              edit(item);
            }}
          >
            {item.text}
            {selected === item.id && (
              <div className="markup-actions" onPointerDown={(event) => event.stopPropagation()}>
                <button onClick={() => edit(item)}>Edit</button>
                <button onClick={() => onChange(markup.map((item2) => (item2.type === 'text' && item2.id === item.id ? { ...item2, highlight: !item2.highlight } : item2)))}>{item.highlight ? 'Unhighlight' : 'Highlight'}</button>
                <button onClick={remove}>Delete</button>
                <button onClick={() => setSelected(null)}>Done</button>
              </div>
            )}
          </div>
        ) : null
      )}
    </div>
  );
}
