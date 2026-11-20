// Markup anchors: a note or arrow end is stored against the day and
// room it sits in, plus its position within that day/room cell as a
// fraction (0-1). The item then renders from its anchor, so it stays on
// the same day and room when the date range changes — instead of an
// absolute pixel position, which lands on a different day once the rows
// move. An anchor whose day or room is not on the board (a different
// date range, or a removed room) resolves to null, and the item is
// hidden rather than drawn in the wrong place. Items with no anchor
// (created before anchoring) keep rendering at their absolute position.
export interface AnchorLayout {
  dates: string[];
  rowTops: number[];
  dayHeight: number;
  roomIds: string[];
  roomLefts: number[];
  roomWidths: number[];
}

export interface AnchorPoint {
  date: string;
  roomId: string;
  fx: number;
  fy: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Where a point anchored to a day and room renders, in board pixels.
export function pointFromAnchor(layout: AnchorLayout, anchor: AnchorPoint): { x: number; y: number } | null {
  const day = layout.dates.indexOf(anchor.date);
  const room = layout.roomIds.indexOf(anchor.roomId);
  if (day < 0 || room < 0) return null;
  return {
    x: layout.roomLefts[room] + clamp01(anchor.fx) * layout.roomWidths[room],
    y: layout.rowTops[day] + clamp01(anchor.fy) * layout.dayHeight
  };
}

// Which day and room a board point sits in, and where within that
// day/room cell. Null when the point is outside every day/room cell
// (the date column, the header, or past the last row).
export function anchorFromPoint(layout: AnchorLayout, x: number, y: number): AnchorPoint | null {
  const day = layout.dates.findIndex((_, i) => y >= layout.rowTops[i] && y < layout.rowTops[i] + layout.dayHeight);
  if (day < 0) return null;
  const room = layout.roomIds.findIndex((_, i) => x >= layout.roomLefts[i] && x < layout.roomLefts[i] + layout.roomWidths[i]);
  if (room < 0) return null;
  return {
    date: layout.dates[day],
    roomId: layout.roomIds[room],
    fx: clamp01((x - layout.roomLefts[room]) / layout.roomWidths[room]),
    fy: clamp01((y - layout.rowTops[day]) / layout.dayHeight)
  };
}
