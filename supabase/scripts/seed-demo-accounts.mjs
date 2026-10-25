#!/usr/bin/env node
/**
 * seed-demo-accounts.mjs
 * ---------------------------------------------------------------------
 * Creates the demo accounts (the administrator, 2 HODs, 3 faculty,
 * 4 students, 2 cluster heads), assigns mentors, maps the mentors to
 * their HODs, raises a few sample queries, and loads the
 * Cluster Head sample data (attendance, GPA, backlogs and black dots) so
 * every dashboard — including the At-Risk Students page and the survey
 * tracking — has something in it on first login.
 *
 * Safe to run more than once — existing accounts are reused, not
 * duplicated, and every data load is an upsert.
 *
 * All the dummy academic data lives in ONE file,
 * sample-data/cluster-head-sample-data.mjs, and is loaded here through the
 * same RPCs the portal uses. That matters: the seed exercises the real
 * upload path rather than a parallel one that could silently diverge.
 *
 * Usage:
 *   node supabase/scripts/seed-demo-accounts.mjs
 *
 * Requires in .env (repo root):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY      <-- server-side only, never in frontend
 *   SEED_DEFAULT_PASSWORD          <-- optional, defaults below
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SAMPLE_CLUSTER_HEADS,
  SAMPLE_CLUSTER_HEAD_COURSES,
  SAMPLE_CLUSTER_HEAD_2_COURSES,
  SAMPLE_HODS,
  SAMPLE_ATTENDANCE,
  SAMPLE_BACKLOG_RESULTS,
  SAMPLE_BLACK_DOT_NOTICE,
  SAMPLE_SURVEY_RESPONSES,
  sampleAttendancePeriod,
  sampleBacklogRpcArgs,
  sampleBlackDotRpcRows,
  sampleGpaRpcRows,
  sampleHodMappingRows
} from '../../sample-data/cluster-head-sample-data.mjs';
import { makeAdministrator, wasCreatedAsAdministrator } from './make-administrator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

// --- tiny .env loader so this works without extra dependencies ---------
const envPath = resolve(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.SEED_DEFAULT_PASSWORD || 'SsmpDemo@2026';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('\n  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('  Copy .env.example to .env and fill both in first.\n');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ---------------------------------------------------------------------
const DEMO_ACCOUNTS = [
  // The administrator: the whole department, and the mentor-HOD mapping
  // upload (migration 0039). npm run db:admin creates this one alone.
  { email: 'smp.admin@jaipur.manipal.edu',      role: 'admin',   full_name: 'SMP Admin',            login_id: 'ADM001',     branch: 'IoT & IS' },

  // Two HODs, each seeing only the faculty mapped to them (SAMPLE_HOD_MAPPING).
  { email: SAMPLE_HODS[0].email,                role: 'hod',     full_name: SAMPLE_HODS[0].full_name, login_id: 'HOD001',   branch: 'IoT & IS' },
  { email: SAMPLE_HODS[1].email,                role: 'hod',     full_name: SAMPLE_HODS[1].full_name, login_id: 'HOD002',   branch: 'IoT & IS' },

  { email: 'alice.smith@jaipur.manipal.edu',    role: 'faculty', full_name: 'Dr. Alice Smith',      login_id: 'FAC1001',    branch: 'CSE' },
  { email: 'bob.johnson@jaipur.manipal.edu',    role: 'faculty', full_name: 'Dr. Bob Johnson',      login_id: 'FAC1002',    branch: 'CSE' },
  { email: 'carol.williams@jaipur.manipal.edu', role: 'faculty', full_name: 'Prof. Carol Williams', login_id: 'FAC1003',    branch: 'ECE' },

  { email: 'john.doe@muj.manipal.edu',      role: 'student', full_name: 'John Doe',      login_id: '2428020221', branch: 'CSE', section: 'A', semester_label: '3rd Semester', mentor: 'alice.smith@jaipur.manipal.edu' },
  { email: 'jane.smith@muj.manipal.edu',    role: 'student', full_name: 'Jane Smith',    login_id: '2428020222', branch: 'CSE', section: 'B', semester_label: '3rd Semester', mentor: 'alice.smith@jaipur.manipal.edu' },
  { email: 'mike.davis@muj.manipal.edu',    role: 'student', full_name: 'Mike Davis',    login_id: '2428020223', branch: 'CSE', section: 'A', semester_label: '3rd Semester', mentor: 'bob.johnson@jaipur.manipal.edu' },
  { email: 'emily.wilson@muj.manipal.edu',  role: 'student', full_name: 'Emily Wilson',  login_id: '2428020224', branch: 'ECE', section: 'A', semester_label: '3rd Semester', mentor: 'carol.williams@jaipur.manipal.edu' },

  // A senior mentor (0042): a student account with the senior flag, who
  // looks after sections A3 and B3 (John, Jane, Mike). Emily has none.
  { email: 'riya.senior@muj.manipal.edu',   role: 'student', full_name: 'Riya Kapoor',   login_id: '2228020101', branch: 'CSE', semester_label: '7th Semester', senior: ['A 3', 'B 3'] },

  // Cluster Heads — upload attendance / GPA / backlogs and nothing else.
  ...SAMPLE_CLUSTER_HEADS.map((spec) => ({ ...spec, role: 'cluster_head' }))
];

const SAMPLE_QUERIES = [
  {
    student: 'john.doe@muj.manipal.edu',
    subject: 'Cannot log in to the ERP portal',
    category: 'ERP/Tech',
    priority: 'High',
    description: 'The ERP portal says invalid credentials even though I reset my password twice.',
    replies: []
  },
  {
    student: 'john.doe@muj.manipal.edu',
    subject: 'Course material missing for DBMS',
    category: 'Academic',
    priority: 'Medium',
    description: 'Could you please share the DBMS lab manuals and slides? I missed the last class.',
    replies: [
      { from: 'mentor', body: 'Hello John, I will upload them to Teams under Files by tomorrow morning.' },
      { from: 'student', body: 'Thank you ma’am, I will check there.' }
    ]
  },
  {
    student: 'emily.wilson@muj.manipal.edu',
    subject: 'Lab computer PC-12 not booting',
    category: 'Infrastructure',
    priority: 'Medium',
    description: 'PC 12 in the ECE lab does not boot, it only beeps.',
    replies: [{ from: 'mentor', body: 'I have raised this with the IT technician.' }],
    resolve: true
  }
];

// ---------------------------------------------------------------------
async function findUserByEmail(email) {
  // listUsers is paginated; the demo set is tiny so one page is enough.
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) || null;
}

async function ensureAccount(spec) {
  const existing = await findUserByEmail(spec.email);
  if (existing) {
    console.log(`  = exists   ${spec.role.padEnd(7)} ${spec.email}`);
    if (spec.role === 'admin') await ensureAdministrator(spec, existing);
    return existing.id;
  }

  const { data, error } = await db.auth.admin.createUser({
    email: spec.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      role: spec.role,
      full_name: spec.full_name,
      login_id: spec.login_id,
      branch: spec.branch ?? null,
      section: spec.section ?? null,
      semester_label: spec.semester_label ?? null,
      department: 'IoT & IS',
      must_change_password: false
    },
    app_metadata: { role: spec.role }
  });
  if (error) throw new Error(`${spec.email}: ${error.message}`);
  console.log(`  + created  ${spec.role.padEnd(7)} ${spec.email}`);
  if (spec.role === 'admin') await ensureAdministrator(spec, data.user);
  return data.user.id;
}

/**
 * Supabase Auth writes app_metadata after inserting the auth user, so
 * handle_new_auth_user files the administrator as a student; this sets
 * the role (make-administrator.mjs). It also finishes an administrator
 * left as a student by an earlier run.
 */
async function ensureAdministrator(spec, authUser) {
  const { data: profile, error } = await db.from('user_profiles').select('role').eq('id', authUser.id).maybeSingle();
  if (error) throw error;
  if (profile?.role === 'admin') return;
  if (!wasCreatedAsAdministrator(authUser)) {
    throw new Error(`${spec.email} already belongs to a ${profile?.role ?? 'different'} account, not the administrator.`);
  }
  await makeAdministrator(db, authUser.id);
  console.log(`  ~ promoted ${spec.role.padEnd(7)} ${spec.email}`);
}

async function main() {
  console.log('\nSeeding SSMP demo accounts\n' + '-'.repeat(52));

  const idByEmail = {};
  for (const spec of DEMO_ACCOUNTS) {
    idByEmail[spec.email] = await ensureAccount(spec);
  }

  // The auth trigger writes the profile row; give it a beat on cold projects.
  await new Promise((r) => setTimeout(r, 1200));

  console.log('\nAssigning mentors');
  for (const spec of DEMO_ACCOUNTS.filter((a) => a.mentor)) {
    const { error } = await db
      .from('user_profiles')
      .update({ assigned_mentor_id: idByEmail[spec.mentor] })
      .eq('id', idByEmail[spec.email]);
    if (error) throw error;
    console.log(`  ${spec.full_name} -> ${spec.mentor}`);
  }

  // Through the RPC behind the administrator's Upload page. The service
  // role has no auth.uid(), which map_faculty_to_hods() accepts as a
  // trusted server call.
  console.log('\nMapping mentors to their HOD');
  {
    const { data, error } = await db.rpc('map_faculty_to_hods', { p_rows: sampleHodMappingRows() });
    if (error) throw error;
    console.log(`  ${data.mapped} mapped, ${data.unchanged} already mapped, ${data.failed} failed, across ${data.hods} HOD(s)`);
  }

  // The senior flag and sections are written with the service role, as
  // npm run db:seniors and the Senior Mentors page would (0042).
  console.log('\nSetting up the senior mentor');
  for (const spec of DEMO_ACCOUNTS.filter((a) => a.senior)) {
    const seniorId = idByEmail[spec.email];
    const { error: flagError } = await db.from('user_profiles').update({ is_senior_mentor: true }).eq('id', seniorId);
    if (flagError) throw flagError;
    for (const section of spec.senior) {
      const { error } = await db.from('senior_mentor_sections').upsert({ section, senior_id: seniorId }, { onConflict: 'section' });
      if (error) throw error;
    }
    console.log(`  ${spec.full_name}: senior mentor for ${spec.senior.map((s) => s.replace(' ', '')).join(', ')}`);

    const subject = 'Which electives count for the IoT minor?';
    const studentId = idByEmail['jane.smith@muj.manipal.edu'];
    const { data: existing } = await db.from('support_queries').select('id').eq('student_id', studentId).eq('subject', subject).maybeSingle();
    if (!existing) {
      const { data: query, error } = await db
        .from('support_queries')
        .insert({ student_id: studentId, mentor_id: seniorId, mentor_kind: 'senior', subject, category: 'Academics', priority: 'Medium' })
        .select()
        .single();
      if (error) throw error;
      await db.from('query_messages').insert({
        query_id: query.id,
        sender_id: studentId,
        body: 'Which electives did you take for the IoT minor, and did all of them count?'
      });
      console.log(`  + ${query.query_code}  ${subject} (Jane -> ${spec.full_name})`);
    }
  }

  console.log('\nCreating sample queries');
  for (const t of SAMPLE_QUERIES) {
    const studentId = idByEmail[t.student];
    const mentorEmail = DEMO_ACCOUNTS.find((a) => a.email === t.student).mentor;
    const mentorId = idByEmail[mentorEmail];

    const { data: dupe } = await db
      .from('support_queries')
      .select('id')
      .eq('student_id', studentId)
      .eq('subject', t.subject)
      .maybeSingle();
    if (dupe) {
      console.log(`  = exists   ${t.subject}`);
      continue;
    }

    const { data: query, error } = await db
      .from('support_queries')
      .insert({
        student_id: studentId,
        mentor_id: mentorId,
        subject: t.subject,
        category: t.category,
        priority: t.priority
      })
      .select()
      .single();
    if (error) throw error;

    const messages = [{ query_id: query.id, sender_id: studentId, body: t.description }];
    for (const r of t.replies) {
      messages.push({
        query_id: query.id,
        sender_id: r.from === 'mentor' ? mentorId : studentId,
        body: r.body
      });
    }
    const { error: msgErr } = await db.from('query_messages').insert(messages);
    if (msgErr) throw msgErr;

    if (t.replies.length) {
      await db
        .from('support_queries')
        .update({ status: 'In Progress', first_response_at: new Date().toISOString() })
        .eq('id', query.id);
    }
    if (t.resolve) {
      await db
        .from('support_queries')
        .update({
          status: 'Resolved',
          resolution_status: 'pending_confirmation',
          resolved_by: mentorId,
          resolved_at: new Date().toISOString()
        })
        .eq('id', query.id);
    }
    console.log(`  + ${query.query_code}  ${t.subject}`);
  }

  console.log('\nAdding shared canned replies for faculty');
  const cannedDefaults = [
    { title: 'Acknowledged', body: 'Thank you for reaching out. I have received your request and will look into it shortly.' },
    { title: 'Need more detail', body: 'Could you share a screenshot or a few more details so I can help you faster?' },
    { title: 'Escalated to IT', body: 'I have escalated this to the IT helpdesk. I will update you as soon as I hear back.' },
    { title: 'Meet in person', body: 'Please drop by my cabin during office hours so we can go through this together.' }
  ];
  for (const c of cannedDefaults) {
    const { data: found } = await db
      .from('canned_replies').select('id').eq('title', c.title).eq('is_global', true).maybeSingle();
    if (!found) await db.from('canned_replies').insert({ ...c, is_global: true, owner_id: null });
  }

  await seedClusterHeadData(idByEmail);

  console.log('\n' + '='.repeat(64));
  console.log('Demo accounts ready. Password for all: ' + PASSWORD);
  console.log('='.repeat(64));
  for (const a of DEMO_ACCOUNTS) {
    console.log(`  ${a.role.padEnd(13)} ${a.email}`);
  }
  console.log('');
  console.log(`HOD scope demo: ${SAMPLE_HODS[0].full_name} sees Alice and Bob (John, Jane, Mike); ${SAMPLE_HODS[1].full_name} sees Carol (Emily).`);
  console.log('Senior mentor demo: Riya Kapoor (a student account) looks after A3 and B3, so John, Jane and Mike can send her queries; Emily cannot.');
  console.log('At-risk demo: John Doe (attendance), Jane Smith (GPA), Mike Davis (backlog).');
  console.log('Emily Wilson cleared her backlog at the make-up, so she is deliberately NOT flagged.');
  console.log('John Doe and Jane Smith each have a black dot, which is also an at-risk reason in its academic cycle.');
  console.log('Fire the 15-day jobs by hand from the administrator or HOD portal -> Scheduled Jobs.\n');
}

/**
 * Loads the Cluster Head sample data through the real RPCs.
 *
 * The service role has no auth.uid(), which the record_*_batch functions
 * treat as a trusted server call — the same escape hatch migrations and
 * the SQL console use. So this exercises the genuine upload path, and any
 * change that breaks a real upload breaks the seed too.
 */
async function seedClusterHeadData(idByEmail) {
  const head1 = idByEmail[SAMPLE_CLUSTER_HEADS[0].email];
  const head2 = idByEmail[SAMPLE_CLUSTER_HEADS[1].email];
  if (!head1) {
    console.log('\nSkipping cluster head sample data (no cluster head account).');
    return;
  }

  // Subjects belong to an academic cycle (migration 0036): the same code
  // appears once per cycle, and uploads go into the active one. Migration
  // 0036 creates the first cycle, so there is always one active.
  const { data: activeCycle, error: cycleError } = await db
    .from('academic_cycles')
    .select('id, label')
    .eq('is_active', true)
    .maybeSingle();
  if (cycleError) throw cycleError;
  if (!activeCycle) throw new Error('No active academic cycle. Apply migration 0036 before seeding.');

  console.log(`\nSetting up cluster head subjects for ${activeCycle.label}`);
  const courseIdByCode = {};

  for (const [ownerId, courses] of [
    [head1, SAMPLE_CLUSTER_HEAD_COURSES],
    [head2, SAMPLE_CLUSTER_HEAD_2_COURSES]
  ]) {
    if (!ownerId) continue;
    for (const [index, course] of courses.entries()) {
      // Written directly rather than through submit_cluster_head_setup(),
      // which keys off auth.uid() and so cannot act on someone else's
      // behalf. Upsert on the same unique key the RPC uses: cluster head,
      // cycle and code. The insert below is filed under the active cycle
      // by a trigger.
      const { data: existing, error: lookupError } = await db
        .from('cluster_head_courses')
        .select('id')
        .eq('cluster_head_id', ownerId)
        .eq('cycle_id', activeCycle.id)
        .ilike('course_code', course.course_code)
        .maybeSingle();
      if (lookupError) throw lookupError;

      if (existing) {
        courseIdByCode[course.course_code] = existing.id;
        continue;
      }

      const { data, error } = await db
        .from('cluster_head_courses')
        .insert({ cluster_head_id: ownerId, ...course, display_order: index + 1 })
        .select('id')
        .single();
      if (error) throw error;
      courseIdByCode[course.course_code] = data.id;
      console.log(`  + ${course.course_name} (${course.course_code})`);
    }

    // cluster_head_setup_completed is a protected column; a service-role
    // write has auth.uid() = null, which the guard trigger permits.
    const { error: flagError } = await db
      .from('user_profiles')
      .update({ cluster_head_setup_completed: true, cluster_head_setup_completed_at: new Date().toISOString() })
      .eq('id', ownerId);
    if (flagError) throw flagError;
  }

  console.log('\nUploading sample attendance');
  const period = sampleAttendancePeriod();
  for (const block of SAMPLE_ATTENDANCE) {
    // Course, name and section are passed the way the real upload passes
    // them — read out of the file header rather than picked from a list.
    if (!courseIdByCode[block.course_code]) continue;
    const { data, error } = await db.rpc('record_attendance_batch', {
      p_course_code: block.course_code,
      p_course_name: block.course_name,
      p_section: block.section,
      p_period_start: period.period_start,
      p_period_end: period.period_end,
      p_filename: `attendance-${block.course_code}-${block.section}-sample.csv`,
      p_rows: block.rows
    });
    if (error) throw error;
    console.log(`  ${block.course_code} section ${block.section}: ${data.matched} recorded, ${data.failed} failed`);
  }

  console.log('\nUploading sample GPA (CGPA / GPA & Credits export)');
  {
    const { data, error } = await db.rpc('record_gpa_batch', {
      p_semester_number: null,
      p_filename: 'gpa-cgpa-credits-sample.xls',
      p_rows: sampleGpaRpcRows()
    });
    if (error) throw error;
    console.log(
      `  Semesters ${(data.semesters ?? []).join(', ')}: ${data.matched} student(s), ` +
        `${data.cgpa_recorded} CGPA, ${data.failed} failed`
    );
  }

  // In order: the end-term defaulter list, then the make-up one, which no
  // longer lists Emily and so clears her backlog.
  console.log('\nUploading sample backlogs (Defaulter Grade results)');
  for (const result of SAMPLE_BACKLOG_RESULTS) {
    const { data, error } = await db.rpc('record_backlog_batch', sampleBacklogRpcArgs(result));
    if (error) throw error;
    console.log(
      `  ${result.exam_session}: ${data.backlogs_recorded} open, ${data.backlogs_cleared} cleared, ${data.failed} failed`
    );
  }

  console.log('\nUploading the sample black dot notice');
  {
    const { data, error } = await db.rpc('record_black_dot_batch', {
      p_filename: SAMPLE_BLACK_DOT_NOTICE.file,
      p_rows: sampleBlackDotRpcRows()
    });
    if (error) throw error;
    // One row is a student from outside the portal, reported back on purpose.
    console.log(`  ${data.matched} black dot(s) across ${data.cases} case(s), ${data.failed} not in the portal`);
  }

  // The uploads above already re-evaluated everyone they touched. Running
  // the sweep explicitly makes the seeded state match what the 15-day job
  // would produce, and raises the meetings.
  console.log('\nRunning the at-risk sweep and meeting dispatch');
  for (const jobType of ['at_risk_sweep', 'at_risk_meeting_dispatch']) {
    const { data, error } = await db.rpc('run_cycle_job', {
      p_job_type: jobType,
      p_trigger: 'manual',
      p_note: 'seeded demo data'
    });
    if (error) throw error;
    console.log(`  ${jobType}: ${JSON.stringify(data.result)}`);
  }

  console.log('\nOpening a survey cycle');
  const { data: surveyRun, error: surveyError } = await db.rpc('run_cycle_job', {
    p_job_type: 'survey_cycle',
    p_trigger: 'manual',
    p_note: 'seeded demo data'
  });
  if (surveyError) throw surveyError;
  console.log(`  Cycle #${surveyRun.result?.cycle_number} open`);

  // Two of four students answer, so completion tracking reads 2/4 rather
  // than 0 or 100 — both of which would hide a counting bug.
  const { data: cycle } = await db
    .from('survey_cycles')
    .select('id')
    .eq('is_active', true)
    .maybeSingle();

  if (cycle) {
    console.log('\nRecording sample survey responses');
    const { data: questions } = await db
      .from('survey_questions')
      .select('id, question_number')
      .order('question_number');

    for (const sample of SAMPLE_SURVEY_RESPONSES) {
      const { data: student } = await db
        .from('user_profiles')
        .select('id, full_name, assigned_mentor_id')
        .eq('login_id', sample.registration_no)
        .maybeSingle();
      if (!student) continue;

      const { data: existing } = await db
        .from('survey_responses')
        .select('id')
        .eq('cycle_id', cycle.id)
        .eq('student_id', student.id)
        .maybeSingle();
      if (existing) {
        console.log(`  = exists   ${student.full_name}`);
        continue;
      }

      const { data: response, error: responseError } = await db
        .from('survey_responses')
        .insert({ cycle_id: cycle.id, student_id: student.id, mentor_id: student.assigned_mentor_id })
        .select('id')
        .single();
      if (responseError) throw responseError;

      const { error: answerError } = await db.from('survey_response_answers').insert(
        (questions ?? []).map((question, index) => ({
          response_id: response.id,
          question_id: question.id,
          rating: sample.ratings[index] ?? 4
        }))
      );
      if (answerError) throw answerError;
      console.log(`  + ${student.full_name} submitted`);
    }
  }
}

main().catch((err) => {
  console.error('\nSeeding failed:', err.message || err);
  process.exit(1);
});
