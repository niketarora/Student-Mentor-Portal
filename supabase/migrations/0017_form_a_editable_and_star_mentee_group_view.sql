-- =====================================================================
-- 0017  Form A becomes student-editable  +  star mentee group ticket view
-- =====================================================================
-- CHANGE 1 — Form A is no longer locked after submission.
--   Students correct their own record from their profile page; no HOD
--   approval round trip. is_submitted still drives the onboarding gate,
--   so a student is still forced through it once, but afterwards the
--   record behaves like ordinary profile data.
--
-- CHANGE 2 — the star mentee (student representative) gets a read-only
--   list of every ticket raised inside their mentor group.
--   Deliberately exposed through a narrow function rather than a policy:
--   the projection omits ticket ids, message bodies, emails and
--   registration numbers, so the representative can see WHAT the group is
--   raising without being able to open a thread, reply, resolve, or read
--   another student's profile.
-- =====================================================================

-- ── 1. Stop locking Form A ────────────────────────────────────────────
drop trigger if exists trg_enforce_form_a_lock on public.student_form_a_profiles;
drop function if exists public.enforce_form_a_lock();

-- Release anything already locked by the previous behaviour.
update public.student_form_a_profiles
   set is_locked = false, unlock_requested = false
 where is_locked = true;

create or replace function public.submit_student_form_a(p_payload jsonb)
returns public.student_form_a_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller public.user_profiles;
  v_row    public.student_form_a_profiles;
  v_same   boolean;
begin
  select * into v_caller from public.user_profiles where id = auth.uid();
  if v_caller.id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_caller.role <> 'student' then
    raise exception 'Only students fill Form A' using errcode = '42501';
  end if;

  v_same := coalesce((p_payload ->> 'permanent_same_as_communication')::boolean, false);

  insert into public.student_form_a_profiles as f (
    student_id, full_name, registration_no, section, roll_no, branch,
    mobile_no, email, hostel_block, room_no, blood_group, date_of_birth, is_day_scholar,
    has_muj_alumni_in_family, alumni_name, alumni_branch, alumni_batch, alumni_institution, alumni_relationship,
    father_name, father_occupation, father_organization, father_designation, father_mobile, father_email,
    mother_name, mother_occupation, mother_organization, mother_designation, mother_mobile, mother_email,
    communication_address, communication_pin_code,
    permanent_same_as_communication, permanent_address, permanent_pin_code,
    parent_business_card_path, student_signature_path,
    is_submitted, submitted_at, is_locked
  )
  values (
    v_caller.id,
    btrim(p_payload ->> 'full_name'),
    btrim(p_payload ->> 'registration_no'),
    nullif(btrim(p_payload ->> 'section'), ''),
    nullif(btrim(p_payload ->> 'roll_no'), ''),
    nullif(btrim(p_payload ->> 'branch'), ''),
    btrim(p_payload ->> 'mobile_no'),
    lower(btrim(p_payload ->> 'email')),
    nullif(btrim(p_payload ->> 'hostel_block'), ''),
    nullif(btrim(p_payload ->> 'room_no'), ''),
    nullif(btrim(p_payload ->> 'blood_group'), ''),
    nullif(p_payload ->> 'date_of_birth', '')::date,
    coalesce((p_payload ->> 'is_day_scholar')::boolean, false),
    coalesce((p_payload ->> 'has_muj_alumni_in_family')::boolean, false),
    nullif(btrim(p_payload ->> 'alumni_name'), ''),
    nullif(btrim(p_payload ->> 'alumni_branch'), ''),
    nullif(btrim(p_payload ->> 'alumni_batch'), ''),
    nullif(btrim(p_payload ->> 'alumni_institution'), ''),
    nullif(btrim(p_payload ->> 'alumni_relationship'), ''),
    btrim(p_payload ->> 'father_name'),
    nullif(p_payload ->> 'father_occupation', '')::public.parent_occupation,
    nullif(btrim(p_payload ->> 'father_organization'), ''),
    nullif(btrim(p_payload ->> 'father_designation'), ''),
    nullif(btrim(p_payload ->> 'father_mobile'), ''),
    nullif(lower(btrim(p_payload ->> 'father_email')), ''),
    btrim(p_payload ->> 'mother_name'),
    nullif(p_payload ->> 'mother_occupation', '')::public.parent_occupation,
    nullif(btrim(p_payload ->> 'mother_organization'), ''),
    nullif(btrim(p_payload ->> 'mother_designation'), ''),
    nullif(btrim(p_payload ->> 'mother_mobile'), ''),
    nullif(lower(btrim(p_payload ->> 'mother_email')), ''),
    btrim(p_payload ->> 'communication_address'),
    btrim(p_payload ->> 'communication_pin_code'),
    v_same,
    case when v_same then btrim(p_payload ->> 'communication_address')
         else btrim(p_payload ->> 'permanent_address') end,
    case when v_same then btrim(p_payload ->> 'communication_pin_code')
         else btrim(p_payload ->> 'permanent_pin_code') end,
    nullif(btrim(p_payload ->> 'parent_business_card_path'), ''),
    nullif(btrim(p_payload ->> 'student_signature_path'), ''),
    true, now(), false
  )
  on conflict (student_id) do update set
    full_name = excluded.full_name,
    registration_no = excluded.registration_no,
    section = excluded.section,
    roll_no = excluded.roll_no,
    branch = excluded.branch,
    mobile_no = excluded.mobile_no,
    email = excluded.email,
    hostel_block = excluded.hostel_block,
    room_no = excluded.room_no,
    blood_group = excluded.blood_group,
    date_of_birth = excluded.date_of_birth,
    is_day_scholar = excluded.is_day_scholar,
    has_muj_alumni_in_family = excluded.has_muj_alumni_in_family,
    alumni_name = excluded.alumni_name,
    alumni_branch = excluded.alumni_branch,
    alumni_batch = excluded.alumni_batch,
    alumni_institution = excluded.alumni_institution,
    alumni_relationship = excluded.alumni_relationship,
    father_name = excluded.father_name,
    father_occupation = excluded.father_occupation,
    father_organization = excluded.father_organization,
    father_designation = excluded.father_designation,
    father_mobile = excluded.father_mobile,
    father_email = excluded.father_email,
    mother_name = excluded.mother_name,
    mother_occupation = excluded.mother_occupation,
    mother_organization = excluded.mother_organization,
    mother_designation = excluded.mother_designation,
    mother_mobile = excluded.mother_mobile,
    mother_email = excluded.mother_email,
    communication_address = excluded.communication_address,
    communication_pin_code = excluded.communication_pin_code,
    permanent_same_as_communication = excluded.permanent_same_as_communication,
    permanent_address = excluded.permanent_address,
    permanent_pin_code = excluded.permanent_pin_code,
    parent_business_card_path = coalesce(excluded.parent_business_card_path, f.parent_business_card_path),
    student_signature_path    = coalesce(excluded.student_signature_path, f.student_signature_path),
    is_submitted = true,
    -- keep the ORIGINAL submission date on later edits
    submitted_at = coalesce(f.submitted_at, now()),
    is_locked = false,
    unlock_requested = false,
    unlock_requested_at = null
  returning * into v_row;

  perform set_config('ssmp.trusted_operation', 'on', true);
  update public.user_profiles
     set form_a_completed = true,
         form_a_completed_at = coalesce(form_a_completed_at, now()),
         phone = coalesce(nullif(btrim(p_payload ->> 'mobile_no'), ''), phone),
         section = coalesce(nullif(btrim(p_payload ->> 'section'), ''), section),
         branch  = coalesce(nullif(btrim(p_payload ->> 'branch'), ''), branch)
   where id = v_caller.id;
  perform set_config('ssmp.trusted_operation', 'off', true);

  return v_row;
end;
$$;

revoke all on function public.submit_student_form_a(jsonb) from public, anon;
grant execute on function public.submit_student_form_a(jsonb) to authenticated;


-- ── 2. Star mentee: read-only view of the mentor group's tickets ──────
create or replace function public.get_mentor_group_tickets()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me public.user_profiles;
begin
  select * into v_me from public.user_profiles where id = auth.uid();

  if v_me.id is null or v_me.role <> 'student' then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not v_me.is_star_mentee then
    raise exception 'Only the student representative can view the group ticket list'
      using errcode = '42501';
  end if;
  if v_me.assigned_mentor_id is null then
    return '[]'::jsonb;
  end if;

  -- Narrow projection on purpose. No ticket id (so no thread can be
  -- opened), no message bodies, no email, no registration number.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'ticket_code',       t.ticket_code,
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
      from public.support_tickets t
      join public.user_profiles s on s.id = t.student_id
     where t.mentor_id = v_me.assigned_mentor_id
  ), '[]'::jsonb);
end;
$$;

comment on function public.get_mentor_group_tickets is
  'Feature 7 companion — read-only ticket list for the star mentee. Returns a deliberately narrow projection so the representative cannot open threads, reply, resolve, or read another student''s profile.';

revoke all on function public.get_mentor_group_tickets() from public, anon;
grant execute on function public.get_mentor_group_tickets() to authenticated;


-- ── 3. Tell the new representative what the role actually unlocks ─────
create or replace function public.notify_on_star_mentee_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_star_mentee = true and old.is_star_mentee = false then
    perform public.enqueue_notification(
      new.id, new.star_mentee_assigned_by, 'star_mentee_assigned',
      'You are now the student representative',
      'Your mentor has marked you as the star mentee for your mentor group. '
      || 'A new "Group Tickets" section has been added to your portal, where you can '
      || 'see the tickets raised by students in your group. It is view-only — you '
      || 'cannot reply, resolve, or open a student''s profile.',
      null, '/student/group-tickets'
    );
  end if;
  return new;
end;
$$;
