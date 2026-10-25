-- =====================================================================
-- 0027  CR reports (MoM + action items) · roster uploads move to the
--       Cluster Head · real-world section labels · parent contact
-- =====================================================================
-- WHY THERE IS NO mom_action_items TABLE
-- ---------------------------------------------------------------------
-- The brief's action item is a support ticket with a different author.
-- It needs: a title, a category, a description, PENDING -> IN_PROGRESS ->
-- RESOLVED (with mandatory remarks) -> CLOSED-on-student-confirmation or
-- REOPENED, an append-only trail of who changed what, and a notification
-- on every hop. support_tickets + ticket_messages + the 0009/0018 RPCs
-- already are that machine, exactly, including the three-rejection cap.
--
-- So the only genuinely new entity is the PARENT: the meeting itself.
-- One table, one nullable FK on support_tickets, and every downstream
-- screen, policy, trigger and PDF join keeps working untouched.
--
--   mom_records            the immutable meeting snapshot
--   support_tickets.mom_id which meeting an item came out of
--
-- A "dynamic export" is then a plain join, which is what §4 of the brief
-- asks for — no second state machine to keep in step with the first.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The meeting record (Section A of the form: static context)
-- ---------------------------------------------------------------------
create table if not exists public.mom_records (
  id             uuid primary key default extensions.gen_random_uuid(),
  -- The student representative who filed it, and the mentor group it
  -- belongs to. Both snapshotted: a later star-mentee change or a
  -- Feature 8 reassignment must not re-attribute an old meeting.
  reported_by    uuid not null references public.user_profiles (id) on delete cascade,
  mentor_id      uuid not null references public.user_profiles (id) on delete cascade,

  meeting_date   date not null,
  students_present integer,
  students_total   integer,
  notes          text not null,

  created_at     timestamptz not null default now(),

  constraint mom_notes_not_blank    check (public.is_non_blank(notes)),
  constraint mom_notes_max_length   check (char_length(notes) <= 5000),
  constraint mom_date_not_future    check (meeting_date <= current_date),
  constraint mom_attendance_sane
    check (students_present is null or students_total is null
           or (students_present >= 0 and students_present <= students_total)),
  constraint mom_reporter_is_not_mentor check (reported_by <> mentor_id)
);

comment on table public.mom_records is
  'Class-representative meeting minutes. Append-only: no UPDATE or DELETE policy exists for anyone. The action items raised in the meeting are support_tickets carrying this row''s id in mom_id.';

create index if not exists mom_records_mentor_idx on public.mom_records (mentor_id, meeting_date desc);
create index if not exists mom_records_reporter_idx on public.mom_records (reported_by, meeting_date desc);

alter table public.support_tickets
  add column if not exists mom_id uuid references public.mom_records (id) on delete set null;

comment on column public.support_tickets.mom_id is
  'Set when this ticket is an action item raised in a CR meeting. Null for an ordinary student ticket. Everything else about the ticket behaves identically.';

create index if not exists tickets_mom_idx on public.support_tickets (mom_id) where mom_id is not null;


-- ---------------------------------------------------------------------
-- 2. RLS — the same shape as every other student-scoped table
-- ---------------------------------------------------------------------
alter table public.mom_records enable row level security;

drop policy if exists mom_select_participants on public.mom_records;

-- The rep who filed it, the mentor it went to, and the HOD.
create policy mom_select_participants on public.mom_records
  for select to authenticated
  using (reported_by = auth.uid() or mentor_id = auth.uid() or public.is_hod());

-- No INSERT/UPDATE/DELETE policy on purpose: submit_mom_report() is the
-- only way in, so a client cannot file a meeting for someone else's group
-- or rewrite one after the fact.

grant select on public.mom_records to authenticated;


-- ---------------------------------------------------------------------
-- 3. One notification per meeting, not one per item
-- ---------------------------------------------------------------------
-- A meeting with eight queries would otherwise ring the mentor's bell
-- eight times. submit_mom_report() sends a single summary instead. This
-- is a full CREATE OR REPLACE, so the 0011 body is restated with the one
-- guard added.
create or replace function public.notify_on_ticket_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student text;
begin
  -- Action items are announced once, by submit_mom_report().
  if new.mom_id is not null then
    return new;
  end if;

  select full_name into v_student from public.user_profiles where id = new.student_id;
  perform public.enqueue_notification(
    new.mentor_id, new.student_id, 'ticket_created',
    format('New %s ticket from %s', new.category, coalesce(v_student, 'a student')),
    format('%s — %s', new.ticket_code, new.subject),
    new.id, '/faculty/tickets/' || new.id::text
  );
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 4. Filing a report: parent + items in one transaction
-- ---------------------------------------------------------------------
-- p_items: [{ "title": "...", "category": "Infrastructure", "description": "..." }, ...]
--
-- The 20-unresolved-ticket cap in create_support_ticket() is deliberately
-- not applied here: it exists to stop one student flooding their own
-- mentor, and a rep filing their group's minutes is the case it would
-- wrongly catch. The 12-item ceiling below is the guard that fits.
create or replace function public.submit_mom_report(
  p_meeting_date     date,
  p_notes            text,
  p_items            jsonb,
  p_students_present integer default null,
  p_students_total   integer default null
)
returns public.mom_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me     public.user_profiles;
  v_mom    public.mom_records;
  v_item   jsonb;
  v_title  text;
  v_desc   text;
  v_ticket uuid;
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

    -- An action item IS a ticket. Same table, same state machine, same
    -- audit trail, same three-rejection cap — it just knows which meeting
    -- it came from.
    insert into public.support_tickets (student_id, mentor_id, subject, category, mom_id)
    values (
      v_me.id, v_me.assigned_mentor_id, v_title,
      coalesce(nullif(v_item ->> 'category', ''), 'Others')::public.ticket_category,
      v_mom.id
    )
    returning id into v_ticket;

    insert into public.ticket_messages (ticket_id, sender_id, body)
    values (v_ticket, v_me.id, v_desc);

    v_count := v_count + 1;
  end loop;

  perform public.enqueue_notification(
    v_me.assigned_mentor_id, v_me.id, 'ticket_created',
    format('CR report from %s — %s item%s to action',
           coalesce(v_me.full_name, 'your representative'), v_count,
           case when v_count = 1 then '' else 's' end),
    format('Meeting of %s. %s', to_char(v_mom.meeting_date, 'DD Mon YYYY'), left(btrim(p_notes), 120)),
    null, '/faculty/cr-reports'
  );

  return v_mom;
end;
$$;

revoke all on function public.submit_mom_report(date, text, jsonb, integer, integer) from public, anon;
grant execute on function public.submit_mom_report(date, text, jsonb, integer, integer) to authenticated;


-- ---------------------------------------------------------------------
-- 5. The faculty "Update Status" dropdown's middle option
-- ---------------------------------------------------------------------
-- Resolved already has resolve_support_ticket(), which takes the
-- mandatory remarks and hands the ticket to the student for confirmation.
-- Open -> In Progress had no explicit call: it only happened as a side
-- effect of replying. The modal needs to say it out loud.
create or replace function public.set_ticket_in_progress(p_ticket_id uuid)
returns public.support_tickets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.support_tickets;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if v_ticket.id is null then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  if not (v_ticket.mentor_id = auth.uid() or public.is_hod()) then
    raise exception 'Only the assigned mentor or the HOD can pick this up' using errcode = '42501';
  end if;
  if v_ticket.status = 'Resolved' and v_ticket.resolution_status = 'confirmed' then
    raise exception 'This ticket is already closed and confirmed' using errcode = '22023';
  end if;

  update public.support_tickets
     set status            = 'In Progress',
         resolution_status = 'none',
         first_response_at = coalesce(first_response_at, now()),
         last_message_at   = now()
   where id = p_ticket_id
  returning * into v_ticket;

  insert into public.ticket_messages (ticket_id, sender_id, body, is_system_message)
  values (p_ticket_id, auth.uid(), 'Picked up — marked as In Progress.', true);

  return v_ticket;
end;
$$;

revoke all on function public.set_ticket_in_progress(uuid) from public, anon;
grant execute on function public.set_ticket_in_progress(uuid) to authenticated;


-- =====================================================================
-- 6. Section labels as the real files actually spell them
-- =====================================================================
-- '^[A-O]$' was written against a hand-made sample. The departmental
-- files carry 'A 3', 'R 3' (Registered Students) and plain 'B'..'N'
-- (the ERP attendance export) — and the two are different things for the
-- same student, which 0025 already documents. Widen to what exists.
alter table public.student_course_sections
  drop constraint if exists student_course_sections_label_shape;
alter table public.student_course_sections
  add constraint student_course_sections_label_shape
  check (section_label ~ '^[A-Za-z0-9][A-Za-z0-9 .-]{0,11}$');

comment on column public.student_course_sections.section_label is
  'Teaching section for this course, e.g. "B" or "R 3". Unrelated to the student''s roster section, and expected to differ.';


-- =====================================================================
-- 7. Attendance: the section is per ROW, not per file
-- =====================================================================
-- The real export is a CONSOLIDATED one: a single course code in the
-- header, an EMPTY "Section:" in that header, and every section of that
-- course stacked in one table with its own Section column per row.
-- Reading the section from the header (0025) filed all 2,500 students
-- under whichever section happened to be first.
--
-- p_section survives only as a fallback for a single-section export that
-- does fill the header in.
drop function if exists public.record_attendance_batch(text, text, text, date, date, text, jsonb);

create or replace function public.record_attendance_batch(
  p_course_code  text,
  p_course_name  text,
  p_section      text,
  p_period_start date,
  p_period_end   date,
  p_filename     text,
  p_rows         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_course    public.cluster_head_courses;
  v_batch_id  uuid;
  v_item      jsonb;
  v_ident     text;
  v_student   uuid;
  v_percent   numeric;
  v_held      integer;
  v_attended  integer;
  v_section   text;
  v_fallback  text;
  v_matched   integer := 0;
  v_failed    integer := 0;
  v_total     integer := 0;
  v_errors    jsonb   := '[]'::jsonb;
  v_sections  text[]  := array[]::text[];
  v_touched   uuid[]  := array[]::uuid[];
  v_sid       uuid;
  v_actor     uuid;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can upload attendance' using errcode = '42501';
  end if;
  if p_course_code is null or btrim(p_course_code) = '' then
    raise exception 'No course code found in the file header' using errcode = '22023';
  end if;

  select * into v_course
    from public.cluster_head_courses
   where lower(course_code) = lower(btrim(p_course_code))
     and (cluster_head_id = auth.uid() or public.is_hod() or auth.uid() is null)
   limit 1;

  if v_course.id is null then
    raise exception
      'Course code "%" is not in your subject list. Add it under My Subjects, then upload this file again.',
      btrim(p_course_code)
      using errcode = '22023';
  end if;

  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'The From/To dates in the file header are missing or out of order' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The uploaded file had no usable rows' using errcode = '22023';
  end if;

  v_fallback := nullif(btrim(coalesce(p_section, '')), '');
  v_actor    := coalesce(auth.uid(), v_course.cluster_head_id);

  insert into public.academic_upload_batches (
    uploaded_by, upload_type, course_id, section_label,
    period_start, period_end, original_filename, total_rows
  )
  values (v_actor, 'attendance', v_course.id, v_fallback,
          p_period_start, p_period_end, coalesce(p_filename, 'upload'), jsonb_array_length(p_rows))
  returning id into v_batch_id;

  for v_item in select * from jsonb_array_elements(p_rows)
  loop
    v_total   := v_total + 1;
    v_ident   := btrim(coalesce(v_item ->> 'identifier', ''));
    v_percent := nullif(v_item ->> 'attendance_percent', '')::numeric;
    v_held    := nullif(v_item ->> 'classes_held', '')::integer;
    v_attended:= nullif(v_item ->> 'classes_attended', '')::integer;
    v_section := nullif(btrim(coalesce(v_item ->> 'section', '')), '');
    v_section := coalesce(v_section, v_fallback);

    if v_ident = '' then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'reason', 'No registration number in this row');
      continue;
    end if;
    if v_percent is null or v_percent < 0 or v_percent > 100 then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', 'The % column is missing or outside 0-100');
      continue;
    end if;
    if v_section is null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', 'No section on this row and none in the file header');
      continue;
    end if;

    -- Registration number is the key. A student sits in different
    -- sections for different courses, so nothing here reads or writes
    -- their roster section.
    select id into v_student
      from public.user_profiles
     where role = 'student' and is_active
       and (lower(coalesce(login_id, '')) = lower(v_ident) or lower(email) = lower(v_ident))
     limit 1;

    if v_student is null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', 'No student matches this registration number');
      continue;
    end if;

    insert into public.student_course_sections (student_id, course_id, section_label)
    values (v_student, v_course.id, v_section)
    on conflict (student_id, course_id) do update
      set section_label = excluded.section_label, updated_at = now();

    insert into public.student_attendance_records (
      student_id, course_id, course_code, course_name, section_label,
      period_start, period_end, classes_held, classes_attended, attendance_percent,
      batch_id, recorded_by
    )
    values (
      v_student, v_course.id, v_course.course_code,
      coalesce(nullif(btrim(coalesce(p_course_name, '')), ''), v_course.course_name),
      v_section, p_period_start, p_period_end,
      v_held, v_attended, round(v_percent, 2), v_batch_id, v_actor
    )
    on conflict (student_id, course_id, period_start) do update
      set course_code        = excluded.course_code,
          course_name        = excluded.course_name,
          section_label      = excluded.section_label,
          period_end         = excluded.period_end,
          classes_held       = excluded.classes_held,
          classes_attended   = excluded.classes_attended,
          attendance_percent = excluded.attendance_percent,
          batch_id           = excluded.batch_id,
          recorded_by        = excluded.recorded_by,
          updated_at         = now();

    if not (v_section = any (v_sections)) then
      v_sections := v_sections || v_section;
    end if;
    if not (v_student = any (v_touched)) then
      v_touched := v_touched || v_student;
    end if;
    v_matched := v_matched + 1;
  end loop;

  update public.academic_upload_batches
     set matched_rows  = v_matched,
         failed_rows   = v_failed,
         row_errors    = v_errors,
         section_label = coalesce(v_fallback, array_to_string(v_sections, ', '))
   where id = v_batch_id;

  foreach v_sid in array v_touched loop
    perform public.evaluate_student_risk(v_sid);
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'course_code', v_course.course_code,
    'course_name', coalesce(nullif(btrim(coalesce(p_course_name, '')), ''), v_course.course_name),
    'section', coalesce(v_fallback, array_to_string(v_sections, ', ')),
    'sections', to_jsonb(v_sections),
    'period_start', p_period_start,
    'period_end', p_period_end,
    'total_rows', v_total, 'matched', v_matched, 'failed', v_failed,
    'students_reevaluated', coalesce(array_length(v_touched, 1), 0),
    'row_errors', v_errors
  );
end;
$$;

revoke all on function public.record_attendance_batch(text, text, text, date, date, text, jsonb) from public, anon;
grant execute on function public.record_attendance_batch(text, text, text, date, date, text, jsonb) to authenticated, service_role;


-- =====================================================================
-- 8. Mentor–mentee mapping upload
-- =====================================================================
-- The departmental list is Registration No. -> Mentor Name + Mentor
-- Email. Setting assigned_mentor_id is all this does; the 0011 trigger
-- then writes mentor_reassignment_log and notifies the student, the old
-- mentor and the new one, for free.
--
-- A mentor email with no faculty account is reported back as a row error
-- rather than auto-created: minting an account here would leave a
-- credential nobody ever receives.
create or replace function public.map_students_to_mentors(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item     jsonb;
  v_ident    text;
  v_email    text;
  v_student  uuid;
  v_mentor   uuid;
  v_status   public.employment_status;
  v_total    integer := 0;
  v_mapped   integer := 0;
  v_same     integer := 0;
  v_failed   integer := 0;
  v_errors   jsonb   := '[]'::jsonb;
  v_current  uuid;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can map mentors' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The uploaded file had no usable rows' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_rows)
  loop
    v_total := v_total + 1;
    v_ident := btrim(coalesce(v_item ->> 'identifier', ''));
    v_email := lower(btrim(coalesce(v_item ->> 'mentor_email', '')));

    if v_ident = '' or v_email = '' then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total,
                                                 'reason', 'Each row needs a registration number and a mentor email');
      continue;
    end if;

    select id into v_student
      from public.user_profiles
     where role = 'student' and is_active
       and (lower(coalesce(login_id, '')) = lower(v_ident) or lower(email) = lower(v_ident))
     limit 1;

    if v_student is null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', 'No student matches this registration number. Import the student roster first.');
      continue;
    end if;

    select id, employment_status into v_mentor, v_status
      from public.user_profiles
     where role = 'faculty' and lower(email) = v_email
     limit 1;

    if v_mentor is null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', format('No faculty account for "%s". Import the faculty roster first.', v_email));
      continue;
    end if;
    if v_status <> 'active' then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', format('Mentor "%s" is marked %s', v_email, v_status));
      continue;
    end if;

    select assigned_mentor_id into v_current from public.user_profiles where id = v_student;
    if v_current is not distinct from v_mentor then
      v_same := v_same + 1;
      continue;
    end if;

    -- assigned_mentor_id is a protected column (§10.3). This function has
    -- already established the caller is a cluster head or the HOD.
    perform set_config('ssmp.trusted_operation', 'on', true);
    update public.user_profiles set assigned_mentor_id = v_mentor where id = v_student;
    perform set_config('ssmp.trusted_operation', 'off', true);

    v_mapped := v_mapped + 1;
  end loop;

  return jsonb_build_object(
    'total_rows', v_total,
    'matched', v_mapped,
    'unchanged', v_same,
    'failed', v_failed,
    'row_errors', v_errors
  );
end;
$$;

revoke all on function public.map_students_to_mentors(jsonb) from public, anon;
grant execute on function public.map_students_to_mentors(jsonb) to authenticated, service_role;


-- =====================================================================
-- 9. Parent contact from the roster, not only from Form A
-- =====================================================================
-- The At-Risk page has always had a Parent Contact column and it has
-- always read student_form_a_profiles — so it says "Not on Form A" for
-- every student who has not filled one in, which is most of them on day
-- one. The Registered Students roster carries the father's name, number
-- and email for all 2,500, so capture it at import and fall back to it.
alter table public.user_profiles add column if not exists parent_name   text;
alter table public.user_profiles add column if not exists parent_mobile text;
alter table public.user_profiles add column if not exists parent_email  text;

comment on column public.user_profiles.parent_mobile is
  'Guardian contact from the student roster import. Form A is still preferred where the student filled one in — see at_risk_student_overview.';

-- Not added to guard_protected_profile_columns(): a student correcting
-- their own guardian number is a legitimate self-service edit, the same
-- as their own phone.

drop view if exists public.at_risk_student_overview cascade;
create view public.at_risk_student_overview
with (security_invoker = true) as
select
  s.id                              as student_id,
  s.full_name                       as student_name,
  s.login_id                        as registration_no,
  s.email,
  s.section,
  s.branch,
  s.semester_label,
  s.assigned_mentor_id,
  m.full_name                       as mentor_name,
  f.is_at_risk,
  f.low_attendance,
  f.low_gpa,
  f.has_backlog,
  f.attendance_percent,
  f.latest_gpa,
  f.latest_gpa_semester,
  f.backlog_count,
  f.reasons,
  f.first_flagged_at,
  f.last_evaluated_at,
  -- Form A is the student's own answer and wins; the roster fills the gap.
  coalesce(a.father_name,   s.parent_name)   as father_name,
  coalesce(a.father_mobile, s.parent_mobile) as father_mobile,
  a.mother_name,
  a.mother_mobile,
  coalesce(a.father_mobile, a.mother_mobile, s.parent_mobile) as primary_parent_mobile,
  coalesce(a.father_email,  s.parent_email)  as primary_parent_email,
  meet.id                           as open_meeting_id,
  meet.status                       as open_meeting_status,
  meet.meeting_join_url             as open_meeting_join_url,
  meet.created_at                   as open_meeting_created_at
from public.user_profiles s
join public.student_risk_flags f      on f.student_id = s.id
left join public.user_profiles m      on m.id = s.assigned_mentor_id
left join public.student_form_a_profiles a on a.student_id = s.id
left join lateral (
  select id, status, meeting_join_url, created_at
    from public.at_risk_meetings
   where student_id = s.id and status in ('awaiting_link', 'scheduled')
   order by created_at desc
   limit 1
) meet on true
where s.role = 'student';

comment on view public.at_risk_student_overview is
  'At-risk roster: attendance, GPA, backlog count and guardian contact in one row. Parent contact prefers Form A and falls back to the student roster import.';

grant select on public.at_risk_student_overview to authenticated;


-- =====================================================================
-- 10. Roster imports move to the Cluster Head portal
-- =====================================================================
-- The endpoint is still service-role only (creating auth accounts always
-- will be). What changes is who may call it, and that a cluster head can
-- read back the batches they themselves uploaded.
drop policy if exists roster_batches_own_select on public.roster_import_batches;

create policy roster_batches_own_select on public.roster_import_batches
  for select to authenticated
  using (uploaded_by = auth.uid());
