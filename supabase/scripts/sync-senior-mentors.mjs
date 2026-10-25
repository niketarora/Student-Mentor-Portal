#!/usr/bin/env node
/**
 * sync-senior-mentors.mjs
 * ---------------------------------------------------------------------
 * Makes the senior mentors in Supabase match the senior list file
 * (migration 0042). Edit the file, run this, and it adds and removes:
 *
 *   npm run db:seniors              apply the list
 *   npm run db:seniors -- --dry-run show what would change, change nothing
 *
 * Nobody is removed while a line of the list is not an e-mail address, or
 * when the list is empty (unless -- --allow-empty is given): removing
 * deletes accounts.
 *
 * The list: supabase/senior-mentors.txt (not committed; it holds real
 * e-mail addresses). One senior per line, optionally with their name:
 *
 *   senior.one@muj.manipal.edu
 *   senior.two@muj.manipal.edu, Asha Verma
 *   # a line starting with # is ignored
 *
 * For each address in the list:
 *   - no account yet: a student account is created on the shared
 *     temporary password (SSMP_TEMPORARY_PASSWORD), with a forced change
 *     at first sign-in, and made a senior mentor;
 *   - a student account already: it is made a senior mentor;
 *   - a staff account (faculty, HOD, ...): refused, it is reported.
 *
 * For each senior no longer in the list:
 *   - the queries juniors sent them move to each junior's faculty mentor,
 *     with a note in the conversation; their sections are freed;
 *   - an account this script created is deleted;
 *   - an account that existed before (a student already in the portal)
 *     is kept and simply stops being a senior.
 *   A query whose student has no faculty mentor cannot move; the senior is
 *   then kept as a senior and reported, so nothing is lost.
 *
 * Seniors are full student accounts: Form A and the profile photo apply
 * to them as to any student. A HOD then gives each senior their sections
 * on the Senior Mentors page.
 *
 * Requires in .env (repo root):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY      <-- server-side only, never in frontend
 *   SSMP_TEMPORARY_PASSWORD        <-- optional, the API's default otherwise
 *   SSMP_SENIOR_LIST               <-- optional, another path for the list
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// The API's own reader, so seniors get the temporary password every other
// new account gets.
const { env } = await import('../../api/_lib/environment.js');

/** Marks an account this script created, so only those are ever deleted. */
export const CREATED_BY = 'senior-list';
const DRY_RUN = process.argv.includes('--dry-run');
const ALLOW_EMPTY = process.argv.includes('--allow-empty');
const LIST_PATH = resolve(ROOT, process.env.SSMP_SENIOR_LIST || 'supabase/senior-mentors.txt');
const EMAIL = /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/;

/**
 * The list file -> [{ email, full_name, line }], plus problems found and
 * how many lines were not an e-mail address. Exported for the tests.
 */
export function parseSeniorList(text) {
  const seniors = [];
  const problems = [];
  const seen = new Set();
  let invalid = 0;
  String(text ?? '').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const [emailPart, ...nameParts] = line.split(',');
    const email = emailPart.trim().toLowerCase();
    const full_name = nameParts.join(',').trim().replace(/\s+/g, ' ') || null;
    if (!EMAIL.test(email)) {
      problems.push(`line ${index + 1}: "${emailPart.trim()}" is not an e-mail address`);
      invalid += 1;
      return;
    }
    if (seen.has(email)) {
      problems.push(`line ${index + 1}: ${email} is listed twice; the first one is used`);
      return;
    }
    seen.add(email);
    seniors.push({ email, full_name: full_name?.slice(0, 120) ?? null, line: index + 1 });
  });
  return { seniors, problems, invalid };
}

async function listAllUsers(db) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

/** Moves a removed senior's queries to each junior's faculty mentor. */
async function handOverQueries(db, senior) {
  const { data: queries, error } = await db
    .from('support_queries')
    .select('id, query_code, student_id')
    .eq('mentor_id', senior.id)
    .eq('mentor_kind', 'senior');
  if (error) throw error;
  if (!queries?.length) return { moved: 0, stuck: 0 };

  const studentIds = [...new Set(queries.map((q) => q.student_id))];
  const { data: students, error: studentError } = await db
    .from('user_profiles')
    .select('id, full_name, assigned_mentor_id')
    .in('id', studentIds);
  if (studentError) throw studentError;
  const mentorOf = new Map((students ?? []).map((s) => [s.id, s.assigned_mentor_id]));

  const facultyIds = [...new Set([...mentorOf.values()].filter(Boolean))];
  const { data: faculty } = facultyIds.length
    ? await db.from('user_profiles').select('id, full_name, role').in('id', facultyIds)
    : { data: [] };
  const facultyById = new Map((faculty ?? []).filter((f) => f.role === 'faculty').map((f) => [f.id, f]));

  let moved = 0;
  let stuck = 0;
  for (const query of queries) {
    const to = facultyById.get(mentorOf.get(query.student_id));
    if (!to) {
      stuck += 1;
      continue;
    }
    if (DRY_RUN) {
      moved += 1;
      continue;
    }
    const { error: moveError } = await db
      .from('support_queries')
      .update({ mentor_id: to.id, mentor_kind: 'faculty', last_message_at: new Date().toISOString() })
      .eq('id', query.id);
    if (moveError) throw moveError;
    await db.from('query_messages').insert({
      query_id: query.id,
      sender_id: null,
      is_system_message: true,
      body: `${senior.full_name} is no longer a senior mentor, so this query has moved to the faculty mentor, ${to.full_name}.`
    });
    await db.from('notifications').insert({
      recipient_id: to.id,
      type: 'mentor_reassigned',
      title: `${query.query_code} moved to you`,
      body: `${senior.full_name} is no longer a senior mentor; their query from your mentee is now yours.`,
      query_id: query.id,
      link_path: `/faculty/queries/${query.id}`
    });
    moved += 1;
  }
  return { moved, stuck };
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('\n  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    console.error('  Copy .env.example to .env and fill both in first.\n');
    process.exit(1);
  }
  if (!existsSync(LIST_PATH)) {
    console.error(`\n  No senior list at ${LIST_PATH}.`);
    console.error('  Copy supabase/senior-mentors.example.txt to supabase/senior-mentors.txt and add the e-mails.\n');
    process.exit(1);
  }

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { seniors: wanted, problems, invalid } = parseSeniorList(readFileSync(LIST_PATH, 'utf8'));
  console.log(`\nSenior mentors${DRY_RUN ? ' (dry run: nothing is changed)' : ''}\n${'-'.repeat(52)}`);
  console.log(`  ${wanted.length} in ${LIST_PATH.replace(`${ROOT}/`, '')}`);
  for (const problem of problems) console.log(`  ! ${problem}`);

  const users = await listAllUsers(db);
  const userByEmail = new Map(users.map((u) => [u.email?.toLowerCase(), u]));
  const userById = new Map(users.map((u) => [u.id, u]));

  const { data: current, error: currentError } = await db
    .from('user_profiles')
    .select('id, email, full_name, role, is_senior_mentor')
    .eq('is_senior_mentor', true);
  if (currentError) throw currentError;
  const wantedEmails = new Set(wanted.map((s) => s.email));
  const tally = { created: 0, made: 0, kept: 0, removed: 0, deleted: 0, refused: 0 };

  // Removing deletes accounts, so a list that looks broken removes nobody:
  // a mistyped line could be a senior who is meant to stay.
  const leaving = (current ?? []).filter((senior) => !wantedEmails.has(senior.email?.toLowerCase()));
  let holdRemovals = null;
  if (invalid && leaving.length) {
    holdRemovals = `${invalid === 1 ? 'A line is' : `${invalid} lines are`} not an e-mail address, so nobody is removed this time. Fix the lines marked ! and run this again.`;
  } else if (!wanted.length && leaving.length && !ALLOW_EMPTY) {
    holdRemovals = `The list is empty, which would remove all ${leaving.length} senior mentor${leaving.length === 1 ? '' : 's'}. ` +
      'Nobody is removed. Add the e-mails, or run with -- --allow-empty to remove them all.';
  }

  // --- the list: create or mark -------------------------------------
  for (const spec of wanted) {
    const user = userByEmail.get(spec.email);
    if (user) {
      const { data: profile, error } = await db
        .from('user_profiles')
        .select('id, role, is_senior_mentor, full_name')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      if (!profile) {
        console.log(`  ! ${spec.email}: has a sign-in but no profile; skipped`);
        tally.refused += 1;
        continue;
      }
      if (profile.role !== 'student') {
        console.log(`  ! ${spec.email}: is a ${profile.role} account; a senior mentor must be a student account. Skipped.`);
        tally.refused += 1;
        continue;
      }
      if (profile.is_senior_mentor) {
        console.log(`  = senior    ${spec.email}`);
        tally.kept += 1;
        continue;
      }
      if (!DRY_RUN) {
        const { error: flagError } = await db.from('user_profiles').update({ is_senior_mentor: true }).eq('id', user.id);
        if (flagError) throw flagError;
      }
      console.log(`  + senior    ${spec.email} (existing student account)`);
      tally.made += 1;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  + create    ${spec.email}`);
      tally.created += 1;
      continue;
    }
    const { data: created, error: createError } = await db.auth.admin.createUser({
      email: spec.email,
      password: env.TEMPORARY_PASSWORD,
      email_confirm: true,
      user_metadata: {
        role: 'student',
        full_name: spec.full_name ?? spec.email.split('@')[0],
        department: 'IoT & IS',
        must_change_password: true
      },
      app_metadata: { created_by: CREATED_BY }
    });
    if (createError) throw new Error(`${spec.email}: ${createError.message}`);
    const { error: flagError } = await db
      .from('user_profiles')
      .update({ is_senior_mentor: true })
      .eq('id', created.user.id);
    if (flagError) throw new Error(`${spec.email}: created, but could not be made a senior: ${flagError.message}`);
    console.log(`  + created   ${spec.email}`);
    tally.created += 1;
  }

  // --- no longer listed: hand over, then delete or unmark -------------
  if (holdRemovals) {
    console.log(`  ! ${holdRemovals}`);
    tally.refused += leaving.length;
  }
  for (const senior of holdRemovals ? [] : leaving) {
    const { moved, stuck } = await handOverQueries(db, senior);
    if (stuck) {
      console.log(
        `  ! ${senior.email}: ${stuck === 1 ? '1 of their queries is' : `${stuck} of their queries are`} from students with no faculty mentor,` +
          ` so ${stuck === 1 ? 'it cannot' : 'they cannot'} move. Kept as a senior; assign those students a mentor and run this again.`
      );
      tally.refused += 1;
      continue;
    }
    const createdHere = userById.get(senior.id)?.app_metadata?.created_by === CREATED_BY;
    if (!DRY_RUN) {
      const { error: sectionError } = await db.from('senior_mentor_sections').delete().eq('senior_id', senior.id);
      if (sectionError) throw sectionError;
      if (createdHere) {
        const { error: deleteError } = await db.auth.admin.deleteUser(senior.id);
        if (deleteError) throw new Error(`${senior.email}: ${deleteError.message}`);
      } else {
        const { error: unflagError } = await db.from('user_profiles').update({ is_senior_mentor: false }).eq('id', senior.id);
        if (unflagError) throw unflagError;
      }
    }
    const note = moved ? `; ${moved} quer${moved === 1 ? 'y' : 'ies'} moved to the faculty mentors` : '';
    if (createdHere) {
      console.log(`  - deleted   ${senior.email}${note}`);
      tally.deleted += 1;
    } else {
      console.log(`  - removed   ${senior.email} (student account kept, no longer a senior)${note}`);
      tally.removed += 1;
    }
  }

  console.log(`\n  ${tally.created} created, ${tally.made} made senior, ${tally.kept} unchanged, ` +
    `${tally.deleted} deleted, ${tally.removed} no longer senior, ${tally.refused} not changed (see !).`);
  if (tally.created && !DRY_RUN) {
    console.log('  New seniors sign in with the temporary password and choose their own; Form A comes next, as for any student.');
  }
  console.log('  Next: give each senior their sections on the HOD portal, Senior Mentors.\n');
}

// Run only as a script, not when the tests import parseSeniorList.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const hint = /is_senior_mentor|senior_mentor_sections|mentor_kind/.test(error.message ?? '')
      ? ' Apply migration 0042 first (npm run db:push).'
      : '';
    console.error(`\n  Could not sync the senior mentors: ${error.message}${hint}\n`);
    process.exit(1);
  });
}
