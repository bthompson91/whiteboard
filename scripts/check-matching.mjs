// Logic tests for the import pipeline — no browser, no test framework.
// Bundles the pure modules with esbuild (already a dependency of vite),
// imports them, and checks matching, review application and date/time
// parsing. Run with `npm test`. Exits non-zero on any failure.
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(join(tmpdir(), 'whiteboard-test-'));
try {
  await build({
    entryPoints: [
      join(root, 'src/lib/importComparison.ts'),
      join(root, 'src/lib/reviewApply.ts'),
      join(root, 'src/lib/dateTime.ts'),
      join(root, 'src/lib/configuration.ts'),
      join(root, 'src/lib/blocks.ts')
    ],
    outdir: dir,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent'
  });
  const { compareImports } = await import(pathToFileURL(join(dir, 'importComparison.js')).href);
  const { applyReview, changeKey } = await import(pathToFileURL(join(dir, 'reviewApply.js')).href);
  const { dateValue, timeValue, dayKind } = await import(pathToFileURL(join(dir, 'dateTime.js')).href);
  const { resolveSalesperson, bookingColour, salespersonInitials, UNAVAILABLE_SALESPERSON } = await import(pathToFileURL(join(dir, 'configuration.js')).href);
  const { blocksFor, strongBorders } = await import(pathToFileURL(join(dir, 'blocks.js')).href);

  let failures = 0;
  const check = (name, cond, extra = '') => {
    if (cond) console.log(`ok - ${name}`);
    else { failures++; console.log(`FAIL - ${name} ${extra}`); }
  };
  const throws = (name, fn) => {
    try { fn(); check(name, false, '(did not throw)'); }
    catch { check(name, true); }
  };
  const booking = (overrides) => ({
    id: 'booking-1', date: '2026-11-19', roomId: 'Room 1', roomIds: ['Room 1'],
    startTime: '18:00', endTime: '22:00', title: 'Charity Gala', ...overrides
  });

  // --- Tier 1: exact match is unchanged ---
  let result = compareImports([booking()], [booking()], 'Venue');
  check('exact match is unchanged', result.changes[0].type === 'unchanged');

  // --- Tier 2: a single changed field is a strong match ---
  result = compareImports([booking()], [booking({ id: 'booking-9', title: 'Charity Dinner' })], 'Venue');
  check('title-only change matches strong', result.changes[0].match?.classification === 'strong' && result.changes[0].match?.reason === 'Title changed', JSON.stringify(result.changes[0].match));
  result = compareImports([booking()], [booking({ id: 'booking-9', startTime: '19:00', endTime: '23:00' })], 'Venue');
  // Time is not part of the identity hash, so a time-only change is caught
  // by the exact-identity path as a changed booking, not a tier-2 match.
  check('time-only change is a changed booking', result.changes[0].type === 'changed' && result.changes[0].changedFields.includes('startTime') && result.changes[0].changedFields.includes('endTime'), JSON.stringify(result.changes[0]));
  result = compareImports([booking()], [booking({ id: 'booking-9', roomIds: ['Room 2'], roomId: 'Room 2' })], 'Venue');
  check('rooms-only change matches strong', result.changes[0].match?.classification === 'strong' && result.changes[0].match?.reason === 'Rooms changed');

  // --- Tier 2 guard: differing job numbers veto the match ---
  result = compareImports(
    [booking({ jobNumber: '111' })],
    [booking({ id: 'booking-9', title: 'Charity Dinner', jobNumber: '222' })],
    'Venue'
  );
  check('differing job numbers veto the match', !result.changes.find(c => c.type === 'new')?.match);

  // --- Tier 2 uniqueness: two one-field candidates fall through to fuzzy ---
  result = compareImports(
    [booking({ id: 'booking-a', title: 'Gala A' }), booking({ id: 'booking-b', title: 'Gala B' })],
    [booking({ id: 'booking-9', title: 'Gala C' })],
    'Venue'
  );
  check('two single-field candidates fall through to fuzzy', !!result.changes.find(c => c.type === 'new')?.match);

  // --- Tier 3: two fields changed still finds a fuzzy match ---
  result = compareImports(
    [booking()],
    [booking({ id: 'booking-9', title: 'Charity Dinner', startTime: '19:00', endTime: '23:00' })],
    'Venue'
  );
  const fuzzy = result.changes.find(c => c.type === 'new')?.match;
  check('title+time change finds a fuzzy match', !!fuzzy && fuzzy.classification !== 'unmatched' && !fuzzy.reason, JSON.stringify(fuzzy));

  // --- Disappeared bookings carry their previous record (no render crash) ---
  result = compareImports([booking(), booking({ id: 'booking-2', title: 'Other Event' })], [booking()], 'Venue');
  const disappeared = result.changes.find(c => c.type === 'disappeared');
  check('disappeared change carries previous', disappeared?.previous?.id === 'booking-2');

  // --- Review application ---
  const previous = [
    booking({ id: 'booking-1', title: 'Charity Gala', colour: '#ff0000', salespersonId: 'sp-1', unavailable: true, hidden: true, jobNumber: '123', timeline: [{ label: 'Setup', start: '15:00', end: '18:00' }, { label: 'Teardown', start: '23:00', end: '00:00' }] }),
    booking({ id: 'booking-2', title: 'Old Event' })
  ];
  const current = [booking({ id: 'booking-9', title: 'Charity Dinner' })];
  result = compareImports(previous, current, 'Venue');
  const selectAll = Object.fromEntries(result.changes.map(c => [changeKey(c), true]));
  let published = applyReview(result.changes, selectAll);
  const merged = published.find(b => b.id === 'booking-1');
  check('accepting a match merges onto the previous booking', !!merged && merged.title === 'Charity Dinner' && merged.colour === '#ff0000' && merged.hidden === true && merged.jobNumber === '123', JSON.stringify(merged));
  check('accepting a match keeps the salesperson', merged?.salespersonId === 'sp-1');
  check('accepting a match keeps the unavailable flag', merged?.unavailable === true);
  check('accepting a match keeps the setup and teardown times', JSON.stringify(merged?.timeline) === JSON.stringify(previous[0].timeline), JSON.stringify(merged?.timeline));
  // When the new import brings its own setup/teardown, those win.
  const current2 = [booking({ id: 'booking-10', title: 'Charity Dinner', timeline: [{ label: 'Setup', start: '16:00', end: '18:00' }] })];
  const comparison2 = compareImports(previous, current2, 'Crown Melbourne');
  const merged2 = applyReview(comparison2.changes, {})[0];
  check('a new import with its own setup time replaces the old one', JSON.stringify(merged2?.timeline) === JSON.stringify(current2[0].timeline), JSON.stringify(merged2?.timeline));
  check('accepting a match removes the disappeared booking', !published.some(b => b.id === 'booking-2'));
  const keepDisappeared = { ...selectAll, [changeKey(result.changes.find(c => c.type === 'disappeared'))]: false };
  published = applyReview(result.changes, keepDisappeared);
  check('unticking a disappeared booking keeps it', published.some(b => b.id === 'booking-2'));
  const rejectMatch = { ...selectAll, [changeKey(result.changes.find(c => c.type === 'new'))]: false };
  published = applyReview(result.changes, rejectMatch);
  const kept = published.find(b => b.id === 'booking-1');
  check('rejecting a matched new booking keeps the previous one', !!kept && kept.title === 'Charity Gala' && kept.colour === '#ff0000');

  // Changed bookings: rejecting keeps the previous version.
  result = compareImports(
    [booking({ startTime: '18:00' })],
    [booking({ id: 'booking-9', startTime: '19:00', endTime: '23:00' })],
    'Venue'
  );
  const changedKey = changeKey(result.changes.find(c => c.type === 'changed'));
  published = applyReview(result.changes, { [changedKey]: false });
  check('rejecting a changed booking keeps the previous version', published[0].startTime === '18:00');

  // --- Date and time parsing ---
  check('DD/MM/YYYY parses day-first', dateValue('19/11/2026', false, 'DD/MM/YYYY') === '2026-11-19');
  check('Excel serial 45292 parses to 2024-01-01', dateValue(45292, false) === '2024-01-01');
  check('MM/DD/YYYY parses month-first', dateValue('11/19/2026', false, 'MM/DD/YYYY') === '2026-11-19');
  throws('month-first date read as day-first throws', () => dateValue('11/19/2026', false, 'DD/MM/YYYY'));
  throws('impossible ISO month throws', () => dateValue('2026-13-01', false));
  check('6:30 PM parses to 18:30', timeValue('6:30 PM') === '18:30');
  check('Excel fraction 0.5 parses to 12:00', timeValue(0.5) === '12:00');
  throws('25:99 throws', () => timeValue('25:99'));

  // --- Salesperson colours ---
  const palette = [{ id: 'sp-1', name: 'Alex', colour: '#3366cc' }];
  check('Unavailable is the grey built-in option', UNAVAILABLE_SALESPERSON.name === 'Unavailable' && UNAVAILABLE_SALESPERSON.colour === '#9aa0a6');
  check('assigned salesperson colour comes from the palette', bookingColour({ salespersonId: 'sp-1', colour: '#ff0000' }, palette) === '#3366cc');
  check('Unavailable resolves to grey', bookingColour({ salespersonId: 'unavailable' }, palette) === '#9aa0a6');
  check('unavailable tick box renders grey', bookingColour({ unavailable: true, salespersonId: 'sp-1' }, palette) === '#9aa0a6');
  check('salesperson colour wins when not unavailable', bookingColour({ unavailable: false, salespersonId: 'sp-1' }, palette) === '#3366cc');
  check('unknown salesperson falls back to the stored colour', bookingColour({ salespersonId: 'sp-gone', colour: '#ff0000' }, palette) === '#ff0000');
  check('no salesperson keeps the stored colour', bookingColour({ colour: '#ff0000' }, palette) === '#ff0000');
  check('resolveSalesperson finds Unavailable by id', resolveSalesperson(palette, 'unavailable')?.name === 'Unavailable');
  check('initials take first and last names', salespersonInitials('Alex Lee') === 'AL');
  check('initials take the first two letters of one name', salespersonInitials('Alex') === 'AL');
  check('initials use the last word for three names', salespersonInitials('Mary Jane Smith') === 'MS');
  check('initials are empty for a blank name', salespersonInitials('  ') === '');

  // --- Block merging: height merges and width merges ---
  const venue = { rooms: [
    { id: 'Palladium A', name: 'Palladium A', order: 0 },
    { id: 'Palladium B', name: 'Palladium B', order: 1 },
    { id: 'River Room 1', name: 'River Room 1', order: 2 },
    { id: 'River Room 2', name: 'River Room 2', order: 3 }
  ] };
  const riverPair = [
    booking({ id: 'a', title: 'River Dinner', roomId: 'River Room 1', roomIds: ['River Room 1'], startTime: '18:00', endTime: '22:00' }),
    booking({ id: 'b', title: 'River Dinner', roomId: 'River Room 2', roomIds: ['River Room 2'], startTime: '18:00', endTime: '22:00' })
  ];
  let blocks = blocksFor(riverPair, venue, [], false);
  check('same title in adjacent rooms at the same time merges into one wide block', blocks.length === 1 && blocks[0].rooms.length === 2 && blocks[0].ids.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'River Dinner', roomId: 'River Room 1', roomIds: ['River Room 1'], startTime: '18:00', endTime: '20:00' }),
    booking({ id: 'b', title: 'River Dinner', roomId: 'River Room 2', roomIds: ['River Room 2'], startTime: '18:00', endTime: '22:00' })
  ], venue, [], false);
  check('same title in adjacent rooms at different times stays two blocks', blocks.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Charity Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '12:00', endTime: '16:00' }),
    booking({ id: 'b', title: 'Charity Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '23:00' })
  ], venue, [], false);
  check('same title in one room at different times merges into one tall block', blocks.length === 1 && blocks[0].start === 12 * 60 && blocks[0].end === 24 * 60, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Charity Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '12:00', endTime: '16:00' }),
    booking({ id: 'b', title: 'charity  gala ', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '23:00' })
  ], venue, [], false);
  check('titles differing only by case or spacing still merge into one tall block', blocks.length === 1 && blocks[0].title === 'Charity Gala', JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'River Dinner', roomId: 'River Room 1', roomIds: ['River Room 1'], startTime: '18:00', endTime: '22:00', timeline: [{ label: 'Setup', start: '15:00', end: '18:00' }] }),
    booking({ id: 'b', title: 'River Dinner', roomId: 'River Room 2', roomIds: ['River Room 2'], startTime: '18:00', endTime: '22:00' })
  ], venue, [], false);
  check('a setup in one room does not stop the wide merge', blocks.length === 1 && blocks[0].rooms.length === 2 && blocks[0].start === 14 * 60 && blocks[0].facts.some(f => f.startsWith('Setup')), JSON.stringify(blocks));
  blocks = blocksFor(riverPair, venue, [], false, ['River Room 1']);
  check('a merge never crosses a strong border', blocks.length === 2, JSON.stringify(blocks));
  blocks = blocksFor(riverPair, venue, [], false, ['River Room 2']);
  check('a border elsewhere does not stop the merge', blocks.length === 1 && blocks[0].rooms.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Palladium Party', roomId: 'River Room 1', roomIds: ['River Room 1', 'River Room 2'], startTime: '19:00', endTime: '23:00' })], venue, [], false, ['River Room 1']);
  check('one booking spanning a strong border renders as two blocks', blocks.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Palladium Party', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B'], startTime: '19:00', endTime: '23:00' })
  ], venue, [], false);
  check('one booking spanning two rooms renders as one wide block', blocks.length === 1 && blocks[0].rooms.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Hidden Event', roomId: 'Palladium A', roomIds: ['Palladium A'], hidden: true })], venue, [], false);
  check('hidden bookings are skipped when the board is locked', blocks.length === 0);
  blocks = blocksFor([booking({ id: 'a', title: 'Hidden Event', roomId: 'Palladium A', roomIds: ['Palladium A'], hidden: true })], venue, [], true);
  check('hidden bookings still render in unlock mode', blocks.length === 1 && blocks[0].hidden === true);

  // --- Block colour rule: whole block unless unavailable ---
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], salespersonId: 'sp-1' })], venue, palette, false);
  check('available booking block is not unavailable', blocks.length === 1 && blocks[0].unavailable === false && blocks[0].colour === '#3366cc', JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], unavailable: true, salespersonId: 'sp-1' })], venue, palette, false);
  check('unavailable booking block is flagged unavailable and grey', blocks.length === 1 && blocks[0].unavailable === true && blocks[0].colour === '#9aa0a6', JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], salespersonId: 'unavailable' })], venue, palette, false);
  check('legacy unavailable salesperson still flags the block', blocks.length === 1 && blocks[0].unavailable === true && blocks[0].colour === '#9aa0a6', JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], salespersonId: 'sp-1', jobNumber: '1022948' })], venue, palette, false);
  check('block carries the salesperson initials', blocks.length === 1 && blocks[0].initials === 'AL' && blocks[0].jobNumber === '1022948', JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], unavailable: true, salespersonId: 'sp-1' })], venue, palette, false);
  check('unavailable block has no initials tag', blocks.length === 1 && blocks[0].initials === undefined, JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'] })], venue, palette, false);
  check('block without a salesperson has no initials tag', blocks.length === 1 && blocks[0].initials === undefined, JSON.stringify(blocks));

  // --- 2-hour snap: blocks line up in general time frames ---
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:30', endTime: '22:12' })], venue, [], false);
  check('block snaps to the nearest 2-hour frames', blocks.length === 1 && blocks[0].start === 18 * 60 && blocks[0].end === 22 * 60, JSON.stringify(blocks));
  check('exact times are kept for display', blocks[0].mainStart === 18 * 60 + 30 && blocks[0].mainEnd === 22 * 60 + 12, JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '22:00' })], venue, [], false);
  check('block already on the grid is unchanged', blocks.length === 1 && blocks[0].start === 18 * 60 && blocks[0].end === 22 * 60, JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '12:30', endTime: '13:00' })], venue, [], false);
  check('short block snaps to one full frame', blocks.length === 1 && blocks[0].start === 12 * 60 && blocks[0].end === 14 * 60, JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:50', endTime: '20:10' })], venue, [], false);
  check('block that would collapse keeps one full frame', blocks.length === 1 && blocks[0].start === 20 * 60 && blocks[0].end === 22 * 60, JSON.stringify(blocks));

  // --- date bar: past days grey, today yellow with red text, future green ---
  check('dayKind calls a past day past', dayKind('2026-11-19', '2026-11-20') === 'past');
  check('dayKind calls today today', dayKind('2026-11-20', '2026-11-20') === 'today');
  check('dayKind calls a future day future', dayKind('2026-11-21', '2026-11-20') === 'future');

  // --- Strong borders: placed after named rooms, not around groups ---
  const borders = strongBorders(['Palladium A', 'Palladium B', 'Palladium C1', 'River Room 1', 'River Room 2'], ['Palladium C1', 'River Room 2']);
  check('strong border after each named room only', borders[2] === true && borders[4] === true && borders[0] === false && borders[1] === false && borders[3] === false, JSON.stringify(borders));
  check('no borders means no strong vertical borders', strongBorders(['Palladium A', 'Palladium B'], []).every(v => !v));
  check('border matching ignores case and whitespace', strongBorders(['Palladium A', 'Palladium B'], [' palladium a '])[0] === true);

  console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
