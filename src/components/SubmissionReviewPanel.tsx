import { ContributorSubmission } from '../types';
import { hasConflict } from '../lib/sharedFile';
import { Booking } from '../types';
import './importReview.css';
interface Props {
  submissions: ContributorSubmission[];
  bookings: Booking[];
  onAccept: (submission: ContributorSubmission) => void;
  onReject: (submission: ContributorSubmission) => void;
  onClose: () => void;
}
const describe = (booking: Booking) => `${booking.title} — ${booking.date} ${booking.startTime}–${booking.endTime}`;
export default function SubmissionReviewPanel({ submissions, bookings, onAccept, onReject, onClose }: Props) {
  return (
    <div className="review-overlay">
      <section className="review-panel" aria-label="Review contributor submissions">
        <header>
          <h2>Contributor submissions</h2>
          <p>{submissions.length} pending change{submissions.length === 1 ? '' : 's'}</p>
        </header>
        <div className="review-list">
          {submissions.length === 0 && <p className="review-empty">No contributor submissions are waiting for review.</p>}
          {submissions.map(submission => {
            const current = bookings.find(booking => booking.id === submission.bookingId);
            const conflict = hasConflict(submission, current);
            return (
              <div key={submission.id} className={`review-item ${conflict ? 'disappeared' : 'changed'}`}>
                <div>
                  <strong>{submission.author}</strong>
                  <span>{describe(submission.proposed)}</span>
                  <small>
                    {describe(submission.base)} → {describe(submission.proposed)}
                  </small>
                  {conflict && <small>The booking has changed since this submission was made. Reject it and ask the contributor to resubmit.</small>}
                </div>
                <div className="submission-actions">
                  <button disabled={conflict} onClick={() => onAccept(submission)}>Accept</button>
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
