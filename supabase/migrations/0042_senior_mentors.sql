-- =====================================================================
-- 0042  Senior mentors: a second mentor for every student
-- =====================================================================
-- A student can now have two mentors: their faculty mentor, as before,
-- and a senior (or alumni) mentor. A senior is a student account with the
-- senior flag; on top of the student portal they answer the queries their
-- juniors send them and can ask for help.
--
-- WHO IS WHOSE SENIOR
--   is_senior_mentor        set by `npm run db:seniors` from the list of
--                           senior e-mails (service role only).
--   senior_mentor_sections  which sections each senior looks after,
--                           chosen by a HOD or the administrator on the
--                           Senior Mentors page. One senior per section.
--   student_section_code()  a student's section: their faculty mentor's
--                           section from the mentor-HOD mapping ("A 3"),
--                           else their own roster section if it is written
--                           the same way.
--   senior_mentor_of()      the senior of that section, never the student
--                           themselves.
--
-- QUERIES
--   mentor_kind        'faculty' (as before) or 'senior': whom the student
--                      chose in "Raise a query". mentor_id is that person.
--   referred_to_faculty / referred_at
--                      a senior raised the query to the student's faculty
--                      mentor, who can now read, reply to and resolve it.
--   escalated_to_hod and the rest (0018) now also record a senior's
--                      escalation; escalation_source says who raised it:
--                      'faculty' or 'senior'.
--   query_escalations  every referral and escalation with its reason.
--                      The people handling the query read it; the student
--                      does not (the conversation only says it happened).
--
-- Escalated queries leave the HOD's All Queries list for the new Raised to
-- HOD page; queries raised to a faculty member appear on their Raised to Me
-- page, not in their Query Queue (both are frontend filters).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The senior flag
-- ---------------------------------------------------------------------
alter table public.user_profiles
  add column if not exists is_senior_mentor boolean not null default false;

alter table public.user_profiles drop constraint if exists user_profiles_senior_is_student;
alter table public.user_profiles
  add constraint user_profiles_senior_is_student check (role = 'student' or not is_senior_mentor);

comment on column public.user_profiles.is_senior_mentor is
  'A senior/alumni mentor (0042): a student who also answers juniors'' queries. Set by npm run db:seniors only.';

create index if not exists user_profiles_senior_mentor_idx
  on public.user_profiles (id) where is_senior_mentor;

-- Only the service role (the sync script) and the administrator change it.
create or replace function public.guard_protected_profile_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if (auth.uid() is null)
     or coalesce(current_setting('ssmp.trusted_operation', true), 'off') = 'on'
     or public.is_admin() then
    return new;
  end if;

  if new.hod_id is distinct from old.hod_id
     or new.mentor_section is distinct from old.mentor_section
     or new.mentor_designation is distinct from old.mentor_designation
     or (old.hod_id is not null and new.hod_email is distinct from old.hod_email) then
    raise exception 'Not permitted: the mentor-HOD mapping is managed by the administrator'
      using errcode = '42501';
  end if;

  -- Senior mentors come from the senior list (npm run db:seniors, 0042).
  if new.is_senior_mentor is distinct from old.is_senior_mentor then
    raise exception 'Not permitted: senior mentors are set from the senior mentor list by the administrator'
      using errcode = '42501';
  end if;

  if public.is_hod() then
    if new.role is distinct from old.role
       and (new.role in ('hod', 'admin') or old.role in ('hod', 'admin')) then
      raise exception 'Not permitted: only the administrator can grant or remove the HOD or administrator role'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Not permitted: role cannot be changed by the account holder'
      using errcode = '42501';
  end if;
  if new.assigned_mentor_id is distinct from old.assigned_mentor_id then
    raise exception 'Not permitted: mentor assignment is managed by the HOD'
      using errcode = '42501';
  end if;
  if new.is_star_mentee is distinct from old.is_star_mentee
     or new.star_mentee_assigned_by is distinct from old.star_mentee_assigned_by then
    raise exception 'Not permitted: star mentee is set by the assigned mentor'
      using errcode = '42501';
  end if;
  if new.employment_status is distinct from old.employment_status
     or new.available_for_reassignment is distinct from old.available_for_reassignment then
    raise exception 'Not permitted: employment status is managed by the HOD'
      using errcode = '42501';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'Not permitted: account activation is managed by the HOD'
      using errcode = '42501';
  end if;
  if new.form_a_completed is distinct from old.form_a_completed then
    raise exception 'Not permitted: onboarding status is set by submitting Form A'
      using errcode = '42501';
  end if;
  if new.cluster_head_setup_completed is distinct from old.cluster_head_setup_completed then
    raise exception 'Not permitted: setup status is set by submitting the cluster head setup form'
      using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'Not permitted: identity fields are managed by Supabase Auth'
      using errcode = '42501';
  end if;
  if new.login_id is distinct from old.login_id then
    raise exception 'Not permitted: the registration number is managed by the department'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;


-- ---------------------------------------------------------------------
-- 2. Sections
-- ---------------------------------------------------------------------
-- "A3", "a 3", "A-3" -> "A 3": the form the mentor-HOD mapping stores
-- (normaliseMappingSection in the API). Anything else -> NULL.
create or replace function public.normalise_section(p_section text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when r is null then null else r[1] || ' ' || r[2] end
    from (select regexp_match(upper(regexp_replace(btrim(coalesce(p_section, '')), '\s+', ' ', 'g')),
                              '^([A-Z]+) ?-? ?([0-9]+)$') as r) x;
$$;

create table if not exists public.senior_mentor_sections (
  -- One senior per section, so every student has at most one senior.
  section      text primary key,
  senior_id    uuid not null references public.user_profiles (id) on delete cascade,
  assigned_by  uuid references public.user_profiles (id) on delete set null,
  assigned_at  timestamptz not null default now(),
  -- The department's sections: A 3 ... T 4.
  constraint senior_section_known check (section ~ '^[A-T] [34]$')
);

comment on table public.senior_mentor_sections is
  'Which sections each senior mentor looks after (0042). Written only by set_senior_mentor_sections().';

create index if not exists senior_mentor_sections_senior_idx on public.senior_mentor_sections (senior_id);

alter table public.senior_mentor_sections enable row level security;
drop policy if exists senior_sections_select on public.senior_mentor_sections;
create policy senior_sections_select on public.senior_mentor_sections
  for select to authenticated
  using (senior_id = auth.uid() or (select public.is_hod()));
revoke all on public.senior_mentor_sections from anon, authenticated;
grant select on public.senior_mentor_sections to authenticated;

-- A student's section: their faculty mentor's (the mapping), else their own.
create or replace function public.student_section_code(p_student_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.normalise_section(f.mentor_section), public.normalise_section(s.section))
    from public.user_profiles s
    left join public.user_profiles f on f.id = s.assigned_mentor_id and f.role = 'faculty'
   where s.id = p_student_id and s.role = 'student';
$$;

create or replace function public.senior_mentor_of(p_student_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.senior_id
    from public.senior_mentor_sections m
    join public.user_profiles sp on sp.id = m.senior_id
   where m.section = public.student_section_code(p_student_id)
     and m.senior_id <> p_student_id
     and sp.role = 'student' and sp.is_senior_mentor and sp.is_active
   limit 1;
$$;

create or replace function public.is_senior_mentor()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles
     where id = auth.uid() and role = 'student' and is_senior_mentor and is_active
  );
$$;


-- ---------------------------------------------------------------------
-- 3. Queries: whom they went to, and where they were raised
-- ---------------------------------------------------------------------
alter table public.support_queries
  add column if not exists mentor_kind text not null default 'faculty',
  add column if not exists referred_to_faculty uuid references public.user_profiles (id) on delete set null,
  add column if not exists referred_at timestamptz,
  add column if not exists escalation_source text;

alter table public.support_queries drop constraint if exists query_mentor_kind_valid;
alter table public.support_queries
  add constraint query_mentor_kind_valid check (mentor_kind in ('faculty', 'senior'));
alter table public.support_queries drop constraint if exists query_escalation_source_valid;
alter table public.support_queries
  add constraint query_escalation_source_valid check (escalation_source is null or escalation_source in ('faculty', 'senior'));

comment on column public.support_queries.mentor_kind is
  'Whom the student sent it to (0042): ''faculty'' (their faculty mentor) or ''senior'' (their senior mentor). mentor_id is that person.';
comment on column public.support_queries.referred_to_faculty is
  'The faculty mentor a senior raised this query to (0042), who can then read, reply and resolve.';
comment on column public.support_queries.escalation_source is
  'Who escalated it to the HOD (0042): ''faculty'' or ''senior''.';

-- Every escalation before 0042 was a mentor's.
update public.support_queries
   set escalation_source = 'faculty'
 where escalated_to_hod and escalation_source is null;

create index if not exists support_queries_referred_idx
  on public.support_queries (referred_to_faculty, last_message_at desc) where referred_to_faculty is not null;
create index if not exists support_queries_escalated_idx
  on public.support_queries (escalated_at desc) where escalated_to_hod;
create index if not exists support_queries_senior_idx
  on public.support_queries (mentor_id, last_message_at desc) where mentor_kind = 'senior';


-- ---------------------------------------------------------------------
-- 4. Access: whoever a query was raised to can read and answer it
-- ---------------------------------------------------------------------
create or replace function public.can_access_query(p_query_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.support_queries t
    where t.id = p_query_id
      and (
        t.student_id = auth.uid()                -- the student who raised it
        or t.mentor_id = auth.uid()              -- the faculty or senior mentor it went to
        or public.oversees_faculty(t.mentor_id)  -- the mentor's HOD, or the administrator
        or t.referred_to_faculty = auth.uid()    -- the faculty mentor a senior raised it to
        or (t.escalated_to_hod and public.oversees_student(t.student_id))  -- the HOD it was escalated to
      )
  );
$$;

-- Everyone who handles a query, not the student: reads escalation reasons.
create or replace function public.can_handle_query(p_query_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.can_access_query(p_query_id)
     and not exists (select 1 from public.support_queries where id = p_query_id and student_id = auth.uid());
$$;

drop policy if exists queries_select_participants on public.support_queries;
create policy queries_select_participants on public.support_queries
  for select to authenticated
  using (
    student_id = auth.uid()
    or mentor_id = auth.uid()
    or referred_to_faculty = auth.uid()
    or (select public.is_admin())
    or mentor_id = any ((select public.my_overseen_faculty())::uuid[])
    or (escalated_to_hod and public.oversees_student(student_id))
  );


-- ---------------------------------------------------------------------
-- 5. Escalation records
-- ---------------------------------------------------------------------
create table if not exists public.query_escalations (
  id              uuid primary key default extensions.gen_random_uuid(),
  query_id        uuid not null references public.support_queries (id) on delete cascade,
  raised_by       uuid references public.user_profiles (id) on delete set null,
  raised_by_kind  text not null,
  raised_to       text not null,
  target_faculty  uuid references public.user_profiles (id) on delete set null,
  reason          text,
  created_at      timestamptz not null default now(),
  constraint escalation_raised_by_kind_valid check (raised_by_kind in ('faculty', 'senior')),
  constraint escalation_raised_to_valid check (raised_to in ('faculty', 'hod')),
  constraint escalation_reason_length check (reason is null or char_length(reason) <= 1000)
);

comment on table public.query_escalations is
  'Every referral of a query to a faculty mentor and every escalation to the HOD, with the reason (0042). Readable by the people handling the query, not by the student.';

create index if not exists query_escalations_query_idx on public.query_escalations (query_id, created_at desc);

-- The escalations made before 0042, with the mentor's note as the reason.
insert into public.query_escalations (query_id, raised_by, raised_by_kind, raised_to, reason, created_at)
select q.id, q.escalated_by, 'faculty', 'hod', q.escalation_note, coalesce(q.escalated_at, q.updated_at)
  from public.support_queries q
 where q.escalated_to_hod
   and not exists (select 1 from public.query_escalations e where e.query_id = q.id and e.raised_to = 'hod');

alter table public.query_escalations enable row level security;
drop policy if exists escalations_select_handlers on public.query_escalations;
create policy escalations_select_handlers on public.query_escalations
  for select to authenticated
  using (public.can_handle_query(query_id));
revoke all on public.query_escalations from anon, authenticated;
grant select on public.query_escalations to authenticated;


-- ---------------------------------------------------------------------
-- 6. Notification links follow the recipient's portal
-- ---------------------------------------------------------------------
create or replace function public.query_link_for(p_query public.support_queries, p_recipient uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when p_recipient = p_query.student_id then '/student/queries/'
           when p_recipient = p_query.mentor_id and p_query.mentor_kind = 'senior' then '/student/peer-queries/'
           else coalesce((select case role
                                   when 'faculty' then '/faculty/queries/'
                                   when 'hod'     then '/hod/queries/'
                                   when 'admin'   then '/admin/queries/'
                                 end
                            from public.user_profiles where id = p_recipient), '/student/queries/')
         end || p_query.id::text;
$$;

create or replace function public.notify_on_query_created()
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
    new.mentor_id, new.student_id, 'query_created',
    format('New %s query from %s', new.category, coalesce(v_student, 'a student')),
    format('%s — %s', new.query_code, new.subject),
    new.id, public.query_link_for(new, new.mentor_id)
  );
  return new;
end;
$$;

-- A reply notifies the student and the mentor it went to, and the faculty
-- mentor a senior raised it to: everyone in the conversation but the sender.
create or replace function public.notify_on_query_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_query     public.support_queries;
  v_sender    text;
  v_recipient uuid;
begin
  if new.is_system_message then
    return new;   -- resolution/confirmation/escalation code covers these
  end if;

  select * into v_query from public.support_queries where id = new.query_id;
  if v_query.id is null then return new; end if;

  select full_name into v_sender from public.user_profiles where id = new.sender_id;

  for v_recipient in
    select distinct r from unnest(array[v_query.student_id, v_query.mentor_id, v_query.referred_to_faculty]) as r
     where r is not null and r <> new.sender_id
  loop
    perform public.enqueue_notification(
      v_recipient, new.sender_id, 'query_message',
      format('New reply from %s', coalesce(v_sender, 'a user')),
      left(new.body, 140),
      v_query.id, public.query_link_for(v_query, v_recipient)
    );
  end loop;
  return new;
end;
$$;

create or replace function public.notify_on_query_resolution_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text;
begin
  if new.resolution_status is not distinct from old.resolution_status then
    -- not a resolution change; check for a fresh rating instead
    if new.satisfaction_rating is not null and old.satisfaction_rating is null then
      perform public.enqueue_notification(
        new.mentor_id, new.student_id, 'query_rated',
        format('Query %s rated %s/5', new.query_code, new.satisfaction_rating),
        new.subject, new.id, public.query_link_for(new, new.mentor_id)
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
      new.id, public.query_link_for(new, new.student_id)
    );

  elsif new.resolution_status = 'confirmed' then
    perform public.enqueue_notification(
      new.mentor_id, new.student_id, 'query_confirmed',
      format('%s confirmed as resolved', new.query_code),
      new.subject, new.id, public.query_link_for(new, new.mentor_id)
    );

  elsif new.resolution_status = 'reopened' then
    perform public.enqueue_notification(
      new.mentor_id, new.student_id, 'query_reopened',
      format('%s reopened by the student', new.query_code),
      coalesce(new.student_confirmation_comment, 'The student reported the issue is not resolved.'),
      new.id, public.query_link_for(new, new.mentor_id)
    );
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 7. Raising a query: to the faculty mentor or the senior mentor
-- ---------------------------------------------------------------------
drop function if exists public.create_support_query(text, public.query_category, text, public.query_priority);

create or replace function public.create_support_query(
  p_subject     text,
  p_category    public.query_category,
  p_description text,
  p_priority    public.query_priority default 'Medium',
  p_recipient   text default 'faculty'
)
returns public.support_queries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller     public.user_profiles;
  v_query      public.support_queries;
  v_open_count integer;
  v_recipient  text := lower(btrim(coalesce(p_recipient, 'faculty')));
  v_mentor     uuid;
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

  if v_recipient = 'faculty' then
    v_mentor := v_caller.assigned_mentor_id;
    if v_mentor is null then
      raise exception 'No faculty mentor assigned. Please contact the HOD.' using errcode = '22023';
    end if;
  elsif v_recipient = 'senior' then
    v_mentor := public.senior_mentor_of(v_caller.id);
    if v_mentor is null then
      raise exception 'No senior mentor is assigned to you yet. Send this to your faculty mentor instead.'
        using errcode = '22023';
    end if;
  else
    raise exception 'Choose your faculty mentor or your senior mentor' using errcode = '22023';
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

  insert into public.support_queries (student_id, mentor_id, mentor_kind, subject, category, priority)
  values (v_caller.id, v_mentor, v_recipient, btrim(p_subject), p_category, p_priority)
  returning * into v_query;

  insert into public.query_messages (query_id, sender_id, body)
  values (v_query.id, v_caller.id, btrim(p_description));

  return v_query;
end;
$$;

revoke all on function public.create_support_query(text, public.query_category, text, public.query_priority, text) from public, anon;
grant execute on function public.create_support_query(text, public.query_category, text, public.query_priority, text) to authenticated;


-- ---------------------------------------------------------------------
-- 8. Replying and resolving: whoever the query was raised to
-- ---------------------------------------------------------------------
create or replace function public.post_query_message(p_query_id uuid, p_body text)
returns public.query_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_query    public.support_queries;
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

  -- The student, the mentor it went to, their HOD, and anyone it was raised to.
  if not public.can_access_query(p_query_id) then
    raise exception 'Unauthorized to post on this query' using errcode = '42501';
  end if;

  insert into public.query_messages (query_id, sender_id, body)
  values (p_query_id, auth.uid(), btrim(p_body))
  returning * into v_message;

  -- Anyone but the student answering counts as the first response, so a
  -- senior's reply picks the query up just as a faculty member's does.
  update public.support_queries
     set last_message_at   = now(),
         first_response_at = case
                               when first_response_at is null and auth.uid() <> v_query.student_id
                               then now() else first_response_at
                             end,
         status            = case
                               when auth.uid() <> v_query.student_id and status = 'Open'
                               then 'In Progress'::public.query_status else status
                             end
   where id = p_query_id;

  return v_message;
end;
$$;

create or replace function public.resolve_support_query(p_query_id uuid, p_note text default null)
returns public.support_queries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_query public.support_queries;
  v_name  text;
begin
  select * into v_query from public.support_queries where id = p_query_id;
  if v_query.id is null then
    raise exception 'Query not found' using errcode = 'P0002';
  end if;

  -- Anyone handling it (students may not resolve their own query; they
  -- answer the confirmation prompt instead).
  if not public.can_handle_query(p_query_id) then
    raise exception 'Only the mentor it was sent to, or whoever it was raised to, can resolve this query'
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
$$;


-- ---------------------------------------------------------------------
-- 9. A faculty member refers a query to the HOD (0018), now also a query
--    a senior raised to them; recorded with escalation_source 'faculty'.
-- ---------------------------------------------------------------------
create or replace function public.escalate_query_to_hod(p_query_id uuid, p_note text default null)
returns public.support_queries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_query   public.support_queries;
  v_caller  public.user_profiles;
  v_owner   public.user_profiles;
  v_student public.user_profiles;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_title   text;
  v_body    text;
  v_to      record;
  v_sent    integer := 0;
begin
  select * into v_query from public.support_queries where id = p_query_id;
  if v_query.id is null then
    raise exception 'Query not found' using errcode = 'P0002';
  end if;

  if v_query.mentor_kind = 'senior' and v_query.mentor_id = auth.uid() then
    raise exception 'Use Ask HOD / Escalate on the query and give your reason' using errcode = '22023';
  end if;
  -- The faculty mentor it went to, the one a senior raised it to, or their HOD.
  if not (   (v_query.mentor_id = auth.uid() and v_query.mentor_kind = 'faculty')
          or v_query.referred_to_faculty = auth.uid()
          or public.oversees_faculty(v_query.mentor_id)) then
    raise exception 'Only the assigned mentor can refer this query to the HOD'
      using errcode = '42501';
  end if;
  if v_query.escalated_to_hod then
    raise exception 'This query has already been referred to the HOD' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'The note must be 1000 characters or fewer' using errcode = '22023';
  end if;

  select * into v_caller  from public.user_profiles where id = auth.uid();
  select * into v_student from public.user_profiles where id = v_query.student_id;
  -- The HOD is found through the faculty member who is referring it.
  select * into v_owner from public.user_profiles
   where id = case when v_query.mentor_kind = 'faculty' then v_query.mentor_id else auth.uid() end;

  update public.support_queries
     set escalated_to_hod  = true,
         escalated_at      = now(),
         escalated_by      = auth.uid(),
         escalation_note   = v_note,
         escalation_source = 'faculty',
         last_message_at   = now()
   where id = p_query_id
   returning * into v_query;

  insert into public.query_escalations (query_id, raised_by, raised_by_kind, raised_to, reason)
  values (p_query_id, auth.uid(), 'faculty', 'hod', v_note);

  insert into public.query_messages (query_id, sender_id, body, is_system_message)
  values (
    p_query_id, auth.uid(),
    format('%s referred this query to the HOD.%s',
           coalesce(v_caller.full_name, 'The mentor'),
           case when v_note is null then '' else ' Note: ' || v_note end),
    true
  );

  v_title := format('%s referred %s to you', coalesce(v_caller.full_name, 'A mentor'), v_query.query_code);
  v_body  := format('%s — %s', coalesce(v_student.full_name, 'A student'),
                    coalesce(v_note, 'The mentor has asked you to look at this query.'));

  for v_to in
    select id from public.user_profiles
     where id = v_owner.hod_id and role = 'hod' and is_active
  loop
    perform public.enqueue_notification(
      v_to.id, auth.uid(), 'query_escalated', v_title, v_body,
      v_query.id, '/hod/queries/' || v_query.id::text
    );
    v_sent := v_sent + 1;
  end loop;

  if v_sent = 0 then
    for v_to in select id from public.user_profiles where role = 'admin' and is_active loop
      perform public.enqueue_notification(
        v_to.id, auth.uid(), 'query_escalated', v_title, v_body,
        v_query.id, '/admin/queries/' || v_query.id::text
      );
    end loop;
  end if;

  perform public.enqueue_notification(
    v_query.student_id, auth.uid(), 'query_escalated',
    format('%s has been referred to the HOD', v_query.query_code),
    'Your mentor has asked the Head of Department to look at this. They will be in touch.',
    v_query.id, '/student/queries/' || v_query.id::text
  );

  return v_query;
end;
$$;


-- ---------------------------------------------------------------------
-- 10. A senior asks for help: to the student's faculty mentor or the HOD
-- ---------------------------------------------------------------------
create or replace function public.escalate_peer_query(p_query_id uuid, p_to text, p_reason text)
returns public.support_queries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_query   public.support_queries;
  v_senior  public.user_profiles;
  v_student public.user_profiles;
  v_faculty public.user_profiles;
  v_to      text := lower(btrim(coalesce(p_to, '')));
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_title   text;
  v_body    text;
  v_hod     record;
  v_sent    integer := 0;
begin
  select * into v_query from public.support_queries where id = p_query_id;
  if v_query.id is null then
    raise exception 'Query not found' using errcode = 'P0002';
  end if;
  if not (v_query.mentor_kind = 'senior' and v_query.mentor_id = auth.uid()) then
    raise exception 'Only the senior mentor this query was sent to can escalate it here' using errcode = '42501';
  end if;
  if v_to not in ('faculty', 'hod') then
    raise exception 'Choose the student''s faculty mentor or the HOD' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'Say why you are escalating it: what is the concern or doubt?' using errcode = '22023';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'The reason must be 1000 characters or fewer' using errcode = '22023';
  end if;
  if v_query.status = 'Resolved' and v_query.resolution_status = 'confirmed' then
    raise exception 'This query is already closed and confirmed' using errcode = '22023';
  end if;

  select * into v_senior  from public.user_profiles where id = auth.uid();
  select * into v_student from public.user_profiles where id = v_query.student_id;
  select * into v_faculty from public.user_profiles
   where id = v_student.assigned_mentor_id and role = 'faculty';

  if v_to = 'faculty' then
    if v_faculty.id is null then
      raise exception 'This student has no faculty mentor yet. Escalate it to the HOD instead.' using errcode = '22023';
    end if;
    if v_query.referred_to_faculty is not null then
      raise exception 'This query has already been raised to the faculty mentor' using errcode = '22023';
    end if;

    update public.support_queries
       set referred_to_faculty = v_faculty.id,
           referred_at         = now(),
           last_message_at     = now()
     where id = p_query_id
     returning * into v_query;

    insert into public.query_escalations (query_id, raised_by, raised_by_kind, raised_to, target_faculty, reason)
    values (p_query_id, auth.uid(), 'senior', 'faculty', v_faculty.id, v_reason);

    insert into public.query_messages (query_id, sender_id, body, is_system_message)
    values (p_query_id, auth.uid(),
            format('%s (senior mentor) raised this query to %s, the student''s faculty mentor.',
                   coalesce(v_senior.full_name, 'The senior mentor'), coalesce(v_faculty.full_name, 'the faculty mentor')),
            true);

    perform public.enqueue_notification(
      v_faculty.id, auth.uid(), 'query_escalated',
      format('%s (senior mentor) raised %s to you', coalesce(v_senior.full_name, 'A senior mentor'), v_query.query_code),
      format('%s — %s', coalesce(v_student.full_name, 'A student'), v_reason),
      v_query.id, '/faculty/queries/' || v_query.id::text
    );
    perform public.enqueue_notification(
      v_query.student_id, auth.uid(), 'query_escalated',
      format('%s has been raised to your faculty mentor', v_query.query_code),
      format('Your senior mentor has asked %s to help with this.', coalesce(v_faculty.full_name, 'your faculty mentor')),
      v_query.id, '/student/queries/' || v_query.id::text
    );
    return v_query;
  end if;

  -- To the HOD
  if v_query.escalated_to_hod then
    raise exception 'This query has already been escalated to the HOD' using errcode = '22023';
  end if;

  update public.support_queries
     set escalated_to_hod  = true,
         escalated_at      = now(),
         escalated_by      = auth.uid(),
         escalation_source = 'senior',
         last_message_at   = now()
   where id = p_query_id
   returning * into v_query;

  insert into public.query_escalations (query_id, raised_by, raised_by_kind, raised_to, reason)
  values (p_query_id, auth.uid(), 'senior', 'hod', v_reason);

  insert into public.query_messages (query_id, sender_id, body, is_system_message)
  values (p_query_id, auth.uid(),
          format('%s (senior mentor) escalated this query to the HOD.', coalesce(v_senior.full_name, 'The senior mentor')),
          true);

  v_title := format('%s (senior mentor) escalated %s', coalesce(v_senior.full_name, 'A senior mentor'), v_query.query_code);
  v_body  := format('%s — %s', coalesce(v_student.full_name, 'A student'), v_reason);

  -- The HOD the student's faculty mentor reports to; if none, the administrator.
  for v_hod in
    select id from public.user_profiles
     where id = v_faculty.hod_id and role = 'hod' and is_active
  loop
    perform public.enqueue_notification(v_hod.id, auth.uid(), 'query_escalated', v_title, v_body,
                                        v_query.id, '/hod/queries/' || v_query.id::text);
    v_sent := v_sent + 1;
  end loop;
  if v_sent = 0 then
    for v_hod in select id from public.user_profiles where role = 'admin' and is_active loop
      perform public.enqueue_notification(v_hod.id, auth.uid(), 'query_escalated', v_title, v_body,
                                          v_query.id, '/admin/queries/' || v_query.id::text);
    end loop;
  end if;

  perform public.enqueue_notification(
    v_query.student_id, auth.uid(), 'query_escalated',
    format('%s has been escalated to the HOD', v_query.query_code),
    'Your senior mentor has asked the Head of Department to look at this.',
    v_query.id, '/student/queries/' || v_query.id::text
  );

  return v_query;
end;
$$;


-- ---------------------------------------------------------------------
-- 11. What each portal reads
-- ---------------------------------------------------------------------

-- A student's senior mentor, or NULL.
create or replace function public.get_my_senior_mentor()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'id', p.id, 'full_name', p.full_name, 'email', p.email, 'login_id', p.login_id,
           'section', replace(public.student_section_code(auth.uid()), ' ', ''))
    from public.user_profiles p
   where p.id = public.senior_mentor_of(auth.uid());
$$;

-- Names (and e-mails) of the people on a query, for whoever may read it:
-- a senior and their junior cannot read each other's profiles directly.
create or replace function public.get_query_people(p_query_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_people jsonb;
begin
  if not public.can_access_query(p_query_id) then
    raise exception 'Query not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_object_agg(p.id, jsonb_build_object(
           'id', p.id, 'full_name', p.full_name, 'email', p.email, 'role', p.role,
           'is_senior_mentor', p.is_senior_mentor,
           'login_id', case when p.role = 'student' then p.login_id end,
           'section',  case when p.role = 'student' then replace(public.student_section_code(p.id), ' ', '') end)), '{}'::jsonb)
    into v_people
    from public.user_profiles p
   where p.id in (
           select unnest(array[q.student_id, q.mentor_id, q.referred_to_faculty, q.escalated_by, q.resolved_by])
             from public.support_queries q where q.id = p_query_id
           union
           select sender_id from public.query_messages where query_id = p_query_id
           union
           select raised_by from public.query_escalations where query_id = p_query_id
         );
  return v_people;
end;
$$;

-- The senior's Peer Queries.
create or replace function public.get_peer_queries()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'query_code', q.query_code, 'subject', q.subject, 'category', q.category,
           'priority', q.priority, 'status', q.status, 'resolution_status', q.resolution_status,
           'created_at', q.created_at, 'last_message_at', q.last_message_at,
           'escalated_to_hod', q.escalated_to_hod, 'escalated_at', q.escalated_at,
           'referred_to_faculty', q.referred_to_faculty, 'referred_at', q.referred_at,
           'student', jsonb_build_object('id', s.id, 'full_name', s.full_name, 'login_id', s.login_id,
                                         'section', replace(public.student_section_code(s.id), ' ', '')),
           -- Whom "raise to faculty mentor" would reach, and who it reached.
           'faculty_mentor', case when fm.id is null then null
                                  else jsonb_build_object('id', fm.id, 'full_name', fm.full_name) end,
           'referred_faculty_name', f.full_name)
         order by q.last_message_at desc), '[]'::jsonb)
    from public.support_queries q
    join public.user_profiles s on s.id = q.student_id
    left join public.user_profiles fm on fm.id = s.assigned_mentor_id and fm.role = 'faculty'
    left join public.user_profiles f on f.id = q.referred_to_faculty
   where q.mentor_id = auth.uid() and q.mentor_kind = 'senior';
$$;

-- The senior's Assigned Mentees: the students of their sections.
create or replace function public.get_my_senior_mentees()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select section from public.senior_mentor_sections where senior_id = auth.uid()
  ), students as (
    select s.*, coalesce(public.normalise_section(f.mentor_section), public.normalise_section(s.section)) as code,
           f.full_name as faculty_name
      from public.user_profiles s
      left join public.user_profiles f on f.id = s.assigned_mentor_id and f.role = 'faculty'
     where s.role = 'student' and s.id <> auth.uid()
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', st.id, 'full_name', st.full_name, 'login_id', st.login_id, 'email', st.email,
           'branch', st.branch, 'semester_label', st.semester_label, 'section', replace(st.code, ' ', ''),
           'faculty_mentor', st.faculty_name, 'is_active', st.is_active,
           'queries', (select count(*) from public.support_queries q
                        where q.student_id = st.id and q.mentor_id = auth.uid() and q.mentor_kind = 'senior'),
           'open_queries', (select count(*) from public.support_queries q
                             where q.student_id = st.id and q.mentor_id = auth.uid() and q.mentor_kind = 'senior'
                               and q.status <> 'Resolved'))
         order by st.code, st.full_name), '[]'::jsonb)
    from students st
   where public.is_senior_mentor() and st.code in (select section from mine);
$$;

-- Raised to Me (faculty) and Raised to HOD (HOD, administrator).
create or replace function public.get_raised_queries()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select id, role from public.user_profiles where id = auth.uid() and is_active
  ), raised as (
    select q.*, 'faculty'::text as raised_to
      from public.support_queries q, me
     where me.role = 'faculty' and q.referred_to_faculty = me.id
    union all
    select q.*, 'hod'::text
      from public.support_queries q, me
     where me.role in ('hod', 'admin') and q.escalated_to_hod
       and (public.oversees_faculty(q.mentor_id) or public.oversees_student(q.student_id))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'query_code', r.query_code, 'subject', r.subject, 'category', r.category,
           'priority', r.priority, 'status', r.status, 'resolution_status', r.resolution_status,
           'created_at', r.created_at, 'last_message_at', r.last_message_at, 'mentor_kind', r.mentor_kind,
           'raised_to', r.raised_to,
           'raised_at', coalesce(e.created_at, case when r.raised_to = 'hod' then r.escalated_at else r.referred_at end),
           'raised_by_kind', coalesce(e.raised_by_kind, case when r.raised_to = 'hod' then coalesce(r.escalation_source, 'faculty') else 'senior' end),
           'raised_by', jsonb_build_object('id', rb.id, 'full_name', rb.full_name),
           'reason', e.reason,
           'escalated_to_hod', r.escalated_to_hod,
           'student', jsonb_build_object('id', s.id, 'full_name', s.full_name, 'login_id', s.login_id,
                                         'section', replace(public.student_section_code(s.id), ' ', '')),
           'mentor', jsonb_build_object('id', m.id, 'full_name', m.full_name))
         order by coalesce(e.created_at, r.escalated_at, r.referred_at) desc nulls last), '[]'::jsonb)
    from raised r
    join public.user_profiles s on s.id = r.student_id
    left join public.user_profiles m on m.id = r.mentor_id
    left join lateral (
      select * from public.query_escalations x
       where x.query_id = r.id and x.raised_to = r.raised_to
       order by x.created_at desc limit 1
    ) e on true
    left join public.user_profiles rb on rb.id = coalesce(e.raised_by, case when r.raised_to = 'hod' then r.escalated_by end);
$$;

-- The Senior Mentors page.
create or replace function public.list_senior_mentors()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_hod() then
    raise exception 'Only a HOD or the administrator can see the senior mentors' using errcode = '42501';
  end if;

  with codes as (
    select s.id, coalesce(public.normalise_section(f.mentor_section), public.normalise_section(s.section)) as code
      from public.user_profiles s
      left join public.user_profiles f on f.id = s.assigned_mentor_id and f.role = 'faculty'
     where s.role = 'student'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'full_name', p.full_name, 'email', p.email, 'login_id', p.login_id,
           'is_active', p.is_active,
           'sections', coalesce((select jsonb_agg(replace(m.section, ' ', '') order by m.section)
                                   from public.senior_mentor_sections m where m.senior_id = p.id), '[]'::jsonb),
           'mentees', (select count(*) from codes c
                        where c.id <> p.id and c.code in (select section from public.senior_mentor_sections where senior_id = p.id)),
           'open_queries', (select count(*) from public.support_queries q
                             where q.mentor_id = p.id and q.mentor_kind = 'senior' and q.status <> 'Resolved'),
           'escalations', (select count(*) from public.query_escalations e where e.raised_by = p.id))
         order by p.full_name), '[]'::jsonb)
    into v_result
    from public.user_profiles p
   where p.role = 'student' and p.is_senior_mentor;

  return v_result;
end;
$$;

-- Star a senior and choose their sections (replaces the whole set).
create or replace function public.set_senior_mentor_sections(p_senior_id uuid, p_sections text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_senior   public.user_profiles;
  v_sections text[];
  v_bad      text;
  v_taken    record;
  v_added    text[];
begin
  if not public.is_hod() then
    raise exception 'Only a HOD or the administrator can assign senior mentors' using errcode = '42501';
  end if;

  select * into v_senior from public.user_profiles where id = p_senior_id;
  if v_senior.id is null or v_senior.role <> 'student' or not v_senior.is_senior_mentor then
    raise exception 'That account is not a senior mentor' using errcode = '22023';
  end if;

  select array_agg(distinct coalesce(public.normalise_section(s), s) order by coalesce(public.normalise_section(s), s))
    into v_sections
    from unnest(coalesce(p_sections, '{}'::text[])) as s
   where btrim(coalesce(s, '')) <> '';
  v_sections := coalesce(v_sections, '{}'::text[]);

  select s into v_bad from unnest(v_sections) as s where s !~ '^[A-T] [34]$' limit 1;
  if v_bad is not null then
    raise exception '% is not one of the sections A3 to T4', v_bad using errcode = '22023';
  end if;

  -- One senior per section.
  select m.section, p.full_name into v_taken
    from public.senior_mentor_sections m
    join public.user_profiles p on p.id = m.senior_id
   where m.section = any (v_sections) and m.senior_id <> p_senior_id
   order by m.section limit 1;
  if v_taken.section is not null then
    raise exception '% already has a senior mentor (%). Remove it there first.',
      replace(v_taken.section, ' ', ''), v_taken.full_name using errcode = '22023';
  end if;

  select array_agg(s order by s) into v_added
    from unnest(v_sections) as s
   where not exists (select 1 from public.senior_mentor_sections m where m.senior_id = p_senior_id and m.section = s);

  delete from public.senior_mentor_sections
   where senior_id = p_senior_id and not (section = any (v_sections));
  insert into public.senior_mentor_sections (section, senior_id, assigned_by)
  select s, p_senior_id, auth.uid() from unnest(v_sections) as s
  on conflict (section) do nothing;

  if v_added is not null then
    perform public.enqueue_notification(
      p_senior_id, auth.uid(), 'star_mentee_assigned',
      'You are a senior mentor',
      format('You now look after section%s %s. Their queries to you appear under Peer Queries.',
             case when array_length(v_added, 1) > 1 then 's' else '' end,
             array_to_string(array(select replace(x, ' ', '') from unnest(v_added) as x), ', ')),
      null, '/student/senior-mentees'
    );
  end if;

  return jsonb_build_object('senior_id', p_senior_id,
                            'sections', to_jsonb(array(select replace(x, ' ', '') from unnest(v_sections) as x)));
end;
$$;


-- ---------------------------------------------------------------------
-- 12. Direct writes to a query: the priority only
-- ---------------------------------------------------------------------
-- The UPDATE policies let the mentor, their HOD and the administrator
-- update their queries directly, which until now meant any column. A
-- senior is a student, and a direct update could mark a query escalated
-- without a reason or point it at any faculty member. The only direct
-- update the portal makes is the priority (FacultyQueryDetailPage);
-- everything else goes through the functions above, which run as their
-- owner and are not affected.
revoke update on public.support_queries from authenticated;
grant update (priority) on public.support_queries to authenticated;

-- Likewise a student's direct INSERT (policy queries_insert_own) could
-- carry any status, rating or escalation, and now also any faculty member
-- in referred_to_faculty. The portal raises queries only through
-- create_support_query() (and CR items through submit_mom_report()).
revoke insert on public.support_queries from authenticated;


-- ---------------------------------------------------------------------
-- 13. Grants
-- ---------------------------------------------------------------------
-- Internal helpers: called by the functions above, not by the browser.
revoke all on function public.normalise_section(text)            from public, anon, authenticated;
revoke all on function public.student_section_code(uuid)          from public, anon, authenticated;
revoke all on function public.senior_mentor_of(uuid)              from public, anon, authenticated;
revoke all on function public.query_link_for(public.support_queries, uuid) from public, anon, authenticated;

revoke all on function public.is_senior_mentor()                  from public, anon;
revoke all on function public.can_handle_query(uuid)              from public, anon;
revoke all on function public.escalate_peer_query(uuid, text, text) from public, anon;
revoke all on function public.get_my_senior_mentor()              from public, anon;
revoke all on function public.get_query_people(uuid)              from public, anon;
revoke all on function public.get_peer_queries()                  from public, anon;
revoke all on function public.get_my_senior_mentees()             from public, anon;
revoke all on function public.get_raised_queries()                from public, anon;
revoke all on function public.list_senior_mentors()               from public, anon;
revoke all on function public.set_senior_mentor_sections(uuid, text[]) from public, anon;

grant execute on function public.is_senior_mentor()                  to authenticated;
grant execute on function public.can_handle_query(uuid)              to authenticated;
grant execute on function public.escalate_peer_query(uuid, text, text) to authenticated;
grant execute on function public.get_my_senior_mentor()              to authenticated;
grant execute on function public.get_query_people(uuid)              to authenticated;
grant execute on function public.get_peer_queries()                  to authenticated;
grant execute on function public.get_my_senior_mentees()             to authenticated;
grant execute on function public.get_raised_queries()                to authenticated;
grant execute on function public.list_senior_mentors()               to authenticated;
grant execute on function public.set_senior_mentor_sections(uuid, text[]) to authenticated;
