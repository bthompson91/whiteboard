import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format } from 'date-fns';
import BookingGrid from './components/BookingGrid';
import ImportHistoryPanel from './components/ImportHistoryPanel';
import ImportReviewPanel from './components/ImportReviewPanel';
import MarkupLayer from './components/MarkupLayer';
import PrintView from './components/PrintView';
import SetupWizard from './components/SetupWizard';
import Toolbar from './components/Toolbar';
import ConfigurationPage from './components/ConfigurationPage';
import { BoardRole, Booking, EditorLock, ImportHistoryEntry, MarkupItem } from './types';
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
import { applyTimetargetRows, parseTimetargetWorkbook, TimetargetSkipped } from './lib/timetargetImport';
import { buildWeekendNotesDocx } from './lib/weekendNotes';
import {
  createSharedFile,
  downloadSharedFile,
  hasFileSystemAccess,
  loadLinkedHandle,
  parseSharedFile,
  pickLinkedFile,
  pickLinkedFileToSave,
  readSharedFileFromHandle,
  saveLinkedHandle,
  writeLinkedFile,
  writeSharedFileToHandle,
  LinkedFileHandle,
  StoredFileHandle
} from './lib/sharedFile';
import { parseVenueConfig } from './lib/venueConfig';
import { boardSettings, readConfiguration } from './lib/configuration';
const MARKUP_KEY = 'whiteboard-markup';
const WELCOME_DISMISSED_KEY = 'whiteboard-welcome-dismissed';
const VENUE_YAML_KEY = 'whiteboard-venue-yaml';
const ROLE_KEY = 'whiteboard-role';
const DISPLAY_NAME_KEY = 'whiteboard-display-name';
const EDITOR_SESSION_KEY = 'whiteboard-editor-session';
// The editor lock: only one editor at a time. The lock lives in the
// shared board file and is refreshed every 30s while someone is the
// editor; a lock older than this is stale and can be taken over, so a
// browser that closed without releasing does not lock everyone out.
const EDITOR_LOCK_TTL_MS = 120000;
const EDITOR_LOCK_HEARTBEAT_MS = 30000;
const BOARD_CACHE_KEY = 'whiteboard-board-cache';
const REVISION_KEY = 'whiteboard-board-revision';
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
function storedBoard(): Booking[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(BOARD_CACHE_KEY) || '[]');
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
    // The old 'master' and 'contributor' roles are gone; a stored one
    // falls back to viewer.
    if (stored === 'master') return 'editor';
    return stored === 'viewer' || stored === 'editor' ? stored : 'viewer';
  });
  // The editor lock, as this browser last saw it. A session id that
  // survives reloads, so this browser recognises its own lock after a
  // refresh instead of thinking someone else holds it.
  const [editorSessionId] = useState(() => {
    const stored = localStorage.getItem(EDITOR_SESSION_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(EDITOR_SESSION_KEY, id);
    return id;
  });
  const [editorLock, setEditorLock] = useState<EditorLock | null>(null);
  const editorLockRef = useRef<EditorLock | null>(null);
  editorLockRef.current = editorLock;
  const [pendingRole, setPendingRole] = useState<BoardRole | null>(null);
  // Someone else holds a fresh editor lock, and the user asked to
  // switch to editor anyway: this is the override dialog, with the
  // holder's name and when they took the lock.
  const [lockConflict, setLockConflict] = useState<{ name: string; at: number } | null>(null);
  // The name shown on the editor lock, so other devices can see who is
  // editing. It falls back to the old contributor name when present.
  const [displayName, setDisplayName] = useState(() => localStorage.getItem(DISPLAY_NAME_KEY) || localStorage.getItem('whiteboard-contributor-name') || 'Editor');
  const [bookings, setBookings] = useState<Booking[]>(storedBoard);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const [pendingReview, setPendingReview] = useState<ImportResult | null>(null);
  const [linkHistory, setLinkHistory] = useState<ImportResult[]>([]);
  const [revision, setRevision] = useState<number>(() => Number(localStorage.getItem(REVISION_KEY)) || 1);
  const [importHistory, setImportHistory] = useState<ImportHistoryEntry[]>(readImportHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [markup, setMarkup] = useState<MarkupItem[]>(storedMarkup);
  const [editingEnabled, setEditingEnabled] = useState(false);
  const [markupMode, setMarkupMode] = useState<'none' | 'text' | 'arrow'>('none');
  // Show hidden bookings on the board (faded, dashed) even while the
  // board is locked, so they can be found and — once unlocked —
  // restored from the inspector. Hidden bookings already show while
  // unlocked; this is the explicit toggle issue #2 asks for.
  const [showHidden, setShowHidden] = useState(false);
  // Paint mode: the editor picks a salesperson in the top bar, then
  // clicks blocks to paint them in that colour. Turning it on picks
  // the first salesperson so it is ready to paint straight away.
  const [paintMode, setPaintMode] = useState(false);
  const [paintSalespersonId, setPaintSalespersonId] = useState('');
  const [paintApplyAll, setPaintApplyAll] = useState(false);
  // Salesperson filter, for viewer and editor alike: when one is
  // picked, every other block dims to 25% opacity.
  const [filterSalespersonId, setFilterSalespersonId] = useState('');
  // The filter's focus window starts at the previous day: only the
  // filtered salesperson's blocks from yesterday onward stay full, and
  // only annotations anchored to one of those blocks stay full. Older
  // blocks and annotations dim too. The cells are "date|roomId" keys.
  const yesterday = format(addDays(new Date(), -1), 'yyyy-MM-dd');
  const highlightedCells = useMemo(() => {
    const cells = new Set<string>();
    if (!filterSalespersonId) return cells;
    for (const b of bookings) {
      if (b.salespersonId !== filterSalespersonId || b.date < yesterday) continue;
      for (const roomId of b.roomIds || [b.roomId]) cells.add(`${b.date}|${roomId}`);
    }
    return cells;
  }, [bookings, filterSalespersonId, yesterday]);
  const togglePaintMode = () => {
    if (!paintMode && !paintSalespersonId && settings?.salespeople?.length) {
      setPaintSalespersonId(settings.salespeople[0].id);
    }
    setPaintMode(!paintMode);
  };
  const [error, setError] = useState<string | null>(initial.error);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  // The first-time setup wizard: creating a venue from its booking
  // file. It opens from the Link files panel, and on first run — when
  // no venue YAML has ever been stored and the welcome has not been
  // dismissed — the welcome offers it instead of the empty board.
  const [setupWizardOpen, setSetupWizardOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(() => !initial.text && !localStorage.getItem(WELCOME_DISMISSED_KEY));
  const dismissWelcome = () => {
    localStorage.setItem(WELCOME_DISMISSED_KEY, '1');
    setWelcomeOpen(false);
  };
  // The linked files. The board works from two files that sit in one
  // folder: the bookings export and the venue YAML. The board JSON
  // itself is a third file the editor publishes. Each is a File System
  // Access handle, kept in a ref (handles are not serialisable), with
  // the linked filename in state so the toolbar can show it. The
  // handles last for this page load; linking again after a reload
  // picks the same files.
  const boardHandleRef = useRef<LinkedFileHandle | null>(null);
  const yamlHandleRef = useRef<LinkedFileHandle | null>(null);
  const bookingsHandleRef = useRef<LinkedFileHandle | null>(null);
  // The Today button lives in the Toolbar, but the scroll itself lives
  // in BookingGrid, where the rows are. This ref carries the scroll
  // function up so the button can call it.
  const scrollToTodayRef = useRef<(() => void) | null>(null);
  const [linkedFiles, setLinkedFiles] = useState<{ board: string | null; yaml: string | null; bookings: string | null }>({ board: null, yaml: null, bookings: null });
  const [linkFilesOpen, setLinkFilesOpen] = useState(false);
  // Print view: a paper-friendly board for a chosen date range, built
  // for Print -> Save as PDF. The dialog picks the range (defaulting
  // to the bookings on the board); confirming opens the print view.
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  // The last TimeTarget import's result, shown as a summary dialog.
  const [timetargetResult, setTimetargetResult] = useState<{ added: number; updated: number; skipped: TimetargetSkipped[] } | null>(null);
  const [printStart, setPrintStart] = useState('');
  const [printEnd, setPrintEnd] = useState('');
  const [printRange, setPrintRange] = useState<{ start: string; end: string } | null>(null);
  const openPrintDialog = () => {
    const dates = bookings.map(b => b.date).sort();
    const today = format(new Date(), 'yyyy-MM-dd');
    setPrintStart(dates[0] || today);
    setPrintEnd(dates[dates.length - 1] || format(addDays(new Date(), 6), 'yyyy-MM-dd'));
    setPrintDialogOpen(true);
  };
  const [saving, setSaving] = useState(false);
  // Restore the linked files from the previous session. Handles are
  // kept in IndexedDB — they cannot go in localStorage, which only
  // holds strings — so the links survive a reload and a new version of
  // the app. A stored handle is only reused when the browser still
  // grants permission for it; otherwise it stays unlinked and the Link
  // files button shows red until it is linked again.
  useEffect(() => {
    if (!hasFileSystemAccess()) return;
    let cancelled = false;
    (async () => {
      const entries: { key: 'board' | 'yaml' | 'bookings'; ref: React.MutableRefObject<LinkedFileHandle | null>; mode: 'read' | 'readwrite' }[] = [
        { key: 'board', ref: boardHandleRef, mode: 'readwrite' },
        { key: 'yaml', ref: yamlHandleRef, mode: 'readwrite' },
        { key: 'bookings', ref: bookingsHandleRef, mode: 'read' }
      ];
      for (const { key, ref, mode } of entries) {
        try {
          const handle = await loadLinkedHandle(key);
          if (!handle || cancelled) continue;
          const stored = handle as StoredFileHandle;
          const permission = typeof stored.queryPermission === 'function'
            ? await stored.queryPermission({ mode })
            : 'granted';
          if (permission !== 'granted') continue;
          ref.current = handle;
          setLinkedFiles(current => ({ ...current, [key]: handle.name }));
        } catch {
          // A stored handle that cannot be read stays unlinked.
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);
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
    localStorage.setItem(DISPLAY_NAME_KEY, displayName);
  }, [displayName]);
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
  // Constantly write the board back to its linked file. The editor owns
  // the board file, so only the editor auto-writes it. Debounced, so
  // dragging a colour across several bookings does not write on every
  // keystroke. Markup rides along in the same file, so a note or arrow
  // drawn on one device shows on every device that reads the board.
  // The editor lock rides along too, so every device can see who is
  // editing.
  useEffect(() => {
    const handle = boardHandleRef.current;
    if (!handle || role !== 'editor') return;
    const timer = window.setTimeout(() => {
      writeSharedFileToHandle(handle, createSharedFile(bookings, revision, importHistory, markup, editorLock)).catch(e => {
        setError(e instanceof Error ? e.message : String(e));
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [bookings, revision, importHistory, markup, editorLock, role]);
  const saveConfiguration = (text: string, renames: Record<string,string> = {}) => {
    readConfiguration(text);
    parseVenueConfig(text);
    localStorage.setItem(VENUE_YAML_KEY, text);
    setYamlText(text);
    // A room renamed in Configuration keeps its bookings and markup:
    // room names are the ids bookings and anchors carry, so follow the
    // rename instead of orphaning them under the old name.
    if (Object.keys(renames).length) {
      const renameId = (id: string) => renames[id] ?? id;
      setBookings(bs => bs.map(b => ({ ...b, roomId: renameId(b.roomId), roomIds: b.roomIds.map(renameId) })));
      setMarkup(ms => ms.map(m => m.type === 'text'
        ? { ...m, roomId: m.roomId ? renameId(m.roomId) : m.roomId }
        : { ...m, roomId1: m.roomId1 ? renameId(m.roomId1) : m.roomId1, roomId2: m.roomId2 ? renameId(m.roomId2) : m.roomId2 }));
    }
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
  // Create a venue from the setup wizard: store the YAML the wizard
  // built, offer to save it over a file (so it is linked like the
  // other venues), then import the wizard's file with the new venue.
  // The bookings file itself came from a file picker, so it has no
  // handle to link; Link files can link it afterwards.
  const createVenueFromWizard = async (text: string, file: File, dateRange: { start: string; end: string } | null) => {
    readConfiguration(text);
    const venueConfig = parseVenueConfig(text);
    localStorage.setItem(VENUE_YAML_KEY, text);
    setYamlText(text);
    setError(null);
    setSetupWizardOpen(false);
    setWelcomeOpen(false);
    if (hasFileSystemAccess()) {
      try {
        const suggested = `${venueConfig.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'venue'}.yaml`;
        const handle = await pickLinkedFileToSave(suggested, 'Venue YAML', { 'text/yaml': ['.yaml', '.yml'] });
        if (handle) {
          yamlHandleRef.current = handle;
          setLinkedFiles(current => ({ ...current, yaml: handle.name }));
          await saveLinkedHandle('yaml', handle);
          await writeLinkedFile(handle, text, 'text/yaml');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    try {
      const result = await parseBookingWorkbook(file, venueConfig, { dateRange });
      handleBookingsLoaded(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
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
    const rank: Record<BoardRole, number> = { viewer: 0, editor: 1 };
    if (rank[next] > rank[role]) setPendingRole(next);
    else changeRole(next);
  };
  // Switch role, releasing the editor lock when leaving the editor
  // role so someone else can take it. The lock is cleared on disk too
  // when the board file is linked.
  const changeRole = (next: BoardRole) => {
    if (role === 'editor' && next !== 'editor') {
      setEditorLock(null);
      if (boardHandleRef.current) {
        writeSharedFileToHandle(boardHandleRef.current, createSharedFile(bookings, revision, importHistory, markup, null)).catch(() => {});
      }
    }
    setRole(next);
  };
  // Confirm a role switch from the dialog. Switching to editor claims
  // the single-editor lock: the board file is re-read first, and if
  // someone else holds a fresh lock the switch is refused and the
  // holder is named. A stale lock (older than the TTL) can be taken
  // over — it means that browser closed without releasing.
  const confirmRoleChange = async () => {
    if (!pendingRole) return;
    const next = pendingRole;
    setPendingRole(null);
    if (next !== 'editor') { changeRole(next); return; }
    setError(null);
    let lock = editorLockRef.current;
    try {
      if (boardHandleRef.current) lock = (await readSharedFileFromHandle(boardHandleRef.current)).editorLock ?? null;
    } catch { /* fall back to the last lock this browser saw */ }
    if (lock && lock.id !== editorSessionId && Date.now() - lock.at < EDITOR_LOCK_TTL_MS) {
      setLockConflict({ name: lock.name || 'Someone', at: lock.at });
      return;
    }
    const claimed: EditorLock = { name: displayName || 'Editor', id: editorSessionId, at: Date.now() };
    setEditorLock(claimed);
    setRole('editor');
    if (boardHandleRef.current) {
      writeSharedFileToHandle(boardHandleRef.current, createSharedFile(bookings, revision, importHistory, markup, claimed)).catch(e => {
        setError(e instanceof Error ? e.message : String(e));
      });
    }
  };
  // Force-take the editor lock when someone else holds it. This is
  // the override for a lock that is fresh but the holder has walked
  // away (or their browser is stuck): it claims the lock for this
  // browser and switches to editor. If the other editor is still
  // actively editing, both browsers can now edit — the other
  // browser's next save will write its own lock back, so only use
  // this when you know the other editor is done.
  const forceTakeover = () => {
    if (!lockConflict) return;
    setLockConflict(null);
    const claimed: EditorLock = { name: displayName || 'Editor', id: editorSessionId, at: Date.now() };
    setEditorLock(claimed);
    setRole('editor');
    if (boardHandleRef.current) {
      writeSharedFileToHandle(boardHandleRef.current, createSharedFile(bookings, revision, importHistory, markup, claimed)).catch(e => {
        setError(e instanceof Error ? e.message : String(e));
      });
    }
  };
  // While this browser is the editor, refresh the lock every 30s so
  // other devices keep seeing it as fresh. Updating the lock triggers
  // the board auto-write, which persists it to the linked file.
  useEffect(() => {
    if (role !== 'editor') return;
    const timer = window.setInterval(() => {
      setEditorLock(current => current && current.id === editorSessionId ? { ...current, at: Date.now() } : current);
    }, EDITOR_LOCK_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [role, editorSessionId]);
  // Only the editor changes bookings, and only the editor's changes are
  // kept: viewers cannot edit, and there is no contributor queue any
  // more — anyone who edits takes the single editor lock instead.
  const handleBookingsChange = (next: Booking[]) => {
    if (role === 'viewer') return;
    setBookings(next);
  };
  const exportPublishedBoard = () => downloadSharedFile(
    createSharedFile(bookings, revision, importHistory, markup, editorLock)
  );
  const importPublishedBoard = async (file: File) => {
    try {
      const shared = parseSharedFile(await file.text());
      setBookings(shared.bookings);
      setRevision(shared.revision);
      setImportHistory(shared.history);
      setMarkup(shared.markup || []);
      setEditorLock(shared.editorLock ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  // Export the venue YAML. This prompts for a location (a save picker)
  // instead of downloading a copy, so it can be saved over the existing
  // YAML file. The picked file is linked, so later config saves write
  // back to it too. In a browser without a save picker it falls back
  // to a download.
  const exportVenueConfig = async () => {
    if (hasFileSystemAccess()) {
      try {
        const handle = await pickLinkedFileToSave(linkedFiles.yaml || 'whiteboard-venue.yaml', 'Venue YAML', { 'text/yaml': ['.yaml', '.yml'] });
        if (!handle) return;
        yamlHandleRef.current = handle;
        setLinkedFiles(current => ({ ...current, yaml: handle.name }));
        await saveLinkedHandle('yaml', handle);
        await writeLinkedFile(handle, yamlText, 'text/yaml');
        setError(null);
        return;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    const blob = new Blob([yamlText], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'whiteboard-venue.yaml';
    link.click();
    URL.revokeObjectURL(url);
  };
  // Link one of the files the board works from. The bookings export and
  // the venue YAML sit in one folder; linking them lets the app write
  // changes back to the same files instead of downloading new copies.
  // The board JSON is the file the editor publishes. Linking a board
  // file loads that board.
  const linkBoardFile = async () => {
    if (!hasFileSystemAccess()) { setError('This browser cannot link files. Use Chrome or Edge on desktop.'); return; }
    try {
      const handle = await pickLinkedFile({ types: [{ description: 'Whiteboard board', accept: { 'application/json': ['.json'] } }] });
      if (!handle) return;
      const shared = await readSharedFileFromHandle(handle);
      boardHandleRef.current = handle;
      setLinkedFiles(current => ({ ...current, board: handle.name }));
      await saveLinkedHandle('board', handle);
      setBookings(shared.bookings);
      setRevision(shared.revision);
      setImportHistory(shared.history);
      setMarkup(shared.markup || []);
      setEditorLock(shared.editorLock ?? null);
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
      await saveLinkedHandle('board', handle);
      await writeSharedFileToHandle(handle, createSharedFile(bookings, revision, importHistory, markup, editorLock));
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
      await saveLinkedHandle('yaml', handle);
      localStorage.setItem(VENUE_YAML_KEY, text);
      setYamlText(text);
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
      await saveLinkedHandle('bookings', handle);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  // A plain file picker, for browsers without File System Access: the
  // file imports fine, it just is not linked, so Refresh cannot re-read
  // it until it is linked from a desktop browser.
  const pickFileViaInput = (accept: string): Promise<File | null> => new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
  // Import the bookings export (.xls): from the linked file when one is
  // linked, otherwise pick a file first. This is the import that used
  // to live on the top bar; it now lives in the Link files panel.
  const importEventsFile = async () => {
    if (!venue) return;
    try {
      const handle = bookingsHandleRef.current;
      if (handle) {
        handleBookingsLoaded(await parseBookingWorkbook(await handle.getFile(), venue));
      } else if (hasFileSystemAccess()) {
        const picked = await pickLinkedFile({ types: [{ description: 'Events file', accept: { 'application/vnd.ms-excel': ['.xls', '.xlsx'] } }] });
        if (!picked) return;
        bookingsHandleRef.current = picked;
        setLinkedFiles(current => ({ ...current, bookings: picked.name }));
        await saveLinkedHandle('bookings', picked);
        handleBookingsLoaded(await parseBookingWorkbook(await picked.getFile(), venue));
      } else {
        const file = await pickFileViaInput('.xls,.xlsx,.xml,.csv');
        if (!file) return;
        handleBookingsLoaded(await parseBookingWorkbook(file, venue));
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  // Import setup times from TimeTarget (one-off, not a linked file):
  // pick the export, turn each row into a text note on the grid at
  // that time in that room. A row updates the note for its setup
  // instead of duplicating it; a hand-typed note is never touched.
  const importTimetargetTimes = async () => {
    if (!venue) return;
    try {
      const file = await pickFileViaInput('.xls,.xlsx,.xml,.csv');
      if (!file) return;
      const parsed = await parseTimetargetWorkbook(file, venue, bookings);
      const applied = applyTimetargetRows(markup, parsed.rows);
      setMarkup(applied.markup);
      setTimetargetResult({ added: applied.added, updated: applied.updated, skipped: parsed.skipped });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  // Weekend notes: a one-off Word download for the overnight crew. No
  // file picker, no linking — the button just spits the file out.
  const exportWeekendNotes = () => {
    if (!venue) return;
    const result = buildWeekendNotesDocx(bookings, markup, venue);
    const blob = new Blob([result.bytes.slice()], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  // Refresh only: re-read the linked board file. This is what a viewer
  // does, and what the board does automatically every 30 seconds in
  // viewer mode.
  const refreshBoard = async () => {
    if (boardHandleRef.current) {
      const shared = await readSharedFileFromHandle(boardHandleRef.current);
      setBookings(shared.bookings);
      setRevision(shared.revision);
      setImportHistory(shared.history);
      setMarkup(shared.markup || []);
      setEditorLock(shared.editorLock ?? null);
    }
    setError(null);
  };
  // Refresh. Saving is automatic — the board writes itself back to
  // its linked file half a second after the editor changes it — so
  // this button does not need to save. It re-reads the linked files,
  // so the board shows what everyone else has saved since. It still
  // writes out any edit made in the last moment first, so the re-read
  // cannot overwrite a just-made change.
  const saveAndRefresh = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (role !== 'viewer') {
        if (boardHandleRef.current && role === 'editor') {
          await writeSharedFileToHandle(boardHandleRef.current, createSharedFile(bookings, revision, importHistory, markup, editorLock));
        }
        if (yamlHandleRef.current) {
          await writeLinkedFile(yamlHandleRef.current, yamlText, 'text/yaml');
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
    <div className={`app${!(linkedFiles.board && linkedFiles.yaml && linkedFiles.bookings) ? ' files-unlinked' : ''}${editingEnabled && role !== 'viewer' ? ' editing' : ''}`}>
      <Toolbar
        venue={venue}
        bookingCount={bookings.length}
        role={role}
        displayName={displayName}
        editingEnabled={editingEnabled}
        markupMode={markupMode}
        showHidden={showHidden}
        paintMode={paintMode}
        paintSalespersonId={paintSalespersonId}
        paintApplyAll={paintApplyAll}
        salespeople={settings?.salespeople || []}
        filterSalespersonId={filterSalespersonId}
        error={error}
        revision={revision}
        onToggleEditing={() => setEditingEnabled(value => !value)}
        onToggleShowHidden={() => setShowHidden(value => !value)}
        onTogglePaintMode={togglePaintMode}
        onPaintSalespersonChange={setPaintSalespersonId}
        onPaintApplyAllChange={setPaintApplyAll}
        onFilterSalespersonChange={setFilterSalespersonId}
        onSetMarkupMode={setMarkupMode}
        onOpenConfiguration={() => {
          setMarkupMode('none');
          setConfigurationOpen(true);
        }}
        onRoleChange={requestRoleChange}
        onDisplayNameChange={setDisplayName}
        onSaveAndRefresh={saveAndRefresh}
        onToday={() => scrollToTodayRef.current?.()}
        saving={saving}
        linkedFiles={linkedFiles}
        editorLockName={editorLock && editorLock.id !== editorSessionId && Date.now() - editorLock.at < EDITOR_LOCK_TTL_MS ? editorLock.name : null}
        onOpenLinkFiles={() => setLinkFilesOpen(true)}
        onOpenPrint={openPrintDialog}
        onImportTimes={importTimetargetTimes}
        onExportWeekendNotes={exportWeekendNotes}
      />
      <main className="board-container">
        <BookingGrid
          venue={venue}
          bookings={bookings}
          salespeople={settings?.salespeople || []}
          roomBorders={settings?.room_borders || []}
          operableWalls={settings?.operable_walls || []}
          editingEnabled={editingEnabled && role !== 'viewer'}
          showHidden={showHidden}
          paintMode={paintMode && role !== 'viewer'}
          paintSalespersonId={paintSalespersonId}
          paintApplyAll={paintApplyAll}
          filterSalespersonId={filterSalespersonId}
          randomEventColours={settings?.random_event_colours ?? false}
          selectedBookingId={selectedBookingId}
          onBookingsChange={handleBookingsChange}
          onSelectedBookingChange={setSelectedBookingId}
          roomBaseWidths={roomBaseWidths}
          roomWidthMin={settings?.room_width_min || 125}
          scrollToTodayRef={scrollToTodayRef}
        />
        <MarkupLayer
          markup={markup}
          mode={markupMode}
          selectedBookingId={selectedBookingId}
          editingEnabled={role !== 'viewer'}
          highlightedCells={highlightedCells}
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
              <p>The board works from two files in one folder — the bookings export and the venue YAML — plus the board file the editor publishes. Link them here and the app writes changes back to the same files instead of downloading new copies.</p>
              {!hasFileSystemAccess() && <p>This browser cannot link files — linking needs Chrome or Edge on a desktop. You can still import a bookings file here and download the board; link the files from a desktop browser and Refresh will re-read the bookings export.</p>}
            </header>
            <table><thead><tr><th>File</th><th>Linked</th><th></th></tr></thead><tbody>
              <tr><td>Bookings export (.xls)</td><td>{linkedFiles.bookings || 'Not linked'}</td><td><button onClick={linkBookingsFile} disabled={!hasFileSystemAccess()} title={hasFileSystemAccess() ? undefined : 'Linking needs Chrome or Edge on a desktop'}>Link</button> <button onClick={importEventsFile} disabled={!venue}>Import</button></td></tr>
              <tr><td>Venue YAML (.yaml)</td><td>{linkedFiles.yaml || 'Not linked'}</td><td><button onClick={linkYamlFile} disabled={!hasFileSystemAccess()} title={hasFileSystemAccess() ? undefined : 'Linking needs Chrome or Edge on a desktop'}>Link</button> <button onClick={exportVenueConfig} disabled={!venue}>Save as</button></td></tr>
              <tr><td>Board (.json)</td><td>{linkedFiles.board || 'Not linked'}</td><td><button onClick={linkBoardFile} disabled={!hasFileSystemAccess()} title={hasFileSystemAccess() ? undefined : 'Linking needs Chrome or Edge on a desktop'}>Open</button> <button onClick={linkBoardFileAsNew} disabled={!hasFileSystemAccess()} title={hasFileSystemAccess() ? undefined : 'Linking needs Chrome or Edge on a desktop'}>Save as</button> <button onClick={exportPublishedBoard}>Download</button></td></tr>
            </tbody></table>
            <p>Linking the bookings export lets Refresh re-read it. The board file is written automatically whenever the editor changes the board.</p>
            <p><button onClick={() => { setSetupWizardOpen(true); setLinkFilesOpen(false); }}>Set up a new venue</button></p>
            {role === 'editor' && <p><button onClick={() => { setHistoryOpen(true); setLinkFilesOpen(false); }}>Import history</button> <button onClick={revertLastImport} disabled={importHistory.length <= 1}>Revert last import</button></p>}
            <footer>
              <button onClick={() => setLinkFilesOpen(false)}>Done</button>
            </footer>
          </section>
        </div>
      )}
      {welcomeOpen && !setupWizardOpen && (
        <div className="review-overlay">
          <section className="review-panel" aria-label="Welcome">
            <header>
              <h2>Welcome to the whiteboard</h2>
              <p>No venue is set up yet. Set one up from its booking file, or link a venue YAML you already have.</p>
              {!hasFileSystemAccess() && <p>Linking files needs Chrome or Edge on a desktop, so on this browser set up a new venue from its booking file instead.</p>}
            </header>
            <footer>
              <button onClick={dismissWelcome}>Not now</button>
              {hasFileSystemAccess() && <button onClick={linkYamlFile}>Link an existing venue file</button>}
              <button className="primary" onClick={() => setSetupWizardOpen(true)}>Set up a new venue</button>
            </footer>
          </section>
        </div>
      )}
      {setupWizardOpen && (
        <SetupWizard onCreateVenue={createVenueFromWizard} onClose={() => setSetupWizardOpen(false)} />
      )}
      {lockConflict && (
        <div className="review-overlay">
          <section className="review-panel" aria-label="Editor already editing">
            <header>
              <h2>{lockConflict.name} is editing right now</h2>
              <p>
                {lockConflict.name} has held the editor lock since {new Date(lockConflict.at).toLocaleTimeString()}. Only one editor at a time. If you know they have finished (or their browser is stuck), you can take the editor lock over. If they are still editing, taking over will let both of you edit at once.
              </p>
            </header>
            <footer>
              <button onClick={() => setLockConflict(null)}>Cancel</button>
              <button className="primary" onClick={forceTakeover}>Take over anyway</button>
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
                The editor can publish changes, change the venue configuration and revert imports. Only one editor at a time: switching claims the editor lock, and if someone else is editing you will be told who.
              </p>
            </header>
            <footer>
              <button onClick={() => setPendingRole(null)}>Cancel</button>
              <button className="primary" onClick={confirmRoleChange}>OK, switch to {pendingRole}</button>
            </footer>
          </section>
        </div>
      )}
      {timetargetResult && (
        <div className="review-overlay">
          <section className="review-panel" aria-label="TimeTarget times imported">
            <header>
              <h2>TimeTarget times imported</h2>
              <p>
                Added {timetargetResult.added} {timetargetResult.added === 1 ? 'note' : 'notes'}
                {timetargetResult.updated ? `, updated ${timetargetResult.updated}` : ''}.
                {timetargetResult.skipped.length ? ` ${timetargetResult.skipped.length} ${timetargetResult.skipped.length === 1 ? 'row was' : 'rows were'} skipped:` : ' Nothing was skipped.'}
              </p>
            </header>
            {timetargetResult.skipped.length > 0 && (
              <ul>
                {timetargetResult.skipped.map(s => <li key={s.row}>Row {s.row}: {s.reason}</li>)}
              </ul>
            )}
            <footer>
              <button className="primary" onClick={() => setTimetargetResult(null)}>Done</button>
            </footer>
          </section>
        </div>
      )}
      {printDialogOpen && (
        <div className="review-overlay">
          <section className="review-panel" aria-label="Print board">
            <header>
              <h2>Print board</h2>
              <p>
                Export the board for a date range as a printout. Rooms run across as many landscape sheets as needed, dates run down the pages, and your notes and arrows print too. Block colours print at 50% so the printout does not eat printer ink. Use Print / Save as PDF in the print view to make the PDF.
              </p>
            </header>
            <label>From <input type="date" value={printStart} onChange={e => setPrintStart(e.target.value)} /></label>{' '}
            <label>To <input type="date" value={printEnd} onChange={e => setPrintEnd(e.target.value)} /></label>
            <footer>
              <button onClick={() => setPrintDialogOpen(false)}>Cancel</button>
              <button className="primary" disabled={!printStart || !printEnd || printEnd < printStart} onClick={() => { setPrintRange({ start: printStart, end: printEnd }); setPrintDialogOpen(false); }}>Show print view</button>
            </footer>
          </section>
        </div>
      )}
      {printRange && (
        <PrintView
          venue={venue}
          bookings={bookings}
          salespeople={settings?.salespeople || []}
          roomBorders={settings?.room_borders || []}
          operableWalls={settings?.operable_walls || []}
          randomEventColours={settings?.random_event_colours ?? false}
          markup={markup}
          startDate={printRange.start}
          endDate={printRange.end}
          roomBaseWidths={roomBaseWidths}
          roomWidthMin={settings?.room_width_min || 125}
          onClose={() => setPrintRange(null)}
        />
      )}
    </div>
  );
}
