import { ContributorSubmission } from '../types';
import { Booking } from '../types';
import { conflictingFields, hasConflict, submissionChanges } from '../lib/sharedFile';
import './importReview.css';
interface Props {
  submissions: ContributorSubmission[];
  bookings: Booking[];
  currentRevision: number;
  onAccept: (submission: ContributorSubmission) => void;
  onReject: (submission: ContributorSubmission) => void;
  onForceAccept: (submission: ContributorSubmission) => void;
  onClose: () => void;
}
const describe = (booking: Booking) => `${booking.title} — ${booking.date} ${booking.startTime}–${booking.endTime}`;
export default function SubmissionReviewPanel({ submissions, bookings, currentRevision, onAccept, onReject, onForceAccept, onClose }: Props) {
  return (
    <div className="review-overlay">
      <section className="review-panel" aria-label="Review contributor submissions">
        <header>
          <h2>Contributor submissions</h2>
          <p>{submissions.length} pending change{submissions.length === 1 ? '' : 's'} · published revision {currentRevision}</p>
        </header>
        <div className="review-list">
          {submissions.length === 0 && <p className="review-empty">No contributor submissions are waiting for review.</p>}
          {submissions.map(submission => {
            const current = bookings.find(booking => booking.id === submission.bookingId);
            const conflict = hasConflict(submission, current);
            const changes = submissionChanges(submission);
            const conflicts = conflictingFields(submission, current);
            const stale = submission.revisionBase !== undefined && submission.revisionBase !== currentRevision;
            return (
              <div key={submission.id} className={`review-item ${conflict ? 'disappeared' : 'changed'}`}>
                <div>
                  <strong>{submission.author}</strong>
                  <span>{describe(submission.proposed)}</span>
                  <small>
                    Based on revision {submission.revisionBase ?? 'unknown'}
                    {stale ? ' · the published board has since changed' : ''}
                  </small>
                  <small>Changes: {changes.length ? changes.join(', ') : 'none'}</small>
                  {conflict && <small>Conflicts: {conflicts.join(', ')}.</small>}
                </div>
                <div className="submission-actions">
                  {!conflict && <button onClick={() => onAccept(submission)}>Accept</button>}
                  {conflict && <button onClick={() => onForceAccept(submission)}>Overwrite and accept</button>}
                  <button onClick={() => onReject(submission)}>Reject</button>
                </div>
              </div>
            );
          })}
        </div>
        <footer>
          <button onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  );
}
