import { useEffect, useMemo, useState } from 'react';
import BookingGrid from './components/BookingGrid';
import ImportReviewPanel from './components/ImportReviewPanel';
import SubmissionReviewPanel from './components/SubmissionReviewPanel';
import MarkupLayer from './components/MarkupLayer';
import Toolbar from './components/Toolbar';
import ConfigurationPage from './components/ConfigurationPage';
import { BoardRole, Booking, ContributorSubmission, MarkupItem } from './types';
import { ImportResult, savePreviousImport } from './lib/bookingImport';
import { createSharedFile, createSubmission, downloadSharedFile, parseSharedFile } from './lib/sharedFile';
import { parseVenueConfig } from './lib/venueConfig';
import { boardSettings, readConfiguration } from './lib/configuration';
const MARKUP_KEY = 'whiteboard-markup';
const VENUE_YAML_KEY = 'whiteboard-venue-yaml';
const ROLE_KEY = 'whiteboard-role';
const SUBMISSIONS_KEY = 'whiteboard-contributor-submissions';
const BOARD_CACHE_KEY = 'whiteboard-board-cache';
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
export default function App() {
  const [initial] = useState(startup);
  const [yamlText, setYamlText] = useState(initial.text);
  const venue = useMemo(() => yamlText ? parseVenueConfig(yamlText) : null, [yamlText]);
  const settings = useMemo(() => yamlText ? boardSettings(readConfiguration(yamlText)) : null, [yamlText]);
  const roomBaseWidths = useMemo(
    () => venue?.rooms.map(room => settings?.room_widths[settings.room_types[room.id] || 'other'] || 175),
    [venue, settings]
  );
  const [role, setRole] = useState<BoardRole>(() => (localStorage.getItem(ROLE_KEY) as BoardRole) || 'master');
  const [bookings, setBookings] = useState<Booking[]>(storedBoard);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const [pendingReview, setPendingReview] = useState<ImportResult | null>(null);
  const [submissions, setSubmissions] = useState<ContributorSubmission[]>(storedSubmissions);
  const [submissionsOpen, setSubmissionsOpen] = useState(false);
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
    setError(null);
  };
  const applyImport = (approved: Booking[]) => {
    setBookings(approved);
    if (pendingReview) setLastImport(pendingReview);
    savePreviousImport(approved);
    setPendingReview(null);
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
        updated.push(createSubmission(booking, current, 'Contributor'));
      }
    }
    setSubmissions(updated);
  };
  const acceptSubmission = (submission: ContributorSubmission) => {
    setBookings(bookings.map(booking => booking.id === submission.bookingId ? submission.proposed : booking));
    setSubmissions(submissions.filter(item => item.id !== submission.id));
  };
  const rejectSubmission = (submission: ContributorSubmission) => {
    setSubmissions(submissions.filter(item => item.id !== submission.id));
  };
  const exportSharedFile = () => downloadSharedFile(createSharedFile(bookings, submissions));
  const importSharedFile = async (file: File) => {
    try {
      const shared = parseSharedFile(await file.text());
      setBookings(shared.bookings);
      setSubmissions(shared.submissions);
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
        editingEnabled={editingEnabled}
        markupMode={markupMode}
        error={error}
        submissionCount={submissions.length}
        onToggleEditing={() => setEditingEnabled(value => !value)}
        onSetMarkupMode={setMarkupMode}
        onOpenConfiguration={() => {
          setMarkupMode('none');
          setConfigurationOpen(true);
        }}
        onBookingsLoaded={handleBookingsLoaded}
        onError={setError}
        onRoleChange={setRole}
        onOpenSubmissions={() => setSubmissionsOpen(true)}
        onExportSharedFile={exportSharedFile}
        onImportSharedFile={importSharedFile}
      />
      <main className="board-container">
        <BookingGrid
          venue={venue}
          bookings={bookings}
          editingEnabled={editingEnabled && role !== 'viewer'}
          onBookingsChange={handleBookingsChange}
          roomBaseWidths={roomBaseWidths}
        />
        <MarkupLayer markup={markup} mode={markupMode} onChange={setMarkup} />
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
        <ImportReviewPanel result={pendingReview} onApply={applyImport} onCancel={() => setPendingReview(null)} />
      )}
      {submissionsOpen && (
        <SubmissionReviewPanel
          submissions={submissions}
          bookings={bookings}
          onAccept={acceptSubmission}
          onReject={rejectSubmission}
          onForceAccept={acceptSubmission}
          onClose={() => setSubmissionsOpen(false)}
        />
      )}
    </div>
  );
}
