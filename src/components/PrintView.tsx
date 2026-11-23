// Print view: a paper-friendly rendering of the board for a chosen
// date range, built for the browser's Print -> Save as PDF. The live
// board is a fixed-height scrolling view whose day heights are measured
// from the screen, so it prints as one clipped page with empty cells
// and no pagination; this view is a plain flowing document instead.
// The HEIGHT is one page: the whole date range fits down a single
// sheet, the day height scaling so all the dates fit. The WIDTH may
// split across pages: rooms flow across as many landscape sheets as
// they need, each sheet carrying the date column and a run of rooms.
// A room with no bookings in the range is shrunk to just the width
// its name needs, and every room name is autofitted to its column, so
// a narrow column never clips its name. The range is capped at two
// weeks, so a sheet never gets denser than that. Blocks use the same
// blocksFor layout as the board (merges, lanes, exact times), markup
// notes and arrows are drawn from their anchors, and block colours
// are at 50% opacity so the printout does not eat printer ink.
import { useMemo } from 'react';
import { addDays, eachDayOfInterval, format, parseISO } from 'date-fns';
import type { Booking } from '../types';
import type { MarkupItem } from '../types';
import type { ParsedVenueConfig } from '../lib/venueConfig';
import type { Salesperson } from '../lib/configuration';
import { blocksFor, blockHasJobNumber, clock, strongBorders, operableWallAfter, timeFraction } from '../lib/blocks';
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
  // Random colours per event: the printout matches the board.
  randomEventColours?: boolean;
  markup: MarkupItem[];
  startDate: string;
  endDate: string;
  roomBaseWidths?: number[];
  roomWidthMin?: number;
  onClose: () => void;
}

// Print layout, in CSS pixels at 96dpi. A landscape A4 page is about
// 1122px by 794px; after the 10mm margins roughly 1047px by 718px is
// printable, so a sheet is sized to that, with a small margin kept
// back (700px of height) so a slightly taller header or a printer's
// own margins never spill it onto a second page. The date column is
// fixed; the rooms share a sheet until it is full, then a new sheet
// starts. The day height is the printable height shared across the
// dates, so the whole range fits down every sheet.
const DATE_COL = 110;
const PAGE_WIDTH = 1047;
const PAGE_HEIGHT = 700;
const HEADER_HEIGHT = 32;
const ROOM_MIN = 110;
const ROOM_MAX = 180;
// An empty column is shrunk to just its name: never narrower than
// this, never wider than its natural width.
const EMPTY_ROOM_MIN = 40;

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

// Text measurement for autofitting room names: a shared offscreen
// canvas, so the name is measured in the same sans-serif the header
// renders in. Falls back to a per-character estimate when there is no
// canvas (a non-browser render).
let measureCanvas: HTMLCanvasElement | null = null;
function textWidth(text: string, fontSize: number): number {
  if (typeof document === 'undefined') return text.length * fontSize * 0.6;
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return text.length * fontSize * 0.6;
  ctx.font = `700 ${fontSize}px sans-serif`;
  return ctx.measureText(text).width;
}

// The font size that fits a room name in its column: the header's
// base size, scaled down when the name is too wide, never below the
// smallest readable size. A few pixels are kept back for padding.
function fitFontSize(text: string, colWidth: number, baseSize = 13, minSize = 7): number {
  const available = Math.max(10, colWidth - 8);
  const w = textWidth(text, baseSize);
  if (w <= available) return baseSize;
  return Math.max(minSize, Math.floor(baseSize * available / w));
}

export default function PrintView({ venue, bookings, salespeople, roomBorders, operableWalls, randomEventColours = false, markup, startDate, endDate, roomBaseWidths, roomWidthMin = 125, onClose }: Props) {
  const dates = useMemo(() => {
    try {
      // At most two weeks: the sheet is one landscape page tall, and a
      // longer range would make the days unreadably short. The dialog
      // caps the range; this is the backstop.
      return eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) }).slice(0, 14).map(d => format(d, 'yyyy-MM-dd'));
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
    return blocksFor(inRange, venue, salespeople, true, roomBorders, operableWalls, randomEventColours);
  }, [bookings, venue, salespeople, roomBorders, operableWalls, randomEventColours, startDate, endDate]);

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

  // Print room widths: the board's base widths, capped so the natural
  // proportions stay. A room with no bookings in the range is an empty
  // column, so it is shrunk to just the width its name needs at a
  // readable size — never narrower than a stub, never wider than its
  // natural width. The rooms are not scaled to one sheet: they flow
  // across as many sheets as they need.
  const widths = useMemo(() => {
    if (!venue) return [];
    const withContent = new Set<string>();
    for (const b of bookings) {
      if (b.date < startDate || b.date > endDate) continue;
      for (const r of (b.roomIds && b.roomIds.length ? b.roomIds : [b.roomId])) withContent.add(r);
    }
    return venue.rooms.map((room, i) => {
      const natural = Math.max(ROOM_MIN, Math.min(ROOM_MAX, Math.max(roomWidthMin, roomBaseWidths?.[i] || 150)));
      if (withContent.has(room.id)) return natural;
      const nameW = Math.ceil(textWidth(room.name, 10)) + 8;
      return Math.max(EMPTY_ROOM_MIN, Math.min(natural, nameW));
    });
  }, [venue, bookings, roomBaseWidths, roomWidthMin, startDate, endDate]);

  // The day height is the printable height shared across the dates,
  // so the whole range fits down every sheet. A short range gets
  // tall days; a two-week range gets short ones.
  const dayHeight = useMemo(() => {
    if (!dates.length) return 160;
    return Math.max(24, Math.floor((PAGE_HEIGHT - HEADER_HEIGHT) / dates.length));
  }, [dates.length]);

  // The rooms in runs that fit one sheet wide: the date column plus
  // rooms until the next room would overflow the printable width,
  // then a new sheet starts. Every sheet carries the whole date
  // range down, so the height never splits.
  const chunks = useMemo(() => {
    const out: number[][] = [];
    let cur: number[] = [];
    let curWidth = DATE_COL;
    for (let i = 0; i < widths.length; i++) {
      if (cur.length && curWidth + widths[i] > PAGE_WIDTH) {
        out.push(cur);
        cur = [];
        curWidth = DATE_COL;
      }
      cur.push(i);
      curWidth += widths[i];
    }
    if (cur.length) out.push(cur);
    return out;
  }, [widths]);

  // The anchor layout for one sheet: that sheet's rooms and dates.
  // Room lefts are relative to the sheet, starting after the date
  // column, so notes and arrows anchor to the sheet they print on.
  const layouts = useMemo(() => {
    if (!venue) return [];
    return chunks.map((rooms) => {
      const lefts: number[] = [];
      let x = DATE_COL;
      for (const i of rooms) { lefts.push(x); x += widths[i]; }
      return {
        dates,
        rowTops: dates.map((_, i) => i * dayHeight),
        dayHeight,
        roomIds: rooms.map(i => venue.rooms[i].id),
        roomLefts: lefts,
        roomWidths: rooms.map(i => widths[i])
      } as AnchorLayout;
    });
  }, [venue, chunks, dates, widths, dayHeight]);

  if (!venue || !layouts.length) return <div className="print-view"><p>Open Configuration to load a venue YAML file.</p><button onClick={onClose}>Back to board</button></div>;

  const strongAfter = strongBorders(venue.rooms.map(r => r.id), roomBorders);
  const dateLabel = (d: string) => format(parseISO(d), 'EEE d MMM');
  const sheetHeight = dates.length * dayHeight;

  return (
    <div className="print-view" aria-label="Print view">
      <div className="print-view-header">
        <h1>Print board — {format(parseISO(startDate), 'd MMM yyyy')} to {format(parseISO(endDate), 'd MMM yyyy')}</h1>
        <p>{chunks.length > 1 ? `${chunks.length} landscape sheets wide, ` : 'One landscape sheet, '}the whole date range down each sheet. Block colours are at 50% to save printer ink. Hidden bookings print faded and dashed. Empty rooms are narrowed to their name.</p>
        <div className="print-view-actions">
          <button className="primary" onClick={() => window.print()}>🖨️ Print / Save as PDF</button>
          <button onClick={onClose}>Back to board</button>
        </div>
      </div>
      {chunks.map((rooms, chunkIndex) => {
        const layout = layouts[chunkIndex];
        const gridTemplate = `${DATE_COL}px ${rooms.map(i => `${widths[i]}px`).join(' ')}`;
        const sheetWidth = DATE_COL + rooms.reduce((a, i) => a + widths[i], 0);
        const firstRoom = rooms[0];
        const lastRoom = rooms[rooms.length - 1];
        const chunkNotes = markup.filter(m => m.type === 'text' && m.date && m.roomId && m.fx !== undefined && m.fy !== undefined && pointFromAnchor(layout, { date: m.date, roomId: m.roomId, fx: m.fx, fy: m.fy }));
        const chunkArrows = markup.filter(m => {
          if (m.type !== 'arrow' || !m.date1 || !m.roomId1 || m.fx1 === undefined || m.fy1 === undefined || !m.date2 || !m.roomId2 || m.fx2 === undefined || m.fy2 === undefined) return false;
          return pointFromAnchor(layout, { date: m.date1, roomId: m.roomId1, fx: m.fx1, fy: m.fy1 }) && pointFromAnchor(layout, { date: m.date2, roomId: m.roomId2, fx: m.fx2, fy: m.fy2 });
        });
        return (
          <section className="print-chunk" key={chunkIndex} style={{ width: sheetWidth }}>
            <div className="print-grid-header" style={{ gridTemplateColumns: gridTemplate }}>
              <div className="print-corner">Date / time</div>
              {rooms.map(i => (
                <div className="print-room-header" key={venue.rooms[i].id} style={{ fontSize: fitFontSize(venue.rooms[i].name, widths[i]) }}>
                  {venue.rooms[i].name}
                </div>
              ))}
            </div>
            <div className="print-grid-body" style={{ height: sheetHeight }}>
              {dates.map((date) => {
                const kind = dayKind(date, today);
                return (
                  <div className={`print-row${kind === 'today' ? ' today' : ''}`} key={date} style={{ gridTemplateColumns: gridTemplate, height: dayHeight }}>
                    <div className={`print-date-cell ${kind}`}>{dateLabel(date)}</div>
                    {rooms.map(i => <div className="print-room-cell" key={venue.rooms[i].id} />)}
                    {segments.filter(s => s.date === date).map(({ block: b, start, end }) => {
                      // A block that only touches this sheet's rooms is
                      // clipped to them; a block spanning the sheet
                      // boundary prints its part on each sheet it
                      // touches. The grid columns are relative to this
                      // sheet's rooms, not the whole board.
                      const blockFirst = b.rooms[0];
                      const blockLast = b.rooms[b.rooms.length - 1];
                      if (blockLast < firstRoom || blockFirst > lastRoom) return null;
                      const clipFirst = Math.max(blockFirst, firstRoom);
                      const clipLast = Math.min(blockLast, lastRoom);
                      const insets = laneInsets(b.rooms, b.lane, b.laneCount, strongAfter);
                      const height = Math.max(1, (timeFraction(end) - timeFraction(start)) * dayHeight);
                      // A short block cannot fit the facts strip and the
                      // title side by side: render one compact line
                      // (title + time) instead, so the text stays inside
                      // the block instead of spilling over its border.
                      const compact = height < 30;
                      // A block with no job number prints with a white
                      // body and only its facts strip in the
                      // salesperson's colour, like the board. A compact
                      // block has no strip, so it keeps its colour —
                      // the colour is its only salesperson signal.
                      const bg = b.unavailable ? printColour('#9aa0a6') : (blockHasJobNumber(b) || compact ? printColour(b.colour) : '#fff');
                      // The facts strip carries the salesperson's colour
                      // even when the body does not (no job number, or
                      // unavailable, whose body is grey) — the board
                      // does the same.
                      const stripBg = b.unavailable ? printColour(b.salespersonColour || '#9aa0a6') : printColour(b.colour);
                      // A block too short to show text legibly hides
                      // it: the compact line (10px) would be clipped to
                      // a sliver. The block stays as a coloured bar.
                      const showText = height >= 12;
                      const label = `${b.title}${b.initials || b.jobNumber ? ` | ${[b.initials, b.jobNumber].filter(Boolean).join(' ')}` : ''}`;
                      return (
                        <div
                          key={`${b.date}|${b.title}|${b.rooms.join(',')}|${b.ids.join(',')}`}
                          className="print-block"
                          style={{
                            gridColumn: `${clipFirst - firstRoom + 2} / ${clipLast - firstRoom + 3}`,
                            gridRow: 1,
                            alignSelf: 'start',
                            marginTop: timeFraction(start) * dayHeight,
                            height,
                            backgroundColor: bg,
                            borderStyle: b.hidden ? 'dashed' : undefined,
                            opacity: b.hidden ? 0.45 : undefined,
                            ...insets
                          }}
                          title={[b.title, `${b.date} ${clock(b.mainStart)}–${clock(b.mainEnd)}`, ...b.facts].join('\n')}
                        >
                          {showText && (compact ? (
                            <div className="print-block-compact">{label} · {clock(b.mainStart)}–{clock(b.mainEnd)}</div>
                          ) : (
                            <>
                              <div className="print-block-facts" style={{backgroundColor:stripBg}}>{b.facts.length ? b.facts[0] : `${clock(b.mainStart)}–${clock(b.mainEnd)}`}</div>
                              <div className="print-block-title">{label}</div>
                            </>
                          ))}
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
                return <div key={m.id} className={`print-note${m.highlight ? ' highlight' : ''}${m.source === 'timetarget' ? ' timetarget' : ''}`} style={{ left: p.x, top: p.y }}>{m.text}</div>;
              })}
              {/* Markup arrows, drawn from their two anchors. */}
              {chunkArrows.length > 0 && (
                <svg className="print-arrows" width={sheetWidth} height={sheetHeight} aria-hidden="true">
                  <defs>
                    <marker id={`print-arrowhead-${chunkIndex}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M0,0 L8,4 L0,8 Z" fill="#7a1f1f" />
                    </marker>
                  </defs>
                  {chunkArrows.map(m => {
                    if (m.type !== 'arrow') return null;
                    const a = pointFromAnchor(layout, { date: m.date1!, roomId: m.roomId1!, fx: m.fx1!, fy: m.fy1! });
                    const c = pointFromAnchor(layout, { date: m.date2!, roomId: m.roomId2!, fx: m.fx2!, fy: m.fy2! });
                    if (!a || !c) return null;
                    return <line key={m.id} x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke="#7a1f1f" strokeWidth={3} markerEnd={`url(#print-arrowhead-${chunkIndex})`} />;
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
