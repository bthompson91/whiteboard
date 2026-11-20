import { useEffect, useMemo, useRef, useState } from 'react';
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
  parseBookingWorkbook,
  readImportHistory,
  revertToImport,
  saveImportHistory,
  savePreviousImport
} from './lib/bookingImport';
import { BookingChange, compareImports } from './lib/importComparison';
import { mergeMatchedBooking } from './lib/reviewApply';
import {
  createSharedFile,
  createSubmission,
  downloadSharedFile,
  hasFileSystemAccess,
  parseSharedFile,
  pickLinkedFile,
  pickLinkedFileToSave,
  readChangesFileFromHandle,
  readSharedFileFromHandle,
  writeChangesFileToHandle,
  writeLinkedFile,
  writeSharedFileToHandle,
  LinkedFileHandle
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
    () => venue?.rooms.map(room => settings?.room_widths[settings.room_types[room.id.trim()] || 'other'] || 175),
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
  // The linked files. The board works from three files that sit in one
  // folder: the bookings export, the venue YAML and changes.json (the
  // one shared list of changes). The board JSON itself is a fourth file
  // the master publishes. Each is a File System Access handle, kept in a
  // ref (handles are not serialisable), with the linked filename in
  // state so the toolbar can show it. The handles last for this page
  // load; linking again after a reload picks the same files.
  const boardHandleRef = useRef<LinkedFileHandle | null>(null);
  const yamlHandleRef = useRef<LinkedFileHandle | null>(null);
  const changesHandleRef = useRef<LinkedFileHandle | null>(null);
  const bookingsHandleRef = useRef<LinkedFileHandle | null>(null);
  const [linkedFiles, setLinkedFiles] = useState<{ board: string | null; yaml: string | null; changes: string | null; bookings: string | null }>({ board: null, yaml: null, changes: null, bookings: null });
  const [linkFilesOpen, setLinkFilesOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const writingChangesRef = useRef(false);
  // The auto-refresh interval reads this, so it always sees the latest
  // processed ids even though the interval itself is only re-created
  // when the role or the saving state changes.
  const processedIdsRef = useRef<string[]>(processedSubmissionIds);
  processedIdsRef.current = processedSubmissionIds;
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
  // Constantly write the board back to its linked file. The master owns
  // the board file, so only the master auto-writes it (a contributor's
  // changes live in changes.json instead). Debounced, so dragging a
  // colour across several bookings does not write on every keystroke.
  useEffect(() => {
    const handle = boardHandleRef.current;
    if (!handle || role !== 'master') return;
    const timer = window.setTimeout(() => {
      writeSharedFileToHandle(handle, createSharedFile(bookings, submissions, revision, processedSubmissionIds, importHistory)).catch(e => {
        setError(e instanceof Error ? e.message : String(e));
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [bookings, submissions, revision, processedSubmissionIds, importHistory, role]);
  // Constantly write the shared changes list back to changes.json.
  // Everyone writes to the same file, so this is a read-modify-write:
  // it reads the file, keeps changes from other contributors that are
  // not in this browser and have not been processed, lets this
  // browser's list win for ids it holds, and drops anything already
  // processed (accepted or rejected by the master). A guard serialises
  // writes so two rapid changes cannot interleave.
  useEffect(() => {
    const handle = changesHandleRef.current;
    if (!handle) return;
    const timer = window.setTimeout(async () => {
      if (writingChangesRef.current) return;
      writingChangesRef.current = true;
      try {
        let disk: ContributorSubmission[] = [];
        try { disk = (await readChangesFileFromHandle(handle)).submissions; } catch { disk = []; }
        const processed = new Set(processedSubmissionIds);
        const byId = new Map<string, ContributorSubmission>();
        for (const s of disk) if (!processed.has(s.id)) byId.set(s.id, s);
        for (const s of submissions) byId.set(s.id, s);
        await writeChangesFileToHandle(handle, [...byId.values()]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        writingChangesRef.current = false;
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [submissions, processedSubmissionIds]);
  const saveConfiguration = (text: string) => {
    readConfiguration(text);
    parseVenueConfig(text);
    localStorage.setItem(VENUE_YAML_KEY, text);
    setYamlText(text);
    setError(null);
    setConfigurationOpen(false);
    // Write the YAML back to its linked file, so the venue config on
    // disk stays the one the board is using.
    if (yamlHandleRef.current) {
      writeLinkedFile(yamlHandleRef.current, text, 'text/yaml').catch(e => {
        setError(e instanceof Error ? e.message : String(e));
      });
    }
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
  // Link one of the files the board works from. The bookings export, the
  // venue YAML and changes.json sit in one folder; linking them lets the
  // app write changes back to the same files instead of downloading new
  // copies. The board JSON is the file the master publishes. Linking a
  // changes file that already holds changes imports them; linking a
  // board file loads that board.
  const linkBoardFile = async () => {
    if (!hasFileSystemAccess()) { setError('This browser cannot link files. Use Chrome or Edge on desktop.'); return; }
    try {
      const handle = await pickLinkedFile({ types: [{ description: 'Whiteboard board', accept: { 'application/json': ['.json'] } }] });
      if (!handle) return;
      const shared = await readSharedFileFromHandle(handle);
      boardHandleRef.current = handle;
      setLinkedFiles(current => ({ ...current, board: handle.name }));
      setBookings(shared.bookings);
      setSubmissions(shared.submissions.filter(s => !processedSubmissionIds.includes(s.id)));
      setProcessedSubmissionIds(current => [...new Set([...current, ...shared.processedSubmissionIds])]);
      setRevision(shared.revision);
      setImportHistory(shared.history);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const linkBoardFileAsNew = async () => {
    if (!hasFileSystemAccess()) { setError('This browser cannot link files. Use Chrome or Edge on desktop.'); return; }
    try {
      const handle = await pickLinkedFileToSave(`whiteboard-published-rev${revision}-${new Date().toISOString().slice(0, 10)}.json`, 'Whiteboard board');
      if (!handle) return;
      boardHandleRef.current = handle;
      setLinkedFiles(current => ({ ...current, board: handle.name }));
      await writeSharedFileToHandle(handle, createSharedFile(bookings, submissions, revision, processedSubmissionIds, importHistory));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const linkYamlFile = async () => {
    if (!hasFileSystemAccess()) { setError('This browser cannot link files. Use Chrome or Edge on desktop.'); return; }
    try {
      const handle = await pickLinkedFile({ types: [{ description: 'Venue YAML', accept: { 'text/yaml': ['.yaml', '.yml'] } }] });
      if (!handle) return;
      const text = await (await handle.getFile()).text();
      readConfiguration(text);
      parseVenueConfig(text);
      yamlHandleRef.current = handle;
      setLinkedFiles(current => ({ ...current, yaml: handle.name }));
      localStorage.setItem(VENUE_YAML_KEY, text);
      setYamlText(text);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const linkChangesFile = async () => {
    if (!hasFileSystemAccess()) { setError('This browser cannot link files. Use Chrome or Edge on desktop.'); return; }
    try {
      const handle = await pickLinkedFile({ types: [{ description: 'Whiteboard changes', accept: { 'application/json': ['.json'] } }] });
      if (!handle) return;
      const text = await (await handle.getFile()).text();
      // An empty file is a fresh changes list; a non-empty one must
      // already be a changes file, or linking it would overwrite it.
      if (text.trim()) {
        const parsed = JSON.parse(text);
        if (parsed?.format !== 'whiteboard-changes' || parsed.version !== 1) throw new Error('This file is not a Whiteboard changes file. Pick changes.json, or an empty file to start one.');
      }
      changesHandleRef.current = handle;
      setLinkedFiles(current => ({ ...current, changes: handle.name }));
      await importChanges();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const linkBookingsFile = async () => {
    if (!hasFileSystemAccess()) { setError('This browser cannot link files. Use Chrome or Edge on desktop.'); return; }
    try {
      const handle = await pickLinkedFile({ types: [{ description: 'Events file', accept: { 'application/vnd.ms-excel': ['.xls', '.xlsx'] } }] });
      if (!handle) return;
      bookingsHandleRef.current = handle;
      setLinkedFiles(current => ({ ...current, bookings: handle.name }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  // Import the bookings export (.xls): from the linked file when one is
  // linked, otherwise pick a file first. This is the import that used
  // to live on the top bar; it now lives in the Link files panel.
  const importEventsFile = async () => {
    if (!venue) return;
    try {
      let handle = bookingsHandleRef.current;
      if (!handle) {
        if (!hasFileSystemAccess()) { setError('This browser cannot link files. Use Chrome or Edge on desktop.'); return; }
        const picked = await pickLinkedFile({ types: [{ description: 'Events file', accept: { 'application/vnd.ms-excel': ['.xls', '.xlsx'] } }] });
        if (!picked) return;
        handle = picked;
        bookingsHandleRef.current = handle;
        const name = handle.name;
        setLinkedFiles(current => ({ ...current, bookings: name }));
      }
      handleBookingsLoaded(await parseBookingWorkbook(await handle.getFile(), venue));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  // The master triggers an import of changes.json: read the shared list
  // and merge its pending changes into the review, skipping anything
  // already accepted or rejected.
  const importChanges = async () => {
    const handle = changesHandleRef.current;
    if (!handle) return;
    try {
      const incoming = (await readChangesFileFromHandle(handle)).submissions
        .filter(submission => !processedSubmissionIds.includes(submission.id));
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
  // Refresh only: re-read the linked board file and import any new
  // changes from changes.json. This is what a viewer does, and what the
  // board does automatically every 30 seconds in viewer mode.
  const refreshBoard = async () => {
    if (boardHandleRef.current) {
      const shared = await readSharedFileFromHandle(boardHandleRef.current);
      setBookings(shared.bookings);
      setSubmissions(shared.submissions.filter(s => !processedIdsRef.current.includes(s.id)));
      setProcessedSubmissionIds(current => [...new Set([...current, ...shared.processedSubmissionIds])]);
      setRevision(shared.revision);
      setImportHistory(shared.history);
    }
    await importChanges();
    setError(null);
  };
  // Refresh. Saving is automatic — the board writes itself back to
  // its linked file half a second after the master changes it, and
  // changes.json writes itself back half a second after anyone's
  // changes change — so this button does not need to save. It re-reads
  // the linked files, so the board shows what everyone else has saved
  // since. It still writes out any edit made in the last moment first,
  // so the re-read cannot overwrite a just-made change.
  const saveAndRefresh = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (role !== 'viewer') {
        if (boardHandleRef.current && role === 'master') {
          await writeSharedFileToHandle(boardHandleRef.current, createSharedFile(bookings, submissions, revision, processedSubmissionIds, importHistory));
        }
        if (yamlHandleRef.current) {
          await writeLinkedFile(yamlHandleRef.current, yamlText, 'text/yaml');
        }
        if (changesHandleRef.current) {
          await writeChangesFileToHandle(changesHandleRef.current, submissions);
        }
      }
      await refreshBoard();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  // In viewer mode the board refreshes itself every 30 seconds, so a
  // wall display (or any viewer) stays current without anyone touching
  // it. It only runs while the role is viewer, and it skips a tick
  // while a save is in progress.
  useEffect(() => {
    if (role !== 'viewer') return;
    const timer = setInterval(() => { if (!saving) refreshBoard().catch(e => setError(e instanceof Error ? e.message : String(e))); }, 30000);
    return () => clearInterval(timer);
  }, [role, saving]);
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
        revision={revision}
        onToggleEditing={() => setEditingEnabled(value => !value)}
        onSetMarkupMode={setMarkupMode}
        onOpenConfiguration={() => {
          setMarkupMode('none');
          setConfigurationOpen(true);
        }}
        onRoleChange={requestRoleChange}
        onContributorNameChange={setContributorName}
        onSaveAndRefresh={saveAndRefresh}
        saving={saving}
        linkedFiles={linkedFiles}
        canLinkFiles={hasFileSystemAccess()}
        onOpenLinkFiles={() => setLinkFilesOpen(true)}
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
          roomWidthMin={settings?.room_width_min || 125}
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
      {linkFilesOpen && (
        <div className="review-overlay">
          <section className="review-panel" aria-label="Link files">
            <header>
              <h2>Link files</h2>
              <p>The board works from three files in one folder — the bookings export, the venue YAML and changes.json — plus the board file the master publishes. Link them here and the app writes changes back to the same files instead of downloading new copies. Everyone writes their changes to the one changes.json; the master imports it and yes/no&apos;s each change.</p>
            </header>
            <table><thead><tr><th>File</th><th>Linked</th><th></th></tr></thead><tbody>
              <tr><td>Bookings export (.xls)</td><td>{linkedFiles.bookings || 'Not linked'}</td><td><button onClick={linkBookingsFile}>Link</button> <button onClick={importEventsFile} disabled={!venue}>Import</button></td></tr>
              <tr><td>Venue YAML (.yaml)</td><td>{linkedFiles.yaml || 'Not linked'}</td><td><button onClick={linkYamlFile}>Link</button> <button onClick={exportVenueConfig} disabled={!venue}>Download</button></td></tr>
              <tr><td>Changes (changes.json)</td><td>{linkedFiles.changes || 'Not linked'}</td><td><button onClick={linkChangesFile}>Link</button> {role !== 'viewer' && <button onClick={() => { importChanges(); setSubmissionsOpen(true); setLinkFilesOpen(false); }}>Review submissions{submissions.length ? ` (${submissions.length})` : ''}</button>}</td></tr>
              <tr><td>Board (.json)</td><td>{linkedFiles.board || 'Not linked'}</td><td><button onClick={linkBoardFile}>Open</button> <button onClick={linkBoardFileAsNew}>Save as</button> <button onClick={exportPublishedBoard}>Download</button></td></tr>
            </tbody></table>
            <p>Linking the bookings export lets Refresh re-read it. Linking changes.json lets the master import everyone&apos;s changes from the Submissions panel. The board file is written automatically whenever the master changes the board.</p>
            {role === 'master' && <p><button onClick={() => { setHistoryOpen(true); setLinkFilesOpen(false); }}>Import history</button> <button onClick={revertLastImport} disabled={importHistory.length <= 1}>Revert last import</button></p>}
            <footer>
              <button onClick={() => setLinkFilesOpen(false)}>Done</button>
            </footer>
          </section>
        </div>
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
