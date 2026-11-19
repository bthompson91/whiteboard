import { useMemo, useState } from 'react';
import { Booking } from '../types';
import { ImportResult } from '../lib/bookingImport';
import { BookingChange } from '../lib/importComparison';
import './importReview.css';
interface Props {
  result: ImportResult;
  onApply: (bookings: Booking[]) => void;
  onLinkMatch: (change: BookingChange) => void;
  onCancel: () => void;
}
const formatBooking = (booking: Booking) => `${booking.title} — ${booking.date} ${booking.startTime}–${booking.endTime}`;
export default function ImportReviewPanel({ result, onApply, onLinkMatch, onCancel }: Props) {
  const actionable = useMemo(
    () => result.comparison.changes.filter(change => change.type !== 'unchanged'),
    [result]
  );
  const [selected, setSelected] = useState<Record<number, boolean>>(
    () => Object.fromEntries(actionable.map((_, index) => [index, true]))
  );
  const toggle = (index: number) => setSelected(current => ({ ...current, [index]: !current[index] }));
  const apply = () => {
    const rejected = actionable.filter((_, index) => !selected[index]);
    const rejectedIds = new Set<string>();
    for (const change of rejected) {
      if (change.type === 'new' || change.type === 'changed') rejectedIds.add(change.booking.id);
      if (change.type === 'disappeared' && change.previous) rejectedIds.add(change.previous.id);
    }
    const retainedPrevious = new Map(
      result.comparison.changes
        .filter(change => change.previous)
        .map(change => [change.previous!.id, change.previous!])
    );
    const bookings: Booking[] = [];
    for (const change of result.comparison.changes) {
      const previousId = change.previous?.id;
      if (previousId && rejectedIds.has(previousId)) {
        if (change.type === 'disappeared') bookings.push(change.previous!);
        continue;
      }
      if (change.type === 'disappeared') continue;
      if (change.type === 'new' && rejectedIds.has(change.booking.id)) continue;
      if (change.type === 'changed' && rejectedIds.has(change.booking.id)) {
        if (previousId && retainedPrevious.has(previousId)) bookings.push(retainedPrevious.get(previousId)!);
        continue;
      }
      bookings.push(change.booking);
    }
    onApply(bookings);
  };
  return (
    <div className="review-overlay">
      <section className="review-panel" aria-label="Review imported changes">
        <header>
          <h2>Review import</h2>
          <p>
            {result.comparison.summary.new} new · {result.comparison.summary.changed} changed ·{' '}
            {result.comparison.summary.disappeared} disappeared · {result.comparison.summary.unchanged} unchanged
          </p>
        </header>
        <div className="review-list">
          {actionable.length === 0 && <p className="review-empty">No changes require review.</p>}
          {actionable.map((change: BookingChange, index: number) => (
            <div key={`${change.type}-${change.booking.id}-${index}`} className={`review-item ${change.type}`}>
              {change.type !== 'disappeared' && (
                <input type="checkbox" checked={selected[index] !== false} onChange={() => toggle(index)} />
              )}
              <div>
                <strong>
                  {change.type === 'new'
                    ? change.match
                      ? `Possible match — ${change.match.classification} (${change.match.score}%)`
                      : 'New'
                    : change.type === 'changed'
                      ? 'Changed'
                      : 'Disappeared'}
                </strong>
                <span>{formatBooking(change.type === 'disappeared' ? change.previous! : change.booking)}</span>
                {change.type === 'changed' && <small>{change.changedFields.join(', ')}</small>}
                {change.match && (
                  <small>
                    Previous: {formatBooking(change.match.previous)}
                  </small>
                )}
              </div>
              {change.match && (
                <div className="submission-actions">
                  <button onClick={() => onLinkMatch(change)}>Link match</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <footer>
          <button onClick={onCancel}>Cancel import</button>
          <button className="primary" onClick={apply}>Apply selected changes</button>
        </footer>
      </section>
    </div>
  );
}
