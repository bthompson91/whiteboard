import { ChangeEvent, useState } from 'react';
import { BoardRole } from '../types';
import { ImportResult } from '../lib/bookingImport';
import { ParsedVenueConfig } from '../lib/venueConfig';
interface Props {
  venue: ParsedVenueConfig | null;
  bookingCount: number;
  role: BoardRole;
  contributorName: string;
  editingEnabled: boolean;
  markupMode: 'none' | 'text' | 'arrow';
  error: string | null;
  submissionCount: number;
  revision: number;
  canRevert: boolean;
  onToggleEditing: () => void;
  onSetMarkupMode: (mode: 'none' | 'text' | 'arrow') => void;
  onOpenConfiguration: () => void;
  onBookingsLoaded: (result: ImportResult) => void;
  onError: (message: string) => void;
  onRoleChange: (role: BoardRole) => void;
  onContributorNameChange: (name: string) => void;
  onOpenSubmissions: () => void;
  onExportPublishedBoard: () => void;
  onImportPublishedBoard: (file: File) => void;
  onExportVenueConfig: () => void;
  onExportContributorFile: () => void;
  onImportContributorFile: (file: File) => void;
  onRevertLastImport: () => void;
}
export default function Toolbar({
  venue, bookingCount, role, contributorName, editingEnabled, markupMode, error, submissionCount, revision, canRevert,
  onToggleEditing, onSetMarkupMode, onOpenConfiguration, onBookingsLoaded, onError,
  onRoleChange, onContributorNameChange, onOpenSubmissions, onExportPublishedBoard, onImportPublishedBoard,
  onExportVenueConfig, onExportContributorFile, onImportContributorFile, onRevertLastImport
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
  const handlePublishedBoard = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) onImportPublishedBoard(file);
  };
  const handleContributorFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) onImportContributorFile(file);
  };
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
        <>
          <button onClick={onOpenConfiguration}>Configuration</button>
          <label>
            Open events
            <input type="file" accept=".xls,.xlsx" onChange={handleBookingFile} disabled={!venue || loading} />
          </label>
          <label>
            Import contributor file
            <input type="file" accept=".json" onChange={handleContributorFile} />
          </label>
          <button onClick={onExportPublishedBoard}>Export published board</button>
          <button onClick={onExportVenueConfig} disabled={!venue}>Export venue config</button>
          <button onClick={onOpenSubmissions}>
            Review submissions{submissionCount ? ` (${submissionCount})` : ''}
          </button>
          <button onClick={onRevertLastImport} disabled={!canRevert}>Revert last import</button>
        </>
      )}
      {role === 'contributor' && (
        <>
          <label>
            Open published board
            <input type="file" accept=".json" onChange={handlePublishedBoard} />
          </label>
          <button onClick={onExportContributorFile}>Export my contributions</button>
          <label>
            Import my contributions
            <input type="file" accept=".json" onChange={handleContributorFile} />
          </label>
        </>
      )}
      {role === 'viewer' && (
        <label>
          Open published board
          <input type="file" accept=".json" onChange={handlePublishedBoard} />
        </label>
      )}
      <span>{loading ? 'Importing…' : `${bookingCount} bookings · rev ${revision}`}</span>
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
