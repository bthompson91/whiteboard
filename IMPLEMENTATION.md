# Venue Booking Whiteboard — Implementation

A Duolingo-style venue booking board: a date × room grid of editable booking
blocks with persistent markup, built for one venue's operations team and
served as a static site. No server. Everything lives in the browser and in
three linked files on disk.

- **Stack:** TypeScript + React + Vite. No backend, no database.
- **Repo:** `bthompson91/whiteboard` (public). GitHub Pages serves `docs/` on
  `main`, base path `/whiteboard/`.
- **Live site:** https://bthompson91.github.io/whiteboard/
- **Venue:** Crown Melbourne. The venue config is `crown_melb.yaml` (38 rooms
  in `rooms.order`).

## How to run, test, and deploy

```sh
npm install
npm test        # harness, see "Tests" below
npm run build   # tsc + vite, outputs to docs/
```

`npm run build` dirties `docs/` (the built bundle). Do not commit that by
hand: after building, restore it with `git checkout -- docs`,
`git clean -fd docs/assets/`, and delete `tsconfig.tsbuildinfo`. CI (the
"Build and commit docs" workflow) rebuilds `docs/` itself on every push to
`main` and commits it with `[skip ci]`, so a push is just a source push and
Pages picks up the rebuilt bundle a minute or two later.

## Data model

`src/types.ts` holds the shared types.

- **`Booking`** — one row from the venue export, plus the user's edits:
  `id, date, roomId, roomIds, startTime, endTime, title, jobNumber?, status?,
  notes?, colour?, salespersonId?, unavailable?, hidden?, mergeTime?,
  mergeRoom?, mergeGroup?, timeline?`. `timeline` is the Setup/Teardown
  entries attached to a main booking (`{ label, start, end }[]`).
- **`SharedBoardFile`** — the board file on disk:
  `{ format: 'whiteboard-shared-board', version: 1, revision, exportedAt,
  bookings, history, markup, editorLock? }`. `revision` increments on every
  publish/import. Old files without `markup` still parse (it defaults to `[]`).
- **`MarkupItem`** — a text note or an arrow. Text notes carry legacy
  absolute `x, y` plus an optional anchor (`date, roomId, fx, fy`) and
  `highlight?`; arrows carry two ends (`x1, y1, x2, y2` plus
  `date1, roomId1, fx1, fy1, date2, roomId2, fx2, fy2`). `fx`/`fy` are
  fractions (0–1) inside the anchor cell. `bookingId` is written but not
  used for rendering.
- **`EditorLock`** — `{ name, id, at }`: who holds the single-editor lock,
  their session id, and when it was last refreshed.
- **`BoardRole`** — `'viewer' | 'editor'`. There is no contributor role and
  no changes queue; with a single editor, anyone who edits takes the lock
  and edits directly.

## Venue configuration (YAML)

The YAML is the per-venue reader config: every venue's export file has a
different layout, and the YAML declares how to read it. `src/lib/venueConfig.ts`
parses the venue sections; `src/lib/configuration.ts` (`readConfiguration`,
`boardSettings`, `writeConfiguration`, `normalizeConfigDoc`) handles the
`whiteboard:` section and validation.

Sections, all editable on the Configuration page (see below):

- **`site`** — venue name.
- **`fields`** — column-header mappings: `booking_name` (the block title),
  `activity_name` (Setup/Dinner/etc.), `event_date`, `start_time`,
  `end_time`, `room_name`, `booking_status`, plus two optional ones:
  `setup_start` (a setup/bump-in time column — the block spans it, as
  for an attached timeline row) and `teardown_end` (a teardown/bump-out
  time column). The Crown YAML has no
  Confirmation No, BEO # or job-number field, so imported bookings arrive
  with `jobNumber: ''` and job numbers only exist when a user sets one in
  the inspector. There is no job-number row in Field mappings: job numbers
  are Encore data, not hotel data, and never come in on the venue file.
- **`display`** — `primary_label`, `secondary_label`, `allowed_statuses`
  (only `Definite` rows are imported).
- **`rooms`** — `order` (the board's room order), `exclude` (rooms to skip),
  `room_aliases` (canonical name → list of alias names the export may use),
  `room_mappings` (a combined export name → list of board rooms, e.g.
  `"Palladium"` → Palladium A, B, C1, C2, C3),
  `timetarget_areas` (board room → the name TimeTarget uses for that room,
  with the venue name on the front — the key the planned TimeTarget
  setup-time import will match upload rows against),
  `unassigned_room` (the room events with no room at all go to, when the
  venue sets one — otherwise they are skipped). `room_mappings` is
  edited in the Combined rooms section of the Configuration page;
  `exclude` is still read at import but is not edited on the page. The
  combined names are load-bearing
  — the Crown export has 174 rows with Function Room exactly `Palladium`,
  187 `River Room` and 47 `Garden Room`, which only become board bookings
  through the mapping.
- **`timeline_items`** — activities that attach to a main booking instead of
  standing alone (Setup, Teardown).
- **`file_input`** — `date_format`, `header_row` (1-based: the row the
  column names sit on — some exports put a title row first, or group
  rows above the headers), and `room_separator` (how one cell can name
  several rooms, e.g. `';'` for "Room A;  Room B"). `date_format` is
  threaded into date parsing; the other two into the reader.
- **`time_slots` and `output`** — the original planner's named day blocks
  and output settings (filename/title/worksheet). Neither is read, and
  both are stripped out of the YAML when a config is read or saved; the
  Configuration page no longer shows either.
- **`whiteboard`** — board-only settings, stored back into the YAML:
  - `room_types`: room name → `large` | `small` | `other` (`other` is the
    medium/default size). Keys are trimmed on read so a stray space cannot
    silently fall back to medium.
  - `room_widths`: `{ large: 200, small: 125, other: 150 }` (pixels).
  - `room_width_min` / `room_width_max`: settable limits (default 125/600).
    The three widths are clamped to them.
  - `salespeople`: `{ id, name, colour, shortName? }[]`.
  - `room_borders`: room names after which a strong (3px) border is drawn.
  - `operable_walls`: room names after which the wall to the next room is
    operable — see "Operable walls" under Board layout. Empty by default,
    so cross-room merging is off until configured.

`starterConfiguration` in `configuration.ts` is the blank-venue template used
when no YAML is loaded.

## Import pipeline

`src/lib/bookingImport.ts` (`parseBookingWorkbook`, `compareImports`) and
`src/lib/importComparison.ts` do the work. The export is an HTML table saved
as `.xls`, a real spreadsheet (`.xlsx`, or SpreadsheetML `.xml` — the MCG
export is one), or a CSV; the parser reads rows, maps columns through
`fields`, rejects impossible dates/times (one bad row no longer aborts the
whole import), and keeps only `allowed_statuses` rows. Rows are read from
the venue's `header_row`, not always the first row, and a cell can name
several rooms when `room_separator` is set — each part resolves on its own,
so a combined name still needs a mapping entry and an excluded part is
dropped while the rest of the booking keeps its rooms. An event with no
room at all goes to `rooms.unassigned_room` when one is set, and is
otherwise skipped.

- **Timeline attach.** A Setup/Teardown row attaches to a main booking with
  the same `[title, date, roomIds]` when there is exactly one such candidate.
  If there are two (e.g. Dinner and Crew Meals under the same title), it
  stays a standalone booking. A venue can also give setup and teardown as
  columns instead of rows (`fields.setup_start` / `fields.teardown_end`):
  the block then spans from the setup start to the event start and from
  the event end to the teardown end, labelled with the first and second
  `timeline_items` entries. A column that cannot be read as a time leaves
  the booking without that end instead of failing the whole import.
- **Date range.** `parseBookingWorkbook` takes an optional date range and
  skips bookings outside it. The setup wizard uses it for a first import
  so a file spanning years does not make a board four years tall; a plain
  re-import has no range and takes everything, as before.
- **Multi-day rows.** One booking per row, on the row's first day. A
  three-day event shows on its first day only; the venue's own per-day
  rows, where it emits them, import as separate bookings.
- **Booking identity** (`src/lib/bookingIdentity.ts`, shared by the import and
  the comparison so they cannot drift). Two keys:
  - `identityKey` — the *event* identity: `[venue, date, jobNumber, title,
    roomIds]`, without times or activity. Used for matching and for carrying
    colour/salesperson across re-imports, so a re-timed booking keeps its
    colour.
  - `bookingId` — the *row* identity: the event identity plus `startTime`,
    `endTime`, `activity`. Each row is its own booking. (Before this fix,
    three rows of the same event — Setup, Dinner, Crew Meals — shared one
    id, and colour-coding one of them overwrote all three.)
- **Carry-over.** On import, each new booking inherits from the matching
  previous booking: colour, salesperson, hidden flag, job number, and
  timeline. The previous source is the live board cache
  (`whiteboard-board-cache`, saved on every bookings change), falling back
  to the stored previous import (`whiteboard-previous-import`) when the
  board is empty. Colour edits in the inspector update the board cache, so
  re-importing the same file no longer strips colours.
- **Job number.** Set in the inspector, never by an import. It is not a
  comparable field (never listed as a change in the review) and is carried
  over from the previous booking. It still vetoes a match when both sides
  have different job numbers.

## Matching (import review)

When a new file is imported, `compareImports` compares it with the previous
bookings and produces a list of changes: `new`, `changed`, `disappeared`,
`unchanged`. Matching is tiered:

1. **Exact** — same `identityKey`.
2. **Single-field** — same date and all but one field (score 90).
3. **Fuzzy** — `matchScore` (see below).

`matchScore` weights: **name 40, date 30, time 15, rooms 10, duration 5**.
Name + date is 70 of 100, so a match that gets either wrong cannot reach 80.
Date gives no partial credit for a day off. **Strong is ≥ 80, possible is
≥ 45.** In the review, a `new` change whose match scores under 80 is left
unchecked, so the user must tick it to apply it. A differing job number on
both sides vetoes a match outright.

`src/lib/reviewApply.ts` (`mergeMatchedBooking`, `applyReview`) is the pure
merge used by both the accept and link paths: accepting or linking a match
carries the previous booking's colour, salesperson, hidden flag, job number
and timeline onto the new row. `src/components/ImportReviewPanel.tsx` is the
review UI: checkboxes per change, "Link match" to pair a new row with a
previous booking, per-link undo, and "Overwrite and accept" / "Accept".
Disappeared changes carry their `previous` booking and are keepable by
unticking (they are not silently deleted). Previous bookings outside the new
import's date range become `unchanged` and are kept with their colour.

**Import history** (`ImportHistoryEntry`: full board snapshots in
`SharedBoardFile.history`, plus `whiteboard-import-history` in localStorage).
Each entry holds a full snapshot, so a long history can exceed browser
storage; the save drops the oldest entry and retries instead of failing.
"Revert last import" restores an earlier snapshot — note it restores the
bookings as they were then, likely without colours added after that import
(an exported published-board file made after colouring would have them).

## Board layout (`blocksFor`)

`src/lib/blocks.ts` turns bookings into `Block`s for rendering. A `Block`
is `{ date, title, ids, rooms, start, end, mainStart, mainEnd, facts,
jobNumber?, colour?, salespersonId?, salespersonColour?, initials?,
unavailable?, hidden?, mergeRoom, mergeGroup?, lane?, laneCount? }`.
`start`/`end` are the full span including timeline entries; `mainStart`/
`mainEnd` are the event times. **Start and end times are hard** — blocks
render at their exact times with no snapping.

- **Height merge (tall blocks).** Same room, same title matched loosely
  (`mergeTitle` ignores case and spacing), overlapping or adjacent times:
  one tall block. The inspector's "Merge with the same booking at other
  times" checkbox (`mergeTime`, undefined = merge) opts a booking out.
- **Width merge (wide blocks).** Same time (event times, not the
  timeline-extended span), adjacent rooms, and all of:
  - the two bookings have the **exact** same title (fuzzy title matching
    was removed for cross-room merges);
  - the wall between the rooms is **operable** (see below);
  - no **strong border** between them.
  The inspector's "Merge with the same booking in other rooms" checkbox
  (`mergeRoom`) opts a booking out.
- **Operable walls.** `operableWallAfter(roomIds, walls)` mirrors
  `strongBorders` (case/whitespace-insensitive). `blocksFor` takes the
  `operable_walls` list as its sixth parameter. A single booking that spans
  several rooms via `room_mappings` also only renders as one wide block
  across operable walls. Default: no walls operable, so cross-room merging
  is off until the walls are ticked in Configuration.
- **Manual merge.** The inspector's "Merge left" / "Merge right" buttons set
  a shared `mergeGroup` on two bookings in neighbouring rooms (same day,
  overlapping main times, same loose title preferred). A merge group joins
  regardless of title/times, but never across a strong border or a fixed
  (non-operable) wall; the buttons are greyed out with a tooltip when the
  neighbouring room is across one. "Unmerge" clears the group.
- **Strong borders.** `strongBorders(roomIds, borders)` marks the rooms
  after which a 3px `#141414` border is drawn. A block's right edge stops
  3px short where its last room has a strong border after it, so the border
  line stays visible. A merge never crosses a strong border, including a
  single booking spanning one.
- **Lanes (overlapping blocks).** `assignLanes(blocks)` runs at the end of
  `blocksFor`. Per date and room, greedy interval colouring assigns each
  block the lowest free lane; `laneCount` is the most blocks active at once
  during it. A multi-room block takes the lane of its most crowded room.
  Blocks with `laneCount > 1` render side-by-side at `1/laneCount` of the
  width in their lane; back-to-back blocks (`end == start`) do not overlap
  and still fill the full width.
- **Night compression.** `timeFraction(minutesOfDay)` maps time to a
  fraction of the day: night hours 00:00–06:00 render at 75% of the height
  of day hours (6 night hours = 4.5 units, 18 day hours = 18 units, 22.5
  total). Both the board and the print view use it.
- **Titles.** `FitTitle` binary-searches the largest font (8–64px) whose
  text fits the block; the font is capped at 80% of the block height and the
  text must fit inside the block (100%). Words wrap by whole words
  (`overflow-wrap: normal`); a word that still does not fit at minimum size
  is clipped, never split. Room names and dates size per cell
  (`roomNameFontSizes`, `dateFontSizes` in BookingGrid, measured on a canvas
  with `fitFontSize`): each room name gets the biggest font that fits its
  own column, each date the biggest that fits the 160px date column.

## Rendering (`BookingGrid.tsx`)

The grid is a date × room table: a sticky header row of room names, a
160px date column on the left, one row per day. Day heights come from a
JS-measured `--day-height` variable. Blocks are absolutely positioned inside
their day row; the room cells are white with thin black dividers and only
strong day separators remain (no hourly row lines).

- **Date bar.** Past days grey `#d9d9d9`, today bright yellow `#ffff00`
  with red text, future days pale green `#b6d7a8` (`dayKind` in
  `src/lib/dateTime.ts`). The whole current day highlights pale canary
  `#fff9c4` across the rooms. The board opens scrolled to the current day
  (or the next date after it), just below the sticky header, only when the
  date range changes; the 📅 Today button glides back smoothly.
- **Times strip.** The left strip of each block shows only the first time of
  each entry and auto-fits its width; times are bold. The hour time scale
  was removed from the date column.
- **Hidden blocks.** Render faded (0.45) and dashed while unlocked, so they
  can be opened and made visible again. The 👁️ Show hidden toggle (editor
  only) renders them even while locked; restoring still needs unlock + the
  inspector's "Hide from board" checkbox.
- **Inspector.** Clicking a block (editor, unlocked) opens the booking
  details popup. The popup sits above everything (dimming backdrop z 3000,
  the edited block raised to 3001 so it stays bright, panel z 3002);
  clicking the edited block cannot re-open it and discard edits. Fields:
  title, job number (with a NO AV tick box — ticking sets the job number to
  `NO AV`, unticking clears it), salesperson dropdown, Unavailable tick
  box, Hide from board, merge checkboxes, Merge left/right, Unmerge. Saving
  a job number writes it to every booking in the block. Assigning a
  salesperson when like bookings exist asks first: "Apply to all" or
  "Just this one" (the latter colours the whole merged block, not just the
  row).
- **Editor mode.** When unlocked and the role is not viewer, the board field
  turns pale pink `#fde8e8` (today's row keeps its canary highlight), so it
  is obvious at a glance the board is open for editing.
- **Salesperson filter.** A dropdown in the top bar (all roles). Pick a
  salesperson and every other block dims to 25% opacity. The focus window
  starts at the previous day: only that person's blocks from yesterday
  onward stay full; their older blocks dim too, as do unassigned blocks. A
  hidden block of the filtered person inside the window keeps its hidden
  fade (0.45). Annotations anchored to one of those blocks stay fully
  visible (see Markup).
- **Paint mode.** The 🎨 button (editor only) reveals a dropdown of sales
  execs and their colours plus an "Apply to all" checkbox. Click a block to
  paint it in that colour with their initials; "No salesperson" clears a
  block. With "Apply to all", painting also colours the same job in other
  rooms. Paint mode works in editor role even while the board is locked.
  Clicking 🎨 again turns it off.

## Salespeople and colour

The palette lives in `whiteboard.salespeople` (`id, name, colour,
shortName?`). Bookings store `salespersonId`; the block colour is resolved
from the palette at render (`bookingColour` in `configuration.ts`), so
renaming or recolouring a salesperson repaints their blocks.

- **Initials.** `salespersonInitials` uses `shortName` when set (edited in
  the palette table next to the name), else derives initials from the name.
  This is how two people who would derive the same initials (M Carrasco
  and Cara Coughey would both be CC) are told apart. The block tag reads
  `Title | AL 1022948` (initials + job number after a pipe; either part
  omitted when missing).
- **Unavailable.** A booking that is not unavailable colours the whole
  block. An unavailable booking colours only the left times strip grey
  (salesperson colour on the strip, grey body; with no salesperson the whole
  block is grey). The built-in grey is `UNAVAILABLE_SALESPERSON`
  (`id: 'unavailable'`, colour `#9aa0a6`).
- **NO AV.** `isNoAv` (trimmed, case-insensitive) exempts `NO AV` from the
  numeric job-number check; `bookingColour` returns grey for it, and
  `blocksFor` treats it as unavailable for rendering but keeps its
  salesperson initials.
- **No salesperson.** An unallocated booking gets the grey-beige paper
  background `#f3f0ea`.
- **Apply to all.** `likeBookings(bookings, title, excludeId, salespersonId)`
  finds bookings with the exact same title that are not already on that
  salesperson. `blockCountForBookings` counts merged blocks as 1, so the
  prompt says how many blocks will change, not how many rows.

## Markup

`src/components/MarkupLayer.tsx` renders the overlay; `src/lib/markupAnchor.ts`
(`AnchorLayout`, `AnchorPoint`, `pointFromAnchor`, `anchorFromPoint`) does
the geometry. A note or arrow end stores the day and room it sits in plus
its position within that cell as a fraction (0–1). Anchored items render
from their anchor, so they stay on the same day and room when the date range
changes, and hide when that day/room is not on the board. Legacy unanchored
items keep rendering at absolute pixels (no auto-migration). Dragging a note
or an arrow end re-anchors it.

- **Creating.** 📝 notes and ➡️ arrows are in the top bar (hidden for
  viewers). Creating a text note prompts for the text (`window.prompt('Note
  text:')`); a blank answer creates nothing. Arrows are drawn by dragging.
  Notes are 20px, default unhighlighted, and can be highlighted yellow.
  Existing notes edit inline (double-click / Edit → textarea; blur or Done
  saves, empty text deletes, Escape cancels).
- **Roles.** Markup is gated by role, not by the lock toggle: the editor can
  annotate without unlocking the board for booking edits, and viewers cannot
  touch markup at all (creation, Delete key, note double-click edit, and the
  actions popups are all gated). `App.tsx` passes MarkupLayer
  `editingEnabled={role !== 'viewer'}`.
- **Filter highlighting.** When a salesperson filter is active, the app
  computes `highlightedCells`, a set of `"date|roomId"` keys for the
  filtered person's bookings from yesterday onward, and passes it to
  MarkupLayer. A text note stays full iff its anchor cell is in the set; an
  arrow stays full iff either end is; unanchored items dim to 25%.

Markup travels in the shared board file (it used to live only in each
browser's localStorage, so it never showed across devices). The lowlight
overlay never blocks it: the overlay sits at z 2500, the toolbar at 2600,
the inspector at 3000/3002, dialogs at 4000.

## Roles and the editor lock

Two roles, trust-based (this is an internal tool, no server-side auth):

- **Viewer** (the default for a fresh browser): can look, filter, and print.
  The board auto-refreshes every 30 seconds by re-reading the linked board
  file.
- **Editor**: can change bookings, markup, and configuration. Switching to
  editor re-reads the board file; if a fresh lock is held by another
  session, a dialog names who is editing and offers "Take over anyway"
  (for when the holder has walked away or their browser is stuck — if the
  other editor is still actively editing, their next auto-write writes
  their lock back, so both can end up editing at once). Leaving editor
  releases the lock.

The lock (`EditorLock { name, id, at }`) lives in the shared board file:
2-minute TTL, 30-second heartbeat, session id in localStorage
(`whiteboard-editor-session`). The toolbar shows "✏️ {name} is editing"
when someone else holds a fresh lock. The lock is only shared when the board
file is linked; a browser that closes without releasing leaves the lock until
the TTL lets someone take over. The editor's display name (used for the
lock) is a name field shown for the editor role; a stored contributor name
migrates to it.

## Linked files and the shared board file

Three files, linked through the File System Access API
(`showOpenFilePicker` / `showSaveFilePicker`, desktop Chrome/Edge only).
`src/lib/sharedFile.ts` holds the helpers: `pickLinkedFile`,
`pickLinkedFileToSave`, `readLinkedFile`, `writeLinkedFile`,
`serializeSharedFile`, `createSharedFile`, `parseSharedFile`,
`writeSharedFileToHandle`, `readSharedFileFromHandle`, plus the IndexedDB
persistence (`saveLinkedHandle` / `loadLinkedHandle`, DB
`whiteboard-linked-files`, keys `board`, `yaml`, `bookings`).

- **Bookings export** (`.xls`) — read-only, linked for re-import, never
  written.
- **Venue YAML** — written back on config save when linked; "Export YAML"
  prompts for a location so it can save over the existing file.
- **Board** (shared JSON) — the live board. The editor auto-writes it
  (debounced 500ms) whenever bookings, revision, history, markup or the
  editor lock change. So editor changes save immediately as they are made;
  the top-bar button is just "🔄 Refresh" (re-read the board file).

Handles are stored in IndexedDB so the links persist across app versions;
on mount each handle is restored only if its permission is still `granted`.
The 🔗 Link files button turns red while any file is unlinked, and the whole
board is lowlit (a fixed overlay above the board but below the toolbar and
dialogs) until all three are linked — the board is not reading and writing
its files then. All popup dialogs (review, configuration, link files) sit at
the top of the z-order (4000) so the lowlight never dims them.

## Configuration page

`src/components/ConfigurationPage.tsx` + `src/configuration.css`. Every
parameter in the YAML is editable, not just the rooms: site, fields,
display, rooms, timeline items, file input, and the
whiteboard section, plus a raw YAML editor. Exceptions: the original
planner's `output` settings and `time_slots` are not shown (both stripped
from the YAML when a config is read or saved); `rooms.exclude` is kept in
the YAML and still read at import, but is not edited on the page. The
room table is
**Order | Room | Alias | Timetarget Area Name | Type | Border after |
Operable wall | Reorder | Remove**:

- **Room** — the name is an editable input, not fixed text. Renaming a
  room (`renameRoomInConfig` in `configuration.ts`) renames it everywhere
  the configuration references it (order, type keys, borders, operable
  walls, aliases, TimeTarget areas, combined-room keys and values,
  exclude list), and Apply and save carries the rename through to the
  bookings and markup anchors that carry the room name, so they follow
  it instead of being orphaned. A name another room already has is
  refused. The input commits on blur, so typing never loses focus.
- **Alias** — a text input per room (comma-separated) editing
  `rooms.room_aliases` inline, next to the room it belongs to. The old
  separate "Room aliases" section is gone.
- **Timetarget Area Name** — a text input per room editing
  `rooms.timetarget_areas`: the name TimeTarget uses for that room. It
  exists for the planned TimeTarget setup-time import (see below): an
  uploaded rostering export lists setup times per TimeTarget room, and
  the import will match each row to a board room through this name.
- **Type** — per-room select (`large` / `small` / `other`). The three width
  fields above the table (Small / Medium / Large) are the single place to
  set widths; the per-room "Base width" column was removed.
- **Border after** — tick a room to draw a strong border after it.
- **Operable wall** — a tick box that straddles the border between two room
  rows (centred on the boundary, in its own column). Ticking it marks the
  wall after that room as operable, which is what allows merging across
  those two rooms. The last room has no wall below it, so its cell is empty.
  The intro paragraph explains both new columns.
- **Minimum / Maximum width** — settable limits above the width fields;
  changing a limit re-clamps the three widths to it. Under the width
  fields a preview shows the three columns at their set widths, scaled
  to fit, with the real pixel numbers — it resizes live as the fields
  are adjusted.
- **Combined rooms** — its own section under the room table: each name on
  the left is a name the export file uses for a combination of rooms, and
  it expands to the rooms on the right. One entry per spelling the venue
  uses. A combined booking only renders as one wide block when the walls
  between those rooms are ticked operable; an operable wall merges
  separate bookings, it does not expand one booking, so the mapping is
  still what turns a combined export name into board rooms.

Salespeople are edited in their own table (Name, Short name, Colour), and
the YAML can be exported with a save-location prompt.

## Print view

`src/components/PrintView.tsx` + `src/components/printView.css`. The 🖨️
Print button (all roles) opens a date-range picker — it defaults to the
min/max booking dates on the board (or today → today+6 when there are no
bookings) — and "Show print view" renders a print-friendly board.

- **Layout.** Dates in the range, one row per day. Rooms are chunked across
  landscape A4 sheets: rooms accumulate until `DATE_COL (140px) + Σ room
  widths > PAGE_WIDTH (1000px)`, then a new chunk starts. Each chunk is a
  `<section>` with a page break after it, its own header row (Date/time +
  that chunk's room names), and dates flowing down; the browser paginates
  vertically (`break-inside: avoid` on rows). Room widths are the board base
  widths clamped to 110–180px. Day height is 160px. The header does not
  repeat on vertical page breaks within a chunk (the date column is on every
  row, so the day is still identifiable).
- **Blocks.** `blocksFor` runs with `showHidden: true`, so hidden bookings
  print (faded, dashed) and nothing is silently missing. Blocks running
  past midnight are split into per-day segments and clipped to the range.
  Lanes, strong borders, and the night compression all apply as on the
  board. Blocks are normal grid items (`gridColumn` / `gridRow` +
  `marginTop`), not absolutely positioned — Chrome's print layout misplaces
  absolutely positioned blocks onto the wrong sheet, so this is what makes
  each block land on its chunk's page. Short blocks (under 30px tall) render
  one compact line (title + time) so the text stays inside the block.
- **Colours.** Block backgrounds print at 50% opacity (`hexToRgba(hex,
  0.5)`) so the printout does not kill printer ink; text stays full
  strength. Unavailable blocks print grey at 50%; unallocated blocks print
  the paper colour at 50%. Date cells use the same past/today/future colours
  as the board, and today's row keeps the canary highlight.
- **Annotations.** Anchored notes and arrows render from their anchors
  (via `pointFromAnchor` with an `AnchorLayout` built per chunk: row tops
  are `i × DAY_HEIGHT`, room lefts are the cumulative widths). Text notes
  print at their anchor (highlighted ones on yellow); arrows render in a
  per-chunk SVG overlay (`#7a1f1f`, 3px, arrowhead marker) only when both
  ends resolve in the same chunk. Legacy unanchored markup cannot be
  positioned, so it is skipped in print.
- **Printing.** The print view is a fixed full-screen overlay (z 4000) with
  "🖨️ Print / Save as PDF" (`window.print()`) and "Back to board" buttons.
  `@page { size: landscape; margin: 10mm }` and the `@media print` rules
  hide the app chrome, turn the overlay into a flowing document, and use
  `!important` on the layout overrides — the app's base styles (`100dvh`
  height, hidden overflow) would otherwise win in the cascade and clip the
  printout to a single page. `print-color-adjust: exact` keeps the colours
  in the printout. There is no `@media print` on the board itself, which is
  why printing the board directly never worked: the scroll container clips,
  the heights do not match the page, and the 38-room grid never paginates.

## Setup wizard (first-time venue setup)

`src/components/SetupWizard.tsx` + `src/lib/wizard.ts`. A new venue — one
with no YAML yet — is set up from its booking file instead of by writing a
YAML by hand. It opens from the Link files panel ("Set up a new venue"),
and on first run, when no venue YAML has ever been stored, a welcome
overlay offers it (or linking an existing YAML) instead of the empty board;
dismissing the welcome is remembered.

Five steps, all driven by the file itself:

1. **Booking file.** Upload the export (`.xls`, `.xlsx`, `.xml`, `.csv`).
   The wizard reads it with the same reader the import uses, so a file
   the wizard accepts is a file the import can read. The header row is
   detected (the first row with at least three text cells — MCG's headers
   are on row 2, under a title row) and can be changed.
2. **Columns.** Each app field gets a dropdown of the file's columns, with
   a suggestion from the header names (Description as title, Bump In as
   date and setup start, Booked Spaces as room, and so on — Crown's
   headers suggest the same way). Title, Date, Start time, End time and
   Room are required. A preview shows the first events as they will
   import, with the error that stops any row. The date-order question
   only appears when the date column holds text like 09/11/2026; Excel
   dates and ISO dates read the same either way.
3. **Rooms.** Every distinct space in the file, most-used first, with a
   count — tick Exclude on the ones that are not rooms. One cell can name
   several rooms; the separator is detected (`;` for MCG) and editable.
   Events with no space go in an "Unassigned" room when the box is ticked.
   Only rows with a title count as events: the total and day-group rows
   below the header have no title, and would otherwise inflate the counts.
4. **Statuses and dates.** Tick which statuses import ("To Be
   Cancelled" starts off). A date range for the first import,
   defaulting to today → today + 90 days, or all dates. Salespeople are
   not part of this step: they are always assigned by hand, in the
   inspector or with paint mode — the people named in a venue's file
   are the hotel's salespeople, not Encore's, so the wizard creates
   none and the import attaches none.
5. **Name the venue.** A summary of the choices, then "Create venue and
   import": the YAML is built (`buildVenueYaml`), a save picker asks where
   to put it so it is linked like the other venues, and the file imports
   straight onto the board through the normal review flow, with the chosen
   date range.

The wizard's choices become the YAML: `file_input.header_row` and
`room_separator` when they differ from the defaults, `rooms.unassigned_room`
when set, `fields.setup_start` / `fields.teardown_end` when mapped,
and `timeline_items` in the venue's own words ("Bump In",
"Bump Out" for MCG, "Setup", "Teardown" otherwise). The MCG export was the
test case: 608 events, 84 spaces, headers on row 2,
rooms separated by ";", bump in/out as setup/teardown. A full import of it
gives 602 bookings (6 "To Be Cancelled" excluded), 534 with a bump-in/out
timeline, 60 in "Unassigned", and a
90-day first import gives 172.

## Planned: TimeTarget setup-time import

Not built yet. In editor mode, an Excel export from the rostering system
(TimeTarget) — a list of rooms, functions, and dates/times, the function
usually "Set Up" — will be uploaded, and for each entry a text notation
showing the time in 24-hour time will be added automatically at that time
on the booking grid, editable like any other text notation. TimeTarget
room names carry the venue name on the front and do not match board room
names, so each row is matched to a board room through
`rooms.timetarget_areas` (board room → the name TimeTarget uses for that
room), edited in the Timetarget Area Name column of the room table. The
import still needs the file's actual columns/sheet layout before it can
be built.

## Tests

`npm test` runs `scripts/check-matching.mjs` (esbuild, no new dependencies):
181 checks covering matching tiers and weights, booking identity, height and
width merges, operable-wall gating, exact-title cross-room merges, strong
borders, merge groups, lanes, `likeBookings` / `blockCountForBookings`,
night compression, and configuration validation (including `operable_walls`
read, default, and rejection of a non-list value). Run it before pushing;
the build (`npm run build`) must also be green.

## Known limitations

- File linking needs the File System Access API (desktop Chrome/Edge). The
  board still works unlinked (browser storage only), but nothing is written
  to disk and the board is lowlit.
- The editor lock is only shared when the board file is linked.
- Legacy unanchored markup does not print (it cannot be positioned).
- The print header repeats per room chunk, not per vertical page break
  within a chunk.
- In the import review, the selection is re-derived when the result
  changes (e.g. after linking a match), which resets manual ticks.
- Colours lost in a bad re-import are not recoverable — they need re-doing
  once (the board-cache carry-over prevents it recurring).
- The board is a desktop-browser tool, never phone.
