/**
 * TicketConversation
 * The shared message thread. Used unchanged by the student, faculty and
 * HOD views — the differences are only which actions are offered, which
 * come in as props.
 */

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import Avatar from '../ui/Avatar.jsx';
import { formatDateTime, formatRelativeTime } from '../../lib/formatters.js';

export default function TicketConversation({ ticket, messages, onPosted, onOptimisticMessage, cannedReplies = [], readOnly }) {
  const { profile } = useAuth();
  const { run, pending } = useAsyncAction();
  const [draft, setDraft] = useState('');
  const [showCanned, setShowCanned] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const submit = async (event) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;

    // Clear the box immediately -- if the send fails we put the text back,
    // which feels far better than a disabled textarea while we wait.
    setDraft('');

    await run(
      async () => {
        const { data, error } = await supabase.rpc('post_ticket_message', {
          p_ticket_id: ticket.id,
          p_body: body
        });
        if (error) throw error;
        return data;
      },
      {
        onSuccess: (posted) => {
          // Show it straight away. The Realtime subscription will deliver
          // the authoritative row a moment later; the id de-dupe below
          // keeps it from appearing twice.
          if (posted?.id) onOptimisticMessage?.({ ...posted, sender: { id: profile?.id, full_name: profile?.full_name, role: profile?.role } });
          onPosted?.();
        },
        onError: () => setDraft(body)
      }
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.map((message) => {
          const mine = message.sender_id === profile?.id;
          if (message.is_system_message) {
            return (
              <div key={message.id} className="flex justify-center">
                <p className="max-w-[85%] rounded-full bg-surface-container px-3.5 py-1.5 text-center text-label-sm text-on-surface-variant">
                  {message.body}
                  <span className="ml-2 text-tertiary">{formatRelativeTime(message.created_at)}</span>
                </p>
              </div>
            );
          }
          return (
            <div key={message.id} className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
              <Avatar
                path={message.sender?.avatar_url}
                name={message.sender?.full_name}
                size={32}
              />
              <div className={`max-w-[78%] ${mine ? 'text-right' : ''}`}>
                <p className="mb-0.5 text-label-sm text-tertiary">
                  {mine ? 'You' : message.sender?.full_name ?? 'Unknown'}
                  <span className="mx-1.5">·</span>
                  <time dateTime={message.created_at} title={formatDateTime(message.created_at)}>
                    {formatRelativeTime(message.created_at)}
                  </time>
                </p>
                <div
                  className={`inline-block whitespace-pre-wrap break-words rounded-lg px-3.5 py-2.5 text-left text-body-sm ${
                    mine
                      ? 'bg-primary text-on-primary'
                      : 'border border-topbar-border bg-surface-container-lowest text-on-surface'
                  }`}
                >
                  {message.body}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {!readOnly && (
        <form onSubmit={submit} className="border-t border-topbar-border bg-surface-container-low p-3">
          {cannedReplies.length > 0 && (
            <div className="mb-2">
              <button
                type="button"
                onClick={() => setShowCanned((value) => !value)}
                className="btn-ghost btn-sm"
                aria-expanded={showCanned}
              >
                <span className="material-symbols-outlined text-[17px]">bolt</span>
                Quick replies
              </button>
              {showCanned && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {cannedReplies.map((reply) => (
                    <button
                      key={reply.id}
                      type="button"
                      onClick={() => {
                        setDraft((current) => (current ? `${current}\n${reply.body}` : reply.body));
                        setShowCanned(false);
                      }}
                      className="chip border border-outline-variant bg-surface-container-lowest hover:bg-primary-fixed"
                    >
                      {reply.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-end gap-2">
            <label htmlFor="ticket-reply" className="sr-only">
              Write a reply
            </label>
            <textarea
              id="ticket-reply"
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event);
              }}
              maxLength={5000}
              placeholder="Write a reply...  (Ctrl + Enter to send)"
              className="field-input flex-1 resize-none"
            />
            <button type="submit" className="btn-primary" disabled={pending || !draft.trim()}>
              <span className="material-symbols-outlined text-[18px]">send</span>
              <span className="hidden sm:inline">{pending ? 'Sending' : 'Send'}</span>
            </button>
          </div>
          <p className="mt-1 text-right text-label-sm text-tertiary">{draft.length}/5000</p>
        </form>
      )}
    </div>
  );
}
