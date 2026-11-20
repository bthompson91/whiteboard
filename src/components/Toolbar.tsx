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
  saving, linkedFiles, canLinkFiles,
  onToggleEditing, onSetMarkupMode, onOpenConfiguration,
  onRoleChange, onContributorNameChange, onSaveAndRefresh, onOpenLinkFiles
}: Props) {
  return (
    <header className="toolbar">
      <strong>{venue?.name || 'Venue Booking Whiteboard'}</strong>
      <select value={role} onChange={event => onRoleChange(event.target.value as BoardRole)} aria-label="User role">
        <option value="viewer">Viewer</option>
        <option value="contributor">Contributor</option>
        <option value="master">Master</option>
      </select>
      {role === 'contributor' && (
        <input
          value={contributorName}
          onChange={event => onContributorNameChange(event.target.value)}
          placeholder="Your name"
          aria-label="Contributor name"
        />
      )}
      {role === 'master' && (
        <button onClick={onOpenConfiguration} title="Configuration">⚙️</button>
      )}
      <button onClick={onSaveAndRefresh} disabled={saving} title={role === 'viewer' ? 'Refresh the board from the linked files' : 'Save changes to the linked files, then refresh the board'}>
        {saving ? 'Saving…' : role === 'viewer' ? '🔄 Refresh' : '💾 Save and refresh'}
      </button>
      {canLinkFiles && (
        <button onClick={onOpenLinkFiles} title="Link the bookings export, venue YAML, changes.json and board file">
          🔗 Link files{linkedFiles.changes ? ` (${linkedFiles.changes})` : ''}
        </button>
      )}
      <span>{`${bookingCount} bookings · rev ${revision}`}</span>
      {role !== 'viewer' && (
        <button onClick={onToggleEditing} title={editingEnabled ? 'Lock bookings' : 'Unlock bookings'}>
          {editingEnabled ? '🔓' : '🔒'}
        </button>
      )}
      <button className={markupMode === 'text' ? 'active' : ''} onClick={() => onSetMarkupMode(markupMode === 'none' ? 'text' : 'none')} title="Text note">📝</button>
      <button className={markupMode === 'arrow' ? 'active' : ''} onClick={() => onSetMarkupMode(markupMode === 'none' ? 'arrow' : 'none')} title="Arrow">➡️</button>
      {error && <div className="error" role="alert">{error}</div>}
    </header>
  );
}
