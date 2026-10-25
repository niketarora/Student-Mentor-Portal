/**
 * useRealtimeQueries
 * Loads queries the caller is allowed to see (RLS decides that, not this
 * file) and keeps the list live over Realtime.
 *
 * The same hook backs all three portals — students see their own queries,
 * faculty see the ones assigned to them, the HOD sees everything, because
 * the SELECT policy on support_queries already scopes the query.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { describeError } from '../lib/formatters.js';

const SELECT = `
  *,
  student:student_id (id, full_name, email, login_id, section, branch, semester_label),
  mentor:mentor_id (id, full_name, email, login_id)
`;

/**
 * Since 0042 one person can see queries in more than one capacity: a senior
 * mentor is a student who also answers juniors' queries, and a faculty
 * member reads the queries a senior raised to them. The filters keep each
 * page to its own list:
 *   studentId         the student's own queries (My Queries);
 *   mentorId          queries sent to this mentor (the Query Queue);
 *   excludeEscalated  All Queries without the ones escalated to the HOD,
 *                     which have their own Raised to HOD page.
 */
export function useRealtimeQueries({
  status, category, search, pageSize = 25, studentId, mentorId, excludeEscalated = false
} = {}) {
  const [queries, setQueries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('support_queries')
      .select(SELECT, { count: 'exact' })
      .order('last_message_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (studentId) query = query.eq('student_id', studentId);
    if (mentorId) query = query.eq('mentor_id', mentorId);
    if (excludeEscalated) query = query.eq('escalated_to_hod', false);
    if (status && status !== 'All') query = query.eq('status', status);
    if (category && category !== 'All') query = query.eq('category', category);
    if (search?.trim()) {
      const term = search.trim().replace(/[%,]/g, '');
      query = query.or(`subject.ilike.%${term}%,query_code.ilike.%${term}%`);
    }

    const { data, error: queryError, count } = await query;
    if (queryError) {
      setError(describeError(queryError));
    } else {
      setQueries(data ?? []);
      setTotal(count ?? 0);
      setError(null);
    }
    setLoading(false);
  }, [status, category, search, page, pageSize, studentId, mentorId, excludeEscalated]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [status, category, search]);

  // Any insert/update on a query the user can see triggers a refresh.
  useEffect(() => {
    const channel = supabase
      .channel('queries-stream')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_queries' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  return { queries, loading, error, page, setPage, pageCount, total, reload: load };
}

/**
 * A single query plus its live message thread.
 *
 * `loading` is true only for the very first fetch. Every later refresh --
 * a new message arriving over Realtime, the query being resolved -- swaps
 * the data underneath without unmounting the page, so sending a message no
 * longer blanks the screen with "Loading query...".
 */
export function useQueryThread(queryId) {
  const [query, setQuery] = useState(null);
  const [messages, setMessages] = useState([]);
  const [escalations, setEscalations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const hasLoadedOnce = useRef(false);

  const load = useCallback(async () => {
    if (!queryId) return;
    if (!hasLoadedOnce.current) setLoading(true);

    const [
      { data: queryRow, error: queryError },
      { data: messageRows, error: messageError },
      { data: people },
      { data: escalationRows }
    ] = await Promise.all([
      supabase.from('support_queries').select(SELECT).eq('id', queryId).single(),
      supabase
        .from('query_messages')
        .select('*, sender:sender_id (id, full_name, role, avatar_url)')
        .eq('query_id', queryId)
        .order('created_at', { ascending: true }),
      // Names the profile embeds cannot give: a senior and a junior cannot
      // read each other's profiles (0042). Absent before that migration.
      supabase.rpc('get_query_people', { p_query_id: queryId }),
      // The reasons for raising it; the student gets none back (RLS).
      supabase.from('query_escalations').select('*').eq('query_id', queryId).order('created_at', { ascending: false })
    ]);

    if (queryError || messageError) {
      // A failed background refresh must not wipe a thread that is on screen.
      if (!hasLoadedOnce.current) setError(describeError(queryError ?? messageError));
      else console.warn('[query] refresh failed:', (queryError ?? messageError).message);
    } else {
      const known = people ?? {};
      const fill = (embedded, id) => embedded ?? known[id] ?? null;
      setQuery({
        ...queryRow,
        student: fill(queryRow.student, queryRow.student_id),
        mentor: fill(queryRow.mentor, queryRow.mentor_id),
        referred_faculty: known[queryRow.referred_to_faculty] ?? null,
        escalated_by_person: known[queryRow.escalated_by] ?? null
      });
      setMessages((messageRows ?? []).map((message) => ({ ...message, sender: fill(message.sender, message.sender_id) })));
      setEscalations((escalationRows ?? []).map((row) => ({ ...row, raised_by_person: known[row.raised_by] ?? null })));
      setError(null);
    }
    hasLoadedOnce.current = true;
    setLoading(false);
  }, [queryId]);

  // A different query is a fresh page, so the loader is appropriate again.
  useEffect(() => {
    hasLoadedOnce.current = false;
  }, [queryId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!queryId) return undefined;
    const channel = supabase
      .channel(`query-${queryId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'query_messages', filter: `query_id=eq.${queryId}` },
        () => load()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'support_queries', filter: `id=eq.${queryId}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryId, load]);

  /** Appends a just-sent message, ignoring it if Realtime already did. */
  const appendMessage = useCallback((message) => {
    if (!message?.id) return;
    setMessages((current) =>
      current.some((existing) => existing.id === message.id) ? current : [...current, message]
    );
  }, []);

  return { query, messages, escalations, loading, error, reload: load, appendMessage };
}
