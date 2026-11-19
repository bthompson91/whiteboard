import { ChangeEvent, useState } from 'react';
import { BoardRole } from '../types';
import { ImportResult } from '../lib/bookingImport';
import { ParsedVenueConfig } from '../lib/venueConfig';
interface Props {
  venue: ParsedVenueConfig | null;
  bookingCount: number;
  role: BoardRole;
  editingEnabled: boolean;
  markupMode: 'none' | 'text' | 'arrow';
  error: string | null;
  submissionCount: number;
  onToggleEditing: () => void;
  onSetMarkupMode: (mode: 'none' | 'text' | 'arrow') => void;
  onOpenConfiguration: () => void;
  onBookingsLoaded: (result: ImportResult) => void;
  onError: (message: string) => void;
  onRoleChange: (role: BoardRole) => void;
  onOpenSubmissions: () => void;
  onExportSharedFile: () => void;
  onImportSharedFile: (file: File) => void;
}
export default function Toolbar({
  venue, bookingCount, role, editingEnabled, markupMode, error, submissionCount,
  onToggleEditing, onSetMarkupMode, onOpenConfiguration, onBookingsLoaded, onError,
  onRoleChange, onOpenSubmissions, onExportSharedFile, onImportSharedFile
}: Props) {
  const [loading, setLoading] = useState(false);
  const handleBookingFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !venue) return;
    setLoading(true);
    try {
      const { parseBookingWorkbook } = await import('../lib/bookingImport');
      onBookingsLoaded(await parseBookingWorkbook(file, venue));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  const handleSharedFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) onImportSharedFile(file);
  };
  return (
    <header className="toolbar">
      <strong>{venue?.name || 'Venue Booking Whiteboard'}</strong>
      <select value={role} onChange={event => onRoleChange(event.target.value as BoardRole)} aria-label="User role">
        <option value="viewer">Viewer</option>
        <option value="contributor">Contributor</option>
        <option value="master">Master</option>
      </select>
      {role === 'master' && (
        <>
          <button onClick={onOpenConfiguration}>Configuration</button>
          <label>
            Open events
            <input type="file" accept=".xls,.xlsx" onChange={handleBookingFile} disabled={!venue || loading} />
          </label>
          <label>
            Open shared file
            <input type="file" accept=".json" onChange={handleSharedFile} />
          </label>
          <button onClick={onExportSharedFile}>Export shared file</button>
          <button onClick={onOpenSubmissions}>
            Review submissions{submissionCount ? ` (${submissionCount})` : ''}
          </button>
        </>
      )}
      <span>{loading ? 'Importing…' : `${bookingCount} bookings`}</span>
      {role !== 'viewer' && (
        <button onClick={onToggleEditing}>
          {editingEnabled ? 'Lock bookings' : 'Unlock bookings'}
        </button>
      )}
      <button className={markupMode === 'text' ? 'active' : ''} onClick={() => onSetMarkupMode(markupMode === 'none' ? 'text' : 'none')}>Text note</button>
      <button className={markupMode === 'arrow' ? 'active' : ''} onClick={() => onSetMarkupMode(markupMode === 'none' ? 'arrow' : 'none')}>Arrow</button>
      {error && <div className="error" role="alert">{error}</div>}
    </header>
  );
}
