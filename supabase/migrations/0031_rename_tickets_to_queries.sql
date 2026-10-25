-- =====================================================================
-- 0031  Rename: ticket -> query, everywhere
-- =====================================================================
-- The department calls these queries, so the software does too. This is
-- a pure rename: no behaviour changes, no columns gained or lost.
--
-- Generated from the live schema rather than hand-written, so it carries
-- every definition as 0004..0030 actually left it.
--
-- Why renames and not drop/create for the tables: ALTER ... RENAME moves
-- the name only. Row data, ACLs, foreign keys, the realtime publication
-- membership and the RLS policies all hang off the OID and follow it, so
-- nothing has to be rebuilt or re-granted.
--
-- Functions are the exception. A plpgsql body is stored as text and is
-- NOT rewritten by a rename, so every function that so much as mentions
-- a ticket is re-created below with its body rewritten. The ones whose
-- parameters are renamed (p_ticket_id -> p_query_id) have to be dropped
-- first: CREATE OR REPLACE refuses to rename an input parameter.
--
-- Earlier migrations are left exactly as they were applied. A fresh
-- database replays 0001..0030 under the old names and arrives here.
-- =====================================================================

-- ── Enum types ───────────────────────────────────────────────────────
alter type public.ticket_category rename to query_category;
alter type public.ticket_priority rename to query_priority;
alter type public.ticket_status rename to query_status;

-- ── Enum values on notification_type ─────────────────────────────────
alter type public.notification_type rename value 'ticket_created' to 'query_created';
alter type public.notification_type rename value 'ticket_message' to 'query_message';
alter type public.notification_type rename value 'ticket_resolution_pending' to 'query_resolution_pending';
alter type public.notification_type rename value 'ticket_confirmed' to 'query_confirmed';
alter type public.notification_type rename value 'ticket_reopened' to 'query_reopened';
alter type public.notification_type rename value 'ticket_rated' to 'query_rated';
alter type public.notification_type rename value 'ticket_escalated' to 'query_escalated';

-- ── Views are rebuilt at the end; drop them before their columns move
drop view if exists public.faculty_performance_summary;
drop view if exists public.student_ticket_summary;
drop view if exists public.ticket_daily_trend;

-- ── Policies reference can_access_ticket(); drop before the function ─
drop policy if exists tickets_select_participants on public.support_tickets;
drop policy if exists tickets_update_mentor on public.support_tickets;
drop policy if exists tickets_update_hod on public.support_tickets;
drop policy if exists messages_select_participants on public.ticket_messages;
drop policy if exists tickets_insert_own on public.support_tickets;

-- ── Triggers point at functions that are about to be dropped ─────────
drop trigger if exists trg_tickets_updated_at on public.support_tickets;
drop trigger if exists trg_assign_ticket_code on public.support_tickets;
drop trigger if exists trg_notify_ticket_created on public.support_tickets;
drop trigger if exists trg_notify_ticket_message on public.ticket_messages;
drop trigger if exists trg_notify_ticket_resolution on public.support_tickets;

-- ── Functions whose name or parameters change ────────────────────────
drop function if exists public.assign_ticket_code();
drop function if exists public.can_access_ticket(p_query_id uuid);
drop function if exists public.confirm_ticket_resolution(p_query_id uuid, p_response confirmation_response, p_comment text);
drop function if exists public.create_support_ticket(p_subject text, p_category query_category, p_description text, p_priority query_priority);
drop function if exists public.enqueue_notification(p_recipient uuid, p_actor uuid, p_type notification_type, p_title text, p_body text, p_query uuid, p_link text);
drop function if exists public.escalate_ticket_to_hod(p_query_id uuid, p_note text);
drop function if exists public.get_mentor_group_tickets();
drop function if exists public.notify_on_ticket_created();
drop function if exists public.notify_on_ticket_message();
drop function if exists public.notify_on_ticket_resolution_change();
drop function if exists public.post_ticket_message(p_query_id uuid, p_body text);
drop function if exists public.rate_support_ticket(p_query_id uuid, p_rating smallint);
drop function if exists public.resolve_support_ticket(p_query_id uuid, p_note text);
drop function if exists public.set_ticket_in_progress(p_query_id uuid);

-- ── Tables ───────────────────────────────────────────────────────────
alter table public.support_tickets rename to support_queries;
alter table public.ticket_messages rename to query_messages;

-- ── Columns ──────────────────────────────────────────────────────────
alter table public.notifications rename column ticket_id to query_id;
alter table public.support_queries rename column ticket_code to query_code;
alter table public.query_messages rename column ticket_id to query_id;

-- ── Sequence ─────────────────────────────────────────────────────────
alter sequence public.ticket_code_seq rename to query_code_seq;

-- ── Constraints ──────────────────────────────────────────────────────
alter table public.notifications rename constraint notifications_ticket_id_fkey to notifications_query_id_fkey;
alter table public.support_queries rename constraint support_tickets_escalated_by_fkey to support_queries_escalated_by_fkey;
alter table public.support_queries rename constraint support_tickets_mentor_id_fkey to support_queries_mentor_id_fkey;
alter table public.support_queries rename constraint support_tickets_mom_id_fkey to support_queries_mom_id_fkey;
alter table public.support_queries rename constraint support_tickets_pkey to support_queries_pkey;
alter table public.support_queries rename constraint support_tickets_resolved_by_fkey to support_queries_resolved_by_fkey;
alter table public.support_queries rename constraint support_tickets_student_id_fkey to support_queries_student_id_fkey;
alter table public.support_queries rename constraint support_tickets_ticket_code_key to support_queries_query_code_key;
alter table public.support_queries rename constraint ticket_comment_max_length to query_comment_max_length;
alter table public.support_queries rename constraint ticket_confirmation_has_timestamp to query_confirmation_has_timestamp;
alter table public.support_queries rename constraint ticket_rating_range to query_rating_range;
alter table public.support_queries rename constraint ticket_resolved_has_resolver to query_resolved_has_resolver;
alter table public.support_queries rename constraint ticket_student_is_not_mentor to query_student_is_not_mentor;
alter table public.support_queries rename constraint ticket_subject_max_length to query_subject_max_length;
alter table public.support_queries rename constraint ticket_subject_not_blank to query_subject_not_blank;
alter table public.query_messages rename constraint ticket_messages_pkey to query_messages_pkey;
alter table public.query_messages rename constraint ticket_messages_sender_id_fkey to query_messages_sender_id_fkey;
alter table public.query_messages rename constraint ticket_messages_ticket_id_fkey to query_messages_query_id_fkey;

-- ── Indexes ──────────────────────────────────────────────────────────
alter index public.notifications_ticket_idx rename to notifications_query_idx;
alter index public.ticket_messages_sender_idx rename to query_messages_sender_idx;
alter index public.ticket_messages_ticket_idx rename to query_messages_query_idx;
alter index public.tickets_category_idx rename to queries_category_idx;
alter index public.tickets_escalated_idx rename to queries_escalated_idx;
alter index public.tickets_mentor_idx rename to queries_mentor_idx;
alter index public.tickets_mom_idx rename to queries_mom_idx;
alter index public.tickets_resolution_status_idx rename to queries_resolution_status_idx;
alter index public.tickets_status_idx rename to queries_status_idx;
alter index public.tickets_student_idx rename to queries_student_idx;
alter index public.tickets_subject_trgm_idx rename to queries_subject_trgm_idx;
alter index public.tickets_updated_at_idx rename to queries_updated_at_idx;


-- ═════════════════════════════════════════════════════════════════════
-- Function bodies, rewritten. Same logic, new names.
-- ═════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.assign_query_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.query_code is null or btrim(new.query_code) = '' then
    new.query_code := 'AN-' || nextval('public.query_code_seq')::text;
  end if;
  return new;
end;
$function$;
revoke all on function public.assign_query_code() from public, anon;

CREATE OR REPLACE FUNCTION public.can_access_query(p_query_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.support_queries t
    where t.id = p_query_id
      and (
        t.student_id = auth.uid()          -- isStudentOwner
        or t.mentor_id = auth.uid()        -- isAssignedMentor
        or public.is_hod()                 -- isHod
      )
  );
$function$;
revoke all on function public.can_access_query(p_query_id uuid) from public, anon;
grant execute on function public.can_access_query(p_query_id uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.confirm_query_resolution(p_query_id uuid, p_response confirmation_response, p_comment text DEFAULT NULL::text)
 RETURNS support_queries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query public.support_queries;
  v_limit  integer := public.max_resolution_rejections();
begin
  select * into v_query from public.support_queries where id = p_query_id;
  if v_query.id is null then
    raise exception 'Query not found' using errcode = 'P0002';
  end if;

  -- isStudentOwner only — the whole point of this feature is that the
  -- student, not the faculty, has the final word.
  if v_query.student_id <> auth.uid() then
    raise exception 'Only the student who raised this query can confirm its resolution'
      using errcode = '42501';
  end if;
  if v_query.resolution_status <> 'pending_confirmation' then
    raise exception 'This query is not awaiting your confirmation' using errcode = '22023';
  end if;
  if p_comment is not null and char_length(p_comment) > 1000 then
    raise exception 'Comment must be 1000 characters or fewer' using errcode = '22023';
  end if;

  -- The cap. Confirming "yes" is always allowed; only rejections count.
  if p_response = 'no' and v_query.reopen_count >= v_limit then
    raise exception
      'You have already reopened this query % times, which is the maximum. Please speak with your mentor directly, or ask them to refer it to the HOD.',
      v_limit
      using errcode = '22023';
  end if;

  if p_response = 'yes' then
    update public.support_queries
       set resolution_status            = 'confirmed',
           status                       = 'Resolved',
           student_confirmation         = 'yes',
           student_confirmation_at      = now(),
           student_confirmation_comment = nullif(btrim(p_comment), ''),
           last_message_at              = now()
     where id = p_query_id
     returning * into v_query;

    insert into public.query_messages (query_id, sender_id, body, is_system_message)
    values (p_query_id, auth.uid(), 'Student confirmed the issue is resolved. Query closed.', true);
  else
    update public.support_queries
       set resolution_status            = 'reopened',
           status                       = 'In Progress',
           student_confirmation         = 'no',
           student_confirmation_at      = now(),
           student_confirmation_comment = nullif(btrim(p_comment), ''),
           reopen_count                 = reopen_count + 1,
           resolved_at                  = null,
           last_message_at              = now()
     where id = p_query_id
     returning * into v_query;

    insert into public.query_messages (query_id, sender_id, body, is_system_message)
    values (
      p_query_id, auth.uid(),
      format('Student reported the issue is NOT resolved (rejection %s of %s).%s',
             v_query.reopen_count, v_limit,
             case when nullif(btrim(p_comment), '') is null then ''
                  else ' Comment: ' || btrim(p_comment) end),
      true
    );
  end if;

  return v_query;
end;
$function$;
revoke all on function public.confirm_query_resolution(p_query_id uuid, p_response confirmation_response, p_comment text) from public, anon;
grant execute on function public.confirm_query_resolution(p_query_id uuid, p_response confirmation_response, p_comment text) to authenticated;

CREATE OR REPLACE FUNCTION public.create_support_query(p_subject text, p_category query_category, p_description text, p_priority query_priority DEFAULT 'Medium'::query_priority)
 RETURNS support_queries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller  public.user_profiles;
  v_query  public.support_queries;
  v_open_count integer;
begin
  select * into v_caller from public.user_profiles where id = auth.uid();

  if v_caller.id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_caller.role <> 'student' then
    raise exception 'Only students can raise support queries' using errcode = '42501';
  end if;
  if not v_caller.is_active then
    raise exception 'This account is deactivated' using errcode = '42501';
  end if;
  if v_caller.assigned_mentor_id is null then
    raise exception 'No faculty mentor assigned. Please contact the HOD.' using errcode = '22023';
  end if;
  if not public.is_non_blank(p_subject) or not public.is_non_blank(p_description) then
    raise exception 'Subject and description are required' using errcode = '22023';
  end if;
  if char_length(p_subject) > 200 then
    raise exception 'Subject must be 200 characters or fewer' using errcode = '22023';
  end if;
  if char_length(p_description) > 5000 then
    raise exception 'Description must be 5000 characters or fewer' using errcode = '22023';
  end if;

  -- Abuse guard: cap simultaneously unresolved queries per student.
  select count(*) into v_open_count
    from public.support_queries
   where student_id = v_caller.id and status <> 'Resolved';
  if v_open_count >= 20 then
    raise exception 'You already have 20 unresolved queries. Please close some before raising another.'
      using errcode = '22023';
  end if;

  insert into public.support_queries (student_id, mentor_id, subject, category, priority)
  values (v_caller.id, v_caller.assigned_mentor_id, btrim(p_subject), p_category, p_priority)
  returning * into v_query;

  insert into public.query_messages (query_id, sender_id, body)
  values (v_query.id, v_caller.id, btrim(p_description));

  return v_query;
end;
$function$;
revoke all on function public.create_support_query(p_subject text, p_category query_category, p_description text, p_priority query_priority) from public, anon;
grant execute on function public.create_support_query(p_subject text, p_category query_category, p_description text, p_priority query_priority) to authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_notification(p_recipient uuid, p_actor uuid, p_type notification_type, p_title text, p_body text, p_query uuid, p_link text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Never notify someone about their own action.
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;
  insert into public.notifications (recipient_id, actor_id, type, title, body, query_id, link_path)
  values (p_recipient, p_actor, p_type, p_title, p_body, p_query, p_link);
end;
$function$;
revoke all on function public.enqueue_notification(p_recipient uuid, p_actor uuid, p_type notification_type, p_title text, p_body text, p_query uuid, p_link text) from public, anon;

CREATE OR REPLACE FUNCTION public.escalate_query_to_hod(p_query_id uuid, p_note text DEFAULT NULL::text)
 RETURNS support_queries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query  public.support_queries;
  v_mentor  public.user_profiles;
  v_student text;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_hod     record;
  v_sent    integer := 0;
begin
  select * into v_query from public.support_queries where id = p_query_id;
  if v_query.id is null then
    raise exception 'Query not found' using errcode = 'P0002';
  end if;

  -- isAssignedMentor OR isHod
  if not (v_query.mentor_id = auth.uid() or public.is_hod()) then
    raise exception 'Only the assigned mentor can refer this query to the HOD'
      using errcode = '42501';
  end if;
  if v_query.escalated_to_hod then
    raise exception 'This query has already been referred to the HOD' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'The note must be 1000 characters or fewer' using errcode = '22023';
  end if;

  select * into v_mentor  from public.user_profiles where id = auth.uid();
  select full_name into v_student from public.user_profiles where id = v_query.student_id;

  update public.support_queries
     set escalated_to_hod = true,
         escalated_at     = now(),
         escalated_by     = auth.uid(),
         escalation_note  = v_note,
         last_message_at  = now()
   where id = p_query_id
   returning * into v_query;

  insert into public.query_messages (query_id, sender_id, body, is_system_message)
  values (
    p_query_id, auth.uid(),
    format('%s referred this query to the HOD.%s',
           coalesce(v_mentor.full_name, 'The mentor'),
           case when v_note is null then '' else ' Note: ' || v_note end),
    true
  );

  -- The HOD this mentor named. Matched on the stored email rather than a
  -- foreign key so that the mentor's own words stay the source of truth
  -- even if the HOD account is later replaced by one with the same address.
  for v_hod in
    select id from public.user_profiles
     where role = 'hod' and is_active
       and v_mentor.hod_email is not null
       and lower(email) = lower(v_mentor.hod_email)
  loop
    perform public.enqueue_notification(
      v_hod.id, auth.uid(), 'query_escalated',
      format('%s referred %s to you', coalesce(v_mentor.full_name, 'A mentor'), v_query.query_code),
      format('%s — %s', coalesce(v_student, 'A student'),
             coalesce(v_note, 'The mentor has asked you to look at this query.')),
      v_query.id, '/hod/queries/' || v_query.id::text
    );
    v_sent := v_sent + 1;
  end loop;

  -- No HOD email set, or the account behind it is gone. Telling every HOD
  -- is noisier than intended but never loses the referral.
  if v_sent = 0 then
    for v_hod in select id from public.user_profiles where role = 'hod' and is_active loop
      perform public.enqueue_notification(
        v_hod.id, auth.uid(), 'query_escalated',
        format('%s referred %s to you', coalesce(v_mentor.full_name, 'A mentor'), v_query.query_code),
        format('%s — %s', coalesce(v_student, 'A student'),
               coalesce(v_note, 'The mentor has asked you to look at this query.')),
        v_query.id, '/hod/queries/' || v_query.id::text
      );
    end loop;
  end if;

  -- The student is told too, so the referral is never a surprise.
  perform public.enqueue_notification(
    v_query.student_id, auth.uid(), 'query_escalated',
    format('%s has been referred to the HOD', v_query.query_code),
    'Your mentor has asked the Head of Department to look at this. They will be in touch.',
    v_query.id, '/student/queries/' || v_query.id::text
  );

  return v_query;
end;
$function$;
revoke all on function public.escalate_query_to_hod(p_query_id uuid, p_note text) from public, anon;
grant execute on function public.escalate_query_to_hod(p_query_id uuid, p_note text) to authenticated;

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me     public.user_profiles;
  v_result jsonb;
begin
  select * into v_me from public.user_profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_me.role = 'student' then
    select jsonb_build_object(
      'role', 'student',
      'total_queries',        count(*),
      'open_queries',         count(*) filter (where status = 'Open'),
      'in_progress_queries',  count(*) filter (where status = 'In Progress'),
      'resolved_queries',     count(*) filter (where status = 'Resolved'),
      'awaiting_confirmation',count(*) filter (where resolution_status = 'pending_confirmation'),
      'unrated_resolved',     count(*) filter (where status = 'Resolved' and satisfaction_rating is null),
      'avg_resolution_hours', round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                    filter (where resolved_at is not null)::numeric, 1)
    ) into v_result
    from public.support_queries where student_id = v_me.id;

    v_result := v_result || jsonb_build_object(
      'form_a_completed',  v_me.form_a_completed,
      'is_star_mentee',    v_me.is_star_mentee,
      'achievements_count',(select count(*) from public.student_achievements where student_id = v_me.id),
      'unread_notifications',
        (select count(*) from public.notifications where recipient_id = v_me.id and is_read = false)
    );

  elsif v_me.role = 'faculty' then
    select jsonb_build_object(
      'role', 'faculty',
      'total_queries',        count(*),
      'open_queries',         count(*) filter (where status = 'Open'),
      'in_progress_queries',  count(*) filter (where status = 'In Progress'),
      'resolved_queries',     count(*) filter (where status = 'Resolved'),
      'awaiting_confirmation',count(*) filter (where resolution_status = 'pending_confirmation'),
      'reopened_queries',     count(*) filter (where resolution_status = 'reopened'),
      'avg_first_response_hours', round(avg(extract(epoch from (first_response_at - created_at))/3600.0)
                                        filter (where first_response_at is not null)::numeric, 1),
      'avg_resolution_hours', round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                    filter (where resolved_at is not null)::numeric, 1),
      'avg_satisfaction',     round(avg(satisfaction_rating)
                                    filter (where satisfaction_rating is not null)::numeric, 2),
      'resolved_this_week',   count(*) filter (where resolved_at >= date_trunc('week', now())),
      'resolved_last_week',   count(*) filter (where resolved_at >= date_trunc('week', now()) - interval '7 days'
                                                and resolved_at <  date_trunc('week', now()))
    ) into v_result
    from public.support_queries where mentor_id = v_me.id;

    v_result := v_result || jsonb_build_object(
      'mentee_count',
        (select count(*) from public.user_profiles where assigned_mentor_id = v_me.id and role = 'student'),
      'onboarding_pending',
        (select count(*) from public.user_profiles
          where assigned_mentor_id = v_me.id and role = 'student' and form_a_completed = false),
      'star_mentee',
        (select jsonb_build_object('id', id, 'name', full_name)
           from public.user_profiles
          where assigned_mentor_id = v_me.id and is_star_mentee limit 1),
      'unread_notifications',
        (select count(*) from public.notifications where recipient_id = v_me.id and is_read = false)
    );

  else  -- hod
    select jsonb_build_object(
      'role', 'hod',
      'total_queries',        count(*),
      'open_queries',         count(*) filter (where status = 'Open'),
      'in_progress_queries',  count(*) filter (where status = 'In Progress'),
      'resolved_queries',     count(*) filter (where status = 'Resolved'),
      'awaiting_confirmation',count(*) filter (where resolution_status = 'pending_confirmation'),
      'reopened_queries',     count(*) filter (where resolution_status = 'reopened'),
      'avg_first_response_hours', round(avg(extract(epoch from (first_response_at - created_at))/3600.0)
                                        filter (where first_response_at is not null)::numeric, 1),
      'avg_resolution_hours', round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                    filter (where resolved_at is not null)::numeric, 1),
      'avg_satisfaction',     round(avg(satisfaction_rating)
                                    filter (where satisfaction_rating is not null)::numeric, 2),
      'academic_queries',     count(*) filter (where category = 'Academic'),
      'erp_tech_queries',     count(*) filter (where category = 'ERP/Tech'),
      'infrastructure_queries', count(*) filter (where category = 'Infrastructure')
    ) into v_result
    from public.support_queries;

    v_result := v_result || jsonb_build_object(
      'total_students', (select count(*) from public.user_profiles where role = 'student'),
      'total_faculty',  (select count(*) from public.user_profiles where role = 'faculty'),
      'active_faculty', (select count(*) from public.user_profiles where role = 'faculty' and employment_status = 'active'),
      'departed_faculty', (select count(*) from public.user_profiles where role = 'faculty' and employment_status = 'departed'),
      'unassigned_students', (select count(*) from public.user_profiles where role = 'student' and assigned_mentor_id is null),
      'onboarding_pending', (select count(*) from public.user_profiles where role = 'student' and form_a_completed = false),
      'unread_notifications',
        (select count(*) from public.notifications where recipient_id = v_me.id and is_read = false)
    );
  end if;

  return coalesce(v_result, '{}'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_department_faculty_report(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_from   timestamptz := coalesce(p_from, (current_date - interval '90 days')::date)::timestamptz;
  v_to     timestamptz := (coalesce(p_to, current_date) + interval '1 day')::timestamptz;
  v_report jsonb;
begin
  if not public.is_hod() then
    raise exception 'Only the HOD can generate a department-wide report' using errcode = '42501';
  end if;
  if v_to <= v_from then
    raise exception 'The "to" date must be after the "from" date' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'scope', 'department',
    'department', coalesce((select department from public.user_profiles where id = auth.uid()), 'IoT & IS'),
    'period', jsonb_build_object('from', v_from::date, 'to', (v_to - interval '1 day')::date),
    'generated_at', now(),

    -- headline numbers across the whole department -------------------
    'summary', (
      select jsonb_build_object(
        'faculty_count',   (select count(*) from public.user_profiles where role = 'faculty'),
        'active_faculty',  (select count(*) from public.user_profiles where role = 'faculty' and employment_status = 'active'),
        'student_count',   (select count(*) from public.user_profiles where role = 'student'),
        'unassigned_students', (select count(*) from public.user_profiles where role = 'student' and assigned_mentor_id is null),
        'total_queries',   count(*),
        'open_queries',    count(*) filter (where status = 'Open'),
        'in_progress_queries', count(*) filter (where status = 'In Progress'),
        'resolved_queries',count(*) filter (where status = 'Resolved'),
        'escalated_queries', count(*) filter (where escalated_to_hod),
        'avg_first_response_hours', coalesce(round(avg(extract(epoch from (first_response_at - created_at))/3600.0)
                                     filter (where first_response_at is not null)::numeric, 1), 0),
        'avg_resolution_hours', coalesce(round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                     filter (where resolved_at is not null)::numeric, 1), 0),
        'avg_satisfaction', coalesce(round(avg(satisfaction_rating)
                                     filter (where satisfaction_rating is not null)::numeric, 2), 0),
        'resolution_rate_percent',
            case when count(*) = 0 then 0
                 else round(100.0 * count(*) filter (where status = 'Resolved') / count(*), 1) end)
      from public.support_queries
      where created_at >= v_from and created_at < v_to),

    -- department-wide category mix (chart) ----------------------------
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'category', category, 'total', total, 'resolved', resolved) order by category), '[]'::jsonb)
      from (select category, count(*) as total, count(*) filter (where status = 'Resolved') as resolved
              from public.support_queries
             where created_at >= v_from and created_at < v_to
             group by category) c),

    -- department-wide status mix (chart) ------------------------------
    'by_status', (
      select jsonb_build_object(
        'open',        count(*) filter (where status = 'Open'),
        'in_progress', count(*) filter (where status = 'In Progress'),
        'resolved',    count(*) filter (where status = 'Resolved'))
      from public.support_queries
      where created_at >= v_from and created_at < v_to),

    -- monthly volume (chart) ------------------------------------------
    'monthly_trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', month, 'created', created_count, 'resolved', resolved_count) order by month), '[]'::jsonb)
      from (select to_char(date_trunc('month', created_at), 'Mon YY') as month,
                   date_trunc('month', created_at)                    as sort_key,
                   count(*)                                           as created_count,
                   count(*) filter (where status = 'Resolved')        as resolved_count
              from public.support_queries
             where created_at >= v_from and created_at < v_to
             group by 1, 2 order by 2) m),

    -- one row per faculty member (the tabular half) --------------------
    'faculty', (
      select coalesce(jsonb_agg(row order by (row ->> 'resolved_queries')::int desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', f.id,
          'name', f.full_name,
          'login_id', f.login_id,
          'branch', f.branch,
          'employment_status', f.employment_status,
          'mentee_count', (select count(*) from public.user_profiles s
                            where s.assigned_mentor_id = f.id and s.role = 'student'),
          'total_queries',    count(t.id),
          'open_queries',     count(t.id) filter (where t.status = 'Open'),
          'in_progress_queries', count(t.id) filter (where t.status = 'In Progress'),
          'resolved_queries', count(t.id) filter (where t.status = 'Resolved'),
          'reopened',         count(t.id) filter (where t.resolution_status = 'reopened'),
          'confirmed',        count(t.id) filter (where t.resolution_status = 'confirmed'),
          'avg_first_response_hours', coalesce(round(avg(extract(epoch from (t.first_response_at - t.created_at))/3600.0)
                                       filter (where t.first_response_at is not null)::numeric, 1), 0),
          'avg_resolution_hours', coalesce(round(avg(extract(epoch from (t.resolved_at - t.created_at))/3600.0)
                                       filter (where t.resolved_at is not null)::numeric, 1), 0),
          'avg_satisfaction', coalesce(round(avg(t.satisfaction_rating)
                                       filter (where t.satisfaction_rating is not null)::numeric, 2), 0),
          'resolution_rate_percent',
              case when count(t.id) = 0 then 0
                   else round(100.0 * count(t.id) filter (where t.status = 'Resolved') / count(t.id), 1) end
        ) as row
        from public.user_profiles f
        left join public.support_queries t
               on t.mentor_id = f.id and t.created_at >= v_from and t.created_at < v_to
        where f.role = 'faculty'
        group by f.id
      ) rows)
  ) into v_report;

  return v_report;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_faculty_activity_report(p_faculty_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_faculty_id uuid := coalesce(p_faculty_id, auth.uid());
  v_from       timestamptz := coalesce(p_from, (current_date - interval '90 days')::date)::timestamptz;
  v_to         timestamptz := (coalesce(p_to, current_date) + interval '1 day')::timestamptz;
  v_faculty    public.user_profiles;
  v_report     jsonb;
begin
  -- isAssignedMentor(self) OR isHod
  if v_faculty_id <> auth.uid() and not public.is_hod() then
    raise exception 'You can only generate a report for your own activity' using errcode = '42501';
  end if;

  select * into v_faculty from public.user_profiles where id = v_faculty_id and role = 'faculty';
  if v_faculty.id is null then
    raise exception 'Faculty member not found' using errcode = 'P0002';
  end if;
  if v_to <= v_from then
    raise exception 'The "to" date must be after the "from" date' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'faculty', jsonb_build_object(
        'id', v_faculty.id, 'name', v_faculty.full_name, 'email', v_faculty.email,
        'login_id', v_faculty.login_id, 'branch', v_faculty.branch,
        'department', v_faculty.department, 'employment_status', v_faculty.employment_status),
    'period', jsonb_build_object('from', v_from::date, 'to', (v_to - interval '1 day')::date),
    'generated_at', now(),

    -- headline numbers -------------------------------------------------
    'summary', (
      select jsonb_build_object(
        'total_queries',        count(*),
        'open_queries',         count(*) filter (where status = 'Open'),
        'in_progress_queries',  count(*) filter (where status = 'In Progress'),
        'resolved_queries',     count(*) filter (where status = 'Resolved'),
        'avg_first_response_hours', coalesce(round(avg(extract(epoch from (first_response_at - created_at))/3600.0)
                                     filter (where first_response_at is not null)::numeric, 1), 0),
        'avg_resolution_hours', coalesce(round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                     filter (where resolved_at is not null)::numeric, 1), 0),
        'avg_satisfaction',     coalesce(round(avg(satisfaction_rating)
                                     filter (where satisfaction_rating is not null)::numeric, 2), 0),
        'rated_queries',        count(*) filter (where satisfaction_rating is not null),
        'escalated_queries',    count(*) filter (where escalated_to_hod),
        'resolution_rate_percent',
            case when count(*) = 0 then 0
                 else round(100.0 * count(*) filter (where status = 'Resolved') / count(*), 1) end)
      from public.support_queries
      where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to),

    -- bar / donut chart: category mix ---------------------------------
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'category', category, 'total', total,
               'resolved', resolved, 'open', open_count) order by category), '[]'::jsonb)
      from (
        select category,
               count(*)                                  as total,
               count(*) filter (where status = 'Resolved') as resolved,
               count(*) filter (where status <> 'Resolved') as open_count
        from public.support_queries
        where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to
        group by category) c),

    -- stacked bar chart: status mix -----------------------------------
    'by_status', (
      select coalesce(jsonb_agg(jsonb_build_object('status', status, 'total', total) order by status), '[]'::jsonb)
      from (select status, count(*) as total
              from public.support_queries
             where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to
             group by status) s),

    -- donut chart: Feature 3 confirmation outcomes --------------------
    'resolution_confirmation', (
      select jsonb_build_object(
        'confirmed_yes',        count(*) filter (where resolution_status = 'confirmed'),
        'reopened_no',          count(*) filter (where resolution_status = 'reopened'),
        'awaiting_response',    count(*) filter (where resolution_status = 'pending_confirmation'),
        'never_resolved',       count(*) filter (where resolution_status = 'none'))
      from public.support_queries
      where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to),

    -- line chart: weekly volume ---------------------------------------
    'weekly_trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'week_start', week_start, 'created', created_count, 'resolved', resolved_count)
               order by week_start), '[]'::jsonb)
      from (
        select date_trunc('week', created_at)::date              as week_start,
               count(*)                                          as created_count,
               count(*) filter (where status = 'Resolved')       as resolved_count
        from public.support_queries
        where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to
        group by 1) w),

    -- bar chart: satisfaction histogram -------------------------------
    'rating_distribution', (
      select coalesce(jsonb_object_agg(rating::text, cnt), '{}'::jsonb)
      from (select satisfaction_rating as rating, count(*) as cnt
              from public.support_queries
             where mentor_id = v_faculty_id and satisfaction_rating is not null
               and created_at >= v_from and created_at < v_to
             group by satisfaction_rating) r),

    -- table: mentee roster --------------------------------------------
    'mentees', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.full_name, 'registration_no', s.login_id,
               'section', s.section, 'branch', s.branch, 'email', s.email,
               'is_star_mentee', s.is_star_mentee,
               'form_a_completed', s.form_a_completed,
               'query_count', (select count(*) from public.support_queries t
                                 where t.student_id = s.id and t.mentor_id = v_faculty_id))
               order by s.full_name), '[]'::jsonb)
      from public.user_profiles s
      where s.assigned_mentor_id = v_faculty_id and s.role = 'student')
  ) into v_report;

  return v_report;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_mentor_group_queries()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me public.user_profiles;
begin
  select * into v_me from public.user_profiles where id = auth.uid();

  if v_me.id is null or v_me.role <> 'student' then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not v_me.is_star_mentee then
    raise exception 'Only the student representative can view the group query list'
      using errcode = '42501';
  end if;
  if v_me.assigned_mentor_id is null then
    return '[]'::jsonb;
  end if;

  -- Narrow projection on purpose. No query id (so no thread can be
  -- opened), no message bodies, no email, no registration number.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'query_code',       t.query_code,
             'subject',           t.subject,
             'category',          t.category,
             'priority',          t.priority,
             'status',            t.status,
             'resolution_status', t.resolution_status,
             'created_at',        t.created_at,
             'last_message_at',   t.last_message_at,
             'student_name',      s.full_name,
             'section',           s.section,
             'is_mine',           (t.student_id = auth.uid())
           ) order by t.last_message_at desc)
      from public.support_queries t
      join public.user_profiles s on s.id = t.student_id
     where t.mentor_id = v_me.assigned_mentor_id
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.get_mentor_group_queries() from public, anon;
grant execute on function public.get_mentor_group_queries() to authenticated;

CREATE OR REPLACE FUNCTION public.get_student_dossier(p_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student   public.user_profiles;
  v_can_see_gpa boolean;
  v_report    jsonb;
begin
  select * into v_student from public.user_profiles where id = p_student_id and role = 'student';
  if v_student.id is null then
    raise exception 'Student not found' using errcode = 'P0002';
  end if;

  -- isAssignedMentor OR isHod OR the student themselves
  if not (public.is_mentor_of(p_student_id) or public.is_hod() or p_student_id = auth.uid()) then
    raise exception 'You are not this student''s mentor' using errcode = '42501';
  end if;

  v_can_see_gpa := public.can_view_student_gpa(p_student_id);

  select jsonb_build_object(
    'student', jsonb_build_object(
        'id', v_student.id, 'name', v_student.full_name, 'email', v_student.email,
        'registration_no', v_student.login_id, 'section', v_student.section,
        'branch', v_student.branch, 'semester_label', v_student.semester_label,
        'department', v_student.department, 'phone', v_student.phone,
        'is_star_mentee', v_student.is_star_mentee,
        'form_a_completed', v_student.form_a_completed),
    'mentor', (select jsonb_build_object('id', m.id, 'name', m.full_name, 'email', m.email)
                 from public.user_profiles m where m.id = v_student.assigned_mentor_id),
    'generated_at', now(),

    -- Feature 1 data -------------------------------------------------
    'form_a', (
      -- Only surface a form the student has actually submitted. A row can
      -- exist unsubmitted if they toggled GPA sharing before onboarding.
      select case when f.id is null or not f.is_submitted then null else jsonb_build_object(
        'submitted_at', f.submitted_at,
        'registration_no', f.registration_no, 'roll_no', f.roll_no,
        'date_of_birth', f.date_of_birth, 'blood_group', f.blood_group,
        'mobile_no', f.mobile_no, 'email', f.email,
        'hostel_block', f.hostel_block, 'room_no', f.room_no, 'is_day_scholar', f.is_day_scholar,
        'has_muj_alumni_in_family', f.has_muj_alumni_in_family,
        'alumni', case when f.has_muj_alumni_in_family then jsonb_build_object(
            'name', f.alumni_name, 'branch', f.alumni_branch, 'batch', f.alumni_batch,
            'institution', f.alumni_institution, 'relationship', f.alumni_relationship) end,
        'father', jsonb_build_object('name', f.father_name, 'occupation', f.father_occupation,
            'organization', f.father_organization, 'designation', f.father_designation,
            'mobile', f.father_mobile, 'email', f.father_email),
        'mother', jsonb_build_object('name', f.mother_name, 'occupation', f.mother_occupation,
            'organization', f.mother_organization, 'designation', f.mother_designation,
            'mobile', f.mother_mobile, 'email', f.mother_email),
        'communication_address', f.communication_address,
        'communication_pin_code', f.communication_pin_code,
        'permanent_address', f.permanent_address,
        'permanent_pin_code', f.permanent_pin_code) end
      from public.student_form_a_profiles f where f.student_id = p_student_id),

    -- Feature 2 data, honouring the sharing toggle --------------------
    'gpa_shared', v_can_see_gpa,
    'semester_gpas', case when v_can_see_gpa then (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'semester', semester_number, 'gpa', gpa, 'updated_at', updated_at)
                 order by semester_number), '[]'::jsonb)
        from public.student_semester_gpas where student_id = p_student_id)
      else '[]'::jsonb end,
    'gpa_stats', case when v_can_see_gpa then (
        select jsonb_build_object(
          'semesters_recorded', count(*),
          'cgpa', coalesce(round(avg(gpa)::numeric, 2), 0),
          'highest', coalesce(max(gpa), 0),
          'lowest',  coalesce(min(gpa), 0),
          'trend',   case when count(*) < 2 then 'insufficient_data'
                          when (select gpa from public.student_semester_gpas
                                 where student_id = p_student_id order by semester_number desc limit 1)
                             > (select gpa from public.student_semester_gpas
                                 where student_id = p_student_id order by semester_number desc offset 1 limit 1)
                          then 'improving' else 'declining' end)
        from public.student_semester_gpas where student_id = p_student_id)
      else null end,

    -- Feature 6 data -------------------------------------------------
    'achievements', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'title', title, 'category', category, 'description', description,
               'achieved_on', achieved_on, 'verified', verified_by_faculty,
               'proof_file_path', proof_file_path)
               order by achieved_on desc nulls last), '[]'::jsonb)
      from public.student_achievements where student_id = p_student_id),
    'achievements_by_category', (
      select coalesce(jsonb_object_agg(category, cnt), '{}'::jsonb)
      from (select category, count(*) as cnt from public.student_achievements
             where student_id = p_student_id group by category) a),

    -- Query history + Feature 3 outcomes -----------------------------
    'query_summary', (
      select jsonb_build_object(
        'total',            count(*),
        'open',             count(*) filter (where status = 'Open'),
        'in_progress',      count(*) filter (where status = 'In Progress'),
        'resolved',         count(*) filter (where status = 'Resolved'),
        'academic',         count(*) filter (where category = 'Academic'),
        'erp_tech',         count(*) filter (where category = 'ERP/Tech'),
        'infrastructure',   count(*) filter (where category = 'Infrastructure'),
        'confirmed_yes',    count(*) filter (where resolution_status = 'confirmed'),
        'reopened_no',      count(*) filter (where resolution_status = 'reopened'),
        'avg_resolution_hours', coalesce(round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                  filter (where resolved_at is not null)::numeric, 1), 0),
        'avg_rating_given', coalesce(round(avg(satisfaction_rating)
                                  filter (where satisfaction_rating is not null)::numeric, 2), 0))
      from public.support_queries where student_id = p_student_id),
    'queries', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'query_code', query_code, 'subject', subject, 'category', category,
               'status', status, 'resolution_status', resolution_status,
               'created_at', created_at, 'resolved_at', resolved_at,
               'satisfaction_rating', satisfaction_rating,
               'confirmation', student_confirmation,
               'confirmation_comment', student_confirmation_comment)
               order by created_at desc), '[]'::jsonb)
      from public.support_queries where student_id = p_student_id),
    'monthly_query_trend', (
      select coalesce(jsonb_agg(jsonb_build_object('month', month, 'count', cnt) order by month), '[]'::jsonb)
      from (select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, count(*) as cnt
              from public.support_queries where student_id = p_student_id
             group by 1) m)
  ) into v_report;

  return v_report;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_star_mentee_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.is_star_mentee = true and old.is_star_mentee = false then
    perform public.enqueue_notification(
      new.id, new.star_mentee_assigned_by, 'star_mentee_assigned',
      'You are now the student representative',
      'Your mentor has marked you as the star mentee for your mentor group. '
      || 'A new "Group Queries" section has been added to your portal, where you can '
      || 'see the queries raised by students in your group. It is view-only — you '
      || 'cannot reply, resolve, or open a student''s profile.',
      null, '/student/group-queries'
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_query_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student text;
begin
  -- Action items are announced once, by submit_mom_report().
  if new.mom_id is not null then
    return new;
  end if;

  select full_name into v_student from public.user_profiles where id = new.student_id;
  perform public.enqueue_notification(
    new.mentor_id, new.student_id, 'query_created',
    format('New %s query from %s', new.category, coalesce(v_student, 'a student')),
    format('%s — %s', new.query_code, new.subject),
    new.id, '/faculty/queries/' || new.id::text
  );
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_query_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query    public.support_queries;
  v_sender    text;
  v_recipient uuid;
  v_link      text;
begin
  if new.is_system_message then
    return new;   -- resolution/confirmation triggers cover these
  end if;

  select * into v_query from public.support_queries where id = new.query_id;
  if v_query.id is null then return new; end if;

  select full_name into v_sender from public.user_profiles where id = new.sender_id;

  if new.sender_id = v_query.student_id then
    v_recipient := v_query.mentor_id;
    v_link := '/faculty/queries/' || v_query.id::text;
  else
    v_recipient := v_query.student_id;
    v_link := '/student/queries/' || v_query.id::text;
  end if;

  perform public.enqueue_notification(
    v_recipient, new.sender_id, 'query_message',
    format('New reply from %s', coalesce(v_sender, 'a user')),
    left(new.body, 140),
    v_query.id, v_link
  );
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_query_resolution_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor text;
begin
  if new.resolution_status is not distinct from old.resolution_status then
    -- not a resolution change; check for a fresh rating instead
    if new.satisfaction_rating is not null and old.satisfaction_rating is null then
      perform public.enqueue_notification(
        new.mentor_id, new.student_id, 'query_rated',
        format('Query %s rated %s/5', new.query_code, new.satisfaction_rating),
        new.subject, new.id, '/faculty/queries/' || new.id::text
      );
    end if;
    return new;
  end if;

  select full_name into v_actor from public.user_profiles where id = coalesce(new.resolved_by, new.mentor_id);

  if new.resolution_status = 'pending_confirmation' then
    perform public.enqueue_notification(
      new.student_id, new.resolved_by, 'query_resolution_pending',
      'Was your issue fixed?',
      format('%s marked "%s" as resolved. Please confirm.', coalesce(v_actor, 'Your mentor'), new.subject),
      new.id, '/student/queries/' || new.id::text
    );

  elsif new.resolution_status = 'confirmed' then
    perform public.enqueue_notification(
      new.mentor_id, new.student_id, 'query_confirmed',
      format('%s confirmed as resolved', new.query_code),
      new.subject, new.id, '/faculty/queries/' || new.id::text
    );

  elsif new.resolution_status = 'reopened' then
    perform public.enqueue_notification(
      new.mentor_id, new.student_id, 'query_reopened',
      format('%s reopened by the student', new.query_code),
      coalesce(new.student_confirmation_comment, 'The student reported the issue is not resolved.'),
      new.id, '/faculty/queries/' || new.id::text
    );
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.post_query_message(p_query_id uuid, p_body text)
 RETURNS query_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query   public.support_queries;
  v_role     public.user_role;
  v_message  public.query_messages;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_non_blank(p_body) then
    raise exception 'Message cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_body) > 5000 then
    raise exception 'Message must be 5000 characters or fewer' using errcode = '22023';
  end if;

  select * into v_query from public.support_queries where id = p_query_id;
  if v_query.id is null then
    raise exception 'Query not found' using errcode = 'P0002';
  end if;

  -- isStudentOwner / isAssignedMentor / isHod
  if not (v_query.student_id = auth.uid()
          or v_query.mentor_id = auth.uid()
          or public.is_hod()) then
    raise exception 'Unauthorized to post on this query' using errcode = '42501';
  end if;

  select role into v_role from public.user_profiles where id = auth.uid();

  insert into public.query_messages (query_id, sender_id, body)
  values (p_query_id, auth.uid(), btrim(p_body))
  returning * into v_message;

  update public.support_queries
     set last_message_at   = now(),
         first_response_at = case
                               when first_response_at is null and v_role in ('faculty','hod')
                               then now() else first_response_at
                             end,
         status            = case
                               when v_role in ('faculty','hod') and status = 'Open'
                               then 'In Progress'::public.query_status else status
                             end
   where id = p_query_id;

  return v_message;
end;
$function$;
revoke all on function public.post_query_message(p_query_id uuid, p_body text) from public, anon;
grant execute on function public.post_query_message(p_query_id uuid, p_body text) to authenticated;

CREATE OR REPLACE FUNCTION public.rate_support_query(p_query_id uuid, p_rating smallint)
 RETURNS support_queries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query public.support_queries;
begin
  select * into v_query from public.support_queries where id = p_query_id;
  if v_query.id is null then
    raise exception 'Query not found' using errcode = 'P0002';
  end if;
  if v_query.student_id <> auth.uid() then
    raise exception 'You are not authorized to rate this query' using errcode = '42501';
  end if;
  if v_query.status <> 'Resolved' then
    raise exception 'Only a resolved query can be rated' using errcode = '22023';
  end if;
  if v_query.satisfaction_rating is not null then
    raise exception 'This query has already been rated' using errcode = '22023';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = '22023';
  end if;

  update public.support_queries
     set satisfaction_rating = p_rating
   where id = p_query_id
   returning * into v_query;

  return v_query;
end;
$function$;
revoke all on function public.rate_support_query(p_query_id uuid, p_rating smallint) from public, anon;
grant execute on function public.rate_support_query(p_query_id uuid, p_rating smallint) to authenticated;

CREATE OR REPLACE FUNCTION public.request_counselling(p_concern text)
 RETURNS counselling_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me  public.user_profiles;
  v_row public.counselling_requests;
  v_open integer;
begin
  select * into v_me from public.user_profiles where id = auth.uid();

  if v_me.id is null or v_me.role <> 'student' then
    raise exception 'Only a student can request counselling' using errcode = '42501';
  end if;
  if not v_me.is_active then
    raise exception 'This account is deactivated' using errcode = '42501';
  end if;
  if v_me.assigned_mentor_id is null then
    raise exception 'You have no assigned mentor yet. Please contact the HOD office.'
      using errcode = '22023';
  end if;
  if not public.is_non_blank(p_concern) then
    raise exception 'Write down what you would like to talk about' using errcode = '22023';
  end if;
  if char_length(p_concern) > 3000 then
    raise exception 'Please keep this under 3000 characters' using errcode = '22023';
  end if;

  -- Same shape as the 20-unresolved cap on queries, set lower: this is a
  -- request to be spoken to, and five unanswered ones mean the mentor has
  -- not replied yet, not that a sixth will help.
  select count(*) into v_open
    from public.counselling_requests
   where student_id = v_me.id and status <> 'closed';
  if v_open >= 5 then
    raise exception 'You already have 5 open counselling requests. Your mentor has been notified — please wait for them to reach out.'
      using errcode = '22023';
  end if;

  insert into public.counselling_requests (student_id, mentor_id, concern)
  values (v_me.id, v_me.assigned_mentor_id, btrim(p_concern))
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_support_query(p_query_id uuid, p_note text DEFAULT NULL::text)
 RETURNS support_queries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query public.support_queries;
  v_name   text;
begin
  select * into v_query from public.support_queries where id = p_query_id;
  if v_query.id is null then
    raise exception 'Query not found' using errcode = 'P0002';
  end if;

  -- isAssignedMentor OR isHod (students may not resolve their own query;
  -- they answer the confirmation prompt instead)
  if not (v_query.mentor_id = auth.uid() or public.is_hod()) then
    raise exception 'Only the assigned mentor or the HOD can resolve this query'
      using errcode = '42501';
  end if;
  if v_query.status = 'Resolved' and v_query.resolution_status = 'confirmed' then
    raise exception 'This query is already closed and confirmed' using errcode = '22023';
  end if;

  select full_name into v_name from public.user_profiles where id = auth.uid();

  update public.support_queries
     set status            = 'Resolved',
         resolution_status = 'pending_confirmation',
         resolved_by       = auth.uid(),
         resolved_at       = now(),
         last_message_at   = now()
   where id = p_query_id
   returning * into v_query;

  insert into public.query_messages (query_id, sender_id, body, is_system_message)
  values (
    p_query_id, auth.uid(),
    coalesce(nullif(btrim(p_note), ''),
             format('Marked as resolved by %s. Awaiting student confirmation.', v_name)),
    true
  );

  return v_query;
end;
$function$;
revoke all on function public.resolve_support_query(p_query_id uuid, p_note text) from public, anon;
grant execute on function public.resolve_support_query(p_query_id uuid, p_note text) to authenticated;

CREATE OR REPLACE FUNCTION public.set_mentor_department_and_hod(p_department text, p_hod_email text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me     public.user_profiles;
  v_dept   text := btrim(coalesce(p_department, ''));
  v_email  text := lower(btrim(coalesce(p_hod_email, '')));
  v_hod    public.user_profiles;
  v_count  integer;
begin
  select * into v_me from public.user_profiles where id = auth.uid();
  if v_me.id is null or v_me.role <> 'faculty' then
    raise exception 'Only a faculty mentor can set this' using errcode = '42501';
  end if;

  if not public.is_non_blank(v_dept) then
    raise exception 'Enter a department' using errcode = '22023';
  end if;
  if char_length(v_dept) > 120 then
    raise exception 'Department must be 120 characters or fewer' using errcode = '22023';
  end if;

  -- Checked here, not at escalation time: a typo should be rejected while
  -- the mentor is looking at the form, not silently discovered months
  -- later by a query that went nowhere.
  if v_email = '' then
    raise exception 'Enter your HOD''s email address' using errcode = '22023';
  end if;
  select * into v_hod
    from public.user_profiles
   where lower(email) = v_email and role = 'hod' and is_active;
  if v_hod.id is null then
    raise exception 'No active HOD account has the email %. Check the address with your department office.', v_email
      using errcode = '22023';
  end if;

  update public.user_profiles
     set department = v_dept,
         hod_email  = v_hod.email
   where id = v_me.id;

  update public.user_profiles
     set department = v_dept
   where assigned_mentor_id = v_me.id
     and role = 'student'
     and department is distinct from v_dept;
  get diagnostics v_count = row_count;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_query_in_progress(p_query_id uuid)
 RETURNS support_queries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query public.support_queries;
begin
  select * into v_query from public.support_queries where id = p_query_id;
  if v_query.id is null then
    raise exception 'Query not found' using errcode = 'P0002';
  end if;
  if not (v_query.mentor_id = auth.uid() or public.is_hod()) then
    raise exception 'Only the assigned mentor or the HOD can pick this up' using errcode = '42501';
  end if;
  if v_query.status = 'Resolved' and v_query.resolution_status = 'confirmed' then
    raise exception 'This query is already closed and confirmed' using errcode = '22023';
  end if;

  update public.support_queries
     set status            = 'In Progress',
         resolution_status = 'none',
         first_response_at = coalesce(first_response_at, now()),
         last_message_at   = now()
   where id = p_query_id
  returning * into v_query;

  insert into public.query_messages (query_id, sender_id, body, is_system_message)
  values (p_query_id, auth.uid(), 'Picked up — marked as In Progress.', true);

  return v_query;
end;
$function$;
revoke all on function public.set_query_in_progress(p_query_id uuid) from public, anon;
grant execute on function public.set_query_in_progress(p_query_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.submit_mom_report(p_meeting_date date, p_notes text, p_items jsonb, p_students_present integer DEFAULT NULL::integer, p_students_total integer DEFAULT NULL::integer)
 RETURNS mom_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me     public.user_profiles;
  v_mom    public.mom_records;
  v_item   jsonb;
  v_title  text;
  v_desc   text;
  v_query uuid;
  v_count  integer := 0;
begin
  select * into v_me from public.user_profiles where id = auth.uid();

  if v_me.id is null or v_me.role <> 'student' then
    raise exception 'Only a student representative can file a CR report' using errcode = '42501';
  end if;
  if not coalesce(v_me.is_star_mentee, false) then
    raise exception 'Only the student representative for your mentor group can file a CR report'
      using errcode = '42501';
  end if;
  if v_me.assigned_mentor_id is null then
    raise exception 'You have no assigned mentor yet. Please contact the HOD.' using errcode = '22023';
  end if;
  if not public.is_non_blank(p_notes) then
    raise exception 'Add the general discussion notes before submitting' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Action items must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 12 then
    raise exception 'File at most 12 action items per meeting' using errcode = '22023';
  end if;

  insert into public.mom_records (
    reported_by, mentor_id, meeting_date, notes, students_present, students_total
  )
  values (
    v_me.id, v_me.assigned_mentor_id, p_meeting_date, btrim(p_notes),
    p_students_present, p_students_total
  )
  returning * into v_mom;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_title := btrim(coalesce(v_item ->> 'title', ''));
    v_desc  := btrim(coalesce(v_item ->> 'description', ''));

    if v_title = '' or v_desc = '' then
      raise exception 'Every action item needs a title and a description' using errcode = '22023';
    end if;
    if char_length(v_title) > 200 then
      raise exception 'Action item titles must be 200 characters or fewer' using errcode = '22023';
    end if;
    if char_length(v_desc) > 5000 then
      raise exception 'Action item descriptions must be 5000 characters or fewer' using errcode = '22023';
    end if;

    -- An action item IS a query. Same table, same state machine, same
    -- audit trail, same three-rejection cap — it just knows which meeting
    -- it came from.
    insert into public.support_queries (student_id, mentor_id, subject, category, mom_id)
    values (
      v_me.id, v_me.assigned_mentor_id, v_title,
      coalesce(nullif(v_item ->> 'category', ''), 'Others')::public.query_category,
      v_mom.id
    )
    returning id into v_query;

    insert into public.query_messages (query_id, sender_id, body)
    values (v_query, v_me.id, v_desc);

    v_count := v_count + 1;
  end loop;

  perform public.enqueue_notification(
    v_me.assigned_mentor_id, v_me.id, 'query_created',
    format('CR report from %s — %s item%s to action',
           coalesce(v_me.full_name, 'your representative'), v_count,
           case when v_count = 1 then '' else 's' end),
    format('Meeting of %s. %s', to_char(v_mom.meeting_date, 'DD Mon YYYY'), left(btrim(p_notes), 120)),
    null, '/faculty/cr-reports'
  );

  return v_mom;
end;
$function$;


-- ── Policies ─────────────────────────────────────────────────────────
create policy queries_select_participants on public.support_queries
  for select to authenticated
  using (((student_id = auth.uid()) OR (mentor_id = auth.uid()) OR is_hod()));
create policy queries_update_mentor on public.support_queries
  for update to authenticated
  using ((mentor_id = auth.uid()))
  with check ((mentor_id = auth.uid()));
create policy queries_update_hod on public.support_queries
  for update to authenticated
  using (is_hod())
  with check (is_hod());
create policy messages_select_participants on public.query_messages
  for select to authenticated
  using (can_access_query(query_id));
create policy queries_insert_own on public.support_queries
  for insert to authenticated
  with check ((is_student() AND (student_id = auth.uid()) AND (mentor_id = my_mentor_id())));

-- ── Triggers ─────────────────────────────────────────────────────────
CREATE TRIGGER trg_queries_updated_at BEFORE UPDATE ON public.support_queries FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
CREATE TRIGGER trg_assign_query_code BEFORE INSERT ON public.support_queries FOR EACH ROW EXECUTE FUNCTION assign_query_code();
CREATE TRIGGER trg_notify_query_created AFTER INSERT ON public.support_queries FOR EACH ROW EXECUTE FUNCTION notify_on_query_created();
CREATE TRIGGER trg_notify_query_message AFTER INSERT ON public.query_messages FOR EACH ROW EXECUTE FUNCTION notify_on_query_message();
CREATE TRIGGER trg_notify_query_resolution AFTER UPDATE ON public.support_queries FOR EACH ROW EXECUTE FUNCTION notify_on_query_resolution_change();


-- ── Views ────────────────────────────────────────────────────────────

create view public.faculty_performance_summary with (security_invoker = true) as
 SELECT f.id AS faculty_id,
    f.full_name AS faculty_name,
    f.email AS faculty_email,
    f.login_id AS faculty_login_id,
    f.branch,
    f.department,
    f.employment_status,
    f.available_for_reassignment,
    f.mentee_capacity,
    ( SELECT count(*) AS count
           FROM user_profiles s
          WHERE s.assigned_mentor_id = f.id AND s.role = 'student'::user_role) AS mentee_count,
    count(t.id) AS total_queries,
    count(t.id) FILTER (WHERE t.status = 'Open'::query_status) AS open_queries,
    count(t.id) FILTER (WHERE t.status = 'In Progress'::query_status) AS in_progress_queries,
    count(t.id) FILTER (WHERE t.status = 'Resolved'::query_status) AS resolved_queries,
    count(t.id) FILTER (WHERE t.category = 'Academic'::query_category) AS academic_queries,
    count(t.id) FILTER (WHERE t.category = 'ERP/Tech'::query_category) AS erp_tech_queries,
    count(t.id) FILTER (WHERE t.category = 'Infrastructure'::query_category) AS infrastructure_queries,
    count(t.id) FILTER (WHERE t.resolution_status = 'confirmed'::resolution_status) AS confirmed_resolutions,
    count(t.id) FILTER (WHERE t.resolution_status = 'reopened'::resolution_status) AS reopened_resolutions,
    count(t.id) FILTER (WHERE t.resolution_status = 'pending_confirmation'::resolution_status) AS awaiting_confirmation,
    round(avg(EXTRACT(epoch FROM t.first_response_at - t.created_at) / 3600.0) FILTER (WHERE t.first_response_at IS NOT NULL), 1) AS avg_first_response_hours,
    round(avg(EXTRACT(epoch FROM t.resolved_at - t.created_at) / 3600.0) FILTER (WHERE t.resolved_at IS NOT NULL), 1) AS avg_resolution_hours,
    round(avg(t.satisfaction_rating) FILTER (WHERE t.satisfaction_rating IS NOT NULL), 2) AS avg_satisfaction,
    count(t.id) FILTER (WHERE t.satisfaction_rating IS NOT NULL) AS rated_queries,
        CASE
            WHEN count(t.id) = 0 THEN 0::numeric
            ELSE round(100.0 * count(t.id) FILTER (WHERE t.status = 'Resolved'::query_status)::numeric / count(t.id)::numeric, 1)
        END AS resolution_rate_percent
   FROM user_profiles f
     LEFT JOIN support_queries t ON t.mentor_id = f.id
  WHERE f.role = 'faculty'::user_role
  GROUP BY f.id;
grant select on public.faculty_performance_summary to authenticated;

create view public.student_query_summary with (security_invoker = true) as
 SELECT s.id AS student_id,
    s.full_name AS student_name,
    s.login_id AS registration_no,
    s.email,
    s.section,
    s.branch,
    s.semester_label,
    s.assigned_mentor_id,
    s.is_star_mentee,
    s.form_a_completed,
    count(t.id) AS total_queries,
    count(t.id) FILTER (WHERE t.status = 'Open'::query_status) AS open_queries,
    count(t.id) FILTER (WHERE t.status = 'In Progress'::query_status) AS in_progress_queries,
    count(t.id) FILTER (WHERE t.status = 'Resolved'::query_status) AS resolved_queries,
    count(t.id) FILTER (WHERE t.category = 'Academic'::query_category) AS academic_queries,
    count(t.id) FILTER (WHERE t.category = 'ERP/Tech'::query_category) AS erp_tech_queries,
    count(t.id) FILTER (WHERE t.category = 'Infrastructure'::query_category) AS infrastructure_queries,
    count(t.id) FILTER (WHERE t.resolution_status = 'confirmed'::resolution_status) AS confirmed_resolutions,
    count(t.id) FILTER (WHERE t.resolution_status = 'reopened'::resolution_status) AS reopened_resolutions,
    round(avg(t.satisfaction_rating) FILTER (WHERE t.satisfaction_rating IS NOT NULL), 2) AS avg_rating_given,
    max(t.created_at) AS last_query_at
   FROM user_profiles s
     LEFT JOIN support_queries t ON t.student_id = s.id
  WHERE s.role = 'student'::user_role
  GROUP BY s.id;
grant select on public.student_query_summary to authenticated;

create view public.query_daily_trend with (security_invoker = true) as
 SELECT mentor_id,
    date_trunc('day'::text, created_at)::date AS day,
    count(*) AS queries_created,
    count(*) FILTER (WHERE status = 'Resolved'::query_status) AS queries_resolved,
    count(*) FILTER (WHERE category = 'Academic'::query_category) AS academic,
    count(*) FILTER (WHERE category = 'ERP/Tech'::query_category) AS erp_tech,
    count(*) FILTER (WHERE category = 'Infrastructure'::query_category) AS infrastructure
   FROM support_queries t
  GROUP BY mentor_id, (date_trunc('day'::text, created_at)::date);
grant select on public.query_daily_trend to authenticated;


-- ── Notification deep links already in the table ─────────────────────
-- Every one of these was written by a trigger as /student/tickets/<id>
-- or /hod/tickets/<id>. The routes are /queries now, so an untouched
-- link would open a 404 on the one screen a student actually clicks.
update public.notifications
   set link_path = replace(link_path, '/tickets', '/queries')
 where link_path like '%/tickets%';


comment on table public.support_queries is
  'Student queries raised to their assigned mentor. Renamed from support_tickets in 0031; the reference codes (AN-1, AN-2, ...) are unchanged.';
