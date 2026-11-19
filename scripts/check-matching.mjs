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
      join(root, 'src/lib/dateTime.ts')
    ],
    outdir: dir,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent'
  });
  const { compareImports } = await import(pathToFileURL(join(dir, 'importComparison.js')).href);
  const { applyReview, changeKey } = await import(pathToFileURL(join(dir, 'reviewApply.js')).href);
  const { dateValue, timeValue } = await import(pathToFileURL(join(dir, 'dateTime.js')).href);

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
    booking({ id: 'booking-1', title: 'Charity Gala', colour: '#ff0000', hidden: true, jobNumber: '123' }),
    booking({ id: 'booking-2', title: 'Old Event' })
  ];
  const current = [booking({ id: 'booking-9', title: 'Charity Dinner' })];
  result = compareImports(previous, current, 'Venue');
  const selectAll = Object.fromEntries(result.changes.map(c => [changeKey(c), true]));
  let published = applyReview(result.changes, selectAll);
  const merged = published.find(b => b.id === 'booking-1');
  check('accepting a match merges onto the previous booking', !!merged && merged.title === 'Charity Dinner' && merged.colour === '#ff0000' && merged.hidden === true && merged.jobNumber === '123', JSON.stringify(merged));
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

  console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
