import { useEffect, useMemo, useState } from 'react';
import { Booking } from '../types';
import { ImportResult } from '../lib/bookingImport';
import { BookingChange } from '../lib/importComparison';
import { applyReview, changeKey } from '../lib/reviewApply';
import './importReview.css';
interface Props {
  result: ImportResult;
  hasDuplicate: boolean;
  canUndoLink: boolean;
  onApply: (bookings: Booking[]) => void;
  onLinkMatch: (change: BookingChange) => void;
  onUndoLink: () => void;
  onCancel: () => void;
}
const formatBooking = (booking: Booking) => `${booking.title} — ${booking.date} ${booking.startTime}–${booking.endTime}`;
const allSelected = (result: ImportResult) =>
  Object.fromEntries(
    result.comparison.changes
      .filter(change => change.type !== 'unchanged')
      .map(change => [
        changeKey(change),
        // A match under 80% certainty is left unchecked: the user must
        // tick it to apply it, so an uncertain match never merges the
        // wrong bookings (and their colour) by default. Anything else
        // — an exact match, a changed booking, a new booking with no
        // match, a disappeared booking — is checked.
        !(change.type === 'new' && change.match && change.match.score < 80)
      ])
  );
export default function ImportReviewPanel({ result, hasDuplicate, canUndoLink, onApply, onLinkMatch, onUndoLink, onCancel }: Props) {
  const actionable = useMemo(
    () => result.comparison.changes.filter(change => change.type !== 'unchanged'),
    [result]
  );
  const [selected, setSelected] = useState<Record<string, boolean>>(() => allSelected(result));
  // The list is recomputed when a match is linked, so re-derive the ticks
  // from the new list instead of letting index-based ticks land on
  // different bookings.
  useEffect(() => { setSelected(allSelected(result)); }, [result]);
  const toggle = (key: string) => setSelected(current => ({ ...current, [key]: !(current[key] !== false) }));
  const apply = () => onApply(applyReview(result.comparison.changes, selected));
  return (
    <div className="review-overlay">
      <section className="review-panel" aria-label="Review imported changes">
        <header>
          <h2>Review import</h2>
          <p>
            {result.comparison.summary.new} new · {result.comparison.summary.changed} changed ·{' '}
            {result.comparison.summary.disappeared} disappeared · {result.comparison.summary.unchanged} unchanged
          </p>
          {hasDuplicate && <p className="duplicate-warning">This file has the same content fingerprint as the most recent import.</p>}
          <p>Untick a disappeared booking to keep it on the board. Untick a matched new booking to keep the previous booking instead.</p>
        </header>
        <div className="review-list">
          {actionable.length === 0 && <p className="review-empty">No changes require review.</p>}
          {actionable.map((change: BookingChange) => {
            const key = changeKey(change);
            return (
              <div key={key} className={`review-item ${change.type}`}>
                <input
                  type="checkbox"
                  checked={selected[key] !== false}
                  onChange={() => toggle(key)}
                  aria-label={change.type === 'disappeared' ? `Remove ${formatBooking(change.previous ?? change.booking)} (untick to keep)` : `Apply ${change.type} change to ${formatBooking(change.booking)}`}
                />
                <div>
                  <strong>
                    {change.type === 'new'
                      ? change.match
                        ? `Possible match — ${change.match.classification} (${change.match.score}%)`
                        : 'New'
                      : change.type === 'changed'
                        ? 'Changed'
                        : 'Disappeared — untick to keep'}
                  </strong>
                  <span>{formatBooking(change.type === 'disappeared' ? (change.previous ?? change.booking) : change.booking)}</span>
                  {change.type === 'changed' && <small>{change.changedFields.join(', ')}</small>}
                  {change.match && <small>Previous: {formatBooking(change.match.previous)}{change.match.reason ? ` — ${change.match.reason}` : ''}</small>}
                </div>
                {change.match && (
                  <div className="submission-actions">
                    <button onClick={() => onLinkMatch(change)}>Link match</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <footer>
          {canUndoLink && <button onClick={onUndoLink}>Undo last link</button>}
          <button onClick={onCancel}>Cancel import</button>
          <button className="primary" onClick={apply}>Apply selected changes</button>
        </footer>
      </section>
    </div>
  );
}
