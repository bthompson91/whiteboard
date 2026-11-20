import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  readWizardFile, detectHeaderRow, headerCandidates, headersFromAoA, sheetRecords,
  suggestFieldMapping, detectRoomSeparator, splitRoomValue, roomParts, dataRecords, columnValues,
  countInRange, salespeopleFromNames, buildVenueYaml, previewRow,
  WIZARD_FIELDS, FieldKey, WizardChoices
} from '../lib/wizard';
import './setupWizard.css';

const STEP_TITLES = ['Booking file', 'Columns', 'Rooms', 'Statuses, people and dates', 'Name the venue'];
const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };

interface Props {
  onCreateVenue: (yamlText: string, file: File, dateRange: { start: string; end: string } | null) => Promise<void>;
  onClose: () => void;
}

export default function SetupWizard({ onCreateVenue, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [aoa, setAoa] = useState<unknown[][]>([]);
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({} as Record<FieldKey, string>);
  const [roomSeparator, setRoomSeparator] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [roomFilter, setRoomFilter] = useState('');
  const [unassigned, setUnassigned] = useState(true);
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string> | null>(null);
  const [createSalespeople, setCreateSalespeople] = useState(true);
  const [noDateLimit, setNoDateLimit] = useState(false);
  const [rangeStart, setRangeStart] = useState(fmtDate(new Date()));
  const [rangeEnd, setRangeEnd] = useState(fmtDate(addDays(new Date(), 90)));
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY');
  const [venueName, setVenueName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const headers = useMemo(() => (aoa.length ? headersFromAoA(aoa, headerRow) : []), [aoa, headerRow]);
  const records = useMemo(() => (workbook ? sheetRecords(workbook, headerRow) : []), [workbook, headerRow]);
  // Only rows with a title are events: the rows below the header also
  // hold the file's total and day-group rows, which have no title and
  // no room, and would otherwise inflate the counts below.
  const dataRows = useMemo(
    () => dataRecords(records, mapping.booking_name || ''),
    [records, mapping.booking_name]
  );
  const candidates = useMemo(() => headerCandidates(aoa), [aoa]);
  const parts = useMemo(
    () => (mapping.room_name ? roomParts(dataRows, mapping.room_name, roomSeparator) : []),
    [dataRows, mapping.room_name, roomSeparator]
  );
  const emptySpaceCount = useMemo(() => {
    if (!mapping.room_name) return 0;
    return dataRows.filter(r => {
      const v = r[mapping.room_name];
      return v == null || String(v).trim() === '';
    }).length;
  }, [dataRows, mapping.room_name]);
  const statuses = useMemo(
    () => (mapping.booking_status ? columnValues(dataRows, mapping.booking_status) : []),
    [dataRows, mapping.booking_status]
  );
  const salespersonNames = useMemo(
    () => (mapping.salesperson ? columnValues(dataRows, mapping.salesperson).map(v => v.value) : []),
    [dataRows, mapping.salesperson]
  );
  // The date format only matters when the date column holds text like
  // 09/11/2026. Excel dates and ISO dates read the same either way.
  const needsDateFormat = useMemo(() => {
    if (!mapping.event_date) return false;
    return records.some(r => {
      const v = r[mapping.event_date];
      return typeof v === 'string' && /^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}$/.test(v.trim());
    });
  }, [records, mapping.event_date]);
  const dateRange = noDateLimit ? null : { start: rangeStart, end: rangeEnd };
  const inRangeCount = useMemo(
    () => (mapping.event_date ? countInRange(dataRows, mapping.event_date, dateFormat, dateRange) : 0),
    [dataRows, mapping.event_date, dateFormat, dateRange]
  );
  const keptRooms = parts.filter(p => !excluded.has(p.name)).map(p => p.name);
  const chosenStatuses = statuses.filter(s => (selectedStatuses ?? new Set(statuses.filter(x => !/cancel/i.test(x.value)).map(x => x.value))).has(s.value)).map(s => s.value);
  const chosenSalespeople = createSalespeople && mapping.salesperson ? salespeopleFromNames(salespersonNames) : [];

  const pickFile = async (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    try {
      const { workbook: wb, aoa: rows, headerRow: detected } = await readWizardFile(picked);
      setFile(picked);
      setWorkbook(wb);
      setAoa(rows);
      setHeaderRow(detected);
      const heads = headersFromAoA(rows, detected);
      setMapping(suggestFieldMapping(heads));
      const recs = sheetRecords(wb, detected);
      const suggested = suggestFieldMapping(heads);
      const roomValues = recs.map(r => String(r[suggested.room_name] ?? '')).filter(Boolean);
      setRoomSeparator(detectRoomSeparator(roomValues));
      setExcluded(new Set());
      setSelectedStatuses(null);
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const changeHeaderRow = (row: number) => {
    setHeaderRow(row);
    // A header that is not on the new header row cannot stay mapped.
    const heads = headersFromAoA(aoa, row);
    setMapping(current => {
      const next = { ...current } as Record<FieldKey, string>;
      for (const key of Object.keys(next) as FieldKey[]) if (next[key] && !heads.includes(next[key])) next[key] = '';
      return next;
    });
  };
  const canNext = () => {
    if (step === 0) return !!file;
    if (step === 1) return WIZARD_FIELDS.filter(f => f.required).every(f => mapping[f.key]?.trim());
    if (step === 2) return keptRooms.length > 0;
    if (step === 3) {
      if (mapping.booking_status && chosenStatuses.length === 0) return false;
      return noDateLimit || (!!rangeStart && !!rangeEnd && rangeEnd >= rangeStart);
    }
    return venueName.trim().length > 0;
  };
  const create = async () => {
    if (!file) return;
    setCreating(true);
    setError(null);
    try {
      // The setup/teardown labels come from the venue's own words when
      // the columns are the bump columns; otherwise the usual names.
      const bump = (col: string) => /bump/i.test(col);
      const choices: WizardChoices = {
        venueName,
        headerRow,
        roomSeparator,
        mapping,
        dateFormat,
        rooms: keptRooms,
        excludedRooms: parts.filter(p => excluded.has(p.name)).map(p => p.name),
        unassignedRoom: unassigned && emptySpaceCount > 0,
        allowedStatuses: chosenStatuses,
        salespeople: chosenSalespeople,
        setupLabel: mapping.setup_start ? (bump(mapping.setup_start) ? 'Bump In' : 'Setup') : 'Setup',
        teardownLabel: mapping.teardown_end ? (bump(mapping.teardown_end) ? 'Bump Out' : 'Teardown') : 'Teardown'
      };
      await onCreateVenue(buildVenueYaml(choices), file, dateRange);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  };
  const preview = dataRows.slice(0, 3).map(r => previewRow(r, mapping, dateFormat, roomSeparator));
  const shownParts = parts.filter(p => !roomFilter.trim() || p.name.toLowerCase().includes(roomFilter.trim().toLowerCase()));
  return (
    <div className="review-overlay">
      <section className="review-panel setup-wizard" aria-label="Set up a new venue">
        <header>
          <h2>Set up a new venue</h2>
          <p>Step {step + 1} of {STEP_TITLES.length} — {STEP_TITLES[step]}</p>
        </header>
        {step === 0 && (
          <div>
            <p>Upload the venue&apos;s booking file — the export it sends you, in whatever layout it comes in. The wizard reads the columns and rooms from the file and builds the venue YAML from them.</p>
            <label>Booking file <input type="file" accept=".xls,.xlsx,.xml,.csv" onChange={e => pickFile(e.target.files?.[0])} /></label>
            {file && <p>{file.name} — {dataRows.length} events in the file.</p>}
          </div>
        )}
        {step === 1 && (
          <div>
            <label>Header row{' '}
              <select value={headerRow} onChange={e => changeHeaderRow(Number(e.target.value))}>
                {candidates.map(c => <option key={c.row} value={c.row}>Row {c.row} — {c.preview}</option>)}
                {!candidates.some(c => c.row === headerRow) && <option value={headerRow}>Row {headerRow}</option>}
              </select>
            </label>
            <p>The header row is the one with the column names. Rows above it are skipped.</p>
            <table><thead><tr><th>Field</th><th>Column in the file</th></tr></thead><tbody>
              {WIZARD_FIELDS.map(f => (
                <tr key={f.key}><td>{f.label}{f.required ? ' *' : ''}</td><td>
                  <select aria-label={f.label} value={mapping[f.key] || ''} onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value }))}>
                    <option value="">Not in this file</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </td></tr>
              ))}
            </tbody></table>
            {needsDateFormat && (
              <label>Date order{' '}
                <select value={dateFormat} onChange={e => setDateFormat(e.target.value)}>
                  <option value="DD/MM/YYYY">Day first (09/11/2026 is 9 November)</option>
                  <option value="MM/DD/YYYY">Month first (09/11/2026 is 11 September)</option>
                </select>
              </label>
            )}
            <h3>Preview — first rows as they will import</h3>
            <table><thead><tr><th>Title</th><th>Date</th><th>Time</th><th>Rooms</th><th></th></tr></thead><tbody>
              {preview.map((p, i) => (
                <tr key={i}><td>{p.title}</td><td>{p.date}</td><td>{p.start}–{p.end}</td><td>{p.rooms}</td><td>{p.error}</td></tr>
              ))}
            </tbody></table>
            {!WIZARD_FIELDS.filter(f => f.required).every(f => mapping[f.key]?.trim()) && <p>Title, Date, Start time, End time and Room all need a column.</p>}
          </div>
        )}
        {step === 2 && (
          <div>
            <p>Every distinct space in the file, most-used first. Tick Exclude on the ones that are not rooms on the board. One cell can name several rooms — the separator below is how the file separates them.</p>
            <label>Room separator <input aria-label="Room separator" value={roomSeparator} onChange={e => setRoomSeparator(e.target.value)} placeholder="e.g. ;" /></label>
            {emptySpaceCount > 0 && (
              <label><input type="checkbox" checked={unassigned} onChange={e => setUnassigned(e.target.checked)} /> Put the {emptySpaceCount} event{emptySpaceCount === 1 ? '' : 's'} with no space in an “Unassigned” room</label>
            )}
            <label>Filter rooms <input aria-label="Filter rooms" value={roomFilter} onChange={e => setRoomFilter(e.target.value)} placeholder="Type to filter" /></label>
            <div className="setup-room-list">
              {shownParts.map(p => (
                <label key={p.name} className="setup-room-row">
                  <input type="checkbox" checked={!excluded.has(p.name)} onChange={e => setExcluded(current => {
                    const next = new Set(current);
                    if (e.target.checked) next.delete(p.name); else next.add(p.name);
                    return next;
                  })} />
                  <span>{p.name}</span><span>{p.count}</span>
                </label>
              ))}
            </div>
            <p>{keptRooms.length} rooms kept, {excluded.size} excluded.</p>
          </div>
        )}
        {step === 3 && (
          <div>
            {mapping.booking_status && (
              <div>
                <h3>Statuses — which events import</h3>
                {statuses.map(s => (
                  <label key={s.value} className="setup-check-row">
                    <input type="checkbox" checked={(selectedStatuses ?? new Set(statuses.filter(x => !/cancel/i.test(x.value)).map(x => x.value))).has(s.value)} onChange={e => setSelectedStatuses(current => {
                      const base = current ?? new Set(statuses.filter(x => !/cancel/i.test(x.value)).map(x => x.value));
                      const next = new Set(base);
                      if (e.target.checked) next.add(s.value); else next.delete(s.value);
                      return next;
                    })} />
                    <span>{s.value}</span><span>{s.count}</span>
                  </label>
                ))}
              </div>
            )}
            {mapping.salesperson && salespersonNames.length > 0 && (
              <div>
                <h3>Salespeople</h3>
                <label><input type="checkbox" checked={createSalespeople} onChange={e => setCreateSalespeople(e.target.checked)} /> Create {salespersonNames.length} salespeople from the {mapping.salesperson} column</label>
                {createSalespeople && <p>{salespersonNames.join(', ')}</p>}
              </div>
            )}
            {mapping.setup_start && <p>Setup start ({mapping.setup_start}) and teardown end ({mapping.teardown_end || '—'}) will show as setup and teardown on the blocks.</p>}
            <h3>First import — date range</h3>
            <p>The file spans more than the board should show at once. Import from a range now; a later re-import can bring in the rest.</p>
            <label><input type="checkbox" checked={noDateLimit} onChange={e => setNoDateLimit(e.target.checked)} /> Import all dates</label>
            {!noDateLimit && (
              <span>{' '}<label>From <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)} /></label>{' '}
              <label>To <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} /></label></span>
            )}
            <p>{inRangeCount} events in the range.</p>
          </div>
        )}
        {step === 4 && (
          <div>
            <label>Venue name <input aria-label="Venue name" value={venueName} onChange={e => setVenueName(e.target.value)} placeholder="e.g. MCG" /></label>
            <p>This is the name on the board and in the YAML. Saving asks where to put the YAML file, so it is linked like the other venues.</p>
            <ul>
              <li>{keptRooms.length} rooms{excluded.size ? `, ${excluded.size} excluded` : ''}{unassigned && emptySpaceCount > 0 ? `, plus Unassigned for ${emptySpaceCount} events with no space` : ''}.</li>
              <li>{mapping.booking_status ? `${chosenStatuses.length} of ${statuses.length} statuses import` : 'No status column mapped — every event imports'}.</li>
              <li>{chosenSalespeople.length ? `${chosenSalespeople.length} salespeople created` : 'No salespeople created'}.</li>
              <li>{dateRange ? `${inRangeCount} events from ${dateRange.start} to ${dateRange.end}` : `${dataRows.length} events, all dates`}.</li>
              <li>{mapping.setup_start ? 'Setup and teardown times from the file' : 'No setup or teardown times'}.</li>
            </ul>
          </div>
        )}
        {error && <p className="setup-error">{error}</p>}
        <footer>
          <button onClick={onClose}>Cancel</button>
          {step > 0 && <button onClick={() => setStep(step - 1)}>Back</button>}
          {step < STEP_TITLES.length - 1 && <button className="primary" disabled={!canNext()} onClick={() => setStep(step + 1)}>Next</button>}
          {step === STEP_TITLES.length - 1 && <button className="primary" disabled={!canNext() || creating} onClick={create}>{creating ? 'Creating…' : 'Create venue and import'}</button>}
        </footer>
      </section>
    </div>
  );
}
