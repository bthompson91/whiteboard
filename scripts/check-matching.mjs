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
      join(root, 'src/lib/blocks.ts'),
      join(root, 'src/lib/markupAnchor.ts'),
      join(root, 'src/lib/bookingIdentity.ts'),
      join(root, 'src/lib/sharedFile.ts')
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
  const { resolveSalesperson, bookingColour, salespersonInitials, UNAVAILABLE_SALESPERSON, isNoAv, boardSettings, readConfiguration } = await import(pathToFileURL(join(dir, 'configuration.js')).href);
  const { createSharedFile, parseSharedFile } = await import(pathToFileURL(join(dir, 'sharedFile.js')).href);
  const { blocksFor, strongBorders, likeBookings, blockCountForBookings, timeFraction, fitFontSize } = await import(pathToFileURL(join(dir, 'blocks.js')).href);
  const { pointFromAnchor, anchorFromPoint } = await import(pathToFileURL(join(dir, 'markupAnchor.js')).href);
  const { bookingId } = await import(pathToFileURL(join(dir, 'bookingIdentity.js')).href);

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

  // --- Job number is user-edited, never flagged by an import ---
  // A booking that changes only in time (with the same job number on
  // both sides) is a changed booking, but the job number is never
  // listed as a changed field: the import must not remove or
  // overwrite a job number the user set in the inspector. The job
  // number is carried over from the previous booking on import, so a
  // re-import still exact-matches instead of treating the booking as
  // new because the file carries no job number.
  result = compareImports(
    [booking({ jobNumber: '1022948' })],
    [booking({ id: 'booking-9', jobNumber: '1022948', startTime: '19:00', endTime: '23:00' })],
    'Venue'
  );
  check('a changed booking never lists jobNumber as changed', result.changes[0].type === 'changed' && !result.changes[0].changedFields.includes('jobNumber') && result.changes[0].changedFields.includes('startTime'), JSON.stringify(result.changes[0]));

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

  // --- Matching weights: display name and date dominate ---
  // Same name and date, two other fields changed, still reaches 80%:
  // name 40 + date 30 carry it even with different rooms and a shifted
  // time, so it is a strong match (checked by default).
  result = compareImports(
    [booking()],
    [booking({ id: 'booking-10', startTime: '19:00', endTime: '23:00', roomId: 'Palladium B', roomIds: ['Palladium B'] })],
    'Venue'
  );
  const sameNameDate = result.changes.find(c => c.type === 'new')?.match;
  check('same name and date reaches 80% despite other changes', !!sameNameDate && sameNameDate.score >= 80 && sameNameDate.classification === 'strong', JSON.stringify(sameNameDate));
  // Same name, time and rooms but a different date cannot reach 80%:
  // the date is worth 30 and gets no credit when it differs, so the
  // match is possible (left unchecked) rather than strong.
  result = compareImports(
    [booking()],
    [booking({ id: 'booking-11', date: '2026-11-21' })],
    'Venue'
  );
  const otherDate = result.changes.find(c => c.type === 'new')?.match;
  check('different date cannot reach 80% even when everything else matches', !!otherDate && otherDate.score < 80 && otherDate.classification === 'possible', JSON.stringify(otherDate));

  // --- Time scale: 00:00-06:00 is 75% height per hour ---
  // The 6 night hours take 4.5 units, the 18 day hours 18 units, 22.5
  // in total, so a night hour is 75% of a day hour and daytime bookings
  // read bigger.
  check('midnight is the top of the day', timeFraction(0) === 0);
  check('06:00 is 4.5/22.5 of the day height', Math.abs(timeFraction(360) - 4.5 / 22.5) < 1e-9, String(timeFraction(360)));
  check('midnight next day is the bottom', timeFraction(1440) === 1);
  // Room names are normalised: the largest size that fits every name
  // in its own column, decided by the tightest room. A name measured
  // 100 wide at 13px in a 100-wide column fits at 13; the same name
  // in a 50-wide column fits at 6, which floors to the 8 minimum.
  check('room name size fits every name in its column', fitFontSize([100, 100], [100, 100]) === 13);
  check('the tightest room decides the size for all', fitFontSize([100, 200], [100, 100]) === 8, String(fitFontSize([100, 200], [100, 100])));
  check('room name size never exceeds the maximum', fitFontSize([10], [1000]) === 24);
  check('room name size never drops below the minimum', fitFontSize([1000], [10]) === 8);
  check('a night hour is 75% of a day hour', Math.abs((timeFraction(60) - timeFraction(0)) - 0.75 * (timeFraction(780) - timeFraction(720))) < 1e-9);
  check('a 3-hour night booking is 75% of a 3-hour daytime booking', Math.abs((timeFraction(180) - timeFraction(0)) - 0.75 * (timeFraction(720) - timeFraction(540))) < 1e-9);

  // --- Disappeared bookings carry their previous record (no render crash) ---
  result = compareImports([booking(), booking({ id: 'booking-2', title: 'Other Event' })], [booking()], 'Venue');
  const disappeared = result.changes.find(c => c.type === 'disappeared');
  check('disappeared change carries previous', disappeared?.previous?.id === 'booking-2');

  // --- Importing a different date range keeps the other days' bookings ---
  // A previous booking on a day the new file does not cover is not gone,
  // so it stays (colour coding and all) instead of being deleted as
  // disappeared. Only a booking on a covered day that is missing is
  // disappeared.
  result = compareImports(
    [
      booking({ id: 'old-1', date: '2026-11-19', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '12:00', endTime: '16:00', colour: '#3366cc', salespersonId: 'sp-1' }),
      booking({ id: 'old-2', date: '2026-11-20', title: 'Dinner', roomId: 'River Room 1', roomIds: ['River Room 1'], startTime: '18:00', endTime: '22:00' })
    ],
    [
      booking({ id: 'new-1', date: '2026-11-20', title: 'Lunch', roomId: 'Palladium B', roomIds: ['Palladium B'], startTime: '12:00', endTime: '14:00' }),
      booking({ id: 'new-2', date: '2026-11-21', title: 'Party', roomId: 'River Room 2', roomIds: ['River Room 2'], startTime: '19:00', endTime: '23:00' })
    ],
    'Venue'
  );
  check('a booking outside the new file date range is kept, not disappeared', result.changes.find(c => c.booking.id === 'old-1')?.type === 'unchanged', JSON.stringify(result.changes.map(c => [c.type, c.booking.id])));
  check('a booking on a covered day that is missing is still disappeared', result.changes.find(c => c.booking.id === 'old-2')?.type === 'disappeared');
  const keptPublished = applyReview(result.changes, {});
  const keptOld = keptPublished.find(b => b.id === 'old-1');
  check('the kept booking keeps its colour coding', keptOld?.colour === '#3366cc' && keptOld?.salespersonId === 'sp-1', JSON.stringify(keptOld));
  check('the disappeared booking on a covered day is still removed', !keptPublished.some(b => b.id === 'old-2'));

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

  // --- Room widths: the type widths above the table apply to all ---
  // A room type key with a stray space must still match the room, so
  // the width set for that type is the width the room gets instead of
  // silently falling back to Medium.
  const widthSettings = boardSettings({ whiteboard: { room_types: { 'Palladium A ': 'large', 'River Room 1': 'small' }, room_widths: { large: 400, small: 125, other: 150 } } });
  check('room type keys are trimmed so the width applies', widthSettings.room_types['Palladium A'] === 'large' && widthSettings.room_types['River Room 1'] === 'small' && widthSettings.room_widths.large === 400, JSON.stringify(widthSettings.room_types));
  // Every type obeys its width, not just Medium: a large room gets the
  // large width, a small room the small width, a medium room the medium
  // width. (This is the lookup the board does per room.)
  const widthFor = (settings, room) => settings.room_widths[settings.room_types[room.trim()] || 'other'] || 175;
  check('large rooms obey the large width', widthFor(widthSettings, 'Palladium A') === 400);
  check('small rooms obey the small width', widthFor(widthSettings, 'River Room 1') === 125);
  check('medium rooms obey the medium width', widthFor(widthSettings, 'Garden Room 1') === 150);
  check('a room with no type falls back to the medium width', widthFor(boardSettings({ whiteboard: { room_widths: { large: 400, small: 125, other: 150 } } }), 'Unknown Room') === 150);
  // --- Room width limits are settable, not hard-coded ---
  // The 125-600 defaults can be widened or narrowed in Configuration,
  // and the three widths are validated against the set limits.
  const wideSettings = boardSettings({ whiteboard: { room_types: { 'Palladium A': 'large', 'River Room 1': 'small' }, room_width_min: 80, room_width_max: 900, room_widths: { large: 800, small: 80, other: 150 } } });
  check('width limits default to 125 and 600', boardSettings({ whiteboard: {} }).room_width_min === 125 && boardSettings({ whiteboard: {} }).room_width_max === 600);
  check('a width above the old 600 cap is allowed when the limit is raised', wideSettings.room_widths.large === 800 && widthFor(wideSettings, 'Palladium A') === 800);
  check('a width below the old 125 floor is allowed when the limit is lowered', wideSettings.room_widths.small === 80);
  check('a width outside the set limits is rejected', (() => { try { readConfiguration(`rooms:\n  order: [Room 1]\nwhiteboard:\n  room_width_min: 80\n  room_width_max: 900\n  room_widths:\n    large: 901\n`, false); return false; } catch (e) { return String(e.message || e).includes('80 to 900'); } })());
  check('a maximum below the minimum is rejected', (() => { try { readConfiguration(`rooms:\n  order: [Room 1]\nwhiteboard:\n  room_width_min: 500\n  room_width_max: 100\n`, false); return false; } catch (e) { return String(e.message || e).includes('must not be less than the minimum'); } })());

  // --- Markup rides in the shared board file, so it shows on every device ---
  // Markup used to live only in each browser's local storage, so a note
  // or arrow drawn on one device never appeared on another. It now
  // travels in the board file, which the editor auto-writes and every
  // device re-reads on refresh.
  const sampleMarkup = [{ id: 'm1', type: 'text', text: 'Turn here', x: 10, y: 20, w: 120, h: 40, highlight: true }];
  const boardText = JSON.stringify(createSharedFile([], 1, [], sampleMarkup));
  const parsedBoard = parseSharedFile(boardText);
  check('markup round-trips through the shared board file', parsedBoard.markup.length === 1 && parsedBoard.markup[0].text === 'Turn here' && parsedBoard.markup[0].highlight === true, boardText);
  check('a board file written before markup default to no markup', parseSharedFile(JSON.stringify({ format: 'whiteboard-shared-board', version: 1, bookings: [], submissions: [] })).markup.length === 0);
  // --- The editor lock rides in the board file too, so only one editor ---
  // holds it at a time. A lock round-trips; a board file written before
  // the lock defaults to no lock.
  const lock = { name: 'Alex', id: 'session-1', at: Date.now() };
  const lockedBoard = parseSharedFile(JSON.stringify(createSharedFile([], 1, [], [], lock)));
  check('the editor lock round-trips through the shared board file', lockedBoard.editorLock?.name === 'Alex' && lockedBoard.editorLock?.id === 'session-1' && typeof lockedBoard.editorLock?.at === 'number', JSON.stringify(lockedBoard.editorLock));
  check('a board file written before the lock defaults to no lock', parseSharedFile(JSON.stringify({ format: 'whiteboard-shared-board', version: 1, bookings: [], submissions: [] })).editorLock === null);
  check('assigned salesperson colour comes from the palette', bookingColour({ salespersonId: 'sp-1', colour: '#ff0000' }, palette) === '#3366cc');
  check('Unavailable resolves to grey', bookingColour({ salespersonId: 'unavailable' }, palette) === '#9aa0a6');
  check('unavailable tick box renders grey', bookingColour({ unavailable: true, salespersonId: 'sp-1' }, palette) === '#9aa0a6');
  check('NO AV is the job number marker', isNoAv('NO AV') && isNoAv('no av') && isNoAv('  NO AV  ') && !isNoAv('12345') && !isNoAv(undefined) && !isNoAv(''));
  check('NO AV renders grey like an unavailable booking', bookingColour({ salespersonId: 'sp-1', jobNumber: 'NO AV' }, palette) === '#9aa0a6');
  check('salesperson colour wins when not unavailable', bookingColour({ unavailable: false, salespersonId: 'sp-1' }, palette) === '#3366cc');
  check('unknown salesperson falls back to the stored colour', bookingColour({ salespersonId: 'sp-gone', colour: '#ff0000' }, palette) === '#ff0000');
  check('no salesperson keeps the stored colour', bookingColour({ colour: '#ff0000' }, palette) === '#ff0000');
  check('resolveSalesperson finds Unavailable by id', resolveSalesperson(palette, 'unavailable')?.name === 'Unavailable');
  check('initials take first and last names', salespersonInitials({ id: 'a', name: 'Alex Lee', colour: '#000000' }) === 'AL');
  check('initials take the first two letters of one name', salespersonInitials({ id: 'a', name: 'Alex', colour: '#000000' }) === 'AL');
  check('initials use the last word for three names', salespersonInitials({ id: 'a', name: 'Mary Jane Smith', colour: '#000000' }) === 'MS');
  check('initials are empty for a blank name', salespersonInitials({ id: 'a', name: '  ', colour: '#000000' }) === '');
  // A short name set in the palette wins over the derived initials, so
  // two people who would otherwise collide can be told apart: M
  // Carrasco and Cara Coughey would both derive "CC".
  check('a set short name is used as the tag', salespersonInitials({ id: 'a', name: 'M Carrasco', colour: '#000000', shortName: 'MC' }) === 'MC');
  check('the derived initials are used when no short name is set', salespersonInitials({ id: 'a', name: 'Cara Coughey', colour: '#000000' }) === 'CC');

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
  // A merged block shows the job number even when it is only on a row
  // other than the one that created the block: editing the job number
  // used to leave some blocks showing the old number, because the
  // block's number came from one row and only that row was updated.
  const mergedPair = [
    booking({ id: 'a', title: 'Enchanted Ball', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '09:00', endTime: '18:45', jobNumber: '' }),
    booking({ id: 'b', title: 'Enchanted Ball', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:45', endTime: '00:00', jobNumber: '1022948' })
  ];
  blocks = blocksFor(mergedPair, venue, [], false);
  check('a merged block shows a job number carried by a later row', blocks.length === 1 && blocks[0].jobNumber === '1022948', JSON.stringify(blocks.map(b => b.jobNumber)));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Enchanted Ball', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '09:00', endTime: '18:45', jobNumber: '1022948' }),
    booking({ id: 'b', title: 'Enchanted Ball', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:45', endTime: '00:00', jobNumber: '' })
  ], venue, [], false);
  check('a merged block keeps the first row’s job number when a later row has none', blocks.length === 1 && blocks[0].jobNumber === '1022948', JSON.stringify(blocks.map(b => b.jobNumber)));
  blocks = blocksFor([
    booking({ id: 'a', title: 'River Dinner', roomId: 'River Room 1', roomIds: ['River Room 1'], startTime: '18:00', endTime: '20:00' }),
    booking({ id: 'b', title: 'River Dinner', roomId: 'River Room 2', roomIds: ['River Room 2'], startTime: '18:00', endTime: '22:00' })
  ], venue, [], false);
  check('same title in adjacent rooms at different times stays two blocks', blocks.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Charity Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '12:00', endTime: '16:00' }),
    booking({ id: 'b', title: 'Charity Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '23:00' })
  ], venue, [], false);
  check('same title in one room at different times merges into one tall block', blocks.length === 1 && blocks[0].start === 12 * 60 && blocks[0].end === 23 * 60, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Charity Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '12:00', endTime: '16:00' }),
    booking({ id: 'b', title: 'charity  gala ', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '23:00' })
  ], venue, [], false);
  check('titles differing only by case or spacing still merge into one tall block', blocks.length === 1 && blocks[0].title === 'Charity Gala', JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'River Dinner', roomId: 'River Room 1', roomIds: ['River Room 1'], startTime: '18:00', endTime: '22:00', timeline: [{ label: 'Setup', start: '15:00', end: '18:00' }] }),
    booking({ id: 'b', title: 'River Dinner', roomId: 'River Room 2', roomIds: ['River Room 2'], startTime: '18:00', endTime: '22:00' })
  ], venue, [], false);
  check('a setup in one room does not stop the wide merge', blocks.length === 1 && blocks[0].rooms.length === 2 && blocks[0].start === 15 * 60 && blocks[0].facts.some(f => f.startsWith('Setup')), JSON.stringify(blocks));
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
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], unavailable: true, salespersonId: 'sp-1' })], venue, palette, false);
  check('unavailable block keeps its salesperson colour for the strip', blocks.length === 1 && blocks[0].salespersonColour === '#3366cc' && blocks[0].colour === '#9aa0a6', JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], unavailable: true })], venue, palette, false);
  check('unavailable block without a salesperson has no strip colour', blocks.length === 1 && blocks[0].salespersonColour === undefined, JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], unavailable: true, salespersonId: 'unavailable' })], venue, palette, false);
  check('legacy unavailable is not a real salesperson for the strip', blocks.length === 1 && blocks[0].salespersonColour === undefined, JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], salespersonId: 'sp-1', jobNumber: 'NO AV' })], venue, palette, false);
  check('NO AV keeps the salesperson colour for the strip and the initials', blocks.length === 1 && blocks[0].unavailable === true && blocks[0].colour === '#9aa0a6' && blocks[0].salespersonColour === '#3366cc' && blocks[0].initials === 'AL' && blocks[0].jobNumber === 'NO AV', JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], jobNumber: 'NO AV' })], venue, palette, false);
  check('NO AV without a salesperson is unavailable with no strip colour', blocks.length === 1 && blocks[0].unavailable === true && blocks[0].salespersonColour === undefined && blocks[0].initials === undefined, JSON.stringify(blocks));

  // --- Hard times: blocks render at their exact times, no snap ---
  // Start and end times are hard on the board. The 2-hour snap used to
  // round them, which expanded back-to-back blocks into each other.
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:30', endTime: '22:12' })], venue, [], false);
  check('block renders at its exact times, not snapped', blocks.length === 1 && blocks[0].start === 18 * 60 + 30 && blocks[0].end === 22 * 60 + 12, JSON.stringify(blocks));
  check('exact times are kept for display', blocks[0].mainStart === 18 * 60 + 30 && blocks[0].mainEnd === 22 * 60 + 12, JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '12:30', endTime: '13:00' })], venue, [], false);
  check('a short block keeps its exact short span', blocks.length === 1 && blocks[0].start === 12 * 60 + 30 && blocks[0].end === 13 * 60, JSON.stringify(blocks));
  // 1 Dec, Garden Rooms: the AICC (span 10:30-15:00, rooms Garden 2+3)
  // and the Gala (span 15:00-21:00, rooms Garden 1+2) meet at 15:00 in
  // Garden Room 2. They must not overlap: the AICC ends where the
  // Gala starts.
  const gardenVenue = { rooms: [
    { id: 'Garden Room 1', name: 'Garden Room 1', order: 0 },
    { id: 'Garden Room 2', name: 'Garden Room 2', order: 1 },
    { id: 'Garden Room 3', name: 'Garden Room 3', order: 2 }
  ] };
  const aicc = booking({ id: 'aicc-lunch', title: 'AICC Boardroom Lunch with Anthony Miller, CEO of Westpac', roomId: 'Garden Room 2', roomIds: ['Garden Room 2', 'Garden Room 3'], startTime: '12:15', endTime: '14:00', timeline: [{ label: 'Setup', start: '10:30', end: '12:15' }, { label: 'Teardown', start: '14:00', end: '15:00' }] });
  const gala = booking({ id: 'gala-vip', title: '2026 Crown Australian Open Welcome Gala', roomId: 'Garden Room 1', roomIds: ['Garden Room 1', 'Garden Room 2'], startTime: '18:00', endTime: '19:00', timeline: [{ label: 'Setup', start: '15:00', end: '18:00' }, { label: 'Teardown', start: '19:00', end: '21:00' }] });
  blocks = blocksFor([aicc, gala], gardenVenue, [], false);
  const aiccBlock = blocks.find(b => b.title.includes('AICC'));
  const galaBlock = blocks.find(b => b.title.includes('Gala'));
  check('back-to-back blocks in a shared room do not overlap', !!aiccBlock && !!galaBlock && aiccBlock.end <= galaBlock.start && aiccBlock.end === 15 * 60 && galaBlock.start === 15 * 60, JSON.stringify(blocks.map(b => [b.title.slice(0, 10), b.start, b.end])));

  // --- date bar: past days grey, today yellow with red text, future green ---
  check('dayKind calls a past day past', dayKind('2026-11-19', '2026-11-20') === 'past');
  check('dayKind calls today today', dayKind('2026-11-20', '2026-11-20') === 'today');
  check('dayKind calls a future day future', dayKind('2026-11-21', '2026-11-20') === 'future');

  // --- Strong borders: placed after named rooms, not around groups ---
  const borders = strongBorders(['Palladium A', 'Palladium B', 'Palladium C1', 'River Room 1', 'River Room 2'], ['Palladium C1', 'River Room 2']);
  check('strong border after each named room only', borders[2] === true && borders[4] === true && borders[0] === false && borders[1] === false && borders[3] === false, JSON.stringify(borders));
  check('no borders means no strong vertical borders', strongBorders(['Palladium A', 'Palladium B'], []).every(v => !v));
  check('border matching ignores case and whitespace', strongBorders(['Palladium A', 'Palladium B'], [' palladium a '])[0] === true);

  // --- Blocks keep their original size: nothing cuts a span short ---
  // A merged block keeps its full height even when another booking sits
  // in the gap between its parts (that gap booking used to cut the
  // whole merged block and delete its later part), and overlapping
  // bookings keep their own spans rather than being cut to fit.
  blocks = blocksFor([
    booking({ id: 'a', title: 'Lunch', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '12:00', endTime: '16:00', timeline: [{ label: 'Teardown', start: '16:00', end: '18:00' }] }),
    booking({ id: 'b', title: 'Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '22:00', timeline: [{ label: 'Setup', start: '16:00', end: '18:00' }] })
  ], venue, [], false);
  check('a later setup no longer cuts the earlier teardown short', blocks.length === 2 && blocks.find(b => b.title === 'Lunch')?.end === 18 * 60 && blocks.find(b => b.title === 'Dinner')?.start === 16 * 60, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Lunch', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '12:00', endTime: '15:00', timeline: [{ label: 'Teardown', start: '15:00', end: '17:00' }] }),
    booking({ id: 'b', title: 'Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '22:00', timeline: [{ label: 'Setup', start: '15:30', end: '18:00' }] })
  ], venue, [], false);
  check('a 15:30 setup no longer cuts a 17:00 teardown', blocks.find(b => b.title === 'Lunch')?.end === 17 * 60 && blocks.find(b => b.title === 'Dinner')?.start === 15 * 60 + 30, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '12:00', endTime: '16:00' }),
    booking({ id: 'b', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '23:00' }),
    booking({ id: 'c', title: 'Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '15:00', endTime: '17:00' })
  ], venue, [], false);
  check('a merged block keeps its full height with a booking in the gap', blocks.find(b => b.title === 'Gala')?.start === 12 * 60 && blocks.find(b => b.title === 'Gala')?.end === 23 * 60 && blocks.find(b => b.title === 'Gala')?.ids.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Late Night', roomId: 'Palladium A', roomIds: ['Palladium A'], date: '2026-11-19', startTime: '22:00', endTime: '02:00' }),
    booking({ id: 'b', title: 'Early Morning', roomId: 'Palladium A', roomIds: ['Palladium A'], date: '2026-11-20', startTime: '00:00', endTime: '04:00' })
  ], venue, [], false);
  check('a block running past midnight keeps its span', blocks.find(b => b.title === 'Late Night')?.end === 26 * 60, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Lunch', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '12:00', endTime: '14:00' }),
    booking({ id: 'b', title: 'Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '22:00' })
  ], venue, [], false);
  check('bookings that do not overlap are left alone', blocks.length === 2 && blocks.find(b => b.title === 'Lunch')?.end === 14 * 60, JSON.stringify(blocks));

  // --- Manual merge/unmerge: a booking opts out of merging by time or room ---
  blocks = blocksFor([
    booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '12:00', endTime: '16:00', mergeTime: false }),
    booking({ id: 'b', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '23:00' })
  ], venue, [], false);
  check('a booking that opted out of merging by time stays separate', blocks.length === 2 && blocks.filter(b => b.title === 'Gala').length === 2, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Dinner', roomId: 'River Room 1', roomIds: ['River Room 1'], startTime: '18:00', endTime: '22:00', mergeRoom: false }),
    booking({ id: 'b', title: 'Dinner', roomId: 'River Room 2', roomIds: ['River Room 2'], startTime: '18:00', endTime: '22:00' })
  ], venue, [], false);
  check('a booking that opted out of merging by room stays separate', blocks.length === 2 && blocks.filter(b => b.title === 'Dinner').length === 2 && blocks.every(b => b.rooms.length === 1), JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '12:00', endTime: '16:00' }),
    booking({ id: 'b', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '23:00' })
  ], venue, [], false);
  check('merging by time still happens by default', blocks.length === 1 && blocks[0].ids.length === 2, JSON.stringify(blocks));

  // --- Like bookings: the exact same title, any room or day ---
  check('like bookings are the exact same title in any room or day', likeBookings([
    booking({ id: 'a', title: 'Gala', salespersonId: 'sp-1' }),
    booking({ id: 'b', title: 'Gala', roomId: 'River Room 1', roomIds: ['River Room 1'], date: '2026-11-20', salespersonId: 'sp-2' }),
    booking({ id: 'c', title: 'Gala', salespersonId: 'sp-1' }),
    booking({ id: 'd', title: 'Dinner', salespersonId: 'sp-2' })
  ], 'Gala', 'a', 'sp-1').map(b => b.id).join(',') === 'b');
  check('like bookings need the exact title, not just a loose match', likeBookings([booking({ id: 'b', title: 'gala' })], 'Gala', 'a', 'sp-1').length === 0);

  // --- Markup anchors: a note is stored against its day and room ---
  const anchorLayout = {
    dates: ['2026-11-19', '2026-11-20'],
    rowTops: [40, 160],
    dayHeight: 120,
    roomIds: ['A', 'B'],
    roomLefts: [160, 310],
    roomWidths: [150, 150]
  };
  const anchor = anchorFromPoint(anchorLayout, 200, 100);
  check('a board point anchors to its day and room', anchor?.date === '2026-11-19' && anchor?.roomId === 'A' && Math.abs(anchor.fx - 40 / 150) < 0.01 && anchor.fy === 0.5, JSON.stringify(anchor));
  const roundTrip = anchor ? pointFromAnchor(anchorLayout, anchor) : null;
  check('an anchor renders back at the same point', roundTrip?.x === 200 && roundTrip?.y === 100, JSON.stringify(roundTrip));
  check('a point in the date column has no anchor', anchorFromPoint(anchorLayout, 100, 100) === null);
  check('a point past the last row has no anchor', anchorFromPoint(anchorLayout, 200, 300) === null);
  check('an anchor for a day that is not shown resolves to nothing', pointFromAnchor(anchorLayout, { date: '2026-11-21', roomId: 'A', fx: 0.5, fy: 0.5 }) === null);
  check('an anchor for a room that is not shown resolves to nothing', pointFromAnchor(anchorLayout, { date: '2026-11-19', roomId: 'C', fx: 0.5, fy: 0.5 }) === null);

  // --- Booking ids are unique per row, not per event ---
  // A Setup, a Dinner and a Crew Meals for one event in the same rooms
  // share the event identity, but they are different bookings: if they
  // share one id, saving one in the inspector replaces all of them and
  // the setup vanishes from the block.
  const enchanted = (overrides) => ({ id: 'x', date: '2026-11-20', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B', 'Palladium C1', 'Palladium C2', 'Palladium C3'], startTime: '18:00', endTime: '22:00', title: 'The 2026 Enchanted Ball', activity: 'Dinner', ...overrides });
  check('rows for one event get different ids', new Set([
    bookingId(enchanted({ activity: 'Setup', startTime: '09:00', endTime: '18:45' }), 'Crown Melbourne'),
    bookingId(enchanted({ activity: 'Dinner', startTime: '18:45', endTime: '00:00' }), 'Crown Melbourne'),
    bookingId(enchanted({ activity: 'Crew Meals - Encore AV Desk', startTime: '20:45', endTime: '21:15' }), 'Crown Melbourne')
  ]).size === 3);
  check('the same row gets the same id', bookingId(enchanted({ activity: 'Dinner', startTime: '18:45', endTime: '00:00' }), 'Crown Melbourne') === bookingId(enchanted({ activity: 'Dinner', startTime: '18:45', endTime: '00:00' }), 'Crown Melbourne'));

  // --- Manual merge (merge group) joins across rooms ---
  // Two bookings in rooms next to each other that share a merge group
  // render as one wide block even when their titles, times or a strong
  // border would stop the automatic merge. Without the group they stay
  // separate, and a group never joins rooms that are not next to each
  // other.
  blocks = blocksFor([
    booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '22:00', mergeGroup: 'g1' }),
    booking({ id: 'b', title: 'Dinner', roomId: 'Palladium B', roomIds: ['Palladium B'], startTime: '19:00', endTime: '23:00', mergeGroup: 'g1' })
  ], venue, [], false);
  check('bookings sharing a merge group render as one wide block', blocks.length === 1 && blocks[0].rooms.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '22:00' }),
    booking({ id: 'b', title: 'Dinner', roomId: 'Palladium B', roomIds: ['Palladium B'], startTime: '19:00', endTime: '23:00' })
  ], venue, [], false);
  check('without a merge group, different titles and times stay separate', blocks.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '22:00', mergeGroup: 'g1' }),
    booking({ id: 'b', title: 'Dinner', roomId: 'Palladium B', roomIds: ['Palladium B'], startTime: '19:00', endTime: '23:00', mergeGroup: 'g1' })
  ], venue, [], false, ['Palladium A']);
  check('a manual merge does not cross a strong border', blocks.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '22:00', mergeGroup: 'g1' }),
    booking({ id: 'b', title: 'Dinner', roomId: 'River Room 1', roomIds: ['River Room 1'], startTime: '19:00', endTime: '23:00', mergeGroup: 'g1' })
  ], venue, [], false);
  check('a merge group does not join rooms that are not next to each other', blocks.length === 2, JSON.stringify(blocks));

  // --- Apply-to-all counts merged blocks as one ---
  // A Setup, a Dinner and a Crew Meals for one event render as one
  // block, so the apply-to-all prompt counts them as one booking, not
  // three. Bookings in separate blocks count separately.
  const galaRows = [
    booking({ id: 's', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '09:00', endTime: '18:00' }),
    booking({ id: 'd', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '22:00' }),
    booking({ id: 'c', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '20:00', endTime: '21:00' })
  ];
  const galaBlocks = blocksFor(galaRows, venue, [], false);
  check('bookings merged into one block count as one', blockCountForBookings(galaBlocks, galaRows) === 1, JSON.stringify(galaBlocks));
  const mixed = [
    ...galaRows,
    booking({ id: 'x', title: 'Other', roomId: 'River Room 1', roomIds: ['River Room 1'], startTime: '18:00', endTime: '22:00' })
  ];
  const mixedBlocks = blocksFor(mixed, venue, [], false);
  check('bookings in separate blocks count separately', blockCountForBookings(mixedBlocks, mixed) === 2, JSON.stringify(mixedBlocks));

  console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
