// Print view: a paper-friendly rendering of the board for a chosen
// date range, built for the browser's Print -> Save as PDF. The live
// board is a fixed-height scrolling view whose day heights are measured
// from the screen, so it prints as one clipped page with empty cells
// and no pagination; this view is a plain flowing document instead.
// It fits on ONE landscape sheet: every room across (scaled to the
// printable width) and the whole date range down (the day height
// scales so all the dates fit), so it reads like a screenshot of the
// board. The range is capped at two weeks, so the sheet never gets
// denser than that. Blocks use the same blocksFor layout as the board
// (merges, lanes, exact times), markup notes and arrows are drawn from
// their anchors, and block colours are at 50% opacity so the printout
// does not eat printer ink.
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
// printable, so the whole sheet is sized to that, with a small margin
// kept back (700px of height) so a slightly taller header or a
// printer's own margins never spill it onto a second page. The date
// column is fixed; the rooms share what is left, keeping their
// relative widths, and the day height is the printable height shared
// across the dates, so the whole range fits on the one sheet.
const DATE_COL = 110;
const PAGE_WIDTH = 1047;
const PAGE_HEIGHT = 700;
const HEADER_HEIGHT = 32;
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

export default function PrintView({ venue, bookings, salespeople, roomBorders, operableWalls, randomEventColours = false, markup, startDate, endDate, roomBaseWidths, roomWidthMin = 125, onClose }: Props) {
  const dates = useMemo(() => {
    try {
      // At most two weeks: the sheet is one landscape page, and a
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
  // proportions stay, then scaled together so every room fits across
  // the one landscape sheet. A room never goes below 12px, so it
  // still reads as a column even on a 38-room board.
  const widths = useMemo(() => {
    if (!venue) return [];
    const natural = venue.rooms.map((_, i) => Math.max(ROOM_MIN, Math.min(ROOM_MAX, Math.max(roomWidthMin, roomBaseWidths?.[i] || 150))));
    const total = natural.reduce((a, b) => a + b, 0);
    if (!total) return natural;
    const scale = Math.min(1, (PAGE_WIDTH - DATE_COL) / total);
    return natural.map(w => Math.max(12, Math.floor(w * scale)));
  }, [venue, roomBaseWidths, roomWidthMin]);

  // The day height is the printable height shared across the dates,
  // so the whole range fits down the one sheet. A short range gets
  // tall days; a two-week range gets short ones.
  const dayHeight = useMemo(() => {
    if (!dates.length) return 160;
    return Math.max(24, Math.floor((PAGE_HEIGHT - HEADER_HEIGHT) / dates.length));
  }, [dates.length]);

  // The anchor layout for the whole sheet: every room, every date.
  const layout: AnchorLayout | null = useMemo(() => {
    if (!venue) return null;
    const lefts: number[] = [];
    let x = DATE_COL;
    for (const w of widths) { lefts.push(x); x += w; }
    return {
      dates,
      rowTops: dates.map((_, i) => i * dayHeight),
      dayHeight,
      roomIds: venue.rooms.map(r => r.id),
      roomLefts: lefts,
      roomWidths: widths
    };
  }, [venue, dates, widths, dayHeight]);

  if (!venue || !layout) return <div className="print-view"><p>Open Configuration to load a venue YAML file.</p><button onClick={onClose}>Back to board</button></div>;

  const strongAfter = strongBorders(venue.rooms.map(r => r.id), roomBorders);
  const dateLabel = (d: string) => format(parseISO(d), 'EEE d MMM');
  const gridTemplate = `${DATE_COL}px ${widths.map(w => `${w}px`).join(' ')}`;
  const sheetWidth = DATE_COL + widths.reduce((a, b) => a + b, 0);
  const sheetHeight = dates.length * dayHeight;
  const sheetNotes = markup.filter(m => m.type === 'text' && m.date && m.roomId && m.fx !== undefined && m.fy !== undefined && pointFromAnchor(layout, { date: m.date, roomId: m.roomId, fx: m.fx, fy: m.fy }));
  const sheetArrows = markup.filter(m => {
    if (m.type !== 'arrow' || !m.date1 || !m.roomId1 || m.fx1 === undefined || m.fy1 === undefined || !m.date2 || !m.roomId2 || m.fx2 === undefined || m.fy2 === undefined) return false;
    return pointFromAnchor(layout, { date: m.date1, roomId: m.roomId1, fx: m.fx1, fy: m.fy1 }) && pointFromAnchor(layout, { date: m.date2, roomId: m.roomId2, fx: m.fx2, fy: m.fy2 });
  });

  return (
    <div className="print-view" aria-label="Print view">
      <div className="print-view-header">
        <h1>Print board — {format(parseISO(startDate), 'd MMM yyyy')} to {format(parseISO(endDate), 'd MMM yyyy')}</h1>
        <p>One landscape sheet: every room across and the whole date range down. Block colours are at 50% to save printer ink. Hidden bookings print faded and dashed.</p>
        <div className="print-view-actions">
          <button className="primary" onClick={() => window.print()}>🖨️ Print / Save as PDF</button>
          <button onClick={onClose}>Back to board</button>
        </div>
      </div>
      <section className="print-chunk" style={{ width: sheetWidth }}>
        <div className="print-grid-header" style={{ gridTemplateColumns: gridTemplate }}>
          <div className="print-corner">Date / time</div>
          {venue.rooms.map((r) => <div className="print-room-header" key={r.id}>{r.name}</div>)}
        </div>
        <div className="print-grid-body" style={{ height: sheetHeight }}>
          {dates.map((date) => {
            const kind = dayKind(date, today);
            return (
              <div className={`print-row${kind === 'today' ? ' today' : ''}`} key={date} style={{ gridTemplateColumns: gridTemplate, height: dayHeight }}>
                <div className={`print-date-cell ${kind}`}>{dateLabel(date)}</div>
                {venue.rooms.map(r => <div className="print-room-cell" key={r.id} />)}
                {segments.filter(s => s.date === date).map(({ block: b, start, end }) => {
                  const firstRoom = b.rooms[0];
                  const lastRoom = b.rooms[b.rooms.length - 1];
                  const insets = laneInsets(b.rooms, b.lane, b.laneCount, strongAfter);
                  const bg = b.unavailable ? printColour('#9aa0a6') : printColour(b.colour);
                  const height = Math.max(1, (timeFraction(end) - timeFraction(start)) * dayHeight);
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
                        gridColumn: `${firstRoom + 2} / ${lastRoom + 3}`,
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
          {sheetNotes.map(m => {
            if (m.type !== 'text') return null;
            const p = pointFromAnchor(layout, { date: m.date!, roomId: m.roomId!, fx: m.fx!, fy: m.fy! });
            if (!p) return null;
            return <div key={m.id} className={`print-note${m.highlight ? ' highlight' : ''}${m.source === 'timetarget' ? ' timetarget' : ''}`} style={{ left: p.x, top: p.y }}>{m.text}</div>;
          })}
          {/* Markup arrows, drawn from their two anchors. */}
          {sheetArrows.length > 0 && (
            <svg className="print-arrows" width={sheetWidth} height={sheetHeight} aria-hidden="true">
              <defs>
                <marker id="print-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="#7a1f1f" />
                </marker>
              </defs>
              {sheetArrows.map(m => {
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
    </div>
  );
}
