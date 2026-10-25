import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../../context/NotificationProvider.jsx';
import { formatRelativeTime } from '../../lib/formatters.js';

const TYPE_ICONS = {
  query_created: 'add_circle',
  query_message: 'chat',
  query_resolution_pending: 'help',
  query_confirmed: 'task_alt',
  query_reopened: 'replay',
  query_rated: 'star',
  mentor_reassigned: 'swap_horiz',
  star_mentee_assigned: 'workspace_premium',
  achievement_verified: 'verified',
  onboarding_reminder: 'assignment',
  account_provisioned: 'person_add',
  // Added in migration 0018 but never given an icon, so it silently fell
  // back to the generic bell.
  query_escalated: 'priority_high',
  student_at_risk: 'e911_emergency',
  at_risk_meeting_required: 'event_available',
  at_risk_cleared: 'verified',
  survey_published: 'ballot',
  survey_reminder: 'notifications_active',
  academic_data_uploaded: 'cloud_upload',
  counselling_request: 'volunteer_activism'
};

export default function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    };
    const onEscape = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const openNotification = async (notification) => {
    if (!notification.is_read) await markRead(notification.id);
    setOpen(false);
    if (notification.link_path) navigate(notification.link_path);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-lg p-2.5 text-on-surface-variant transition-colors hover:bg-surface-container"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
      >
        <span className="material-symbols-outlined text-[22px]">notifications</span>
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="animate-scale-in absolute right-0 z-50 mt-2 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-topbar-border bg-surface-container-lowest shadow-dropdown">
          <div className="flex items-center justify-between border-b border-topbar-border px-4 py-3">
            <h2 className="text-label-md text-on-surface">Notifications</h2>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} className="text-label-sm text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="custom-scrollbar max-h-[420px] overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-10 text-center text-body-sm text-tertiary">
                You have no notifications yet.
              </p>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => openNotification(notification)}
                  className={`flex w-full items-start gap-3 border-b border-surface-container px-4 py-3 text-left transition-colors hover:bg-surface-container-low ${
                    notification.is_read ? '' : 'bg-primary-fixed/40'
                  }`}
                >
                  <span
                    className="material-symbols-outlined mt-0.5 text-[20px] text-primary"
                    aria-hidden="true"
                  >
                    {TYPE_ICONS[notification.type] ?? 'notifications'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label-md text-on-surface">{notification.title}</span>
                    {notification.body && (
                      <span className="mt-0.5 block line-clamp-2 text-body-sm text-on-surface-variant">
                        {notification.body}
                      </span>
                    )}
                    <span className="mt-1 block text-label-sm text-tertiary">
                      {formatRelativeTime(notification.created_at)}
                    </span>
                  </span>
                  {!notification.is_read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
