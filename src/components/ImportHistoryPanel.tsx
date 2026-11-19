import { ImportHistoryEntry } from '../types';
import './importReview.css';
interface Props {
  history: ImportHistoryEntry[];
  onRestore: (entry: ImportHistoryEntry) => void;
  onClose: () => void;
}
export default function ImportHistoryPanel({ history, onRestore, onClose }: Props) {
  return (
    <div className="review-overlay">
      <section className="review-panel" aria-label="Import history">
        <header>
          <h2>Import history</h2>
          <p>{history.length} recent import{history.length === 1 ? '' : 's'} · maximum 10 retained</p>
        </header>
        <div className="review-list">
          {history.length === 0 && <p className="review-empty">No imports have been published yet.</p>}
          {history.map((entry, index) => (
            <div key={entry.id} className={`review-item ${index === 0 ? 'new' : 'changed'}`}>
              <div>
                <strong>{index === 0 ? 'Current board' : `Earlier import · revision before current`}</strong>
                <span>{entry.name}</span>
                <small>
                  {new Date(entry.importedAt).toLocaleString()} · fingerprint {entry.fingerprint} · {entry.bookings.length} bookings
                </small>
              </div>
              {index > 0 && (
                <div className="submission-actions">
                  <button onClick={() => onRestore(entry)}>Restore this import</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <footer>
          <button onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  );
}
