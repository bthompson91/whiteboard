// Logic tests for the import pipeline — no browser, no test framework.
// Bundles the pure modules with esbuild (already a dependency of vite),
// imports them, and checks matching, review application and date/time
// parsing. Run with `npm test`. Exits non-zero on any failure.
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The bundle lives inside the repo (and is deleted afterwards) so the
// one dependency left external — xlsx, which esbuild cannot bundle
// into node ESM because it uses dynamic require — still resolves
// from the repo's node_modules when the bundle imports it.
const dir = await mkdtemp(join(root, '.test-'));
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
      join(root, 'src/lib/sharedFile.ts'),
      join(root, 'src/lib/venueConfig.ts'),
      join(root, 'src/lib/wizard.ts'),
      join(root, 'src/lib/bookingImport.ts'),
      join(root, 'src/lib/timetargetImport.ts'),
      join(root, 'src/lib/docx.ts'),
      join(root, 'src/lib/weekendNotes.ts')
    ],
    outdir: dir,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['xlsx'],
    logLevel: 'silent'
  });
  const { compareImports } = await import(pathToFileURL(join(dir, 'importComparison.js')).href);
  const { applyReview, changeKey, mergeMatchedBooking, applyJobNumberEdits } = await import(pathToFileURL(join(dir, 'reviewApply.js')).href);
  const { dateValue, timeValue, dayKind } = await import(pathToFileURL(join(dir, 'dateTime.js')).href);
  const { resolveSalesperson, bookingColour, salespersonInitials, UNAVAILABLE_SALESPERSON, isNoAv, boardSettings, readConfiguration, normalizeConfigDoc, writeConfiguration, renameRoomInConfig } = await import(pathToFileURL(join(dir, 'configuration.js')).href);
  const { createSharedFile, parseSharedFile } = await import(pathToFileURL(join(dir, 'sharedFile.js')).href);
  const { blocksFor, blockJobNumber, strongBorders, operableWallAfter, likeBookings, relatedBookings, blockCountForBookings, timeFraction, fitFontSize, assignLanes, isBlockHidden, setBlockHidden, eventColour } = await import(pathToFileURL(join(dir, 'blocks.js')).href);
  const { pointFromAnchor, anchorFromPoint } = await import(pathToFileURL(join(dir, 'markupAnchor.js')).href);
  const { bookingId, identityKey, matchJobNumber } = await import(pathToFileURL(join(dir, 'bookingIdentity.js')).href);
  const { parseVenueConfig, resolveRooms } = await import(pathToFileURL(join(dir, 'venueConfig.js')).href);
  const { detectHeaderRow, headerCandidates, suggestFieldMapping, detectRoomSeparator, splitRoomValue, roomParts, dataRecords, columnValues, countInRange, buildVenueDoc, buildVenueYaml, previewRow } = await import(pathToFileURL(join(dir, 'wizard.js')).href);
  const { sheetRecords } = await import(pathToFileURL(join(dir, 'bookingImport.js')).href);
  const { findTimetargetColumns, resolveTimetargetRoom, eventMatchesEvent, timetargetNoteKey, parseTimetargetWorkbook, applyTimetargetRows } = await import(pathToFileURL(join(dir, 'timetargetImport.js')).href);
  const { overnightWindow, headerRangeLabel, parseHhmm, roomDisplayName, collectOvernightItems, buildWeekendNotesDocx } = await import(pathToFileURL(join(dir, 'weekendNotes.js')).href);
  const { buildDocx, zipStore } = await import(pathToFileURL(join(dir, 'docx.js')).href);

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
  let blocks = blocksFor(riverPair, venue, [], false, [], ['River Room 1']);
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
  ], venue, [], false, [], ['River Room 1']);
  check('a setup in one room does not stop the wide merge', blocks.length === 1 && blocks[0].rooms.length === 2 && blocks[0].start === 15 * 60 && blocks[0].facts.some(f => f.startsWith('Setup')), JSON.stringify(blocks));
  blocks = blocksFor(riverPair, venue, [], false, ['River Room 1'], ['River Room 1']);
  check('a merge never crosses a strong border', blocks.length === 2, JSON.stringify(blocks));
  blocks = blocksFor(riverPair, venue, [], false, ['River Room 2'], ['River Room 1']);
  check('a border elsewhere does not stop the merge', blocks.length === 1 && blocks[0].rooms.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Palladium Party', roomId: 'River Room 1', roomIds: ['River Room 1', 'River Room 2'], startTime: '19:00', endTime: '23:00' })], venue, [], false, ['River Room 1'], ['River Room 1']);
  check('one booking spanning a strong border renders as two blocks', blocks.length === 2, JSON.stringify(blocks));

  // --- Per-room hiding: hiding one block of a booking in several
  // rooms hides that room only, not the whole booking ---
  const multiRoom = booking({ id: 'm', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B', 'River Room 1'], startTime: '19:00', endTime: '23:00', hiddenRooms: ['Palladium B'] });
  blocks = blocksFor([multiRoom], venue, [], false);
  check('hiding one room of a multi-room booking hides that block only', blocks.length === 2 && blocks.every(b => b.rooms[0] !== 1), JSON.stringify(blocks.map(b => b.rooms)));
  blocks = blocksFor([multiRoom], venue, [], true);
  check('a hidden room still renders faded when Show hidden is on', blocks.length === 3 && blocks.filter(b => b.hidden).length === 1, JSON.stringify(blocks.map(b => [b.rooms, b.hidden])));
  blocks = blocksFor([booking({ id: 'h', title: 'Hidden', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00', hidden: true })], venue, [], false);
  check('a booking hidden everywhere renders no blocks', blocks.length === 0);
  check('hiding one block adds only its rooms to hiddenRooms', (() => {
    const b = booking({ id: 'm', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B', 'River Room 1'], startTime: '19:00', endTime: '23:00' });
    const hidden = setBlockHidden(b, ['Palladium B'], true);
    return JSON.stringify(hidden.hiddenRooms) === JSON.stringify(['Palladium B']) && hidden.hidden !== true;
  })());
  check('unhiding one block of a booking hidden everywhere keeps the other rooms hidden', (() => {
    const b = booking({ id: 'm', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B', 'River Room 1'], startTime: '19:00', endTime: '23:00', hidden: true });
    const shown = setBlockHidden(b, ['Palladium B'], false);
    return shown.hidden === false && JSON.stringify(shown.hiddenRooms) === JSON.stringify(['Palladium A', 'River Room 1']);
  })());
  check('a block counts as hidden only when every one of its rooms is hidden', isBlockHidden(booking({ id: 'm', title: 'x', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B'], startTime: '19:00', endTime: '23:00', hiddenRooms: ['Palladium A'] }), ['Palladium A', 'Palladium B']) === false && isBlockHidden(booking({ id: 'm', title: 'x', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B'], startTime: '19:00', endTime: '23:00', hiddenRooms: ['Palladium A', 'Palladium B'] }), ['Palladium A', 'Palladium B']) === true);
  check('a matched re-import carries the per-room hiding over', (() => {
    const previous = booking({ id: 'p', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B'], startTime: '19:00', endTime: '23:00', hiddenRooms: ['Palladium B'] });
    const next = booking({ id: 'n', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B'], startTime: '19:00', endTime: '23:00' });
    const merged = mergeMatchedBooking(previous, next);
    return JSON.stringify(merged.hiddenRooms) === JSON.stringify(['Palladium B']) && merged.id === 'p';
  })());

  // --- Random colours per event ---
  check('an event colour is stable and a hex colour', eventColour('MCG Dinner') === eventColour('MCG Dinner') && /^#[0-9a-f]{6}$/.test(eventColour('MCG Dinner')));
  check('an event colour ignores case and spacing', eventColour('MCG  Dinner') === eventColour('mcg dinner'));
  check('different events get different colours', eventColour('MCG Dinner') !== eventColour('Charity Gala') && eventColour('MCG Dinner') !== eventColour('River Dinner') && eventColour('Charity Gala') !== eventColour('River Dinner'));
  const eventPair = [
    booking({ id: 'a', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00', salespersonId: 'sp-1' }),
    booking({ id: 'b', title: 'MCG Dinner', roomId: 'Palladium B', roomIds: ['Palladium B'], startTime: '19:00', endTime: '23:00' })
  ];
  const people = [{ id: 'sp-1', name: 'Alex Lee', colour: '#d32f2f' }];
  blocks = blocksFor(eventPair, venue, people, false, [], [], true);
  check('random colours give every block of one event the same colour', blocks.length === 2 && blocks[0].colour === blocks[1].colour && blocks[0].colour === eventColour('MCG Dinner'), JSON.stringify(blocks.map(b => b.colour)));
  check('random colours set the salesperson colour aside but keep the assignment', blocks[0].salespersonColour === undefined && blocks[0].salespersonId === 'sp-1' && blocks[0].initials === 'AL', JSON.stringify(blocks[0]));
  blocks = blocksFor(eventPair, venue, people, false);
  check('with random colours off the salesperson colour applies', blocks[0].colour === '#d32f2f', JSON.stringify(blocks.map(b => b.colour)));
  blocks = blocksFor([booking({ id: 'u', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00', unavailable: true })], venue, [], false, [], [], true);
  check('an unavailable booking stays grey with random colours on', blocks.length === 1 && blocks[0].colour === '#9aa0a6', JSON.stringify(blocks.map(b => b.colour)));
  check('random event colours are read from the venue settings', boardSettings(readConfiguration(`rooms:\n  order: [Room 1]\nwhiteboard:\n  random_event_colours: true\n`, false)).random_event_colours === true);
  check('a non-boolean random event colours is rejected', (() => { try { readConfiguration(`rooms:\n  order: [Room 1]\nwhiteboard:\n  random_event_colours: 5\n`, false); return false; } catch { return true; } })());

  // --- Per-room job numbers ---
  check('the event identity ignores the job number, so a number set in the inspector does not hide the booking on re-import', identityKey(booking({ id: 'a', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00' }), 'MCG') === identityKey(booking({ id: 'b', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00', jobNumber: '1022948' }), 'MCG'));
  check('the booking id still folds the job number in', bookingId(booking({ id: 'a', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00' }), 'MCG') !== bookingId(booking({ id: 'b', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00', jobNumber: '1022948' }), 'MCG'));
  const numbered = booking({ id: 'n', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B'], startTime: '19:00', endTime: '23:00', jobNumber: '1022948', jobNumbers: { 'Palladium B': 'NO AV' } });
  check('a block shows its own room number, or the booking number', blockJobNumber(numbered, ['Palladium A']) === '1022948' && blockJobNumber(numbered, ['Palladium B']) === 'NO AV');
  check('a wide block shows the booking number when its rooms disagree', blockJobNumber(numbered, ['Palladium A', 'Palladium B']) === '1022948');
  check('a wide block shows the shared number when its rooms agree', blockJobNumber(booking({ id: 'w', title: 'X', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B'], startTime: '19:00', endTime: '23:00', jobNumbers: { 'Palladium A': 'NO AV', 'Palladium B': 'NO AV' } }), ['Palladium A', 'Palladium B']) === 'NO AV');
  blocks = blocksFor([numbered], venue, [], false);
  check('each room of one booking shows its own job number', blocks.length === 2 && blocks.find(b => b.rooms[0] === 0).jobNumber === '1022948' && blocks.find(b => b.rooms[0] === 1).jobNumber === 'NO AV', JSON.stringify(blocks.map(b => [b.rooms, b.jobNumber, b.unavailable])));
  check('NO AV is per room too: only that room renders grey', blocks.find(b => b.rooms[0] === 1).unavailable === true && blocks.find(b => b.rooms[0] === 0).unavailable === false, JSON.stringify(blocks.map(b => [b.rooms, b.unavailable])));
  blocks = blocksFor([numbered], venue, [], false, [], ['Palladium A']);
  check('a wide block across operable walls shows the one booking number', blocks.length === 1 && blocks[0].jobNumber === '1022948' && blocks[0].unavailable === false, JSON.stringify(blocks.map(b => [b.rooms, b.jobNumber, b.unavailable])));
  blocks = blocksFor([booking({ id: 'd', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B'], startTime: '19:00', endTime: '23:00', jobNumbers: { 'Palladium A': '111', 'Palladium B': '222' } })], venue, [], false);
  check('two rooms can carry two different job numbers', blocks.length === 2 && blocks.find(b => b.rooms[0] === 0).jobNumber === '111' && blocks.find(b => b.rooms[0] === 1).jobNumber === '222', JSON.stringify(blocks.map(b => [b.rooms, b.jobNumber])));
  check('a matched re-import carries the per-room job numbers over', (() => {
    const previous = booking({ id: 'p', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B'], startTime: '19:00', endTime: '23:00', jobNumber: '1022948', jobNumbers: { 'Palladium B': 'NO AV' } });
    const next = booking({ id: 'n', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B'], startTime: '19:00', endTime: '23:00' });
    const merged = mergeMatchedBooking(previous, next);
    return merged.jobNumber === '1022948' && JSON.stringify(merged.jobNumbers) === JSON.stringify({ 'Palladium B': 'NO AV' });
  })());

  // --- Related bookings list + per-room veto ---
  check('related bookings are the same title, without the one being edited, in date order', (() => {
    const list = relatedBookings([
      booking({ id: 'a', title: 'MCG Dinner', date: '2026-11-23', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00' }),
      booking({ id: 'b', title: 'MCG Dinner', date: '2026-11-21', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00' }),
      booking({ id: 'c', title: 'Charity Gala', date: '2026-11-21', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00' })
    ], 'MCG Dinner', 'b');
    return list.length === 1 && list[0].id === 'a';
  })());
  check('related bookings sort by date', (() => {
    const list = relatedBookings([
      booking({ id: 'a', title: 'MCG Dinner', date: '2026-11-23', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00' }),
      booking({ id: 'b', title: 'MCG Dinner', date: '2026-11-21', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00' })
    ], 'MCG Dinner', 'none');
    return list.length === 2 && list[0].id === 'b' && list[1].id === 'a';
  })());
  check('a related job-number edit sets the number and clears per-room numbers', (() => {
    const edited = applyJobNumberEdits([booking({ id: 'r', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00', jobNumbers: { 'Palladium A': 'NO AV' } })], { r: '001022948' });
    return edited[0].jobNumber === '1022948' && edited[0].jobNumbers === undefined;
  })());
  check('a related edit never touches the block being edited', (() => {
    const edited = applyJobNumberEdits([booking({ id: 'r', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00' })], { r: '1022948' }, new Set(['r']));
    return edited[0].jobNumber === undefined;
  })());
  check('an empty related edit clears the number', (() => {
    const edited = applyJobNumberEdits([booking({ id: 'r', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00', jobNumber: '1022948' })], { r: '' });
    return edited[0].jobNumber === undefined;
  })());
  check('the match number is the booking number, else the first per-room number', matchJobNumber(booking({ id: 'a', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00', jobNumber: '1022948', jobNumbers: { 'Palladium A': '111' } })) === '1022948' && matchJobNumber(booking({ id: 'b', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B'], startTime: '19:00', endTime: '23:00', jobNumbers: { 'Palladium B': '222', 'Palladium A': '111' } })) === '111' && matchJobNumber(booking({ id: 'c', title: 'MCG Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '19:00', endTime: '23:00' })) === '');
  result = compareImports(
    [booking({ jobNumbers: { 'Palladium A': '111' } })],
    [booking({ id: 'booking-9', title: 'Charity Dinner', jobNumbers: { 'Palladium A': '222' } })],
    'Venue'
  );
  check('differing per-room job numbers veto the match too', !result.changes.find(c => c.type === 'new')?.match);

  // --- TimeTarget setup-time import ---
  const ttVenue = parseVenueConfig(`site:\n  name: Crown Melbourne\nrooms:\n  order: [Garden Room 3, Crown Aviary, Evergreen, River Room 2, River Room 1, M8, M15, M9]\n  room_aliases:\n    'M9': ['M Nine']\n  timetarget_areas:\n    'Garden Room 3': 'Crown Melbourne - Garden Room 3'\n    'Crown Aviary': 'Crown Melbourne - Crown Aviary'\n    'Evergreen': 'Crown Melbourne - Evergreen'\n    'River Room 2': 'Crown Melbourne - River Room 2'\n    'River Room 1': 'Crown Melbourne - River Room 1'\n    'M8': 'Crown Melbourne - M8'\n    'M15': 'Crown Melbourne - M15'\n    'M9': 'Crown Melbourne - M9'\n`);
  check('TimeTarget columns are found case-insensitively, event optional', (() => {
    const cols = findTimetargetColumns(['date', 'START TIME', 'Function', 'AREA', 'event name']);
    return cols.date === 'date' && cols.startTime === 'START TIME' && cols.function === 'Function' && cols.area === 'AREA' && cols.event === 'event name';
  })());
  throws('TimeTarget import refuses a file without the Area column', () => findTimetargetColumns(['Date', 'Start Time', 'Function', 'Event']));
  check('a TimeTarget area resolves through timetarget_areas, a room name, and an alias', resolveTimetargetRoom('Crown Melbourne - Garden Room 3', ttVenue) === 'Garden Room 3' && resolveTimetargetRoom('M9', ttVenue) === 'M9' && resolveTimetargetRoom('M Nine', ttVenue) === 'M9' && resolveTimetargetRoom('Nowhere', ttVenue) === null);
  check('an event name matches a board title loosely, one containing the other', eventMatchesEvent('2026 Carji Greeves Medal Dinner', '2026 Carji Greeves Medal') && eventMatchesEvent('Gala', 'Annual Gala Dinner') && !eventMatchesEvent('Gala', 'Dinner') && !eventMatchesEvent('', 'Dinner'));
  const ttBookings = [
    booking({ id: 'b-carji', title: '2026 Carji Greeves Medal', date: '2026-10-01', roomId: 'Garden Room 3', roomIds: ['Garden Room 3'], startTime: '17:00', endTime: '23:00' }),
    booking({ id: 'b-carlisle', title: '2026 Carlisle Homes Supplier of the Year Awards', date: '2026-10-02', roomId: 'Crown Aviary', roomIds: ['Crown Aviary'], startTime: '11:00', endTime: '15:00' }),
    booking({ id: 'b-charlize', title: "Charlize's 18th Birthday & Year 12 Graduation", date: '2026-10-03', roomId: 'Evergreen', roomIds: ['Evergreen'], startTime: '18:30', endTime: '23:30' }),
    booking({ id: 'b-nicholls', title: '2026 John Nicholls Medal', date: '2026-10-04', roomId: 'River Room 2', roomIds: ['River Room 2'], startTime: '15:00', endTime: '23:00' }),
    booking({ id: 'b-barker', title: '2026 Trevor Barker Award and Hall of Fame', date: '2026-10-05', roomId: 'River Room 1', roomIds: ['River Room 1'], startTime: '18:00', endTime: '23:00' }),
    booking({ id: 'b-cfo', title: 'CFO Day', date: '2026-10-06', roomId: 'M8', roomIds: ['M8'], startTime: '08:45', endTime: '17:00' }),
    booking({ id: 'b-hello-1', title: 'Helloworld / MTA Conference', date: '2026-10-01', roomId: 'M9', roomIds: ['M9'], startTime: '15:00', endTime: '22:00' }),
    booking({ id: 'b-hello-2', title: 'Helloworld / MTA Conference', date: '2026-10-01', roomId: 'M9', roomIds: ['M9'], startTime: '22:00', endTime: '07:00' })
  ];
  const ttFile = new File([readFileSync(join(root, 'test-data', 'timetarget-sample.xlsx'))], 'timetarget-sample.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const ttParsed = await parseTimetargetWorkbook(ttFile, ttVenue, ttBookings);
  check('the sample TimeTarget file parses to 10 rows with 1 skipped (the ghost area)', ttParsed.rows.length === 10 && ttParsed.skipped.length === 1 && ttParsed.skipped[0].reason.includes('Imaginary Room'), JSON.stringify(ttParsed.skipped));
  check('a fuzzy event name still finds its booking, and the two sessions find theirs', (() => {
    const carji = ttParsed.rows.find(r => r.roomId === 'Garden Room 3');
    const hello1 = ttParsed.rows.find(r => r.roomId === 'M9' && r.startTime === '13:00');
    const hello2 = ttParsed.rows.find(r => r.roomId === 'M9' && r.startTime === '20:00');
    return carji?.bookingId === 'b-carji' && hello1?.bookingId === 'b-hello-1' && hello2?.bookingId === 'b-hello-2';
  })());
  check('a setup with no event name still imports, with no booking attached', (() => {
    const blank = ttParsed.rows.find(r => r.roomId === 'M15');
    return blank && blank.event === '' && blank.bookingId === undefined && blank.startTime === '04:00';
  })());
  let ttApplied = applyTimetargetRows([], ttParsed.rows);
  check('the sample import adds 10 TimeTarget notes, each marked with its key', ttApplied.added === 10 && ttApplied.updated === 0 && ttApplied.markup.every(m => m.type === 'text' && m.source === 'timetarget' && m.timetargetKey) && ttApplied.markup.filter(m => m.text === 'Set Up 15:00').length === 1, JSON.stringify(ttApplied.markup.map(m => m.text)));
  check('the two sessions of one event get two notes, at their own times', (() => {
    const notes = ttApplied.markup.filter(m => m.type === 'text' && m.roomId === 'M9');
    return notes.length === 2 && notes.some(m => m.text === 'Set Up 13:00') && notes.some(m => m.text === 'Set Up 20:00');
  })());
  ttApplied = applyTimetargetRows(ttApplied.markup, ttParsed.rows);
  check('re-importing the same file updates the notes instead of duplicating them', ttApplied.added === 0 && ttApplied.updated === 10 && ttApplied.markup.length === 10);
  check('a changed setup time moves its note instead of adding one', (() => {
    const moved = ttParsed.rows.map(r => (r.roomId === 'Garden Room 3' ? { ...r, startTime: '16:00', startMinutes: 960 } : r));
    const again = applyTimetargetRows(ttApplied.markup, moved);
    const note = again.markup.find(m => m.type === 'text' && m.roomId === 'Garden Room 3');
    return again.added === 0 && again.updated === 10 && note?.text === 'Set Up 16:00' && note?.id === ttApplied.markup.find(m => m.type === 'text' && m.roomId === 'Garden Room 3')?.id;
  })());
  check('a hand-typed note at the same place is never touched by the import', (() => {
    const manual = { id: 'manual-1', type: 'text', x: 0, y: 0, text: 'Setup 06:30 — crew call 06:00', date: '2026-10-01', roomId: 'Garden Room 3', fx: 0.5, fy: 0.5 };
    const again = applyTimetargetRows([manual, ...ttApplied.markup], ttParsed.rows);
    return again.markup.find(m => m.id === 'manual-1')?.text === 'Setup 06:30 — crew call 06:00' && again.markup.length === 11;
  })());
  blocks = blocksFor([
    booking({ id: 'a', title: 'Palladium Party', roomId: 'Palladium A', roomIds: ['Palladium A', 'Palladium B'], startTime: '19:00', endTime: '23:00' })
  ], venue, [], false, [], ['Palladium A']);
  check('one booking spanning two rooms renders as one wide block', blocks.length === 1 && blocks[0].rooms.length === 2, JSON.stringify(blocks));
  // --- Operable walls gate every merge across rooms ---
  // Merging is only allowed across a wall that is operable: the wall
  // after the room above it must be ticked in Configuration. A fixed
  // wall stops both the automatic merge and a manual merge group, and
  // a width merge needs the titles to match exactly — there is no
  // fuzzy matching across rooms.
  blocks = blocksFor(riverPair, venue, [], false);
  check('a wide merge does not happen without an operable wall', blocks.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'River Dinner', roomId: 'River Room 1', roomIds: ['River Room 1'], startTime: '18:00', endTime: '22:00' }),
    booking({ id: 'b', title: 'river  dinner', roomId: 'River Room 2', roomIds: ['River Room 2'], startTime: '18:00', endTime: '22:00' })
  ], venue, [], false, [], ['River Room 1']);
  check('titles differing only by case or spacing do not merge across rooms', blocks.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '22:00', mergeGroup: 'g1' }),
    booking({ id: 'b', title: 'Dinner', roomId: 'Palladium B', roomIds: ['Palladium B'], startTime: '19:00', endTime: '23:00', mergeGroup: 'g1' })
  ], venue, [], false);
  check('a manual merge does not cross a fixed wall', blocks.length === 2, JSON.stringify(blocks));
  check('operable walls are read from the YAML whiteboard section', JSON.stringify(boardSettings({ whiteboard: { operable_walls: ['Palladium A', 'River Room 1'] } }).operable_walls) === JSON.stringify(['Palladium A', 'River Room 1']));
  check('operable walls default to none', boardSettings({ whiteboard: {} }).operable_walls.length === 0);
  check('a non-list operable walls value is rejected', (() => { try { readConfiguration(`rooms:\n  order: [Room 1]\nwhiteboard:\n  operable_walls: Room 1\n`, false); return false; } catch (e) { return String(e.message || e).includes('Operable walls must be a list'); } })());
  check('operable wall matching ignores case and whitespace', operableWallAfter(['Palladium A', 'Palladium B'], [' palladium a '])[0] === true && operableWallAfter(['Palladium A', 'Palladium B'], [' palladium a '])[1] === false);
  // The original planner's output settings are dead: the board never
  // reads them and the Configuration page no longer shows them, so a
  // YAML that still carries them is stripped, not kept or rejected.
  check('an output section is stripped when a config is read', !('output' in readConfiguration(`rooms:\n  order: [Room 1]\noutput:\n  filename_prefix: Room_Planner\n  title: Crown Melbourne Room Planner\n  worksheet_name: Room Planner\n  show_timeline_panel: true\n`, false)));
  check('a malformed output section does not fail reading', (() => { try { return !('output' in readConfiguration(`rooms:\n  order: [Room 1]\noutput: not a mapping\n`, false)); } catch { return false; } })());
  check('normalizeConfigDoc strips an output section', !('output' in normalizeConfigDoc({ rooms: { order: ['Room 1'] }, output: { title: 'x' } })));
  check('a saved config no longer contains output', !writeConfiguration(normalizeConfigDoc(readConfiguration(`rooms:\n  order: [Room 1]\noutput:\n  title: x\n`, false))).includes('output'));
  // TimeTarget area names: one per room, stored under rooms.
  check('a TimeTarget area name is read from the YAML', readConfiguration(`rooms:\n  order: [Room 1]\n  timetarget_areas:\n    Room 1: Crown - Level 1\n`, false).rooms.timetarget_areas['Room 1'] === 'Crown - Level 1');
  check('a non-text TimeTarget area name is rejected', (() => { try { readConfiguration(`rooms:\n  order: [Room 1]\n  timetarget_areas:\n    Room 1: 42\n`, false); return false; } catch (e) { return String(e.message || e).includes('timetarget_areas'); } })());
  check('normalizeConfigDoc trims TimeTarget area names', (() => { const d = normalizeConfigDoc({ rooms: { order: ['Room 1'], timetarget_areas: { ' Room 1 ': ' Area A ', 'Room 2': '  ' } } }); return d.rooms.timetarget_areas['Room 1'] === 'Area A' && !('Room 2' in d.rooms.timetarget_areas); })());
  // Renaming a room renames it everywhere the config references it.
  check('a room rename moves every config reference', (() => {
    const d = { rooms: { order: ['Room 1', 'Room 2'], exclude: ['Room 1'], room_aliases: { 'Room 1': ['R1'] }, timetarget_areas: { 'Room 1': 'Area A' }, room_mappings: { Combined: ['Room 1', 'Room 2'], 'Room 1': ['Room 2'] } }, whiteboard: { room_types: { 'Room 1': 'large' }, room_borders: ['Room 1'], operable_walls: ['Room 1'] } };
    if (!renameRoomInConfig(d, 'Room 1', 'Room One')) return false;
    return JSON.stringify(d.rooms.order) === JSON.stringify(['Room One', 'Room 2'])
      && JSON.stringify(d.rooms.exclude) === JSON.stringify(['Room One'])
      && JSON.stringify(d.rooms.room_aliases) === JSON.stringify({ 'Room One': ['R1'] })
      && JSON.stringify(d.rooms.timetarget_areas) === JSON.stringify({ 'Room One': 'Area A' })
      && JSON.stringify(d.rooms.room_mappings) === JSON.stringify({ Combined: ['Room One', 'Room 2'], 'Room One': ['Room 2'] })
      && JSON.stringify(d.whiteboard.room_types) === JSON.stringify({ 'Room One': 'large' })
      && JSON.stringify(d.whiteboard.room_borders) === JSON.stringify(['Room One'])
      && JSON.stringify(d.whiteboard.operable_walls) === JSON.stringify(['Room One']);
  })());
  check('a room rename to an existing name is refused', !renameRoomInConfig({ rooms: { order: ['Room 1', 'Room 2'] } }, 'Room 1', 'Room 2'));
  check('a room rename to a blank name is refused', !renameRoomInConfig({ rooms: { order: ['Room 1'] } }, 'Room 1', '   '));
  // Combined-room mappings survive a save round-trip intact.
  check('room_mappings survive a save round-trip', (() => {
    const back = readConfiguration(writeConfiguration(normalizeConfigDoc(readConfiguration(`rooms:\n  order: [Room 1, Room 2]\n  room_mappings:\n    Combined:\n      - Room 1\n      - Room 2\n`, false))));
    return JSON.stringify(back.rooms.room_mappings) === JSON.stringify({ Combined: ['Room 1', 'Room 2'] });
  })());
  // Time slots are dead like output: stripped, not kept or rejected.
  check('time_slots are stripped when a config is read', !('time_slots' in readConfiguration(`rooms:\n  order: [Room 1]\ntime_slots:\n  - label: "0000-0559"\n    start: "00:00"\n    end: "05:59"\n`, false)));
  check('a malformed time_slots value does not fail reading', (() => { try { return !('time_slots' in readConfiguration(`rooms:\n  order: [Room 1]\ntime_slots: not a list\n`, false)); } catch { return false; } })());
  check('normalizeConfigDoc strips time_slots', !('time_slots' in normalizeConfigDoc({ rooms: { order: ['Room 1'] }, time_slots: [{ label: 'x', start: '00:00', end: '01:00' }] })));
  check('a saved config no longer contains time_slots', !writeConfiguration(normalizeConfigDoc(readConfiguration(`rooms:\n  order: [Room 1]\ntime_slots:\n  - label: x\n    start: "00:00"\n    end: "01:00"\n`, false))).includes('time_slots'));
  // --- Setup wizard: header detection, column suggestions, rooms ---
  const mcgAoa = [
    ['NMD Current Events', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', 'Status', 'Event ID', 'Bump In', 'Start Time', 'Description', 'Type', 'Booked Spaces', 'Attendance', 'End Date', 'End Time', 'Bump Out', 'Salesperson', 'Coordinator', 'Special Notes for the Event', 'Revenue', 'Open Balance'],
    ['Grand Total - Count: 609'],
    ['', 'Monday, November 9, 2026 - Count: 5'],
    ['', '', '', 'Firm/Definite (30)', 147174, 46335.270833333336, 0.29166666666666674, 'Enterprise Leadership Forum', 'Conference (CNF)', '', 50, 46335, 0.7083333333333333, 46335.75, 'Santimano, Agneeta', 'Wild, Emma', '', 0, 0],
    ['', '', '', 'Firm/Definite (30)', 148884, 46335.3125, 0.35416666666666674, 'MCC Internal Meeting', 'Meeting (MTG)', 'Chadwick Room', 10, 46335, 0.41666666666666674, 46335.458333333336, 'Anderson, Ruby', 'Barbir, Danielle', '', 40.73, 0]
  ];
  const crownHeaders = ['Start Date', 'Start Time 24 Hour', 'End Time 24 Hour', 'Booking Event: Name', 'Function Room', 'Booking: Booking Post As', 'Booking: Status'];
  check('the header row is detected past a title row', detectHeaderRow(mcgAoa) === 2);
  check('the header row is the first row when there is no title row', detectHeaderRow([crownHeaders, ['09/11/2026', '07:00', '17:00', 'Setup', 'Palladium', 'Gala', 'Definite']]) === 1);
  check('header candidates include the real header row', headerCandidates(mcgAoa).some(c => c.row === 2));
  const mcgMapping = suggestFieldMapping(['', '', '', 'Status', 'Event ID', 'Bump In', 'Start Time', 'Description', 'Type', 'Booked Spaces', 'Attendance', 'End Date', 'End Time', 'Bump Out', 'Salesperson', 'Coordinator', 'Special Notes for the Event', 'Revenue', 'Open Balance'].filter(Boolean));
  check('the MCG columns are suggested correctly', mcgMapping.booking_name === 'Description' && mcgMapping.activity_name === 'Type' && mcgMapping.event_date === 'Bump In' && mcgMapping.start_time === 'Start Time' && mcgMapping.end_time === 'End Time' && mcgMapping.room_name === 'Booked Spaces' && mcgMapping.booking_status === 'Status' && mcgMapping.setup_start === 'Bump In' && mcgMapping.teardown_end === 'Bump Out');
  // Salespeople are always assigned by hand: the people named in a
  // venue's file are the hotel's salespeople, not Encore's, so the
  // wizard never suggests a salesperson column.
  check('no salesperson column is suggested', !('salesperson' in mcgMapping));
  const crownMapping = suggestFieldMapping(crownHeaders);
  check('the Crown columns are suggested correctly', crownMapping.booking_name === 'Booking: Booking Post As' && crownMapping.activity_name === 'Booking Event: Name' && crownMapping.event_date === 'Start Date' && crownMapping.start_time === 'Start Time 24 Hour' && crownMapping.end_time === 'End Time 24 Hour' && crownMapping.room_name === 'Function Room' && crownMapping.booking_status === 'Booking: Status');
  check("a ';' room separator is detected", detectRoomSeparator(['Room A;  Room B']) === ';');
  check('no room separator is detected for single rooms', detectRoomSeparator(['Room A']) === '');
  check('a room value splits on its separator', JSON.stringify(splitRoomValue('Members Dining Room;  Percy Beames Bar', ';')) === JSON.stringify(['Members Dining Room', 'Percy Beames Bar']));
  check('an empty room value splits to nothing', splitRoomValue('', ';').length === 0);
  check('room parts are counted most-used first', (() => {
    const parts = roomParts([{ room: 'A; B' }, { room: 'A' }, { room: 'B' }, { room: 'C' }], 'room', ';');
    return parts[0].name === 'A' && parts[0].count === 2 && parts[1].name === 'B' && parts[1].count === 2 && parts[2].name === 'C';
  })());
  const mcgVenue = parseVenueConfig(`site:\n  name: MCG\nfile_input:\n  header_row: 2\n  room_separator: ';'\nfields:\n  booking_name: Description\n  event_date: Bump In\n  start_time: Start Time\n  end_time: End Time\n  room_name: Booked Spaces\nrooms:\n  order: [Chadwick Room, Long Room, Unassigned]\n  unassigned_room: Unassigned\n`);
  check('a multi-room cell resolves to every room', JSON.stringify(resolveRooms('Chadwick Room;  Long Room', mcgVenue)) === JSON.stringify(['Chadwick Room', 'Long Room']));
  check('an empty room resolves to the unassigned room', JSON.stringify(resolveRooms('', mcgVenue)) === JSON.stringify(['Unassigned']));
  check('a header row of 0 is rejected', (() => { try { readConfiguration(`rooms:\n  order: [Room 1]\nfile_input:\n  header_row: 0\n`, false); return false; } catch { return true; } })());
  check('a header row and room separator survive a config round-trip', (() => {
    const back = readConfiguration(`rooms:\n  order: [Room 1]\nfile_input:\n  header_row: 2\n  room_separator: ';'\n`, false);
    const yaml = writeConfiguration(normalizeConfigDoc(JSON.parse(JSON.stringify(back))));
    const again = readConfiguration(yaml);
    return back.file_input?.header_row === 2 && back.file_input?.room_separator === ';' && again.file_input?.header_row === 2 && again.file_input?.room_separator === ';';
  })());
  check('a non-text room separator is rejected', (() => { try { readConfiguration(`rooms:\n  order: [Room 1]\nfile_input:\n  room_separator: 5\n`, false); return false; } catch { return true; } })());
  const mcgWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(mcgWorkbook, XLSX.utils.aoa_to_sheet(mcgAoa), 'Sheet1');
  check('records use the venue header row', (() => {
    // Rows below the header include the total and day-group rows; the
    // import skips those for having no title. The data rows are last.
    const records = sheetRecords(mcgWorkbook, 2);
    return records.length === 4 && records[2]['Description'] === 'Enterprise Leadership Forum' && records[2]['Bump In'] === 46335.270833333336 && records[3]['Booked Spaces'] === 'Chadwick Room';
  })());
  check('records from row 1 treat the title row as the header', (() => {
    const records = sheetRecords(mcgWorkbook, 1);
    return records.length === 5 && records[0]['NMD Current Events'] === '';
  })());
  check('only rows with a title count as events', (() => {
    const records = sheetRecords(mcgWorkbook, 2);
    const data = dataRecords(records, 'Description');
    return data.length === 2 && data[0]['Description'] === 'Enterprise Leadership Forum';
  })());
  check('a preview row reads the mapped values', (() => {
    const records = sheetRecords(mcgWorkbook, 2);
    const p = previewRow(records[3], mcgMapping, 'DD/MM/YYYY', ';');
    return p.title === 'MCC Internal Meeting' && p.date === '2026-11-09' && p.start === '08:30' && p.end === '10:00' && p.rooms === 'Chadwick Room' && p.error === '';
  })());
  check('a preview row with no room reports it', (() => {
    const records = sheetRecords(mcgWorkbook, 2);
    return previewRow(records[2], mcgMapping, 'DD/MM/YYYY', ';').error === 'No room';
  })());
  check('events are counted inside a date range', (() => {
    const records = sheetRecords(mcgWorkbook, 2);
    return countInRange(records, 'Bump In', 'DD/MM/YYYY', { start: '2026-11-09', end: '2026-11-09' }) === 2
      && countInRange(records, 'Bump In', 'DD/MM/YYYY', { start: '2026-11-10', end: '2026-11-10' }) === 0;
  })());
  check('the wizard YAML round-trips with the MCG choices', (() => {
    const yamlText = buildVenueYaml({
      venueName: 'MCG',
      headerRow: 2,
      roomSeparator: ';',
      mapping: mcgMapping,
      dateFormat: 'DD/MM/YYYY',
      rooms: ['Chadwick Room', 'Long Room'],
      excludedRooms: ['OB Van Compound'],
      unassignedRoom: true,
      allowedStatuses: ['Firm/Definite (30)', 'On Hold (25)'],
      setupLabel: 'Bump In',
      teardownLabel: 'Bump Out'
    });
    const back = readConfiguration(yamlText);
    return back.site.name === 'MCG'
      && back.file_input.header_row === 2
      && back.file_input.room_separator === ';'
      && back.fields.booking_name === 'Description'
      && back.fields.setup_start === 'Bump In'
      && back.fields.teardown_end === 'Bump Out'
      && !('salesperson' in back.fields)
      && back.rooms.order.includes('Unassigned')
      && back.rooms.unassigned_room === 'Unassigned'
      && back.rooms.exclude.includes('OB Van Compound')
      && JSON.stringify(back.timeline_items) === JSON.stringify(['Bump In', 'Bump Out'])
      && back.whiteboard.salespeople.length === 0;
  })());
  blocks = blocksFor([booking({ id: 'a', title: 'Hidden Event', roomId: 'Palladium A', roomIds: ['Palladium A'], hidden: true })], venue, [], false);
  check('hidden bookings are skipped when the board is locked', blocks.length === 0);
  blocks = blocksFor([booking({ id: 'a', title: 'Hidden Event', roomId: 'Palladium A', roomIds: ['Palladium A'], hidden: true })], venue, [], true);
  check('hidden bookings still render in unlock mode', blocks.length === 1 && blocks[0].hidden === true);

  // --- Overlapping blocks share the room side-by-side ---
  // The Dec 1 AICC/Gala case is back-to-back (end == start), so it
  // does not overlap and fills the full width. Two blocks that really
  // do overlap in the same room get different lanes and split the width.
  blocks = blocksFor([
    booking({ id: 'a', title: 'AICC', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '10:30', endTime: '15:00' }),
    booking({ id: 'b', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '15:00', endTime: '21:00' })
  ], venue, [], false);
  check('back-to-back blocks do not split', blocks.length === 2 && blocks.every(b => b.laneCount === undefined), JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Nufarm SLT', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '08:00', endTime: '13:30' }),
    booking({ id: 'b', title: 'Finsure PD Day', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '12:00', endTime: '12:30' })
  ], venue, [], false);
  check('two overlapping blocks in one room split the width', blocks.length === 2 && blocks[0].lane === 0 && blocks[0].laneCount === 2 && blocks[1].lane === 1 && blocks[1].laneCount === 2, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'First', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '09:00', endTime: '10:00' }),
    booking({ id: 'b', title: 'Second', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '09:30', endTime: '10:30' }),
    booking({ id: 'c', title: 'Third', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '09:45', endTime: '11:00' })
  ], venue, [], false);
  check('three overlapping blocks take three lanes', blocks.length === 3 && blocks.map(b => b.lane).join(',') === '0,1,2' && blocks.every(b => b.laneCount === 3), JSON.stringify(blocks));
  // A pair that only ever overlaps one other block takes half the
  // width, even when a different pair in the same room needs three lanes.
  blocks = blocksFor([
    booking({ id: 'a', title: 'Morning A', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '09:00', endTime: '10:00' }),
    booking({ id: 'b', title: 'Morning B', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '09:30', endTime: '10:30' }),
    booking({ id: 'c', title: 'Afternoon A', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '14:00', endTime: '15:00' }),
    booking({ id: 'd', title: 'Afternoon B', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '14:15', endTime: '15:15' }),
    booking({ id: 'e', title: 'Afternoon C', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '14:30', endTime: '15:30' })
  ], venue, [], false);
  check('a pair keeps half the width when another group needs three lanes', blocks.length === 5 && blocks[0].laneCount === 2 && blocks[1].laneCount === 2 && blocks[2].laneCount === 3 && blocks[3].laneCount === 3 && blocks[4].laneCount === 3, JSON.stringify(blocks));
  // Overlapping blocks in different rooms do not split each other.
  blocks = blocksFor([
    booking({ id: 'a', title: 'Room A Event', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '09:00', endTime: '12:00' }),
    booking({ id: 'b', title: 'Room B Event', roomId: 'Palladium B', roomIds: ['Palladium B'], startTime: '09:00', endTime: '12:00' })
  ], venue, [], false);
  check('overlapping blocks in different rooms do not split', blocks.length === 2 && blocks.every(b => b.laneCount === undefined), JSON.stringify(blocks));

  // --- Block colour rule: whole block unless unavailable ---
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], salespersonId: 'sp-1' })], venue, palette, false);
  check('available booking block is not unavailable', blocks.length === 1 && blocks[0].unavailable === false && blocks[0].colour === '#3366cc', JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], unavailable: true, salespersonId: 'sp-1' })], venue, palette, false);
  check('unavailable booking block is flagged unavailable and grey', blocks.length === 1 && blocks[0].unavailable === true && blocks[0].colour === '#9aa0a6', JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], salespersonId: 'unavailable' })], venue, palette, false);
  check('legacy unavailable salesperson still flags the block', blocks.length === 1 && blocks[0].unavailable === true && blocks[0].colour === '#9aa0a6', JSON.stringify(blocks));
  blocks = blocksFor([booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], salespersonId: 'sp-1', jobNumber: '1022948' })], venue, palette, false);
  check('block carries the salesperson initials', blocks.length === 1 && blocks[0].initials === 'AL' && blocks[0].jobNumber === '1022948', JSON.stringify(blocks));
  // The salesperson filter dims every block that is not that person's:
  // it reads the salesperson id off the block, so a block must carry
  // the id of the booking that sets its colour.
  blocks = blocksFor([
    booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], salespersonId: 'sp-1' }),
    booking({ id: 'b', title: 'Lunch', roomId: 'Palladium A', roomIds: ['Palladium A'], salespersonId: 'sp-2' }),
    booking({ id: 'c', title: 'Dinner', roomId: 'Palladium A', roomIds: ['Palladium A'] })
  ], venue, palette, false);
  check('blocks carry their salesperson id for the filter', blocks.length === 3 && blocks[0].salespersonId === 'sp-1' && blocks[1].salespersonId === 'sp-2' && blocks[2].salespersonId === undefined, JSON.stringify(blocks));
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
  blocks = blocksFor([aicc, gala], gardenVenue, [], false, [], ['Garden Room 1', 'Garden Room 2']);
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

  // --- Paint mode: the same rule, composed the way paintBlock does it ---
  // Painting a block paints its own rows; with "Apply to all" it also
  // paints the same job in other rooms (the like bookings), and a
  // booking with a different title is never touched.
  const paintList = [
    booking({ id: 'p1', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'] }),
    booking({ id: 'p2', title: 'Gala', roomId: 'Palladium B', roomIds: ['Palladium B'] }),
    booking({ id: 'p3', title: 'Lunch', roomId: 'Palladium A', roomIds: ['Palladium A'] })
  ];
  const paintOne = (applyAll) => {
    const blockIds = new Set(['p1']);
    const like = applyAll ? likeBookings(paintList, 'Gala', 'p1', 'sp-1').filter(l => !blockIds.has(l.id)) : [];
    const ids = new Set([...blockIds, ...like.map(l => l.id)]);
    return paintList.map(b => ids.has(b.id) ? { ...b, salespersonId: 'sp-1', colour: '#ff0000' } : b);
  };
  const paintedAll = paintOne(true);
  check('painting with Apply to all paints the same job in other rooms', paintedAll[0].salespersonId === 'sp-1' && paintedAll[1].salespersonId === 'sp-1' && paintedAll[2].salespersonId === undefined);
  const paintedOne = paintOne(false);
  check('painting without Apply to all paints only the clicked block', paintedOne[0].salespersonId === 'sp-1' && paintedOne[1].salespersonId === undefined && paintedOne[2].salespersonId === undefined);

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
  ], venue, [], false, [], ['Palladium A']);
  check('bookings sharing a merge group render as one wide block', blocks.length === 1 && blocks[0].rooms.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '22:00' }),
    booking({ id: 'b', title: 'Dinner', roomId: 'Palladium B', roomIds: ['Palladium B'], startTime: '19:00', endTime: '23:00' })
  ], venue, [], false);
  check('without a merge group, different titles and times stay separate', blocks.length === 2, JSON.stringify(blocks));
  blocks = blocksFor([
    booking({ id: 'a', title: 'Gala', roomId: 'Palladium A', roomIds: ['Palladium A'], startTime: '18:00', endTime: '22:00', mergeGroup: 'g1' }),
    booking({ id: 'b', title: 'Dinner', roomId: 'Palladium B', roomIds: ['Palladium B'], startTime: '19:00', endTime: '23:00', mergeGroup: 'g1' })
  ], venue, [], false, ['Palladium A'], ['Palladium A']);
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

  // --- TimeTarget notes carry their time for the weekend notes ---
  const carjiNote = ttApplied.markup.find(m => m.type === 'text' && m.roomId === 'Garden Room 3');
  check('a TimeTarget note carries its setup time', carjiNote?.time === '15:00', JSON.stringify(carjiNote));

  // --- Weekend / overnight notes ---
  const wnVenue = parseVenueConfig(`site:\n  name: Test Venue\nrooms:\n  order: ['Room A', 'Room B', 'Room C']\n`);
  const wnFri = overnightWindow(new Date(2026, 9, 2, 10, 0));
  check('a Friday opens the weekend window, 5pm Friday to 7am Monday', wnFri.kind === 'weekend' && wnFri.start.getDay() === 5 && wnFri.start.getDate() === 2 && wnFri.start.getHours() === 17 && wnFri.end.getDay() === 1 && wnFri.end.getDate() === 5 && wnFri.end.getHours() === 7 && wnFri.title === 'Weekend Notes' && wnFri.rangeLabel === 'Friday Oct 2 - Sunday Oct 4' && wnFri.filename.startsWith('Weekend Notes ') && wnFri.filename.endsWith('.docx'), JSON.stringify(wnFri));
  const wnSat = overnightWindow(new Date(2026, 9, 3, 10, 0));
  const wnSun = overnightWindow(new Date(2026, 9, 4, 10, 0));
  check('Saturday and Sunday open the same weekend window', wnSat.start.getTime() === wnFri.start.getTime() && wnSat.end.getTime() === wnFri.end.getTime() && wnSun.start.getTime() === wnFri.start.getTime() && wnSun.end.getTime() === wnFri.end.getTime(), JSON.stringify([wnSat, wnSun]));
  const wnMon = overnightWindow(new Date(2026, 9, 5, 10, 0));
  check('a Monday opens that night, 5pm to 7am Tuesday', wnMon.kind === 'weeknight' && wnMon.start.getDay() === 1 && wnMon.start.getDate() === 5 && wnMon.start.getHours() === 17 && wnMon.end.getDay() === 2 && wnMon.end.getDate() === 6 && wnMon.end.getHours() === 7 && wnMon.title === 'Overnight Notes' && wnMon.rangeLabel === 'Monday Oct 5 - Tuesday Oct 6', JSON.stringify(wnMon));
  check('parseHhmm reads 24-hour times and rejects the rest', parseHhmm('06:30') === 390 && parseHhmm('23:59') === 1439 && parseHhmm('24:00') === null && parseHhmm('6.30') === null);
  const wnBookings = [
    booking({ id: 'b-setup-in', title: 'Setup In', date: '2026-10-02', roomId: 'Room A', roomIds: ['Room A'], timeline: [{ label: 'Setup', start: '15:00', end: '22:00' }] }),
    booking({ id: 'b-setup-out', title: 'Setup Out', date: '2026-10-02', roomId: 'Room A', roomIds: ['Room A'], timeline: [{ label: 'Setup', start: '09:00', end: '15:00' }] }),
    booking({ id: 'b-sat-early', title: 'Sat Early', date: '2026-10-03', roomId: 'Room B', roomIds: ['Room B'], timeline: [{ label: 'Setup', start: '06:00', end: '09:00' }] }),
    booking({ id: 'b-sun', title: 'Sun Setup', date: '2026-10-04', roomId: 'Room A', roomIds: ['Room A'], timeline: [{ label: 'Setup', start: '10:00', end: '12:00' }] }),
    booking({ id: 'b-mon-late', title: 'Mon Late', date: '2026-10-05', roomId: 'Room A', roomIds: ['Room A'], timeline: [{ label: 'Setup', start: '08:00', end: '10:00' }] }),
    booking({ id: 'b-teardown', title: 'Teardown', date: '2026-10-02', roomId: 'Room B', roomIds: ['Room B'], timeline: [{ label: 'Teardown', start: '23:00', end: '01:00' }] }),
    booking({ id: 'b-multi', title: 'Multi Room', date: '2026-10-02', roomId: 'Room A', roomIds: ['Room A', 'Room B'], timeline: [{ label: 'Setup', start: '18:00', end: '20:00' }] }),
    booking({ id: 'b-note', title: 'Noted Setup', date: '2026-10-02', roomId: 'Room A', roomIds: ['Room A'], timeline: [{ label: 'Setup', start: '09:00', end: '18:45' }] }),
    booking({ id: 'b-twin-1', title: 'Twin Event', date: '2026-10-02', roomId: 'Room A', roomIds: ['Room A'], timeline: [{ label: 'Setup', start: '19:00', end: '22:00' }] }),
    booking({ id: 'b-twin-2', title: 'Twin Event', date: '2026-10-02', roomId: 'Room A', roomIds: ['Room A'], timeline: [{ label: 'Teardown', start: '23:30', end: '00:30' }] })
  ];
  const wnMarkup = [
    { id: 'n-1', type: 'text', x: 0, y: 0, text: 'Set Up 18:30', time: '18:30', bookingId: 'b-note', date: '2026-10-02', roomId: 'Room A', fx: 0.5, fy: 0.5, source: 'timetarget', timetargetKey: '2026-10-02|Room A|set up||b-note' },
    { id: 'n-2', type: 'text', x: 0, y: 0, text: 'Pack Down 05:00', time: '05:00', date: '2026-10-03', roomId: 'Room C', fx: 0.5, fy: 0.5, source: 'timetarget', timetargetKey: '2026-10-03|Room C|pack down||' },
    { id: 'n-3', type: 'text', x: 0, y: 0, text: 'Set Up 08:00', time: '08:00', date: '2026-10-05', roomId: 'Room A', fx: 0.5, fy: 0.5, source: 'timetarget', timetargetKey: '2026-10-05|Room A|set up||' },
    { id: 'n-4', type: 'text', x: 0, y: 0, text: 'Pack Down 23:00', time: '23:00', bookingId: 'b-note', date: '2026-10-02', roomId: 'Room A', fx: 0.5, fy: 0.5, source: 'timetarget', timetargetKey: '2026-10-02|Room A|pack down||b-note' },
    { id: 'n-5', type: 'text', x: 0, y: 0, text: 'Set Up 18:00', time: '18:00', bookingId: 'b-multi', date: '2026-10-02', roomId: 'Room A', fx: 0.5, fy: 0.5, source: 'timetarget', timetargetKey: '2026-10-02|Room A|set up||b-multi' },
    { id: 'n-6', type: 'text', x: 0, y: 0, text: 'Set Up 18:00', time: '18:00', bookingId: 'b-multi', date: '2026-10-02', roomId: 'Room B', fx: 0.5, fy: 0.5, source: 'timetarget', timetargetKey: '2026-10-02|Room B|set up||b-multi' },
    { id: 'n-7', type: 'text', x: 0, y: 0, text: 'Set Up 06:00', time: '06:00', bookingId: 'b-sat-early', date: '2026-10-03', roomId: 'Room B', fx: 0.5, fy: 0.5, source: 'timetarget', timetargetKey: '2026-10-03|Room B|set up||b-sat-early' },
    { id: 'n-8', type: 'text', x: 0, y: 0, text: 'Set Up 10:00', time: '10:00', bookingId: 'b-sun', date: '2026-10-04', roomId: 'Room A', fx: 0.5, fy: 0.5, source: 'timetarget', timetargetKey: '2026-10-04|Room A|set up||b-sun' },
    { id: 'n-9', type: 'text', x: 0, y: 0, text: 'Set Up 19:00', time: '19:00', bookingId: 'b-twin-1', date: '2026-10-02', roomId: 'Room A', fx: 0.5, fy: 0.5, source: 'timetarget', timetargetKey: '2026-10-02|Room A|set up||b-twin-1' },
    { id: 'n-10', type: 'text', x: 0, y: 0, text: 'Pack Down 23:30', time: '23:30', bookingId: 'b-twin-2', date: '2026-10-02', roomId: 'Room A', fx: 0.5, fy: 0.5, source: 'timetarget', timetargetKey: '2026-10-02|Room A|pack down||b-twin-2' }
  ];
  const wnMapVenue = parseVenueConfig(`site:\n  name: Test Venue\nrooms:\n  order: ['Room A', 'Room B', 'Room C', 'Room D']\n  room_mappings:\n    Palladium: ['Room A', 'Room B']\n`);
  check('a merged block prints under its combined name, and a long list shortens', roomDisplayName(wnMapVenue, ['Room A', 'Room B']) === 'Palladium' && roomDisplayName(wnMapVenue, ['Room A']) === 'Room A' && roomDisplayName(wnMapVenue, ['Room B', 'Room C']) === 'Room B, Room C' && roomDisplayName(wnMapVenue, ['Room A', 'Room B', 'Room C', 'Room D']) === 'Room A + 3 more', JSON.stringify([roomDisplayName(wnMapVenue, ['Room A', 'Room B']), roomDisplayName(wnMapVenue, ['Room A', 'Room B', 'Room C', 'Room D'])]));
  const wnItems = collectOvernightItems(wnBookings, wnMarkup, wnVenue, wnFri);
  check('only purple notes make items — a booking with no note is not listed', wnItems.length === 6 && !wnItems.some(i => ['Setup In', 'Setup Out', 'Mon Late', 'Teardown'].includes(i.title)), JSON.stringify(wnItems.map(i => `${i.roomId} ${i.date} ${i.title}`)));
  check('items print by day, then by room, then chronologically', JSON.stringify(wnItems.map(i => i.title)) === JSON.stringify(['Multi Room', 'Noted Setup', 'Twin Event', 'Sat Early', '', 'Sun Setup']), JSON.stringify(wnItems.map(i => `${i.date} ${i.roomId} ${i.title}`)));
  check('a multi-room setup is listed once, under its rooms', wnItems.filter(i => i.title === 'Multi Room').length === 1 && wnItems.find(i => i.title === 'Multi Room')?.roomName === 'Room A, Room B', JSON.stringify(wnItems.filter(i => i.title === 'Multi Room')));
  const wnNoted = wnItems.find(i => i.title === 'Noted Setup');
  check('a setup and its pack-down are one entry, with the purple times only', JSON.stringify(wnNoted?.timeLines) === JSON.stringify(['Set Up 18:30', 'Pack Down 23:00']) && wnNoted?.functionLabel === 'Set Up', JSON.stringify(wnNoted));
  const wnTwin = wnItems.find(i => i.title === 'Twin Event');
  check('the setup and pack-down of one event on two bookings are one entry', wnItems.filter(i => i.title === 'Twin Event').length === 1 && JSON.stringify(wnTwin?.timeLines) === JSON.stringify(['Set Up 19:00', 'Pack Down 23:30']), JSON.stringify(wnTwin));
  const wnMulti = wnItems.find(i => i.title === 'Multi Room');
  check('the same purple time in two rooms of one block is one line', JSON.stringify(wnMulti?.timeLines) === JSON.stringify(['Set Up 18:00']), JSON.stringify(wnMulti));
  const wnNoteOnly = wnItems.find(i => i.roomId === 'Room C');
  check('a purple note with no booking is a setup on its own', wnNoteOnly?.title === '' && JSON.stringify(wnNoteOnly?.timeLines) === JSON.stringify(['Pack Down 05:00']) && wnNoteOnly?.functionLabel === 'Pack Down', JSON.stringify(wnNoteOnly));
  // --- The .docx writer ---
  const dx = buildDocx({
    title: 'Test & <Doc>',
    header: [{ runs: [{ text: 'Test & <Doc>' }], align: 'center', bold: true, size: 48 }],
    footer: [{ runs: [{ text: 'Page ' }, { field: 'PAGE' }, { text: ' of ' }, { field: 'NUMPAGES' }], align: 'center', bold: true, size: 24 }],
    body: [
      { type: 'paragraph', paragraph: { runs: [{ text: 'A & B <C>' }], size: 28 } },
      {
        type: 'table',
        table: {
          widths: [4508, 4508],
          rows: [[{ paragraphs: [{ runs: [{ text: 'One' }], align: 'center', bold: true, size: 28 }], width: 4508 }, { paragraphs: [{ runs: [{ text: 'Two' }], align: 'center', bold: true, size: 28 }], width: 4508 }]],
        },
      },
    ],
  });
  const dxText = new TextDecoder().decode(dx);
  check('the writer makes a zip of stored XML parts', dx[0] === 0x50 && dx[1] === 0x4b && dx[2] === 0x03 && dx[3] === 0x04 && dxText.includes('[Content_Types].xml') && dxText.includes('word/document.xml') && dxText.includes('word/styles.xml') && dxText.includes('word/header1.xml') && dxText.includes('word/footer1.xml') && dxText.includes('word/fontTable.xml'), dxText.slice(0, 200));
  check('the writer escapes XML and keeps the Calibri/A4 shape', dxText.includes('A &amp; B &lt;C&gt;') && dxText.includes('Test &amp; &lt;Doc&gt;') && dxText.includes('w:ascii="Calibri"') && dxText.includes('w:pgSz w:w="11906" w:h="16838"') && dxText.includes('TableGrid') && dxText.includes(' PAGE ') && dxText.includes(' NUMPAGES '), dxText.slice(0, 400));
  const zipNames = bytes => {
    const names = [];
    let offset = 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const size = view.getUint32(offset + 18, true);
      names.push(new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen)));
      offset += 30 + nameLen + extraLen + size;
    }
    return { names, offset };
  };
  const dxParts = zipNames(dx);
  check('the zip local headers list every part in order', JSON.stringify(dxParts.names) === JSON.stringify(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/fontTable.xml', 'word/header1.xml', 'word/footer1.xml', 'docProps/core.xml', 'docProps/app.xml']), JSON.stringify(dxParts.names));
  const dxEocd = dx.length - 22;
  check('the end of central directory sits at the end and counts the parts', dx[dxEocd] === 0x50 && dx[dxEocd + 1] === 0x4b && dx[dxEocd + 2] === 0x05 && dx[dxEocd + 3] === 0x06 && new DataView(dx.buffer, dx.byteOffset + dxEocd, 22).getUint16(10, true) === 10, `eocd at ${dxEocd} of ${dx.length}`);

  check('the header uses the compact range, as the samples do', headerRangeLabel(wnFri) === 'Fri, 2 Oct - Sun, 4 Oct' && headerRangeLabel(wnMon) === 'Mon, 5 Oct - Tue, 6 Oct', JSON.stringify([headerRangeLabel(wnFri), headerRangeLabel(wnMon)]));
  const wnResult = buildWeekendNotesDocx(wnBookings, wnMarkup, wnVenue, new Date(2026, 9, 2, 10, 0));
  const wnText = new TextDecoder().decode(wnResult.bytes);
  const wnBullets = wnText.split('<w:t xml:space="preserve">- </w:t>').length - 1;
  check('the DOCX follows the samples: Calibri, header title, header table, day sections, Event/Room headings, dash bullets, no hotel times', wnResult.items === 6 && wnResult.days === 3 && wnResult.filename.endsWith('.docx') && wnResult.bytes[0] === 0x50 && wnResult.bytes[1] === 0x4b && wnText.includes('Weekend Notes Fri, 2 Oct - Sun, 4 Oct') && wnText.includes('Weekend Notes Friday Oct 2 - Sunday Oct 4') && wnText.includes('Duty Manager') && wnText.includes('0427 421 821') && wnText.includes('Saturday') && wnText.includes('Sunday') && wnText.lastIndexOf('>Saturday</w:t>') < wnText.lastIndexOf('>Sunday</w:t>') && wnText.includes('Multi Room/Room A, Room B') && wnText.includes('Noted Setup/Room A') && wnText.includes('Twin Event/Room A') && wnText.includes('Sat Early/Room B') && wnText.includes('Pack Down/Room C') && wnText.includes('Sun Setup/Room A') && wnText.includes('Set Up 18:00') && wnText.includes('Set Up 18:30') && wnText.includes('Pack Down 23:00') && wnText.includes('Set Up 19:00') && wnText.includes('Pack Down 23:30') && wnText.includes('Set Up 06:00') && wnText.includes('Pack Down 05:00') && wnText.includes('Set Up 10:00') && !wnText.includes('Setup 09:00') && !wnText.includes('Setup 19:00') && !wnText.includes('Teardown 23:00') && !wnText.includes(' PD/') && wnText.includes(' PAGE ') && wnText.includes(' NUMPAGES ') && wnBullets === 18, `bullets ${wnBullets}`);
  const wnEmpty = buildWeekendNotesDocx([], [], wnVenue, new Date(2026, 9, 2, 10, 0));
  const wnEmptyText = new TextDecoder().decode(wnEmpty.bytes);
  check('an empty window still produces a file that says so', wnEmpty.items === 0 && wnEmptyText.includes('No setups in this window.') && wnEmptyText.includes('Duty Manager'), '');

  console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
