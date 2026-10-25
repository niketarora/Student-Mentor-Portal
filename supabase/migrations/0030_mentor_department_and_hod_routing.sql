-- =====================================================================
-- 0030  A mentor's department and their HOD, and what that changes
--       about "raise to HOD"
-- =====================================================================
-- Two things the mentor sets once, from My Mentees:
--
--   • the department, which is then stamped on every one of their
--     mentees (one place to fix it, instead of correcting the roster
--     row by row), and
--   • the email of the HOD they report to.
--
-- The HOD email is what changes escalation. escalate_ticket_to_hod()
-- has always notified EVERY active HOD, which is fine when there is one
-- of them and wrong as soon as there are two. It now goes to the HOD the
-- mentor named, and falls back to notifying all of them only when that
-- one cannot be resolved — an escalation that reaches too many people is
-- a nuisance, one that reaches nobody is a lost student.
--
-- The other change: escalation is no longer gated on three rejected
-- resolutions. That gate existed for one workflow (Feature 3's dispute
-- loop) and it is now reachable from the queue on any ticket, so it
-- cannot demand a history of rejections first.
-- =====================================================================

alter table public.user_profiles
  add column if not exists hod_email text;

comment on column public.user_profiles.hod_email is
  'Faculty only. The HOD that this mentor''s escalations are routed to. Validated against an active hod profile when set.';

do $$
begin
  alter table public.user_profiles
    add constraint user_profiles_hod_email_shape
    check (hod_email is null or hod_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
exception
  when duplicate_object then null;
end;
$$;


-- ---------------------------------------------------------------------
-- Set both, from one Save
-- ---------------------------------------------------------------------
-- Returns the number of mentees restamped, which is what the toast says.
create or replace function public.set_mentor_department_and_hod(
  p_department text,
  p_hod_email  text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  -- later by a ticket that went nowhere.
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
$$;

revoke all on function public.set_mentor_department_and_hod(text, text) from public, anon;
grant execute on function public.set_mentor_department_and_hod(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- Raise to HOD — any ticket, one HOD
-- ---------------------------------------------------------------------
create or replace function public.escalate_ticket_to_hod(
  p_ticket_id uuid,
  p_note      text default null
)
returns public.support_tickets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket  public.support_tickets;
  v_mentor  public.user_profiles;
  v_student text;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_hod     record;
  v_sent    integer := 0;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if v_ticket.id is null then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  -- isAssignedMentor OR isHod
  if not (v_ticket.mentor_id = auth.uid() or public.is_hod()) then
    raise exception 'Only the assigned mentor can refer this ticket to the HOD'
      using errcode = '42501';
  end if;
  if v_ticket.escalated_to_hod then
    raise exception 'This ticket has already been referred to the HOD' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'The note must be 1000 characters or fewer' using errcode = '22023';
  end if;

  select * into v_mentor  from public.user_profiles where id = auth.uid();
  select full_name into v_student from public.user_profiles where id = v_ticket.student_id;

  update public.support_tickets
     set escalated_to_hod = true,
         escalated_at     = now(),
         escalated_by     = auth.uid(),
         escalation_note  = v_note,
         last_message_at  = now()
   where id = p_ticket_id
   returning * into v_ticket;

  insert into public.ticket_messages (ticket_id, sender_id, body, is_system_message)
  values (
    p_ticket_id, auth.uid(),
    format('%s referred this ticket to the HOD.%s',
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
      v_hod.id, auth.uid(), 'ticket_escalated',
      format('%s referred %s to you', coalesce(v_mentor.full_name, 'A mentor'), v_ticket.ticket_code),
      format('%s — %s', coalesce(v_student, 'A student'),
             coalesce(v_note, 'The mentor has asked you to look at this ticket.')),
      v_ticket.id, '/hod/tickets/' || v_ticket.id::text
    );
    v_sent := v_sent + 1;
  end loop;

  -- No HOD email set, or the account behind it is gone. Telling every HOD
  -- is noisier than intended but never loses the referral.
  if v_sent = 0 then
    for v_hod in select id from public.user_profiles where role = 'hod' and is_active loop
      perform public.enqueue_notification(
        v_hod.id, auth.uid(), 'ticket_escalated',
        format('%s referred %s to you', coalesce(v_mentor.full_name, 'A mentor'), v_ticket.ticket_code),
        format('%s — %s', coalesce(v_student, 'A student'),
               coalesce(v_note, 'The mentor has asked you to look at this ticket.')),
        v_ticket.id, '/hod/tickets/' || v_ticket.id::text
      );
    end loop;
  end if;

  -- The student is told too, so the referral is never a surprise.
  perform public.enqueue_notification(
    v_ticket.student_id, auth.uid(), 'ticket_escalated',
    format('%s has been referred to the HOD', v_ticket.ticket_code),
    'Your mentor has asked the Head of Department to look at this. They will be in touch.',
    v_ticket.id, '/student/tickets/' || v_ticket.id::text
  );

  return v_ticket;
end;
$$;

revoke all on function public.escalate_ticket_to_hod(uuid, text) from public, anon;
grant execute on function public.escalate_ticket_to_hod(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- The referral count the activity report has always claimed to show
-- ---------------------------------------------------------------------
-- FacultyActivityReportPage and the PDF builder both render a "Referred
-- to HOD" figure from summary.escalated_tickets, and this function has
-- never put that key in the object — so the card has always been blank
-- and its red/grey tone always grey. Nobody noticed while escalation was
-- reachable only after three rejected resolutions. It is a button in the
-- queue now, so the number has to be real.
--
-- One added line; the rest is the function exactly as 0019 left it.

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
        'total_tickets',        count(*),
        'open_tickets',         count(*) filter (where status = 'Open'),
        'in_progress_tickets',  count(*) filter (where status = 'In Progress'),
        'resolved_tickets',     count(*) filter (where status = 'Resolved'),
        'avg_first_response_hours', coalesce(round(avg(extract(epoch from (first_response_at - created_at))/3600.0)
                                     filter (where first_response_at is not null)::numeric, 1), 0),
        'avg_resolution_hours', coalesce(round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                     filter (where resolved_at is not null)::numeric, 1), 0),
        'avg_satisfaction',     coalesce(round(avg(satisfaction_rating)
                                     filter (where satisfaction_rating is not null)::numeric, 2), 0),
        'rated_tickets',        count(*) filter (where satisfaction_rating is not null),
        'escalated_tickets',    count(*) filter (where escalated_to_hod),
        'resolution_rate_percent',
            case when count(*) = 0 then 0
                 else round(100.0 * count(*) filter (where status = 'Resolved') / count(*), 1) end)
      from public.support_tickets
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
        from public.support_tickets
        where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to
        group by category) c),

    -- stacked bar chart: status mix -----------------------------------
    'by_status', (
      select coalesce(jsonb_agg(jsonb_build_object('status', status, 'total', total) order by status), '[]'::jsonb)
      from (select status, count(*) as total
              from public.support_tickets
             where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to
             group by status) s),

    -- donut chart: Feature 3 confirmation outcomes --------------------
    'resolution_confirmation', (
      select jsonb_build_object(
        'confirmed_yes',        count(*) filter (where resolution_status = 'confirmed'),
        'reopened_no',          count(*) filter (where resolution_status = 'reopened'),
        'awaiting_response',    count(*) filter (where resolution_status = 'pending_confirmation'),
        'never_resolved',       count(*) filter (where resolution_status = 'none'))
      from public.support_tickets
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
        from public.support_tickets
        where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to
        group by 1) w),

    -- bar chart: satisfaction histogram -------------------------------
    'rating_distribution', (
      select coalesce(jsonb_object_agg(rating::text, cnt), '{}'::jsonb)
      from (select satisfaction_rating as rating, count(*) as cnt
              from public.support_tickets
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
               'ticket_count', (select count(*) from public.support_tickets t
                                 where t.student_id = s.id and t.mentor_id = v_faculty_id))
               order by s.full_name), '[]'::jsonb)
      from public.user_profiles s
      where s.assigned_mentor_id = v_faculty_id and s.role = 'student')
  ) into v_report;

  return v_report;
end;
$function$;
