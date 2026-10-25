/**
 * NotificationProvider
 * Subscribes to the notifications table over Supabase Realtime. This is
 * the mechanism that makes the three portals feel connected: a student
 * raising a query, a faculty resolving one, or the HOD reassigning a
 * mentor all land here within a second, with no polling.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { useAuth } from './AuthProvider.jsx';
import { useToast } from './ToastProvider.jsx';

const NotificationContext = createContext(null);
const PAGE_SIZE = 30;

export function NotificationProvider({ children }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const userId = profile?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (error) console.error('[notifications] load failed:', error.message);
    setNotifications(data ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!userId) return undefined;

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        (payload) => {
          setNotifications((current) => [payload.new, ...current].slice(0, PAGE_SIZE));
          toast.info(payload.new.title);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        (payload) => {
          setNotifications((current) =>
            current.map((item) => (item.id === payload.new.id ? payload.new : item))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, toast]);

  const markRead = useCallback(async (id) => {
    setNotifications((current) =>
      current.map((item) => (item.id === id ? { ...item, is_read: true } : item))
    );
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id);
    if (error) console.error('[notifications] markRead failed:', error.message);
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
    const { error } = await supabase.rpc('mark_all_notifications_read');
    if (error) console.error('[notifications] markAllRead failed:', error.message);
  }, []);

  const value = useMemo(
    () => ({
      notifications,
      unreadCount: notifications.filter((n) => !n.is_read).length,
      loading,
      markRead,
      markAllRead,
      reload: load
    }),
    [notifications, loading, markRead, markAllRead, load]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used inside <NotificationProvider>');
  return context;
}
