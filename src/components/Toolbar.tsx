import { BoardRole } from '../types';
import { ParsedVenueConfig } from '../lib/venueConfig';
import { readableText, Salesperson } from '../lib/configuration';
interface Props {
  venue: ParsedVenueConfig | null;
  bookingCount: number;
  role: BoardRole;
  displayName: string;
  editingEnabled: boolean;
  markupMode: 'none' | 'text' | 'arrow';
  showHidden: boolean;
  // Paint mode: the editor picks a salesperson, then clicks blocks to
  // paint them in that colour. paintApplyAll also paints the same job
  // in other rooms (the inspector's "Apply to all").
  paintMode: boolean;
  paintSalespersonId: string;
  paintApplyAll: boolean;
  salespeople: Salesperson[];
  // Salesperson filter, for viewer and editor alike: when one is
  // picked, every other block dims to 25% opacity.
  filterSalespersonId: string;
  error: string | null;
  revision: number;
  saving: boolean;
  linkedFiles: { board: string | null; yaml: string | null; bookings: string | null };
  editorLockName: string | null;
  onToggleEditing: () => void;
  onToggleShowHidden: () => void;
  onTogglePaintMode: () => void;
  onPaintSalespersonChange: (salespersonId: string) => void;
  onPaintApplyAllChange: (applyAll: boolean) => void;
  onFilterSalespersonChange: (salespersonId: string) => void;
  onSetMarkupMode: (mode: 'none' | 'text' | 'arrow') => void;
  onOpenConfiguration: () => void;
  onRoleChange: (role: BoardRole) => void;
  onDisplayNameChange: (name: string) => void;
  onSaveAndRefresh: () => void;
  onToday: () => void;
  onOpenLinkFiles: () => void;
  onOpenPrint: () => void;
  onImportTimes: () => void;
}
export default function Toolbar({
  venue, bookingCount, role, displayName, editingEnabled, markupMode, showHidden, paintMode, paintSalespersonId, paintApplyAll, salespeople, filterSalespersonId, error, revision,
  saving, linkedFiles, editorLockName,
  onToggleEditing, onToggleShowHidden, onTogglePaintMode, onPaintSalespersonChange, onPaintApplyAllChange, onFilterSalespersonChange, onSetMarkupMode, onOpenConfiguration,
  onRoleChange, onDisplayNameChange, onSaveAndRefresh, onToday, onOpenLinkFiles, onOpenPrint, onImportTimes
}: Props) {
  return (
    <header className="toolbar">
      <strong>{venue?.name || 'Venue Booking Whiteboard'}</strong>
      <select value={role} onChange={event => onRoleChange(event.target.value as BoardRole)} aria-label="User role">
        <option value="viewer">Viewer</option>
        <option value="editor">Editor</option>
      </select>
      {role === 'editor' && (
        <input
          value={displayName}
          onChange={event => onDisplayNameChange(event.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          title="Shown to everyone else while you hold the editor lock"
        />
      )}
      {editorLockName && <span title="Only one editor at a time">✏️ {editorLockName} is editing</span>}
      {role === 'editor' && (
        <button onClick={onOpenConfiguration} title="Configuration">⚙️</button>
      )}
      {role === 'editor' && (
        <button onClick={onImportTimes} title="Import setup times from TimeTarget (one-off): a Date, Start Time, Function, Area, Event spreadsheet. Each row becomes a text note on the grid at that time in that room.">⏱️ Times</button>
      )}
      <button onClick={onSaveAndRefresh} disabled={saving} title="Re-read the linked files, so the board shows what everyone else has saved. Any edit made in the last moment is written out first, so the refresh cannot lose it.">
        {saving ? 'Refreshing…' : '🔄 Refresh'}
      </button>
      <button onClick={onToday} title="Snap to today">📅 Today</button>
      <button onClick={onOpenPrint} title="Export the board for a date range as a printout (Save as PDF)">🖨️ Print</button>
      <select value={filterSalespersonId} onChange={event => onFilterSalespersonChange(event.target.value)} aria-label="Filter by salesperson" title="Show one salesperson's blocks at full strength; everyone else's dims to 25%">
        <option value="">All salespeople</option>
        {salespeople.map(person => <option key={person.id} value={person.id} style={{ backgroundColor: person.colour, color: readableText(person.colour) }}>{person.name}</option>)}
      </select>
      {/* Always shown: file linking is how the board reads and writes
          its files, so the button must never silently vanish — in a
          browser without File System Access the panel says so and
          offers what still works instead. */}
      <button
        onClick={onOpenLinkFiles}
        title="Link the bookings export, venue YAML and board file"
        // Red while any file is unlinked, so it is obvious at a glance
        // that the board is not yet reading and writing its files.
        style={!(linkedFiles.board && linkedFiles.yaml && linkedFiles.bookings) ? { backgroundColor: '#c62828', borderColor: '#c62828', color: '#fff' } : undefined}
      >
        🔗 Link files{linkedFiles.board ? ` (${linkedFiles.board})` : ''}
      </button>
      <span>{`${bookingCount} bookings · rev ${revision}`}</span>
      {role !== 'viewer' && (
        <button onClick={onToggleEditing} title={editingEnabled ? 'Lock bookings' : 'Unlock bookings'}>
          {editingEnabled ? '🔓' : '🔒'}
        </button>
      )}
      {role !== 'viewer' && (
        <button className={showHidden ? 'active' : ''} onClick={onToggleShowHidden} title="Show hidden bookings on the board (faded, dashed) so they can be found and restored">
          {showHidden ? '👁️ Show hidden' : '🙈 Hidden off'}
        </button>
      )}
      {role !== 'viewer' && (
        <button className={paintMode ? 'active' : ''} onClick={onTogglePaintMode} title="Paint blocks in a salesperson's colour — pick a salesperson, then click a block">
          🎨
        </button>
      )}
      {role !== 'viewer' && paintMode && (
        <>
          <select value={paintSalespersonId} onChange={event => onPaintSalespersonChange(event.target.value)} title="Salesperson to paint with">
            <option value="">No salesperson</option>
            {salespeople.map(person => <option key={person.id} value={person.id} style={{ backgroundColor: person.colour, color: readableText(person.colour) }}>{person.name}</option>)}
          </select>
          <label className="checkbox" title="Also paint the same job in other rooms"><input type="checkbox" checked={paintApplyAll} onChange={event => onPaintApplyAllChange(event.target.checked)} />Apply to all</label>
        </>
      )}
      {role !== 'viewer' && (
        <>
          <button className={markupMode === 'text' ? 'active' : ''} onClick={() => onSetMarkupMode(markupMode === 'none' ? 'text' : 'none')} title="Text note">📝</button>
          <button className={markupMode === 'arrow' ? 'active' : ''} onClick={() => onSetMarkupMode(markupMode === 'none' ? 'arrow' : 'none')} title="Arrow">➡️</button>
        </>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </header>
  );
}
