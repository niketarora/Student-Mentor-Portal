-- =====================================================================
-- 0040  Counselling requests say what kind of counselling they are
-- =====================================================================
-- The student's Counselling page now asks them to choose the kind of
-- counselling first (Academic, Personal, Career, ... Other) and then to
-- describe the issue. The choice is stored with the request so the
-- mentor sees it on their Counselling page and in the notification.
--
--   * counselling_requests.counselling_type: one of the twelve values
--     below. NULL only on requests sent before this migration, which
--     never had a type; nothing is guessed for them.
--
--   * counselling_type_label(): the display name of each value, for the
--     notification. The frontend keeps the same list, in the same order,
--     in COUNSELLING_TYPES (frontend/src/lib/constants.js).
--
--   * request_counselling(p_concern, p_counselling_type) replaces
--     request_counselling(p_concern) and refuses a request without a type.
--     The type has a default only so that a page still calling with the
--     concern alone gets "Choose the type of counselling" rather than
--     "function not found" until the new frontend is deployed.
--
-- Who can read a request is unchanged: the student and their mentor only.
-- =====================================================================

alter table public.counselling_requests
  add column if not exists counselling_type text;

alter table public.counselling_requests
  drop constraint if exists counselling_type_valid;
alter table public.counselling_requests
  add constraint counselling_type_valid check (
    counselling_type is null or counselling_type in (
      'academic', 'personal', 'career', 'placement', 'financial', 'technical',
      'health_wellness', 'behavioural', 'professional_development',
      'higher_education', 'general_guidance', 'other'
    )
  );

comment on column public.counselling_requests.counselling_type is
  'The kind of counselling the student chose (0040). NULL only for requests sent before 0040.';


-- ---------------------------------------------------------------------
-- Display names
-- ---------------------------------------------------------------------
create or replace function public.counselling_type_label(p_type text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_type
    when 'academic'                 then 'Academic Counselling'
    when 'personal'                 then 'Personal Counselling'
    when 'career'                   then 'Career Counselling'
    when 'placement'                then 'Placement Counselling'
    when 'financial'                then 'Financial Counselling'
    when 'technical'                then 'Technical Counselling'
    when 'health_wellness'          then 'Health & Wellness Counselling'
    when 'behavioural'              then 'Behavioural Counselling'
    when 'professional_development' then 'Professional Development Counselling'
    when 'higher_education'         then 'Higher Education Counselling'
    when 'general_guidance'         then 'General Guidance & Mentorship'
    when 'other'                    then 'Other'
  end
$$;

revoke all on function public.counselling_type_label(text) from public, anon;
grant execute on function public.counselling_type_label(text) to authenticated;


-- ---------------------------------------------------------------------
-- Submitting: the type is required
-- ---------------------------------------------------------------------
drop function if exists public.request_counselling(text);

create or replace function public.request_counselling(
  p_concern          text,
  p_counselling_type text default null
)
returns public.counselling_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   public.user_profiles;
  v_row  public.counselling_requests;
  v_open integer;
  v_type text := lower(btrim(coalesce(p_counselling_type, '')));
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
  if v_type = '' then
    raise exception 'Choose the type of counselling' using errcode = '22023';
  end if;
  if public.counselling_type_label(v_type) is null then
    raise exception 'Choose one of the listed types of counselling' using errcode = '22023';
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

  insert into public.counselling_requests (student_id, mentor_id, concern, counselling_type)
  values (v_me.id, v_me.assigned_mentor_id, btrim(p_concern), v_type)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.request_counselling(text, text) from public, anon;
grant execute on function public.request_counselling(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- The mentor's notification names the type
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
      -- "Asha Rao has asked for Career Counselling"; "Other" and requests
      -- without a type keep "has asked to talk".
      case
        when new.counselling_type is null or new.counselling_type = 'other'
          then format('%s has asked to talk', coalesce(v_student, 'A mentee'))
        else format('%s has asked for %s', coalesce(v_student, 'A mentee'),
                    public.counselling_type_label(new.counselling_type))
      end,
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
