// Where a text note sits on the board: centred above the block it
// belongs to, moved up when it would overlap that block, and centred
// between two blocks with a highlight when it would overlap the block
// above too. Pure: the board's block spans go in, the note's position
// comes out, so the rule can be checked without a browser.
import type { Block } from './blocks';

// One block's span in one room on one day, in board pixels. left/right
// are the block's whole span across its rooms, so a note centres on a
// merged block's full width, not on one room of it.
export interface BlockSpan {
  top: number;
  bottom: number;
  left: number;
  right: number;
  block: Block;
}

// The gap left between a note and the block it sits above.
export const NOTE_GAP_PX = 2;

// A note's height before it is measured on the board: a single line of
// 20px text at 1.25 line height, with 2px of padding top and bottom.
export const NOTE_HEIGHT_ESTIMATE_PX = 29;

export interface NotePlacement {
  x: number; // the note's centre
  y: number; // the note's top
  squeezed: boolean; // centred between two blocks, so it renders highlighted
  stuck: boolean; // placed directly above its block (so several notes for one block can stack)
}

// Place a note anchored at (anchorX, anchorY) in board pixels. The
// spans are the blocks in the note's day and room, sorted by top. The
// note's own block is the one its booking belongs to, else the block
// its anchor sits in or the first block below its anchor; a note with
// no block keeps its anchor. The note is centred on its block's span
// (a merged block's whole width), or on its anchor when it has no block.
// A note that sticks to its block (an imported TimeTarget note) always
// sits directly above its block, not just when it would overlap it —
// the setup time is in the note's text, so the note is a label for the
// block, not a marker at the setup time. A hand-typed note keeps its
// anchor and only moves above its block when it would overlap it.
// Either way, a note that would overlap the block above too is centred
// between the two blocks, and highlighted so it reads against the board.
export function placeNote(anchor: { x: number; y: number }, height: number, spans: BlockSpan[], bookingId?: string, stickToBlock = false): NotePlacement {
  const own = bookingId
    ? spans.find(s => s.block.ids.includes(bookingId))
    : undefined;
  const block = own ?? spans.find(s => anchor.y >= s.top && anchor.y < s.bottom) ?? spans.find(s => s.top > anchor.y);
  const x = block ? (block.left + block.right) / 2 : anchor.x;
  let y = anchor.y;
  let squeezed = false;
  let stuck = false;
  if (block && (stickToBlock || (y < block.bottom && y + height > block.top))) {
    // Sit just above the block: always, for a note that sticks to its
    // block; only when it would overlap, for a hand-typed note.
    y = block.top - height - NOTE_GAP_PX;
    stuck = true;
    const above = spans.filter(s => s.bottom <= block.top).sort((a, b) => b.bottom - a.bottom)[0];
    if (above && y < above.bottom) {
      // It would overlap the block above too: centre it between the
      // two blocks, and highlight it so it reads against the board.
      y = above.bottom + (block.top - above.bottom - height) / 2;
      squeezed = true;
    }
  }
  return { x, y, squeezed, stuck };
}
