import { useEffect, useMemo, useState } from 'react';
import BookingGrid from './components/BookingGrid';
import ImportHistoryPanel from './components/ImportHistoryPanel';
import ImportReviewPanel from './components/ImportReviewPanel';
import SubmissionReviewPanel from './components/SubmissionReviewPanel';
import MarkupLayer from './components/MarkupLayer';
import Toolbar from './components/Toolbar';
import ConfigurationPage from './components/ConfigurationPage';
import { BoardRole, Booking, ContributorSubmission, ImportHistoryEntry, MarkupItem } from './types';
import {
  ImportResult,
  readImportHistory,
  revertToImport,
  saveImportHistory,
  savePreviousImport
} from './lib/bookingImport';
import { BookingChange, compareImports } from './lib/importComparison';
import { mergeMatchedBooking } from './lib/reviewApply';
import {
  createContributorFile,
  createSharedFile,
  createSubmission,
  downloadContributorFile,
  downloadSharedFile,
  parseContributorFile,
  parseSharedFile
} from './lib/sharedFile';
import { parseVenueConfig } from './lib/venueConfig';
import { boardSettings, readConfiguration } from './lib/configuration';
const MARKUP_KEY = 'whiteboard-markup';
const VENUE_YAML_KEY = 'whiteboard-venue-yaml';
const ROLE_KEY = 'whiteboard-role';
const CONTRIBUTOR_KEY = 'whiteboard-contributor-name';
const SUBMISSIONS_KEY = 'whiteboard-contributor-submissions';
const BOARD_CACHE_KEY = 'whiteboard-board-cache';
const REVISION_KEY = 'whiteboard-board-revision';
const PROCESSED_KEY = 'whiteboard-processed-submissions';
const HISTORY_KEY = 'whiteboard-import-history';
function startup() {
  try {
    const text = localStorage.getItem(VENUE_YAML_KEY) || '';
    if (text) readConfiguration(text);
    return { text, error: null as string | null };
  } catch (e) {
    return { text: '', error: e instanceof Error ? e.message : String(e) };
  }
}
function storedMarkup(): MarkupItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MARKUP_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function storedSubmissions(): ContributorSubmission[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function storedBoard(): Booking[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(BOARD_CACHE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function storedProcessed(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROCESSED_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
export default function App() {
  const [initial] = useState(startup);
  const [yamlText, setYamlText] = useState(initial.text);
  const venue = useMemo(() => yamlText ? parseVenueConfig(yamlText) : null, [yamlText]);
  const settings = useMemo(() => yamlText ? boardSettings(readConfiguration(yamlText)) : null, [yamlText]);
  const roomBaseWidths = useMemo(
    () => venue?.rooms.map(room => settings?.room_widths[settings.room_types[room.id] || 'other'] || 175),
    [venue, settings]
  );
  const [role, setRole] = useState<BoardRole>(() => {
    const stored = localStorage.getItem(ROLE_KEY);
    return stored === 'viewer' || stored === 'contributor' || stored === 'master' ? stored : 'viewer';
  });
  const [pendingRole, setPendingRole] = useState<BoardRole | null>(null);
  const [contributorName, setContributorName] = useState(() => localStorage.getItem(CONTRIBUTOR_KEY) || 'Contributor');
  const [bookings, setBookings] = useState<Booking[]>(storedBoard);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const [pendingReview, setPendingReview] = useState<ImportResult | null>(null);
  const [linkHistory, setLinkHistory] = useState<ImportResult[]>([]);
  const [submissions, setSubmissions] = useState<ContributorSubmission[]>(storedSubmissions);
  const [processedSubmissionIds, setProcessedSubmissionIds] = useState<string[]>(storedProcessed);
  const [revision, setRevision] = useState<number>(() => Number(localStorage.getItem(REVISION_KEY)) || 1);
  const [importHistory, setImportHistory] = useState<ImportHistoryEntry[]>(readImportHistory);
  const [submissionsOpen, setSubmissionsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [markup, setMarkup] = useState<MarkupItem[]>(storedMarkup);
  const [editingEnabled, setEditingEnabled] = useState(false);
  const [markupMode, setMarkupMode] = useState<'none' | 'text' | 'arrow'>('none');
  const [error, setError] = useState<string | null>(initial.error);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(MARKUP_KEY, JSON.stringify(markup));
    } catch {
      setError('Markup could not be saved in this browser. It remains available until this page is closed.');
    }
  }, [markup]);
  useEffect(() => {
    localStorage.setItem(ROLE_KEY, role);
  }, [role]);
  useEffect(() => {
    localStorage.setItem(CONTRIBUTOR_KEY, contributorName);
  }, [contributorName]);
  useEffect(() => {
    try {
      localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(submissions));
    } catch {
      setError('Contributor submissions could not be saved in this browser.');
    }
  }, [submissions]);
  useEffect(() => {
    try {
      localStorage.setItem(BOARD_CACHE_KEY, JSON.stringify(bookings));
    } catch {
      setError('The local board cache could not be saved in this browser.');
    }
  }, [bookings]);
  useEffect(() => {
    // The previous import is what a re-import carries colour, salesperson
    // and other edits from, so it must track the board, not just the last
    // publish: colour-coding a booking after publishing, then re-importing
    // the exact same file, lost every colour because the snapshot was
    // stale. An empty board never wipes it.
    if (bookings.length) savePreviousImport(bookings);
  }, [bookings]);
  useEffect(() => {
    localStorage.setItem(REVISION_KEY, String(revision));
  }, [revision]);
  useEffect(() => {
    try {
      localStorage.setItem(PROCESSED_KEY, JSON.stringify(processedSubmissionIds));
    } catch {
      setError('Processed submission history could not be saved in this browser.');
    }
  }, [processedSubmissionIds]);
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(importHistory));
    } catch {
      // Each history entry holds a full board snapshot, so a long
      // history can exceed this browser's storage. Drop the oldest
      // entry and try again on the next render, so the history shrinks
      // to fit instead of failing entirely. Only report an error when
      // even an empty history cannot be saved (storage unavailable).
      if (importHistory.length > 0) {
        setImportHistory(current => current.slice(0, -1));
      } else {
        setError('Import history could not be saved in this browser.');
      }
    }
  }, [importHistory]);
  const saveConfiguration = (text: string) => {
    readConfiguration(text);
    parseVenueConfig(text);
    localStorage.setItem(VENUE_YAML_KEY, text);
    setYamlText(text);
    setError(null);
    setConfigurationOpen(false);
  };
  const handleBookingsLoaded = (result: ImportResult) => {
    setPendingReview(result);
    setLinkHistory([]);
    setError(null);
  };
  const publish = (approved: Booking[], result: ImportResult | null) => {
    setBookings(approved);
    savePreviousImport(approved);
    setRevision(current => current + 1);
    if (result) {
      const entry: ImportHistoryEntry = {
        id: `import-${result.source.importedAt}-${result.source.fingerprint}`,
        ...result.source,
        bookings: approved
      };
      setImportHistory(current => [entry, ...current].slice(0, 10));
      setLastImport(result);
    }
    setPendingReview(null);
    setLinkHistory([]);
  };
  const applyImport = (approved: Booking[]) => publish(approved, pendingReview);
  const revertLastImport = () => {
    const [current, previous] = importHistory;
    if (!current || !previous) return;
    restoreImport(previous);
  };
  const restoreImport = (entry: ImportHistoryEntry) => {
    const restored = revertToImport(entry);
    setBookings(restored);
    const entryIndex = importHistory.findIndex(item => item.id === entry.id);
    if (entryIndex >= 0) setImportHistory(importHistory.slice(entryIndex));
    setRevision(current => current + 1);
    setHistoryOpen(false);
  };
  const linkMatch = (change: BookingChange) => {
    if (!pendingReview || !change.match || !venue) return;
    // Capture the match first: narrowing on change.match is lost inside
    // the map callback below, which is what broke the production build.
    const match = change.match;
    setLinkHistory(current => [...current, pendingReview]);
    const linked = pendingReview.bookings.map(booking => {
      if (booking.id !== change.booking.id) return booking;
      return mergeMatchedBooking(match.previous, booking);
    });
    const comparison = compareImports(
      pendingReview.comparison.changes
        .filter(item => item.previous)
        .map(item => item.previous!),
      linked,
      venue.name
    );
    setPendingReview({ bookings: linked, comparison, source: pendingReview.source });
  };
  const undoLinkMatch = () => {
    // Undo one link at a time: pop the most recent pre-link review.
    const previous = linkHistory[linkHistory.length - 1];
    if (!previous) return;
    setPendingReview(previous);
    setLinkHistory(linkHistory.slice(0, -1));
  };
  const requestRoleChange = (next: BoardRole) => {
    // Roles run on trust — this is an internal tool — but switching to a
    // role that can change the board for everyone should take a deliberate
    // click, not an idle dropdown change.
    const rank: Record<BoardRole, number> = { viewer: 0, contributor: 1, master: 2 };
    if (rank[next] > rank[role]) setPendingRole(next);
    else setRole(next);
  };
  const handleBookingsChange = (next: Booking[]) => {
    if (role === 'viewer') return;
    if (role === 'master') {
      setBookings(next);
      return;
    }
    const updated = [...submissions];
    for (const booking of next) {
      const current = bookings.find(existing => existing.id === booking.id);
      if (!current) continue;
      if (JSON.stringify(current) === JSON.stringify(booking)) continue;
      const existing = updated.find(submission => submission.bookingId === booking.id);
      if (existing) {
        updated[updated.indexOf(existing)] = {
          ...existing,
          proposed: { ...booking },
          updatedAt: new Date().toISOString()
        };
      } else {
        updated.push(createSubmission(booking, current, contributorName || 'Contributor', revision));
      }
    }
    setSubmissions(updated);
  };
  const acceptSubmission = (submission: ContributorSubmission) => {
    setBookings(bookings.map(booking => booking.id === submission.bookingId ? submission.proposed : booking));
    setSubmissions(submissions.filter(item => item.id !== submission.id));
    setProcessedSubmissionIds(current => [...current, submission.id]);
    setRevision(current => current + 1);
  };
  const rejectSubmission = (submission: ContributorSubmission) => {
    setSubmissions(submissions.filter(item => item.id !== submission.id));
    setProcessedSubmissionIds(current => [...current, submission.id]);
  };
  const exportPublishedBoard = () => downloadSharedFile(
    createSharedFile(bookings, submissions, revision, processedSubmissionIds, importHistory)
  );
  const importPublishedBoard = async (file: File) => {
    try {
      const shared = parseSharedFile(await file.text());
      setBookings(shared.bookings);
      setSubmissions(shared.submissions.filter(submission => !processedSubmissionIds.includes(submission.id)));
      setProcessedSubmissionIds(current => [...new Set([...current, ...shared.processedSubmissionIds])]);
      setRevision(shared.revision);
      setImportHistory(shared.history);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const exportVenueConfig = () => {
    const blob = new Blob([yamlText], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'whiteboard-venue.yaml';
    link.click();
    URL.revokeObjectURL(url);
  };
  const exportContributorFile = () => downloadContributorFile(
    createContributorFile(contributorName || 'Contributor', revision, submissions)
  );
  const importContributorFile = async (file: File) => {
    try {
      const contributorFile = parseContributorFile(await file.text());
      const incoming = contributorFile.submissions
        .filter(submission => !processedSubmissionIds.includes(submission.id))
        .map(submission => ({
          ...submission,
          author: contributorFile.contributor,
          revisionBase: contributorFile.revisionBase
        }));
      setSubmissions(current => {
        const merged = [...current];
        for (const submission of incoming) {
          const existingIndex = merged.findIndex(item => item.id === submission.id);
          if (existingIndex >= 0) merged[existingIndex] = submission;
          else merged.push(submission);
        }
        return merged;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="app">
      <Toolbar
        venue={venue}
        bookingCount={bookings.length}
        role={role}
        contributorName={contributorName}
        editingEnabled={editingEnabled}
        markupMode={markupMode}
        error={error}
        submissionCount={submissions.length}
        revision={revision}
        canRevert={importHistory.length > 1}
        onToggleEditing={() => setEditingEnabled(value => !value)}
        onSetMarkupMode={setMarkupMode}
        onOpenConfiguration={() => {
          setMarkupMode('none');
          setConfigurationOpen(true);
        }}
        onBookingsLoaded={handleBookingsLoaded}
        onError={setError}
        onRoleChange={requestRoleChange}
        onContributorNameChange={setContributorName}
        onOpenSubmissions={() => setSubmissionsOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onExportPublishedBoard={exportPublishedBoard}
        onImportPublishedBoard={importPublishedBoard}
        onExportVenueConfig={exportVenueConfig}
        onExportContributorFile={exportContributorFile}
        onImportContributorFile={importContributorFile}
        onRevertLastImport={revertLastImport}
      />
      <main className="board-container">
        <BookingGrid
          venue={venue}
          bookings={bookings}
          salespeople={settings?.salespeople || []}
          roomBorders={settings?.room_borders || []}
          editingEnabled={editingEnabled && role !== 'viewer'}
          selectedBookingId={selectedBookingId}
          onBookingsChange={handleBookingsChange}
          onSelectedBookingChange={setSelectedBookingId}
          roomBaseWidths={roomBaseWidths}
        />
        <MarkupLayer
          markup={markup}
          mode={markupMode}
          selectedBookingId={selectedBookingId}
          onChange={setMarkup}
          onClearSelectedBooking={() => setSelectedBookingId(null)}
        />
      </main>
      {configurationOpen && (
        <ConfigurationPage
          yamlText={yamlText}
          hasBookings={bookings.length > 0}
          onSave={saveConfiguration}
          onClose={() => setConfigurationOpen(false)}
        />
      )}
      {pendingReview && (
        <ImportReviewPanel
          result={pendingReview}
          hasDuplicate={!!importHistory[0] && importHistory[0].fingerprint === pendingReview.source.fingerprint}
          canUndoLink={linkHistory.length > 0}
          onApply={applyImport}
          onLinkMatch={linkMatch}
          onUndoLink={undoLinkMatch}
          onCancel={() => {
            setPendingReview(null);
            setLinkHistory([]);
          }}
        />
      )}
      {submissionsOpen && (
        <SubmissionReviewPanel
          submissions={submissions}
          bookings={bookings}
          currentRevision={revision}
          onAccept={acceptSubmission}
          onReject={rejectSubmission}
          onForceAccept={acceptSubmission}
          onClose={() => setSubmissionsOpen(false)}
        />
      )}
      {historyOpen && (
        <ImportHistoryPanel
          history={importHistory}
          onRestore={restoreImport}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {pendingRole && (
        <div className="review-overlay">
          <section className="review-panel" aria-label="Confirm role change">
            <header>
              <h2>Switch to {pendingRole}?</h2>
              <p>
                {pendingRole === 'master'
                  ? 'The master can publish changes, review contributor submissions, change the venue configuration and revert imports. Only switch if you are one of the board editors.'
                  : 'A contributor can edit bookings and send changes for the master to review. Only switch if you are one of the board editors.'}
              </p>
            </header>
            <footer>
              <button onClick={() => setPendingRole(null)}>Cancel</button>
              <button className="primary" onClick={() => { setRole(pendingRole); setPendingRole(null); }}>OK, switch to {pendingRole}</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
