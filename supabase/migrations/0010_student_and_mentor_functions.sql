-- =====================================================================
-- 0010  Student + mentor RPCs
--       Feature 1 (Form A submit/lock), Feature 2 (GPA),
--       Feature 6 (achievement verification), Feature 7 (star mentee)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Feature 1 — locking. Once submitted, the student can view but not edit.
-- Only an HOD can unlock, and only after the student requests it.
-- ---------------------------------------------------------------------
create or replace function public.enforce_form_a_lock()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  -- Fields a student is still allowed to change on a locked form.
  editable_after_lock constant text[] :=
    array['gpa_sharing_enabled', 'unlock_requested', 'unlock_requested_at', 'updated_at'];
  old_frozen jsonb;
  new_frozen jsonb;
  k text;
begin
  -- Trusted server calls (auth.uid() is null) and HODs bypass the lock.
  if auth.uid() is null or public.is_hod() then
    return new;
  end if;

  if not old.is_locked then
    return new;
  end if;

  old_frozen := to_jsonb(old);
  new_frozen := to_jsonb(new);
  foreach k in array editable_after_lock loop
    old_frozen := old_frozen - k;
    new_frozen := new_frozen - k;
  end loop;

  if old_frozen is distinct from new_frozen then
    raise exception 'Form A has been submitted and is now read-only. Ask your HOD to unlock it if a correction is needed.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_form_a_lock on public.student_form_a_profiles;
create trigger trg_enforce_form_a_lock
  before update on public.student_form_a_profiles
  for each row execute function public.enforce_form_a_lock();

-- ---------------------------------------------------------------------
-- Feature 1 — submit Form A. Upserts the profile, locks it and flips the
-- onboarding gate on user_profiles in one transaction.
-- ---------------------------------------------------------------------
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

  select * into v_row from public.student_form_a_profiles where student_id = v_caller.id;
  if v_row.id is not null and v_row.is_locked then
    raise exception 'Form A has already been submitted. Ask your HOD to unlock it if a correction is needed.'
      using errcode = '42501';
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
    true, now(), true
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
    submitted_at = now(),
    is_locked = true,
    unlock_requested = false,
    unlock_requested_at = null
  returning * into v_row;

  -- form_a_completed is a protected column; flag this as a trusted write
  -- so guard_protected_profile_columns() lets it through (see 0007).
  perform set_config('ssmp.trusted_operation', 'on', true);
  update public.user_profiles
     set form_a_completed = true,
         form_a_completed_at = now(),
         phone = coalesce(nullif(btrim(p_payload ->> 'mobile_no'), ''), phone),
         section = coalesce(nullif(btrim(p_payload ->> 'section'), ''), section),
         branch  = coalesce(nullif(btrim(p_payload ->> 'branch'), ''), branch)
   where id = v_caller.id;
  perform set_config('ssmp.trusted_operation', 'off', true);

  return v_row;
end;
$$;

-- Student asks the HOD to reopen their locked form.
create or replace function public.request_form_a_unlock()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.student_form_a_profiles
     set unlock_requested = true, unlock_requested_at = now()
   where student_id = auth.uid() and is_locked = true;
end;
$$;

-- HOD reopens a submitted form for correction.
create or replace function public.unlock_student_form_a(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_hod() then
    raise exception 'Only the HOD can unlock a submitted Form A' using errcode = '42501';
  end if;

  update public.student_form_a_profiles
     set is_locked = false, unlock_requested = false, unlocked_by = auth.uid()
   where student_id = p_student_id;

  perform set_config('ssmp.trusted_operation', 'on', true);
  update public.user_profiles
     set form_a_completed = false, form_a_completed_at = null
   where id = p_student_id;
  perform set_config('ssmp.trusted_operation', 'off', true);

end;
$$;

-- ---------------------------------------------------------------------
-- Feature 2 — GPA sharing toggle + GPA upsert
-- ---------------------------------------------------------------------
create or replace function public.set_gpa_sharing(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_student() then
    raise exception 'Only a student can change their own GPA sharing preference'
      using errcode = '42501';
  end if;

  insert into public.student_form_a_profiles (
    student_id, full_name, registration_no, mobile_no, email,
    father_name, mother_name,
    communication_address, communication_pin_code, permanent_address, permanent_pin_code,
    is_day_scholar, gpa_sharing_enabled
  )
  select p.id, p.full_name, coalesce(p.login_id, 'PENDING'), '0000000000', p.email,
         'PENDING', 'PENDING', 'PENDING', '000000', 'PENDING', '000000', true, p_enabled
    from public.user_profiles p where p.id = auth.uid()
  on conflict (student_id) do update set gpa_sharing_enabled = p_enabled;

  return p_enabled;
end;
$$;

create or replace function public.upsert_semester_gpa(
  p_semester_number smallint,
  p_gpa             numeric
)
returns public.student_semester_gpas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.student_semester_gpas;
begin
  if not public.is_student() then
    raise exception 'Only a student can record their own GPA' using errcode = '42501';
  end if;
  if p_semester_number is null or p_semester_number < 1 or p_semester_number > 8 then
    raise exception 'Semester must be between 1 and 8' using errcode = '22023';
  end if;
  if p_gpa is null or p_gpa < 0 or p_gpa > 10 then
    raise exception 'GPA must be between 0 and 10' using errcode = '22023';
  end if;

  insert into public.student_semester_gpas (student_id, semester_number, gpa)
  values (auth.uid(), p_semester_number, round(p_gpa, 2))
  on conflict (student_id, semester_number)
    do update set gpa = excluded.gpa, updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- Feature 6 — mentor verifies an achievement (badge only)
-- ---------------------------------------------------------------------
create or replace function public.set_achievement_verification(
  p_achievement_id uuid,
  p_verified       boolean
)
returns public.student_achievements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.student_achievements;
begin
  select * into v_row from public.student_achievements where id = p_achievement_id;
  if v_row.id is null then
    raise exception 'Achievement not found' using errcode = 'P0002';
  end if;

  -- isAssignedMentor OR isHod
  if not (public.is_mentor_of(v_row.student_id) or public.is_hod()) then
    raise exception 'Only the assigned mentor or the HOD can verify this achievement'
      using errcode = '42501';
  end if;

  update public.student_achievements
     set verified_by_faculty = p_verified,
         verified_by         = case when p_verified then auth.uid() else null end,
         verified_at         = case when p_verified then now() else null end
   where id = p_achievement_id
   returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- Feature 7 — star mentee (student representative), one per faculty.
-- Unset-then-set runs inside a single function call, so the table can
-- never be observed with two stars under the same mentor.
-- ---------------------------------------------------------------------
create or replace function public.set_star_mentee(
  p_student_id uuid,
  p_is_star    boolean
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student public.user_profiles;
  v_mentor  uuid;
begin
  select * into v_student from public.user_profiles where id = p_student_id;
  if v_student.id is null or v_student.role <> 'student' then
    raise exception 'Student not found' using errcode = 'P0002';
  end if;

  -- isAssignedMentor OR isHod
  if public.is_mentor_of(p_student_id) then
    v_mentor := auth.uid();
  elsif public.is_hod() then
    v_mentor := v_student.assigned_mentor_id;
    if v_mentor is null then
      raise exception 'This student has no assigned mentor yet' using errcode = '22023';
    end if;
  else
    raise exception 'Only the assigned mentor or the HOD can set a star mentee'
      using errcode = '42501';
  end if;

  -- Serialise on the mentor row so two concurrent calls cannot both win.
  perform 1 from public.user_profiles where id = v_mentor for update;

  -- is_star_mentee is a protected column; this function has already
  -- verified the caller is the assigned mentor or the HOD.
  perform set_config('ssmp.trusted_operation', 'on', true);

  if p_is_star then
    update public.user_profiles
       set is_star_mentee = false,
           star_mentee_assigned_by = null,
           star_mentee_assigned_at = null
     where assigned_mentor_id = v_mentor
       and is_star_mentee = true
       and id <> p_student_id;

    update public.user_profiles
       set is_star_mentee = true,
           star_mentee_assigned_by = auth.uid(),
           star_mentee_assigned_at = now()
     where id = p_student_id
     returning * into v_student;
  else
    update public.user_profiles
       set is_star_mentee = false,
           star_mentee_assigned_by = null,
           star_mentee_assigned_at = null
     where id = p_student_id
     returning * into v_student;
  end if;

  perform set_config('ssmp.trusted_operation', 'off', true);

  return v_student;
end;
$$;

-- ---------------------------------------------------------------------
-- Notifications helper
-- ---------------------------------------------------------------------
create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.notifications
     set is_read = true, read_at = now()
   where recipient_id = auth.uid() and is_read = false;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke all on function public.submit_student_form_a(jsonb)                    from public, anon;
revoke all on function public.request_form_a_unlock()                          from public, anon;
revoke all on function public.unlock_student_form_a(uuid)                      from public, anon;
revoke all on function public.set_gpa_sharing(boolean)                         from public, anon;
revoke all on function public.upsert_semester_gpa(smallint, numeric)           from public, anon;
revoke all on function public.set_achievement_verification(uuid, boolean)      from public, anon;
revoke all on function public.set_star_mentee(uuid, boolean)                   from public, anon;
revoke all on function public.mark_all_notifications_read()                    from public, anon;

grant execute on function public.submit_student_form_a(jsonb)               to authenticated;
grant execute on function public.request_form_a_unlock()                    to authenticated;
grant execute on function public.unlock_student_form_a(uuid)                to authenticated;
grant execute on function public.set_gpa_sharing(boolean)                   to authenticated;
grant execute on function public.upsert_semester_gpa(smallint, numeric)     to authenticated;
grant execute on function public.set_achievement_verification(uuid, boolean) to authenticated;
grant execute on function public.set_star_mentee(uuid, boolean)             to authenticated;
grant execute on function public.mark_all_notifications_read()              to authenticated;
