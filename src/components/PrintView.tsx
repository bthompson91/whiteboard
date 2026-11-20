// Print view: a paper-friendly rendering of the board for a chosen
// date range, built for the browser's Print -> Save as PDF. The live
// board is a fixed-height scrolling view whose day heights are measured
// from the screen, so it prints as one clipped page with empty cells
// and no pagination; this view is a plain flowing document instead.
// Rooms are chunked across landscape pages (each chunk is one table
// with the date column repeated, and a page break after it), and dates
// flow down the pages. Blocks use the same blocksFor layout as the
// board (merges, lanes, exact times), markup notes and arrows are
// drawn from their anchors, and block colours are at 50% opacity so
// the printout does not eat printer ink.
import { useMemo } from 'react';
import { addDays, eachDayOfInterval, format, parseISO } from 'date-fns';
import type { Booking } from '../types';
import type { MarkupItem } from '../types';
import type { ParsedVenueConfig } from '../lib/venueConfig';
import type { Salesperson } from '../lib/configuration';
import { blocksFor, clock, strongBorders, operableWallAfter, timeFraction } from '../lib/blocks';
import { pointFromAnchor } from '../lib/markupAnchor';
import type { AnchorLayout } from '../lib/markupAnchor';
import { dayKind } from '../lib/dateTime';
import './printView.css';

interface Props {
  venue: ParsedVenueConfig | null;
  bookings: Booking[];
  salespeople: Salesperson[];
  roomBorders: string[];
  operableWalls: string[];
  markup: MarkupItem[];
  startDate: string;
  endDate: string;
  roomBaseWidths?: number[];
  roomWidthMin?: number;
  onClose: () => void;
}

// Print layout, in CSS pixels at 96dpi. A landscape A4 page is about
// 1122px wide; after margins roughly 1000px is printable, so a chunk
// of rooms must fit in that. Room columns are capped for print so
// more rooms fit per sheet; a day is tall enough to read at a glance.
const DAY_HEIGHT = 160;
const DATE_COL = 140;
const PAGE_WIDTH = 1000;
const ROOM_MIN = 110;
const ROOM_MAX = 180;

function hexToRgba(hex: string, alpha: number): string | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// A block colour at half strength, so the printout does not kill the
// printer ink. The text stays fully opaque: only the background is
// faded, by turning the hex colour into an rgba with alpha 0.5.
function printColour(colour: string | undefined): string {
  const faded = colour ? hexToRgba(colour, 0.5) : null;
  return faded || 'rgba(243,240,234,0.5)';
}

// Lane insets for overlapping blocks, mirroring the board: a block
// that shares its room takes 1/laneCount of the width in its lane.
// The last lane keeps the strong-border 3px stop on its right edge.
function laneInsets(rooms: number[], lane: number | undefined, laneCount: number | undefined, strongAfter: boolean[]): { left: string; right: string } {
  const lastRoom = rooms[rooms.length - 1];
  if (!laneCount || laneCount <= 1 || lane === undefined) return { left: '0', right: strongAfter[lastRoom] ? '3px' : '0' };
  const leftPct = (lane / laneCount) * 100;
  const rightPct = ((laneCount - lane - 1) / laneCount) * 100;
  const right = lane === laneCount - 1 && strongAfter[lastRoom] ? `calc(${rightPct}% + 3px)` : `${rightPct}%`;
  return { left: `${leftPct}%`, right };
}

export default function PrintView({ venue, bookings, salespeople, roomBorders, operableWalls, markup, startDate, endDate, roomBaseWidths, roomWidthMin = 125, onClose }: Props) {
  const dates = useMemo(() => {
    try {
      return eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) }).map(d => format(d, 'yyyy-MM-dd'));
    } catch {
      return [startDate];
    }
  }, [startDate, endDate]);
  const today = format(new Date(), 'yyyy-MM-dd');

  // The same block layout as the board, for the chosen dates only.
  // Hidden bookings print too (faded, dashed), so nothing on the board
  // is silently missing from the printout.
  const blocks = useMemo(() => {
    if (!venue) return [];
    const inRange = bookings.filter(b => b.date >= startDate && b.date <= endDate);
    return blocksFor(inRange, venue, salespeople, true, roomBorders, operableWalls);
  }, [bookings, venue, salespeople, roomBorders, operableWalls, startDate, endDate]);

  // A block that runs past midnight is split into one segment per day,
  // exactly as the board does, so the part after midnight prints on
  // the next day's row instead of vanishing.
  const segments = useMemo(() => {
    const out: { block: (typeof blocks)[number]; date: string; start: number; end: number }[] = [];
    for (const b of blocks) {
      for (let offset = 0; offset <= Math.floor(Math.max(b.start, b.end - 1) / 1440); offset++) {
        const start = Math.max(0, b.start - offset * 1440);
        const end = Math.min(1440, b.end - offset * 1440);
        if (end < start) continue;
        const date = format(addDays(parseISO(b.date), offset), 'yyyy-MM-dd');
        if (date < startDate || date > endDate) continue;
        out.push({ block: b, date, start, end });
      }
    }
    return out;
  }, [blocks, startDate, endDate]);

  // Print room widths: the board's base widths, capped so more rooms
  // fit per landscape sheet. The chunking below uses these widths.
  const widths = useMemo(() => {
    if (!venue) return [];
    return venue.rooms.map((_, i) => Math.max(ROOM_MIN, Math.min(ROOM_MAX, Math.max(roomWidthMin, roomBaseWidths?.[i] || 150))));
  }, [venue, roomBaseWidths, roomWidthMin]);

  // Chunk the rooms across landscape pages: each chunk is the rooms
  // that fit in one printable width, date column included.
  const chunks = useMemo(() => {
    if (!venue) return [] as { rooms: { id: string; name: string }[]; widths: number[]; lefts: number[] }[];
    const out: { rooms: { id: string; name: string }[]; widths: number[]; lefts: number[] }[] = [];
    let current: { id: string; name: string }[] = [];
    let currentWidths: number[] = [];
    let used = DATE_COL;
    venue.rooms.forEach((room, i) => {
      const w = widths[i] || 150;
      if (current.length && used + w > PAGE_WIDTH) {
        out.push({ rooms: current, widths: currentWidths, lefts: leftsFor(currentWidths) });
        current = [];
        currentWidths = [];
        used = DATE_COL;
      }
      current.push(room);
      currentWidths.push(w);
      used += w;
    });
    if (current.length) out.push({ rooms: current, widths: currentWidths, lefts: leftsFor(currentWidths) });
    return out;
    function leftsFor(ws: number[]): number[] {
      const lefts: number[] = [];
      let x = DATE_COL;
      for (const w of ws) { lefts.push(x); x += w; }
      return lefts;
    }
  }, [venue, widths]);

  if (!venue) return <div className="print-view"><p>Open Configuration to load a venue YAML file.</p><button onClick={onClose}>Back to board</button></div>;

  const strongAfter = strongBorders(venue.rooms.map(r => r.id), roomBorders);
  const dateLabel = (d: string) => format(parseISO(d), 'EEE d MMM');

  return (
    <div className="print-view" aria-label="Print view">
      <div className="print-view-header">
        <h1>Print board — {format(parseISO(startDate), 'd MMM yyyy')} to {format(parseISO(endDate), 'd MMM yyyy')}</h1>
        <p>Rooms run across as many landscape sheets as needed; dates run down the pages. Block colours are at 50% to save printer ink. Hidden bookings print faded and dashed.</p>
        <div className="print-view-actions">
          <button className="primary" onClick={() => window.print()}>🖨️ Print / Save as PDF</button>
          <button onClick={onClose}>Back to board</button>
        </div>
      </div>
      {chunks.map((chunk, chunkIndex) => {
        const chunkRoomIds = chunk.rooms.map(r => r.id);
        const layout: AnchorLayout = {
          dates,
          rowTops: dates.map((_, i) => i * DAY_HEIGHT),
          dayHeight: DAY_HEIGHT,
          roomIds: chunkRoomIds,
          roomLefts: chunk.lefts,
          roomWidths: chunk.widths
        };
        const chunkSegments = segments.filter(s => s.block.rooms.some(r => chunkRoomIds.includes(venue.rooms[r].id)));
        const chunkNotes = markup.filter(m => m.type === 'text' && m.date && m.roomId && m.fx !== undefined && m.fy !== undefined && pointFromAnchor(layout, { date: m.date, roomId: m.roomId, fx: m.fx, fy: m.fy }));
        const chunkArrows = markup.filter(m => {
          if (m.type !== 'arrow' || !m.date1 || !m.roomId1 || m.fx1 === undefined || m.fy1 === undefined || !m.date2 || !m.roomId2 || m.fx2 === undefined || m.fy2 === undefined) return false;
          return pointFromAnchor(layout, { date: m.date1, roomId: m.roomId1, fx: m.fx1, fy: m.fy1 }) && pointFromAnchor(layout, { date: m.date2, roomId: m.roomId2, fx: m.fx2, fy: m.fy2 });
        });
        const gridTemplate = `${DATE_COL}px ${chunk.widths.map(w => `${w}px`).join(' ')}`;
        const chunkWidth = DATE_COL + chunk.widths.reduce((a, b) => a + b, 0);
        const chunkHeight = dates.length * DAY_HEIGHT;
        return (
          <section className="print-chunk" key={chunkIndex} style={{ width: chunkWidth }}>
            <div className="print-grid-header" style={{ gridTemplateColumns: gridTemplate }}>
              <div className="print-corner">Date / time</div>
              {chunk.rooms.map((r, i) => <div className="print-room-header" key={r.id}>{r.name}</div>)}
            </div>
            <div className="print-grid-body" style={{ height: chunkHeight }}>
              {dates.map((date, dateIndex) => {
                const kind = dayKind(date, today);
                return (
                  <div className={`print-row${kind === 'today' ? ' today' : ''}`} key={date} style={{ gridTemplateColumns: gridTemplate, height: DAY_HEIGHT }}>
                    <div className={`print-date-cell ${kind}`}>{dateLabel(date)}</div>
                    {chunk.rooms.map(r => <div className="print-room-cell" key={r.id} />)}
                    {chunkSegments.filter(s => s.date === date).map(({ block: b, start, end }) => {
                      const firstRoom = venue.rooms[b.rooms[0]].id;
                      const lastRoom = venue.rooms[b.rooms[b.rooms.length - 1]].id;
                      const firstInChunk = chunkRoomIds.indexOf(firstRoom);
                      const lastInChunk = chunkRoomIds.indexOf(lastRoom);
                      if (firstInChunk < 0 || lastInChunk < 0) return null;
                      const insets = laneInsets(b.rooms, b.lane, b.laneCount, strongAfter);
                      const bg = b.unavailable ? printColour('#9aa0a6') : printColour(b.colour);
                      const height = Math.max(1, (timeFraction(end) - timeFraction(start)) * DAY_HEIGHT);
                      // A short block cannot fit the facts strip and the
                      // title side by side: render one compact line
                      // (title + time) instead, so the text stays inside
                      // the block instead of spilling over its border.
                      const compact = height < 30;
                      const label = `${b.title}${b.initials || b.jobNumber ? ` | ${[b.initials, b.jobNumber].filter(Boolean).join(' ')}` : ''}`;
                      return (
                        <div
                          key={`${b.date}|${b.title}|${b.rooms.join(',')}|${b.ids.join(',')}`}
                          className="print-block"
                          style={{
                            gridColumn: `${firstInChunk + 2} / ${lastInChunk + 3}`,
                            gridRow: 1,
                            alignSelf: 'start',
                            marginTop: timeFraction(start) * DAY_HEIGHT,
                            height,
                            backgroundColor: bg,
                            borderStyle: b.hidden ? 'dashed' : undefined,
                            opacity: b.hidden ? 0.45 : undefined,
                            ...insets
                          }}
                          title={[b.title, `${b.date} ${clock(b.mainStart)}–${clock(b.mainEnd)}`, ...b.facts].join('\n')}
                        >
                          {compact ? (
                            <div className="print-block-compact">{label} · {clock(b.mainStart)}–{clock(b.mainEnd)}</div>
                          ) : (
                            <>
                              <div className="print-block-facts">{b.facts.length ? b.facts[0] : `${clock(b.mainStart)}–${clock(b.mainEnd)}`}</div>
                              <div className="print-block-title">{label}</div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {/* Markup notes, positioned from their anchors. */}
              {chunkNotes.map(m => {
                if (m.type !== 'text') return null;
                const p = pointFromAnchor(layout, { date: m.date!, roomId: m.roomId!, fx: m.fx!, fy: m.fy! });
                if (!p) return null;
                return <div key={m.id} className={`print-note${m.highlight ? ' highlight' : ''}`} style={{ left: p.x, top: p.y }}>{m.text}</div>;
              })}
              {/* Markup arrows, drawn from their two anchors. */}
              {chunkArrows.length > 0 && (
                <svg className="print-arrows" width={chunkWidth} height={chunkHeight} aria-hidden="true">
                  <defs>
                    <marker id="print-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M0,0 L8,4 L0,8 Z" fill="#7a1f1f" />
                    </marker>
                  </defs>
                  {chunkArrows.map(m => {
                    if (m.type !== 'arrow') return null;
                    const a = pointFromAnchor(layout, { date: m.date1!, roomId: m.roomId1!, fx: m.fx1!, fy: m.fy1! });
                    const c = pointFromAnchor(layout, { date: m.date2!, roomId: m.roomId2!, fx: m.fx2!, fy: m.fy2! });
                    if (!a || !c) return null;
                    return <line key={m.id} x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke="#7a1f1f" strokeWidth={3} markerEnd="url(#print-arrowhead)" />;
                  })}
                </svg>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
