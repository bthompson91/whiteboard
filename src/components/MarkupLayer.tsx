import { useState } from 'react';
import { MarkupItem } from '../types';

interface MarkupLayerProps {
  markup: MarkupItem[];
  mode: 'none' | 'text' | 'arrow';
  onChange: (markup: MarkupItem[]) => void;
}

export default function MarkupLayer({ markup, mode, onChange }: MarkupLayerProps) {
  const [draft, setDraft] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mode === 'none') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (mode === 'text') {
      const text = window.prompt('Note text');
      if (text) {
        onChange([
          ...markup,
          { id: crypto.randomUUID(), type: 'text', x, y, text }
        ]);
      }
      return;
    }

    setDraft({ x1: x, y1: y, x2: x, y2: y });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setDraft({
      ...draft,
      x2: event.clientX - rect.left,
      y2: event.clientY - rect.top
    });
  };

  const handlePointerUp = () => {
    if (!draft) return;
    if (Math.abs(draft.x2 - draft.x1) > 5 || Math.abs(draft.y2 - draft.y1) > 5) {
      onChange([
        ...markup,
        { id: crypto.randomUUID(), type: 'arrow', ...draft }
      ]);
    }
    setDraft(null);
  };

  return (
    <div
      className={`markup-layer ${mode}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <svg className="markup-svg">
        {markup.map((item) =>
          item.type === 'arrow' ? (
            <line
              key={item.id}
              x1={item.x1}
              y1={item.y1}
              x2={item.x2}
              y2={item.y2}
              stroke="#ff3b30"
              strokeWidth={3}
              markerEnd="url(#arrowhead)"
            />
          ) : (
            <foreignObject key={item.id} x={item.x} y={item.y} width={220} height={80}>
              <div className="markup-note">{item.text}</div>
            </foreignObject>
          )
        )}
        {draft && (
          <line
            x1={draft.x1}
            y1={draft.y1}
            x2={draft.x2}
            y2={draft.y2}
            stroke="#ff3b30"
            strokeWidth={3}
          />
        )}
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#ff3b30" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}
