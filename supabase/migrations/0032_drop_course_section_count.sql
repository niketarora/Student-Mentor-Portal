-- =====================================================================
-- 0032  A subject is a name and a code. Nothing counts its sections.
-- =====================================================================
-- The setup form asked the Cluster Head how many sections each subject
-- runs, and 0021's comment says why: it was what the Section dropdown on
-- the upload screens was to be built from.
--
-- That dropdown is gone. Since 0025 and 0027 the sections come out of the
-- ERP export itself — the consolidated file leaves the header's Section
-- field blank and puts the real section on every row, which is how a
-- student can sit in "R3" of one course and "B" of another. A number the
-- Cluster Head typed in August cannot contradict that, and if it did the
-- file would win.
--
-- So the column has no reader. Nothing joins on it, no view selects it,
-- no report counts it; the three screens that showed "Sections A, B" were
-- reading it back to the person who typed it. It goes, rather than
-- staying behind as a not-null field the form no longer fills.
--
-- student_course_sections is untouched: that is the real mapping, learned
-- from the uploads, and it is what every section-aware query uses.
-- =====================================================================

alter table public.cluster_head_courses
  drop column if exists section_count;

comment on table public.cluster_head_courses is
  'The subjects a Cluster Head handles: course name and course code. Sections are not declared here — they are learned from the attendance export, in student_course_sections.';


-- ---------------------------------------------------------------------
-- The setup form's writer, without the third question
-- ---------------------------------------------------------------------
create or replace function public.submit_cluster_head_setup(p_courses jsonb)
returns setof public.cluster_head_courses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item   jsonb;
  v_index  smallint := 0;
  v_name   text;
  v_code   text;
  v_seen   text[] := array[]::text[];
begin
  if not public.is_cluster_head() then
    raise exception 'Only a cluster head can submit the cluster head setup form'
      using errcode = '42501';
  end if;
  if p_courses is null or jsonb_typeof(p_courses) <> 'array' or jsonb_array_length(p_courses) = 0 then
    raise exception 'Add at least one subject before submitting' using errcode = '22023';
  end if;
  if jsonb_array_length(p_courses) > 60 then
    raise exception 'That is more subjects than one cluster head can handle (limit 60)' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_courses)
  loop
    v_name := btrim(coalesce(v_item ->> 'course_name', ''));
    v_code := btrim(coalesce(v_item ->> 'course_code', ''));

    if v_name = '' or v_code = '' then
      raise exception 'Every subject needs both a course name and a course code' using errcode = '22023';
    end if;
    if lower(v_code) = any (v_seen) then
      raise exception 'Course code "%" appears more than once', v_code using errcode = '22023';
    end if;
    v_seen := v_seen || lower(v_code);
  end loop;

  -- Replace the list wholesale. ON DELETE CASCADE would take the section
  -- mapping and attendance with it, so only codes that actually went away
  -- are removed.
  delete from public.cluster_head_courses
   where cluster_head_id = auth.uid()
     and lower(course_code) <> all (v_seen);

  for v_item in select * from jsonb_array_elements(p_courses)
  loop
    v_index := v_index + 1;
    insert into public.cluster_head_courses (cluster_head_id, course_name, course_code, display_order)
    values (
      auth.uid(),
      btrim(v_item ->> 'course_name'),
      btrim(v_item ->> 'course_code'),
      v_index
    )
    on conflict (cluster_head_id, lower(course_code)) do update
      set course_name   = excluded.course_name,
          display_order = excluded.display_order,
          updated_at    = now();
  end loop;

  -- cluster_head_setup_completed is a protected column, so the
  -- trusted-operation flag has to be raised and cleared around the write.
  perform set_config('ssmp.trusted_operation', 'on', true);
  update public.user_profiles
     set cluster_head_setup_completed    = true,
         cluster_head_setup_completed_at = coalesce(cluster_head_setup_completed_at, now())
   where id = auth.uid();
  perform set_config('ssmp.trusted_operation', 'off', true);

  return query
    select * from public.cluster_head_courses
     where cluster_head_id = auth.uid()
     order by display_order;
end;
$$;

revoke all on function public.submit_cluster_head_setup(jsonb) from public, anon;
grant execute on function public.submit_cluster_head_setup(jsonb) to authenticated;
