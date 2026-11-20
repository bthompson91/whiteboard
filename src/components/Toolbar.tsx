import { BoardRole } from '../types';
import { ParsedVenueConfig } from '../lib/venueConfig';
interface Props {
  venue: ParsedVenueConfig | null;
  bookingCount: number;
  role: BoardRole;
  contributorName: string;
  editingEnabled: boolean;
  markupMode: 'none' | 'text' | 'arrow';
  error: string | null;
  revision: number;
  saving: boolean;
  linkedFiles: { board: string | null; yaml: string | null; changes: string | null; bookings: string | null };
  canLinkFiles: boolean;
  editorLockName: string | null;
  onToggleEditing: () => void;
  onSetMarkupMode: (mode: 'none' | 'text' | 'arrow') => void;
  onOpenConfiguration: () => void;
  onRoleChange: (role: BoardRole) => void;
  onContributorNameChange: (name: string) => void;
  onSaveAndRefresh: () => void;
  onOpenLinkFiles: () => void;
}
export default function Toolbar({
  venue, bookingCount, role, contributorName, editingEnabled, markupMode, error, revision,
  saving, linkedFiles, canLinkFiles, editorLockName,
  onToggleEditing, onSetMarkupMode, onOpenConfiguration,
  onRoleChange, onContributorNameChange, onSaveAndRefresh, onOpenLinkFiles
}: Props) {
  return (
    <header className="toolbar">
      <strong>{venue?.name || 'Venue Booking Whiteboard'}</strong>
      <select value={role} onChange={event => onRoleChange(event.target.value as BoardRole)} aria-label="User role">
        <option value="viewer">Viewer</option>
        <option value="contributor">Contributor</option>
        <option value="editor">Editor</option>
      </select>
      {editorLockName && <span title="Only one editor at a time">✏️ {editorLockName} is editing</span>}
      {role === 'contributor' && (
        <input
          value={contributorName}
          onChange={event => onContributorNameChange(event.target.value)}
          placeholder="Your name"
          aria-label="Contributor name"
        />
      )}
      {role === 'editor' && (
        <button onClick={onOpenConfiguration} title="Configuration">⚙️</button>
      )}
      <button onClick={onSaveAndRefresh} disabled={saving} title="Re-read the linked files, so the board shows what everyone else has saved. Any edit made in the last moment is written out first, so the refresh cannot lose it.">
        {saving ? 'Refreshing…' : '🔄 Refresh'}
      </button>
      {canLinkFiles && (
        <button
          onClick={onOpenLinkFiles}
          title="Link the bookings export, venue YAML, changes.json and board file"
          // Red while any file is unlinked, so it is obvious at a glance
          // that the board is not yet reading and writing its files.
          style={!(linkedFiles.board && linkedFiles.yaml && linkedFiles.changes && linkedFiles.bookings) ? { backgroundColor: '#c62828', borderColor: '#c62828', color: '#fff' } : undefined}
        >
          🔗 Link files{linkedFiles.changes ? ` (${linkedFiles.changes})` : ''}
        </button>
      )}
      <span>{`${bookingCount} bookings · rev ${revision}`}</span>
      {role !== 'viewer' && (
        <button onClick={onToggleEditing} title={editingEnabled ? 'Lock bookings' : 'Unlock bookings'}>
          {editingEnabled ? '🔓' : '🔒'}
        </button>
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
