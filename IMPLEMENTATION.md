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
  threaded into date parsing; the other two into the reader. All three
  are editable on the Configuration page (Event file section) as well as
  in the setup wizard: a booking whose cell names several rooms lands on
  the grid in every room it names — one block per room, joined into a
  single wide block only where the walls between them are operable.
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

- **Multi-day events.** A venue can write one row for a whole span — the
  MCG writes "Project Control 2026 (1 Day Bump in + 2 Days)" for a
  three-day event, so the board only showed it on the bump-in day. The
  import parses that parenthetical (`parseMultiDayDays`: bump-in days +
  event days) and makes one booking per day, same title, times and rooms,
  each carrying over from its own previous booking. The setup (bump-in)
  attaches to the first day only and the teardown (bump-out) to the last
  day only; middle days are just the event. Only the explicit "N Day(s)
  Bump in + M Day(s)" form expands — a bare "(Day 2)" or "(Bump in)" is
  a single day. Browser-verified on the real MCG export: Project Control
  2026 expands to 23, 24, 25 Nov, six rooms each day, Bump In on day 1,
  Bump Out on day 3.
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
- **Job number per room.** A booking in several rooms can carry a
  different number in each room (`jobNumbers`, room id to number, on the
  booking; the booking's own `jobNumber` is the number for every room
  without an entry). The inspector edits the number for the block clicked
  — the booking's own number when the booking is in one room, a per-room
  number when it is in several — and a per-room list (with a NO AV tickbox
  per room) sits under the field, so 30 of 61 rooms can be NO AV while the
  rest share a number. There is no one-shot for one number in every room:
  jobs differ per room, only the colour is shared across the whole event.
  A collapsed "Related bookings" list in the inspector shows the same
  event on other days, or in other rooms as its own booking, in a
  scrollable frame, each with a job number field and a NO AV tickbox, so
  their numbers can be set without opening each one (bookings in the
  block being edited are left out — they share its number already).
  A wide block spanning several rooms is one big room with one event and
  one job number, so it shows the booking's number (and its grey/NO AV
  rendering follows that number). The per-room numbers carry over on
  re-import like the booking's number. The match veto still fires when
  the numbers live per room (`matchJobNumber`: the booking's number,
  else its first per-room number). The event identity (`identityKey`) deliberately excludes the job number: including it made
  a booking unfindable the moment a number was set, so the carry-over
  missed, the review called it unchanged, and the number was lost on the
  next re-import. The job number stays in the per-row id.

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
both sides vetoes a match outright. The review header has Select all and
Select none buttons — Select all ticks every change, including the
under-80% matches that start unchecked, so a long import is not a click
per row; Select none unticks them all.

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

- **Two-row header.** The board header is two rows. A combined room gets
  a merged cell on the top row spanning its member columns (Palladium
  spans its five rooms), with each member listed underneath on the second
  row by the part of its name after the words it shares with the combined
  name ("Palladium C1" is "C1", "Jim Stynes A" under "Jim Stynes Grill"
  is "A"); a room in no combined room gets one cell spanning both rows,
  vertically centred. The Date / time corner spans both rows too. A
  mapping that names one room, or rooms that are not on the board, makes
  no group. A venue also names bookable subsets ("Promenade 1 & 2",
  "Palladium B & C") alongside the full room, and those subsets are for
  resolving an export row to rooms, not for the header: a mapping only
  becomes a header group when every one of its members is on the board
  and not already claimed by a larger group, largest first, so the full
  room claims its members even if the YAML lists a subset first. Without
  that, every subset made its own header and they all piled on top of
  the full room's. The board renders rooms in display order
  (`boardRoomOrder`): each combined room's members sit together and
  alphabetically, emitted where the group's first member appears, and
  the combined room name itself gets no column of its own when it is
  also a room — bookings in it expand to its members on import, so the
  column would be empty and the name would read twice (once as a
  standalone room, once as the group header). This matters because a
  venue's room order is not guaranteed to keep members together: the
  MCG export lists its member rooms interleaved (Jim Stynes B, Olympic
  Room A, Olympic Room B, Jim Stynes A, ...), which made the group
  spans overlap and the headers pile on top of each other. The group
  header fits its name across the spanned width, a member fits its
  short name in its own column, and the header height is measured so
  the day height adapts. Browser-verified on the real 2–3 Dec board
  (Crown header is now just Palladium, River Room, Garden Room,
  Promenade, M1 - M4, M5 - M10, M11 - M16, Conference Hall — no subset
  headers, no overlap) and on the real MCG YAML (12 checks: no
  duplicate combined names, no overlapping group headers, members
  A, B, C in order).

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
  across operable walls. When the venue has set no `operable_walls` list
  at all, `boardSettings` derives one from the combined rooms: the walls
  between the rooms of each `room_mappings` entry are operable, because a
  combination only exists where those rooms can be opened into one space.
  Only walls between rooms that sit next to each other in the board order
  count. An explicit non-empty list wins — unticking a wall in
  Configuration writes it back, and the derivation stops applying. An
  explicit empty list is treated as unset and the walls derive: before
  the derivation existed, any config save wrote `operable_walls: []`
  into the YAML, and that stale empty list blocked every merge even
  though nobody chose to remove a wall (fixed 2026-11-23).
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
- **Lanes are per room, not per block.** A block keeps the span it
  occupies in each of its rooms (`roomSpans` on the block, filled in by
  `blocksFor` when groups are created and merged; `spanInRoom` falls back
  to the block's overall span when a room has none). `assignLanes`
  decides overlap room by room on those spans: a setup listed on one
  room does not push a merged block into a lane in a room where it does
  not overlap anything. The Carlton case: the B booking has no timeline
  (19:00-22:30) while the C booking carries Setup 15:00-18:30, so the
  merged block's union span (15:00-00:30) overlapped Mortgage Choice
  (16:00-18:30) in B and the block was squeezed to half width in the
  right lane, starting at the C1/C2 boundary — but in B the event is
  only there 19:00-22:30, after Mortgage Choice leaves, so it now keeps
  the full width. A real overlap in the block's own room still splits
  it. (The block still renders as one rectangle on its union span, so
  in B it covers 15:00-18:30 where Mortgage Choice sits — a 16px
  overlap at the bottom of that block in column B that hides no text;
  a single rectangle cannot have a different top per room.)
- **Notes gate the width merge.** Two blocks merge across rooms only
  when their Notes are compatible (`notesMatch` in `blocks.ts`: the
  same after trimming, or one side has none). Two bookings with the same
  title and times but different Notes are different things — the
  Carlton B booking ("FRR - increase numbers") must not merge into the
  C booking ("Dinner") just because the title and times match, even
  though the inspector rightly says the C booking is in 3 rooms. A
  manual merge (mergeGroup) is an explicit user choice and is not
  gated. The gate only applies when both blocks come from a single
  booking: a block height-merged from many sessions carries only its
  first session's Note, which does not describe the block, so it must
  not block a merge — the Mortgage Choice day is many sessions with
  many different Notes in each room, and its A and B blocks still
  merge into one.
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
- **No job number.** A block with no job number (`blockHasJobNumber` in
  `blocks.ts`: a real number set, not empty and not NO AV — NO AV is
  already unavailable and grey) renders with a white body and only its
  left facts strip in the salesperson's colour; a block with a job number
  keeps the whole block in the salesperson's colour. The print view does
  the same for blocks with a facts strip; a compact print block (no
  strip) keeps its colour, since the colour is its only salesperson
  signal.
- **Very short blocks.** A block shorter than 16px hides its title and
  facts text — even the smallest title (8px) and the facts (15px) would
  be clipped to a sliver (a 1-hour teardown continuation showed as a thin
  strip of tiny text). The facts strip stays, empty but coloured, so the
  salesperson colour still shows and a no-job-number block (white body)
  stays visible; the tooltip still carries the title and times. The print
  view hides its text below 12px (its compact line is 10px).

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
  inspector's "Hide from board" checkbox. Hiding is per room: a booking
  in several rooms (an MCG booking in 61 of them) carries `hiddenRooms`
  (the rooms it is hidden in) alongside `hidden` (hidden everywhere), so
  hiding one block hides that room only, not the whole booking — the
  inspector hides the block it was opened from, and offers "Hide in all
  N rooms" when the booking is in more than one. Unhiding one block of
  a booking hidden everywhere keeps the other rooms hidden. Both flags
  carry over on re-import.
- **Inspector.** Clicking a block (editor, unlocked) opens the booking
  details popup. The popup sits above everything (dimming backdrop z 3000,
  the edited block raised to 3001 so it stays bright, panel z 3002);
  clicking the edited block cannot re-open it and discard edits. Fields:
  title, job number (with a NO AV tick box — ticking sets the job number to
  `NO AV`, unticking clears it), salesperson dropdown, Unavailable tick
  box, Hide from board, merge checkboxes, Merge left/right, Unmerge. Saving
  a job number writes it to every booking in the block. The job-number
  field sets the booking-level number as well as the per-room overrides:
  a room with no override falls back to the booking-level number, so
  clearing NO AV used to leave a booking-level 'NO AV' in place and the
  block stayed grey — the untag looked broken. Assigning a
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

- **Random colours per event.** A tickbox in the palette section
  (`whiteboard.random_event_colours`) colours blocks by event instead of
  by salesperson: `eventColour` hashes the normalised title to a pastel
  hue, so every block with the same name matches — the same event in
  several rooms, or the same title on other days — and the colour is
  stable across reloads and re-imports, with nothing stored. Salespeople
  can still be assigned (initials and the filter still work), but their
  colours do not show while it is on; unavailable stays grey. The
  printout matches the board.

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
- **Tool gating.** A note or arrow is only editable when its own tool is
  selected in the top bar: a text box with arrows (or no tool) selected is
  inert, and an arrow with text notes selected is inert — it cannot be
  dragged, edited or deleted, and clicking it does not create a new note
  or arrow on top of it. Switching tools drops the selection, so a note
  selected in text mode is not still selected (and deletable) after
  switching to arrows. The text does not move when a note is highlighted
  or edited: the Edit/Highlight/Delete buttons sit below the note
  (absolutely positioned) instead of inside it, so they cannot widen the
  centred note, and the edit box is given the note's own width instead of
  a fixed 220px.
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
- **Placement.** A text note is centred above the block it belongs to
  (`src/lib/notePlacement.ts`, `placeNote`): its left edge is the block's
  centre, its width fits its text, and when it would overlap the block it
  moves just above it. When that would overlap the block above too, it is
  centred between the two and highlighted. The spans it is placed against
  use the block's own event times (`mainStart`/`mainEnd`), not the
  timeline-extended span, so a setup note hours before the event stays at
  its anchor instead of being flung above a block that only reaches its
  time because of its setup.
- **Dragging starts where the note renders.** An imported note stores
  0,0 and renders from its anchor, so a drag must start from the rendered
  position, not the stored one — dragging from 0,0 re-anchored the note to
  the top-left corner, where it looked vanished. Movements under 3px are
  ignored, so a click selects without moving the note.

Markup travels in the shared board file (it used to live only in each
browser's localStorage, so it never showed across devices). The lowlight
overlay never blocks it: the overlay sits at z 2500, the toolbar at 2600,
the inspector at 3000/3002, dialogs at 4000. Loading a board file
drops a duplicate markup id, keeping the first copy: two notes with one
id made React duplicate the note on every render, and MarkupLayer's
measure() re-rendered on every one of those DOM mutations because it
set fresh state objects even when nothing moved, so the page never
settled and the duplicated note count grew until it died. measure()
now only sets size/layout when the numbers actually changed (fixed
2026-11-23, harness 280 checks).

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

- **Bookings export** (any file type) — read-only, linked for re-import, never
  written. The pickers are not filtered by extension: the export can be
  any file type, and the reader sniffs the content (HTML table vs
  SheetJS) rather than the name. `pickLinkedFile` takes no types for
  it, and the plain-input fallback and the wizard booking file have no
  `accept` filter.
- **Venue YAML** — written back on config save when linked; "Export YAML"
  prompts for a location so it can save over the existing file.
- **Board** (shared board file, gzipped JSON, `.json.gz`) — the live board.
  The editor auto-writes it (debounced 500ms) whenever bookings, revision,
  markup or the editor lock change. So editor changes save immediately as
  they are made; the top-bar button is just "🔄 Refresh" (re-read the board
  file). It is compact JSON through gzip, not pretty text — a 1,500-booking
  board is ~49KB instead of 4.62MB. Old plain `.json` board files still
  open (gzip is detected by magic bytes). There is no import history in
  the file any more: it was only the undo for a bad import, and the
  bookings export is the source of truth, so a bad import is fixed by
  re-importing the right export. The single previous-import snapshot in
  localStorage (for carrying job numbers and colours across a re-import)
  is separate and stays.

Handles are stored in IndexedDB so the links persist across app versions;
on mount each handle is restored only if its permission is still `granted`.
The 🔗 Link files button turns red while any file is unlinked, and the whole
board is lowlit (a fixed overlay above the board but below the toolbar and
dialogs) until all three are linked — the board is not reading and writing
its files then. All popup dialogs (review, configuration, link files) sit at
the top of the z-order (4000) so the lowlight never dims them.

The 🔗 button is always shown: it used to be hidden in browsers without
File System Access (Firefox, Safari, every iOS browser), which made file
linking silently vanish — the panel is only reachable through that button.
In such a browser the button still opens the panel, which says plainly
that linking needs Chrome or Edge on a desktop, greys out the Link/Open/
Save-as buttons, and keeps what still works: Import (which falls back to
a plain file picker — the file imports, it just is not linked, so Refresh
cannot re-read it) and Download. The welcome overlay likewise only offers
"Link an existing venue file" where linking is possible.

## Configuration page

`src/components/ConfigurationPage.tsx` + `src/configuration.css`. Every
parameter in the YAML is editable, not just the rooms: site, fields,
display, rooms, timeline items, file input, and the
whiteboard section, plus a raw YAML editor. Exceptions: the original
planner's `output` settings and `time_slots` are not shown (both stripped
from the YAML when a config is read or saved); `rooms.exclude` is kept in
the YAML and still read at import, but is not edited on the page. The
room table is
**Order | Room | Alias | Timetarget Area Name | Type | Strong Border After |
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
- **Strong Border After** — tick a room to draw a strong border after it.
  The table draws it too: the row gets the same thick line the board
  draws (`3px solid #141414`, the `.group-edge` line) along its bottom,
  so the room sections read in the table the way they read on the board.
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
- **Combined rooms** — there is no separate section: a combined room
  lives in the rooms table itself, as a parent row with its member rooms
  as indented child rows beneath it. A combined room whose name is
  itself a room on the board (Olympic Room, Jim Stynes Grill) is that
  room's row, with its members underneath; a combined room whose name is
  not a room (Palladium) is a group header row with its members
  underneath. A room in two combined rooms shows under the first. The
  Combined room column holds the grouping controls: an Add-member
  dropdown on a parent or standalone room (picking one makes the room a
  combined room), Ungroup on a parent, and Member-of plus Remove-from-
  group on a child row; a new combined room is added below the table.
  The TimeTarget area column holds the area name TimeTarget uses for
  the whole combination. Each name is one entry per spelling the venue
  uses. A combined booking renders as one wide block because the walls
  between the rooms of a combination are filled in as operable (see
  Operable walls above); an operable wall merges
  separate bookings, it does not expand one booking, so the mapping is
  still what turns a combined export name into board rooms. Typing a
  combined room name works: the group row is keyed by its position, not
  its name, and its name commits on blur (keying on the name unmounted
  the row on every keystroke and dropped focus after one character);
  renaming and removing a row each update the mapping and the TimeTarget
  area in a single change (two separate changes cloned the same draft,
  so the second overwrote the first and the name edit was lost and
  Remove left the row in place), and `change()` rebuilds the YAML from
  the latest text via a functional updater so a keystroke that lands
  before React re-renders cannot clone a stale draft and drop the edit
  that just landed. Browser-verified on the real Crown YAML: the table
  groups Palladium over its five rooms, Add-member and Remove-from-
  group move a room in and out of a group, and Add combined room
  creates a new group header row.

Salespeople are edited in their own table (Name, Short name, Colour), and
the YAML can be exported with a save-location prompt. All three tables
(field mappings, rooms, salespeople) are zebra-striped: every other body
row gets a slightly darker background (`#efe9de`, set on the cells in
`configuration.css` so it paints under `border-collapse`), while the
header keeps its own colour (`#e7e1d8`), so a long list reads across
without losing the row.

## Print view

`src/components/PrintView.tsx` + `src/components/printView.css`. The 🖨️
Print button (all roles) opens a date-range picker — it defaults to the
min/max booking dates on the board (or today → today+6 when there are no
bookings), capped at two weeks — and "Show print view" renders a
print-friendly board on one landscape sheet.

- **Layout.** The height is one page: the whole date range fits down
  every sheet, the day height scaling so all the dates fit (a short
  range gets tall days, a two-week range gets short ones). The width
  may split across landscape sheets: rooms flow across as many sheets
  as they need, each sheet carrying the date column and a run of
  rooms, and a block spanning a sheet boundary prints its part on
  each sheet it touches. The range is capped at two weeks, in the
  picker (the To date cannot pass start + 13 days) and in the view
  itself. Room widths are the board base widths clamped to
  110–180px; a room with no bookings in the range is an empty column,
  shrunk to just the width its name needs at a readable size (never
  below 40px, never above its natural width). Every room name is
  autofitted to its column: the header font scales down from its
  base size so a long name in a narrow column still fits. The sheets
  carry no extra margin or padding in print, so a sheet never spills
  onto a blank second page, and each sheet breaks after itself
  except the last.
- **Blocks.** `blocksFor` runs with `showHidden: true`, so hidden bookings
  print (faded, dashed) and nothing is silently missing. Blocks running
  past midnight are split into per-day segments and clipped to the range.
  Lanes, strong borders, and the night compression all apply as on the
  board. Blocks are normal grid items (`gridColumn` / `gridRow` +
  `marginTop`), not absolutely positioned — Chrome's print layout misplaces
  absolutely positioned blocks onto the wrong sheet, so this is what makes
  each block land on its sheet. A block spanning a sheet boundary is
  clipped to each sheet it touches, so its part prints on both. Short
  blocks (under 30px tall) render
  one compact line (title + time) so the text stays inside the block.
- **Colours.** Block backgrounds print at 50% opacity (`hexToRgba(hex,
  0.5)`) so the printout does not kill printer ink; text stays full
  strength. Unavailable blocks print grey at 50%; unallocated blocks print
  the paper colour at 50%. Date cells use the same past/today/future colours
  as the board, and today's row keeps the canary highlight.
- **Annotations.** Anchored notes and arrows render from their anchors
  (via `pointFromAnchor` with an `AnchorLayout` built for each sheet:
  row tops are `i × dayHeight`, room lefts are the cumulative widths
  of that sheet's rooms). Text notes print at their anchor
  (highlighted ones on yellow); arrows render in an SVG overlay
  (`#7a1f1f`, 3px, arrowhead marker) only when both ends resolve on
  the same sheet. Legacy unanchored markup cannot be positioned, so
  it is skipped in print.
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
   count — each room is Keep, Other, or Exclude. Other rooms are kept as
   individual columns at the end of the board, after the main rooms, and
   grouped under a combined room called OTHER, so they read as one group
   in the overnight notes and in the grouped rooms table instead of as
   stray columns. One cell can name several rooms; the separator is
   detected (`;` for MCG) and editable. Events with no space go in an
   "Unassigned" room when the box is ticked.
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
   to put it so it is linked like the other venues, then a second save
   picker asks where to put the new venue's blank board — an empty board
   (no bookings, no markup, revision 1) saved as a new `.json.gz` and
   linked as the board file, so the new venue never reuses the old
   venue's board — and the file imports straight onto the board through
   the normal review flow, with the chosen date range.

   A venue is delinked from the Link files panel: **Unlink** on the
   Venue YAML row forgets every linked file (board, YAML, bookings
   export), clears the venue and the board, and re-opens the welcome
   overlay, so another venue can be set up. The board handle is dropped
   first, before the bookings are cleared, so the auto-save cannot write
   an empty board over the old venue's board file — the files on disk
   are left untouched.

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

## TimeTarget setup-time import

Shipped 2026-11-21 (tests 227/227, live verified). In editor mode, the
⏱️ Times button on the top bar imports a TimeTarget rostering export —
columns Date, Start Time, Function, Area, Event, row 1 the header — as a
one-off import, not a linked file: plain file picker, no refresh. Each
row becomes a text notation on the grid at that time in that room
("Set Up 06:30"), editable like any other note afterwards, and it saves
with the board like any other note. The sample file the import was built
against is `test-data/timetarget-sample.xlsx`, made from real Crown bookings.

- **Columns** (`src/lib/timetargetImport.ts`): matched case-insensitively
  (Start Time also answers to Start/Time, Area to Room, Event to Event
  Name/Title). Date is DD/MM/YYYY (Excel serials work too); the event
  column is optional. A file missing Date, Start Time, Function or Area
  is refused with the missing columns named.
- **Rooms:** each row's area is matched to a board room through
  `rooms.timetarget_areas` first, then a board room name itself, then an
  alias. A row whose area matches nothing is skipped and reported by
  row number, never silently dropped. The import ends with a summary:
  notes added, notes updated, skipped rows with reasons.
- **Event (fuzzy):** the event name may not match the board title
  exactly ("Sample Gala Dinner 2026" against "Sample Gala Dinner"), so the match is loose — one name contains the other
  once both are normalised. The date and room already pin the booking
  down. When several sessions of one event share the room and day, the
  closest start time wins (a setup precedes its session). A row with no
  event still imports, with no booking attached.
- **Notes and re-imports:** a note the import creates carries
  `source: 'timetarget'` and a key (date|room|function|event|booking).
  A later import updates that note's text and position instead of
  duplicating it — first by the exact key, then by the only note for
  that date, room, function and booking when the event name was tweaked.
  The booking is part of that fallback on purpose: two sessions of one
  event share date, room, function and event, and only their bookings
  tell them apart. A hand-typed note has no key and is never touched,
  and the import never deletes a note — a setup that drops off the
  export keeps its note until someone deletes it. The notes are indexed
  once (by key, and by the setup key with a count), and the bookings are
  grouped by date once, so a large file applies in linear time: a
  20,000-row file took 55 seconds and hung the page when every row
  rescanned the whole board, and now applies in 108ms with identical
  notes (fixed 2026-11-23, harness 280 checks).
- **Still to do on Brendan's side:** fill in the Timetarget Area Name
  column in Configuration for the rooms (the Crown YAML has none yet),
  and lay out the real export in the sample's format.

## Jobs import

Shipped 2026-11-23 (harness 293 checks, live verified). In editor
mode, the 📋 Jobs button next to ⏱️ Times imports the sales system's
jobs export — columns Order Id, Description, Sales Person, Start Date,
End Date, row 1 the header — as a one-off import, not a linked file.
The Order Id IS the job number, and the Description is "Area | Event"
in the same format as the TimeTarget rows. The list is kept in the
shared board file (`jobs`, `jobsImportedAt` on `SharedBoardFile`), so
every editor sees it and the inspector can offer possible matches
without re-importing; re-importing replaces it, and the summary dialog
has a Clear jobs list button. Clearing the list drops it from the file
— job numbers already set on bookings are untouched. An old board file
with no jobs field loads with an empty list. Nothing is auto-assigned:
the editor picks a job from the list, or types a number in. The list is
per venue, not per browser: setting up a new venue (wizard or Unlink)
clears it, because the old venue's jobs would otherwise be offered as
possible matches on the new venue's bookings — the list lives in
memory, and the blank board a new venue gets is empty, but the
in-memory list would refill it on the next auto-save. A "Clear jobs"
button sits next to 📋 Jobs in the top bar whenever a list is loaded,
so a board that already picked up the wrong venue's list can be
cleared without re-importing.

- **Columns** (`src/lib/jobsImport.ts`): matched case-insensitively
  (Order Id also answers to Order/Order No/Id, Sales Person to
  Salesperson/Sales Rep/Sales, Start/End Date to Start/End). Dates are
  Excel serials or ISO. A file missing Order Id, Description, Start
  Date or End Date is refused with the missing columns named. Rows with
  no Order Id are skipped and reported by row number.
- **Candidates** (`findJobCandidates`): a job is offered for a booking
  when its event name overlaps the booking title (word-overlap >= 0.5,
  generic words like dinner/lunch/christmas/2026 dropped first, so a
  one-word match like "TLC" alone only scores 0.5) and its dates cover
  the booking — a day either side, because the two systems can disagree
  by a day (the TLC dinner is dated the 28th in the sales system and
  the 29th on the board; Omega Chemicals the 27th vs the 28th). The
  salesperson lifts a candidate by 0.1 and breaks ties, so a multi-job
  event's several jobs sort with the booking's salesperson on top — but
  only when the jobs have different salespeople; the AI Care jobs are
  all Lana Richards', so their Area (Prom 1 & 2, M1&2, Prom 3) is what
  tells them apart. Salesperson names match by full name, by initial
  ("C. Coughey"), or by last name only; a contradicting initial
  ("M Carrasco" vs "Cecilia Carrasco") does not match.
- **Inspector** (`BookingGrid.tsx`): under the Job number field, a
  "Possible jobs" list shows each candidate's Order Id, Area, event,
  salesperson (with a ✓ when it matches the booking's salesperson) and
  its dates when it is a day out; the row already set on the booking is
  marked Selected. Clicking Select fills the job number field (the
  booking's level number; per-room numbers are still typed in by hand)
  and, when the job's salesperson matches someone in the palette
  (`jobSalesperson` in `jobsImport.ts`, the same name matching as the
  ✓), selects that salesperson too — overriding the booking's current
  one. A job with no salesperson, or one the palette does not have,
  leaves the salesperson alone. The number and the salesperson land in
  one draft update, so neither clobbers the other.
  With no jobs list loaded the inspector shows a hint to use 📋 Jobs;
  with a list loaded but no match it says so.
- **Measured against the real export** (23 Nov–31 Dec, 132 board
  events): 57 match one job confidently, 25 are too fuzzy (mostly one
  event with several jobs, plus a few weak single matches), 50 have no
  job at all (24 internal with no job to find, 26 client events not in
  the export). The list Brendan ran is a from-today export to 31 Dec,
  so events after that date have no jobs to match against.

## Weekend notes export

Shipped 2026-11-21 (tests 248/248, live verified; reworked four times
the same day — first to follow the samples' formatting, then to output a
real Word document, then to list only purple-noted events, then to list
every event with purple times only). Reworked 2026-11-23: the footer names
the venue's After Hours Contact, setup/pack-down read "SU"/"PD", and the
button reads
"Overnight Notes" Monday to Thursday and "Weekend Notes" Friday to
Sunday, naming what it will generate. The duty-manager table was dropped
for the overnight notes that day and put back the same day: it belongs in
the weekend export only, not in a weeknight's overnight notes. The 📄 notes button on the top bar (all
roles — it only reads) downloads a .docx file for the overnight crew:
the template they work from, with an empty bullet list under each
event to write in. No file picker, no linking — the button just spits
the file out.

- **The window** (`src/lib/weekendNotes.ts`, `overnightWindow`): on a
  non-Friday weekday it is 5pm today to the end of tomorrow, so it
  lists ALL of tomorrow's events; on a weekend it is Friday to 7am
  Monday, so it lists ALL of the weekend's events. The date decides
  the window, not the time of day, so opening it on a Saturday still
  gives that weekend's window. The file is titled "Weekend Notes Friday Oct 2 - Sunday Oct
  4" for a weekend window and "Overnight Notes Tuesday Oct 6 -
  Wednesday Oct 7" for a weeknight one.
- **The format follows Brendan's own weekend notes**
  (Weekend_Notes_Oct_24-25.docx, Dec_12_to_Dec_14_Weekend_Notes_V1.pdf),
  read out of the .docx XML — including the parts the RTF version got
  wrong. The body font is **Calibri**, not Tahoma: the samples' theme
  minor font is Calibri, and the Tahoma in styles.xml is an 8pt
  footnote style. The title lives in the **header** (24pt bold,
  centred — "Weekend Notes Fri, 2 Oct - Sun, 4 Oct", the compact range
  as the samples write it) and the body starts with the duty-manager
  header table on a weekend window — a weeknight's overnight notes start
  straight at the first day section, with no table. The
  footer carries "After Hours Contact: 0427 421 821" and "Page N of M"
  (real PAGE and NUMPAGES fields), bold 12pt, centred. The contact is
  the venue's `site.after_hours_contact` from Configuration, defaulting
  to the Crown on-call number when blank. The page is A4
  with 1440-twip margins, as in the samples.
- **The header table** (weekend only) is a 4-column TableGrid: "Duty
  Manager – ____" (blank — the board does not know the duty manager),
  the two days (Saturday and Sunday), blank start/end hours for each
  day, and "After Hours Contact: 0427 421 821" from the venue setting.
  Event headings are bold 18pt, day
  headings bold 14pt, body 14pt, and the default paragraph spacing is
  after 200, line 1.15, as in the samples. The one deliberate
  difference from his hand-written notes: every day gets a heading,
  where his leave the first day unheaded.
- **The .docx writer** (`src/lib/docx.ts`) is hand-rolled, no new
  dependency: a minimal zip writer (stored entries — the files are
  tiny, and stored entries keep the XML readable in the bytes, which
  is what the tests assert on) plus the XML parts a Word document
  needs ([Content_Types].xml, package and document relationships,
  document.xml with an A4 section, styles with a Calibri default and a
  Table Grid style, a font table, a header, a footer, core/app
  properties). The harness checks the zip structure directly (local
  headers in order, end of central directory counting the parts) and
  the XML escaping. The generated file passes `unzip -t` and renders
  correctly in LibreOffice.
- **What is listed:** every event in the window — a booking's
  Setup/Teardown timeline entries (Crown calls them Setup/Teardown,
  MCG calls them Bump In/Bump Out) and any TimeTarget note in the
  window. A setup that starts before 5pm and runs past it is in; a
  pack-down past midnight is in (an end at or before its start is read
  as the next day). And every booking on a full day in the window is
  listed even when it has no setup or pack-down recorded — the notes
  list ALL the events for the next day (or the weekend), so an event
  with no work is listed with no time lines and the crew writes the
  times in. **One event is one entry, however many functions
  it has** — the notes for one event on one day combine into one item,
  each function a line under the one heading, earliest first. A setup
  and its pack-down are two lines under one heading, not two
  entries. Items print by room in board order (the event's first
  room), then by day, then chronologically within the room: all the
  Palladiums by date, then all the Rivers, then all the Gardens. The
  document is sectioned by room area — a Palladium event in one room
  and a full-Palladium event share a "Palladium" heading — and each
  event is headed by its date and title ("Tue, 24 Nov — Title").
- **The times:** a time on a line is always a purple TimeTarget note's
  own time ("SU 06:30", "PD 22:30"). The hotel's timeline
  times are never shown. A function with no purple note in the window
  is listed by its short name alone ("SU", "PD"), so the crew
  writes the time in. "SU" is short for Set Up and "PD" for Pack Down,
  in the notes and in the export alike. The note's time is stored on the note itself
  (`MarkupItem.time`, set by the TimeTarget import); a note made
  before that field existed has its time read back out of its text.
  A note with no booking is matched back to one before it is listed:
  by the event name in its TimeTarget key (the import's match strips a
  job/area prefix and allows a truncated event, so "1020926 - pall |
  cba and sbv retired staff christmas lunch 2" still finds "CBA and
  SBV Retired Staff Christmas Lunch 2026"), and otherwise by the
  closest session start after its time in its room — so an orphaned
  note exports with its event's title and combined room, not as a
  nameless setup in one room. A note that matches nothing is still a
  setup on its own, by its function.
- **The purple notation:** TimeTarget notes render in purple on the
  board (`.markup-note.timetarget`) and on the printout, so the notation
  the export reads is visible as such. A hand-typed note is never
  purple and is never read by the export.
- **The file:** .docx (MIME
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`),
  one section per day, each event with its setup time and three empty
  "- " bullets. An empty window still produces a file saying "No
  setups in this window", so the crew can see there is nothing
  overnight instead of wondering whether the export failed. Only board
  data is used: room, title, date, setup time. No job numbers,
  salespeople or duty manager — none of those are in the template.

## Tests

`npm test` runs `scripts/check-matching.mjs` (esbuild, no new dependencies):
311 checks covering matching tiers and weights, booking identity, height and
width merges, operable-wall gating and derivation from combined rooms,
exact-title cross-room merges, strong
borders, merge groups, lanes, `likeBookings` / `blockCountForBookings`,
night compression, and configuration validation (including `operable_walls`
read, default, derivation, and rejection of a non-list value), note
placement and the drag-from-rendered-position fix, SU/PD short names, the
overnight-notes button title, the weekend-only duty-manager table and the
After Hours Contact footer, and the Jobs import (column finding, area/event
splitting, name scores, salesperson matching, candidate ranking with the
salesperson tiebreak and the ±1 day window, the job-to-salesperson
resolution used when a job is selected, and the board-file round-trip
with the jobs list), and `blockHasJobNumber` (a real number counts; empty
and NO AV do not), and per-room lane spans (a setup on one room does not
lane a merged block in another room; a real overlap still splits),
and the Notes gate on the width merge (different Notes do not merge;
same Notes do; height-merged blocks still merge). Run it before pushing;
the build (`npm run build`) must also be green.

## Known limitations

- File linking needs the File System Access API (desktop Chrome/Edge). The
  board still works unlinked (browser storage only), but nothing is written
  to disk and the board is lowlit.
- The editor lock is only shared when the board file is linked.
- Legacy unanchored markup does not print (it cannot be positioned).
- In the import review, the selection is re-derived when the result
  changes (e.g. after linking a match), which resets manual ticks.
- Colours lost in a bad re-import are not recoverable — they need re-doing
  once (the board-cache carry-over prevents it recurring).
- The board is a desktop-browser tool, never phone.
