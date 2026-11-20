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
  error: string | null;
  revision: number;
  saving: boolean;
  linkedFiles: { board: string | null; yaml: string | null; bookings: string | null };
  canLinkFiles: boolean;
  editorLockName: string | null;
  onToggleEditing: () => void;
  onToggleShowHidden: () => void;
  onTogglePaintMode: () => void;
  onPaintSalespersonChange: (salespersonId: string) => void;
  onPaintApplyAllChange: (applyAll: boolean) => void;
  onSetMarkupMode: (mode: 'none' | 'text' | 'arrow') => void;
  onOpenConfiguration: () => void;
  onRoleChange: (role: BoardRole) => void;
  onDisplayNameChange: (name: string) => void;
  onSaveAndRefresh: () => void;
  onToday: () => void;
  onOpenLinkFiles: () => void;
}
export default function Toolbar({
  venue, bookingCount, role, displayName, editingEnabled, markupMode, showHidden, paintMode, paintSalespersonId, paintApplyAll, salespeople, error, revision,
  saving, linkedFiles, canLinkFiles, editorLockName,
  onToggleEditing, onToggleShowHidden, onTogglePaintMode, onPaintSalespersonChange, onPaintApplyAllChange, onSetMarkupMode, onOpenConfiguration,
  onRoleChange, onDisplayNameChange, onSaveAndRefresh, onToday, onOpenLinkFiles
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
      <button onClick={onSaveAndRefresh} disabled={saving} title="Re-read the linked files, so the board shows what everyone else has saved. Any edit made in the last moment is written out first, so the refresh cannot lose it.">
        {saving ? 'Refreshing…' : '🔄 Refresh'}
      </button>
      <button onClick={onToday} title="Snap to today">📅 Today</button>
      {canLinkFiles && (
        <button
          onClick={onOpenLinkFiles}
          title="Link the bookings export, venue YAML and board file"
          // Red while any file is unlinked, so it is obvious at a glance
          // that the board is not yet reading and writing its files.
          style={!(linkedFiles.board && linkedFiles.yaml && linkedFiles.bookings) ? { backgroundColor: '#c62828', borderColor: '#c62828', color: '#fff' } : undefined}
        >
          🔗 Link files{linkedFiles.board ? ` (${linkedFiles.board})` : ''}
        </button>
      )}
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
