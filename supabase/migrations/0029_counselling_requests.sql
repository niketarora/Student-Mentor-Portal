-- =====================================================================
-- 0029  Counselling — student to their own mentor, and nobody else
-- =====================================================================
-- WHY THIS IS NOT A support_tickets CATEGORY
-- ---------------------------------------------------------------------
-- Mechanically it is one: a student writes, their assigned mentor
-- answers, both get notified. Everything about the ticket machinery
-- would have worked.
--
-- What does not work is who can read it. tickets_select_participants
-- grants the HOD every ticket in the department, by design — that is
-- institutional oversight and it is right for a broken projector. It is
-- not right for "I am struggling and I need to talk to someone", which
-- the brief says goes to the assigned mentor. Bolting a category onto
-- support_tickets would mean filtering counselling back out of the HOD
-- queue, both dashboards' category charts, the faculty activity report
-- and the department report — four places to remember forever — and RLS
-- would still hand the row over to any HOD who asked PostgREST directly.
--
-- One table with a two-party policy is smaller than that and actually
-- closes the door.
--
-- No threaded conversation: the brief is "student writes, mentor sees,
-- mentor responds". One note back closes the loop. If this turns into a
-- back-and-forth, that is what support_tickets is for.
-- =====================================================================

create table if not exists public.counselling_requests (
  id             uuid primary key default extensions.gen_random_uuid(),
  student_id     uuid not null references public.user_profiles (id) on delete cascade,
  -- Snapshotted at submission. A Feature 8 reassignment afterwards must
  -- not silently hand an old, personal request to a new mentor who was
  -- never part of the conversation.
  mentor_id      uuid not null references public.user_profiles (id) on delete cascade,

  concern        text not null,
  -- Plain CHECK rather than an enum: three fixed values that drive a
  -- chip colour need no type, and an enum would have cost its own
  -- migration file for the ordering hazard above.
  status         text not null default 'open',

  mentor_note    text,
  responded_by   uuid references public.user_profiles (id) on delete set null,
  responded_at   timestamptz,
  closed_at      timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint counselling_concern_not_blank  check (public.is_non_blank(concern)),
  constraint counselling_concern_max_length check (char_length(concern) <= 3000),
  constraint counselling_note_max_length    check (mentor_note is null or char_length(mentor_note) <= 3000),
  constraint counselling_status_valid       check (status in ('open', 'acknowledged', 'closed')),
  constraint counselling_mentor_is_not_student check (mentor_id <> student_id)
);

comment on table public.counselling_requests is
  'Personal counselling requests. Readable by the student who wrote it and the mentor it was sent to — NOT by the HOD, unlike support_tickets. See the header of this migration before widening that.';

create index if not exists counselling_mentor_open_idx
  on public.counselling_requests (mentor_id, created_at desc) where status <> 'closed';
create index if not exists counselling_student_idx
  on public.counselling_requests (student_id, created_at desc);

drop trigger if exists trg_counselling_updated_at on public.counselling_requests;
create trigger trg_counselling_updated_at
  before update on public.counselling_requests
  for each row execute function public.set_updated_at_timestamp();


-- ---------------------------------------------------------------------
-- RLS — two parties, no third
-- ---------------------------------------------------------------------
alter table public.counselling_requests enable row level security;

drop policy if exists counselling_select_two_parties on public.counselling_requests;
drop policy if exists counselling_update_mentor      on public.counselling_requests;

-- Deliberately NOT can_access_student(), which includes is_hod().
create policy counselling_select_two_parties on public.counselling_requests
  for select to authenticated
  using (student_id = auth.uid() or mentor_id = auth.uid());

-- The mentor closes out their own; the student never edits a sent request.
create policy counselling_update_mentor on public.counselling_requests
  for update to authenticated
  using (mentor_id = auth.uid())
  with check (mentor_id = auth.uid());

-- No INSERT policy: request_counselling() is the only way in, so a
-- student cannot file against a mentor who is not theirs.
grant select, update on public.counselling_requests to authenticated;


-- ---------------------------------------------------------------------
-- Notifications, from a trigger (§10.8 — never from React)
-- ---------------------------------------------------------------------
create or replace function public.notify_on_counselling_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student text;
begin
  select full_name into v_student from public.user_profiles where id = new.student_id;

  if tg_op = 'INSERT' then
    perform public.enqueue_notification(
      new.mentor_id, new.student_id, 'counselling_request',
      format('%s has asked to talk', coalesce(v_student, 'A mentee')),
      left(new.concern, 140),
      null, '/faculty/counselling'
    );
    return new;
  end if;

  -- Only when the mentor actually writes something back.
  if new.mentor_note is distinct from old.mentor_note and new.mentor_note is not null then
    perform public.enqueue_notification(
      new.student_id, new.responded_by, 'counselling_request',
      'Your mentor has replied',
      left(new.mentor_note, 140),
      null, '/student/counselling'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_counselling on public.counselling_requests;
create trigger trg_notify_counselling
  after insert or update on public.counselling_requests
  for each row execute function public.notify_on_counselling_request();


-- ---------------------------------------------------------------------
-- Submitting
-- ---------------------------------------------------------------------
create or replace function public.request_counselling(p_concern text)
returns public.counselling_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  -- Same shape as the 20-unresolved cap on tickets, set lower: this is a
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
$$;

revoke all on function public.request_counselling(text) from public, anon;
grant execute on function public.request_counselling(text) to authenticated;


-- ---------------------------------------------------------------------
-- Responding
-- ---------------------------------------------------------------------
-- The UPDATE policy above would let the mentor write these columns
-- directly. This exists so status and responded_by/at cannot drift apart
-- from the note, and so the student-facing wording has one source.
create or replace function public.respond_to_counselling(
  p_request_id uuid,
  p_note       text,
  p_close      boolean default false
)
returns public.counselling_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.counselling_requests;
begin
  select * into v_row from public.counselling_requests where id = p_request_id;
  if v_row.id is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_row.mentor_id <> auth.uid() then
    raise exception 'Only the assigned mentor can respond to this request' using errcode = '42501';
  end if;
  if p_note is not null and char_length(p_note) > 3000 then
    raise exception 'Please keep the response under 3000 characters' using errcode = '22023';
  end if;

  update public.counselling_requests
     set mentor_note  = coalesce(nullif(btrim(coalesce(p_note, '')), ''), mentor_note),
         responded_by = case when public.is_non_blank(p_note) then auth.uid() else responded_by end,
         responded_at = case when public.is_non_blank(p_note) then now() else responded_at end,
         status       = case when p_close then 'closed' else 'acknowledged' end,
         closed_at    = case when p_close then now() else null end
   where id = p_request_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.respond_to_counselling(uuid, text, boolean) from public, anon;
grant execute on function public.respond_to_counselling(uuid, text, boolean) to authenticated;
