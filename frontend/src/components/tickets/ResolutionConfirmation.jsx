/**
 * FEATURE 3 — the student-facing "was your issue actually fixed?" prompt.
 * Answering "No" reopens the ticket and notifies the mentor; the faculty
 * no longer has the final word on their own resolution.
 */

import { useState } from 'react';

/** Must match max_resolution_rejections() in migration 0018. */
const MAX_REJECTIONS = 3;
import { supabase } from '../../lib/supabaseClient.js';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';

export default function ResolutionConfirmation({ ticket, onDone }) {
  const { run, pending } = useAsyncAction();
  const [comment, setComment] = useState('');
  const [choice, setChoice] = useState(null);

  if (ticket.resolution_status !== 'pending_confirmation') return null;

  // Feature 3 gives the student the final word, but not an unlimited one.
  // After MAX_REJECTIONS rejections the database refuses another, so the
  // button is withdrawn here too rather than letting them hit an error.
  const rejectionsUsed = ticket.reopen_count ?? 0;
  const rejectionsLeft = Math.max(MAX_REJECTIONS - rejectionsUsed, 0);
  const canReject = rejectionsLeft > 0;

  const respond = (response) =>
    run(
      async () => {
        const { error } = await supabase.rpc('confirm_ticket_resolution', {
          p_ticket_id: ticket.id,
          p_response: response,
          p_comment: comment.trim() || null
        });
        if (error) throw error;
      },
      {
        successMessage:
          response === 'yes'
            ? 'Thank you — this ticket is now closed.'
            : 'Ticket reopened. Your mentor has been notified.',
        onSuccess: onDone
      }
    );

  return (
    <div className="rounded-lg border-l-4 border-info bg-info-container/50 p-4">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-[22px] text-info" aria-hidden="true">
          help
        </span>
        <div className="flex-1">
          <h3 className="text-label-md text-on-surface">Was your issue fixed?</h3>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Your mentor has marked <strong>{ticket.subject}</strong> as resolved. Please confirm so we can
            close it — or tell us it is still open and we will reopen it.
          </p>

          {rejectionsUsed > 0 && canReject && (
            <p className="mt-2 text-label-sm text-on-warning-container">
              You have reopened this ticket {rejectionsUsed} time{rejectionsUsed > 1 ? 's' : ''}. You can do
              so {rejectionsLeft} more time{rejectionsLeft > 1 ? 's' : ''} before it has to be discussed with
              your mentor directly.
            </p>
          )}

          {!canReject && (
            <p className="mt-2 rounded bg-warning-container/60 px-3 py-2 text-body-sm text-on-warning-container">
              You have already reopened this ticket {MAX_REJECTIONS} times, which is the maximum. If it is
              still not resolved, please speak to your mentor directly — they can refer it to the Head of
              Department for you.
            </p>
          )}

          {choice && (
            <div className="mt-3">
              <label htmlFor="confirm-comment" className="field-label">
                {choice === 'yes' ? 'Anything to add? (optional)' : 'What is still not working?'}
              </label>
              <textarea
                id="confirm-comment"
                rows={2}
                maxLength={1000}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="field-input"
                placeholder={
                  choice === 'yes' ? 'Thanks for the quick help!' : 'Describe what is still going wrong...'
                }
              />
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {choice !== 'no' && (
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={pending}
                onClick={() => (choice === 'yes' ? respond('yes') : setChoice('yes'))}
              >
                <span className="material-symbols-outlined text-[17px]">thumb_up</span>
                {choice === 'yes' ? 'Confirm & close' : 'Yes, it is fixed'}
              </button>
            )}
            {choice !== 'yes' && canReject && (
              <button
                type="button"
                className="btn-danger btn-sm"
                disabled={pending || (choice === 'no' && !comment.trim())}
                onClick={() => (choice === 'no' ? respond('no') : setChoice('no'))}
              >
                <span className="material-symbols-outlined text-[17px]">thumb_down</span>
                {choice === 'no' ? 'Reopen ticket' : 'No, still an issue'}
              </button>
            )}
            {choice && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setChoice(null)} disabled={pending}>
                Back
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
