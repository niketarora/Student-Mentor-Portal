-- =====================================================================
-- seed.sql — LOCAL DEVELOPMENT ONLY (supabase db reset)
-- =====================================================================
-- Creates auth users directly, which is only appropriate against a local
-- Supabase stack. For a hosted project use:
--     node supabase/scripts/seed-demo-accounts.mjs
-- which goes through the official Admin API.
--
-- Password for every seeded account: SsmpDemo@2026
-- =====================================================================

do $$
declare
  v_password_hash text := extensions.crypt('SsmpDemo@2026', extensions.gen_salt('bf'));
  v_admin     uuid := '11111111-1111-1111-1111-1111111111a1';
  v_hod       uuid := '11111111-1111-1111-1111-111111111111';
  v_hod2      uuid := '11111111-1111-1111-1111-111111111112';
  v_faculty1  uuid := '22222222-2222-2222-2222-222222222221';
  v_faculty2  uuid := '22222222-2222-2222-2222-222222222222';
  v_faculty3  uuid := '22222222-2222-2222-2222-222222222223';
  v_student1  uuid := '33333333-3333-3333-3333-333333333331';
  v_student2  uuid := '33333333-3333-3333-3333-333333333332';
  v_student3  uuid := '33333333-3333-3333-3333-333333333333';
  v_student4  uuid := '33333333-3333-3333-3333-333333333334';
  -- A senior mentor (0042): a student account with the senior flag.
  v_senior    uuid := '33333333-3333-3333-3333-3333333333a1';
  v_query     uuid;
  r record;
begin
  for r in
    select * from (values
      (v_admin,    'smp.admin@jaipur.manipal.edu',      'admin',   'SMP Admin',            'ADM001',     'IoT & IS', null::text, null::text, null::uuid),
      (v_hod,      'hod.iotis@jaipur.manipal.edu',      'hod',     'Dr. Sarah Jenkins',    'HOD001',     'IoT & IS', null, null, null),
      (v_hod2,     'hod2.iotis@jaipur.manipal.edu',     'hod',     'Dr. Vikram Rao',       'HOD002',     'IoT & IS', null, null, null),
      (v_faculty1, 'alice.smith@jaipur.manipal.edu',    'faculty', 'Dr. Alice Smith',      'FAC1001',    'CSE',      null, null, null),
      (v_faculty2, 'bob.johnson@jaipur.manipal.edu',    'faculty', 'Dr. Bob Johnson',      'FAC1002',    'CSE',      null, null, null),
      (v_faculty3, 'carol.williams@jaipur.manipal.edu', 'faculty', 'Prof. Carol Williams', 'FAC1003',    'ECE',      null, null, null),
      (v_student1, 'john.doe@muj.manipal.edu',          'student', 'John Doe',             '2428020221', 'CSE',      'A', '3rd Semester', v_faculty1),
      (v_student2, 'jane.smith@muj.manipal.edu',        'student', 'Jane Smith',           '2428020222', 'CSE',      'B', '3rd Semester', v_faculty1),
      (v_student3, 'mike.davis@muj.manipal.edu',        'student', 'Mike Davis',           '2428020223', 'CSE',      'A', '3rd Semester', v_faculty2),
      (v_student4, 'emily.wilson@muj.manipal.edu',      'student', 'Emily Wilson',         '2428020224', 'ECE',      'A', '3rd Semester', v_faculty3),
      (v_senior,   'riya.senior@muj.manipal.edu',       'student', 'Riya Kapoor',          '2228020101', 'CSE',      null, '7th Semester', null)
    ) as t(id, email, role, full_name, login_id, branch, section, semester_label, mentor_id)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated',
      r.email, v_password_hash, now(),
      jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', r.role),
      jsonb_build_object(
        'role', r.role, 'full_name', r.full_name, 'login_id', r.login_id,
        'branch', r.branch, 'section', r.section, 'semester_label', r.semester_label,
        'department', 'IoT & IS', 'must_change_password', false),
      now(), now(), '', '', '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      extensions.gen_random_uuid(), r.id, r.id::text,
      jsonb_build_object('sub', r.id::text, 'email', r.email, 'email_verified', true),
      'email', now(), now(), now()
    ) on conflict do nothing;

    if r.mentor_id is not null then
      update public.user_profiles set assigned_mentor_id = r.mentor_id where id = r.id;
    end if;
  end loop;

  -- mentor-HOD mapping (0039): Sarah Jenkins has Alice and Bob, Vikram
  -- Rao has Carol; the administrator sees everyone. The same rows as
  -- sample-data/generated/mentor-hod-mapping-sample.csv.
  perform public.map_faculty_to_hods(jsonb_build_array(
    jsonb_build_object('row', 2, 'section', 'A 3', 'designation', 'Mentor',
                       'mentor_email', 'alice.smith@jaipur.manipal.edu', 'hod_email', 'hod.iotis@jaipur.manipal.edu'),
    jsonb_build_object('row', 3, 'section', 'B 3', 'designation', 'Mentor',
                       'mentor_email', 'bob.johnson@jaipur.manipal.edu', 'hod_email', 'hod.iotis@jaipur.manipal.edu'),
    jsonb_build_object('row', 4, 'section', 'A 4', 'designation', 'Class Coordinator (fallback)',
                       'mentor_email', 'carol.williams@jaipur.manipal.edu', 'hod_email', 'hod2.iotis@jaipur.manipal.edu')
  ));

  -- senior mentor (0042): Riya looks after A3 (Alice: John, Jane) and
  -- B3 (Bob: Mike). Emily (A4) has no senior, so she sees the notice.
  update public.user_profiles set is_senior_mentor = true where id = v_senior;
  insert into public.senior_mentor_sections (section, senior_id, assigned_by)
  values ('A 3', v_senior, v_hod), ('B 3', v_senior, v_hod)
  on conflict (section) do nothing;

  -- Jane asks Riya; Mike's query to Riya was escalated to the HOD.
  if not exists (select 1 from public.support_queries where subject = 'Which electives count for the IoT minor?') then
    insert into public.support_queries (student_id, mentor_id, mentor_kind, subject, category, priority, status)
    values (v_student2, v_senior, 'senior', 'Which electives count for the IoT minor?', 'Academics', 'Medium', 'Open')
    returning id into v_query;
    insert into public.query_messages (query_id, sender_id, body)
    values (v_query, v_student2, 'Which electives did you take for the IoT minor, and did all of them count?');
  end if;
  if not exists (select 1 from public.support_queries where subject = 'Lab locked in the evenings') then
    insert into public.support_queries (student_id, mentor_id, mentor_kind, subject, category, priority, status,
                                        first_response_at, escalated_to_hod, escalated_at, escalated_by, escalation_source)
    values (v_student3, v_senior, 'senior', 'Lab locked in the evenings', 'Administrative', 'Medium', 'In Progress',
            now(), true, now(), v_senior, 'senior')
    returning id into v_query;
    insert into public.query_messages (query_id, sender_id, body, is_system_message) values
      (v_query, v_student3, 'The IoT lab is locked after 5 pm, but our project slots are in the evening.', false),
      (v_query, v_senior,   'I will check who keeps the keys.', false),
      (v_query, v_senior,   'Riya Kapoor (senior mentor) escalated this query to the HOD.', true);
    insert into public.query_escalations (query_id, raised_by, raised_by_kind, raised_to, reason)
    values (v_query, v_senior, 'senior', 'hod', 'Only the HOD can approve evening lab access; I do not know who to ask.');
  end if;

  -- sample queries ----------------------------------------------------
  insert into public.support_queries (student_id, mentor_id, subject, category, priority, status)
  select v_student1, v_faculty1, 'Cannot log in to the ERP portal', 'ERP/Tech', 'High', 'Open'
  where not exists (select 1 from public.support_queries where subject = 'Cannot log in to the ERP portal');

  insert into public.support_queries (student_id, mentor_id, subject, category, priority, status)
  select v_student4, v_faculty3, 'Lab computer PC-12 not booting', 'Infrastructure', 'Medium', 'Open'
  where not exists (select 1 from public.support_queries where subject = 'Lab computer PC-12 not booting');

  insert into public.query_messages (query_id, sender_id, body)
  select t.id, t.student_id, 'The ERP portal says invalid credentials even though I reset my password twice.'
    from public.support_queries t
   where t.subject = 'Cannot log in to the ERP portal'
     and not exists (select 1 from public.query_messages m where m.query_id = t.id);

  insert into public.query_messages (query_id, sender_id, body)
  select t.id, t.student_id, 'PC 12 in the ECE lab does not boot, it only beeps.'
    from public.support_queries t
   where t.subject = 'Lab computer PC-12 not booting'
     and not exists (select 1 from public.query_messages m where m.query_id = t.id);

  -- shared canned replies --------------------------------------------
  insert into public.canned_replies (owner_id, title, body, is_global)
  select null, v.title, v.body, true
  from (values
    ('Acknowledged',    'Thank you for reaching out. I have received your request and will look into it shortly.'),
    ('Need more detail','Could you share a screenshot or a few more details so I can help you faster?'),
    ('Escalated to IT', 'I have escalated this to the IT helpdesk. I will update you as soon as I hear back.'),
    ('Meet in person',  'Please drop by my cabin during office hours so we can go through this together.')
  ) as v(title, body)
  where not exists (select 1 from public.canned_replies c where c.title = v.title and c.is_global);
end $$;
