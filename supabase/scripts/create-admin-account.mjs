#!/usr/bin/env node
/**
 * create-admin-account.mjs
 * ---------------------------------------------------------------------
 * Creates the administrator account (migration 0039) and nothing else.
 * The administrator sees the whole department and is the only account
 * that can upload the mentor-HOD mapping, so a deployment needs one
 * before the first upload. Unlike seed-demo-accounts.mjs this is safe on
 * a real project: it touches one account and no data.
 *
 *   npm run db:admin
 *
 * Signs in with the shared temporary password (SSMP_TEMPORARY_PASSWORD,
 * the same one every new account gets) and, like every account created
 * from the portal, is asked to choose its own password at first sign-in.
 *
 * Safe to run more than once. If the address already has an account:
 *   - the administrator: nothing to do;
 *   - an account this script made that is not yet the administrator (an
 *     earlier run stopped part-way): it is finished;
 *   - faculty, a HOD or a cluster head with no mentees: made the
 *     administrator;
 *   - a student: refused. Set SSMP_ADMIN_EMAIL to another address.
 *
 * Supabase Auth writes app_metadata after the auth user is inserted, so
 * handle_new_auth_user files a new account as a student; the role is set
 * afterwards with the service role (make-administrator.mjs).
 *
 * Requires in .env (repo root):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY      <-- server-side only, never in frontend
 *   SSMP_TEMPORARY_PASSWORD        <-- optional, the API's default otherwise
 *   SSMP_ADMIN_EMAIL               <-- optional, defaults below
 *
 * Apply migrations 0038 and 0039 first.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// The API's own reader, so the administrator gets exactly the temporary
// password every other new account gets.
const { env } = await import('../../api/_lib/environment.js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN = {
  email: (process.env.SSMP_ADMIN_EMAIL || 'smp.admin@jaipur.manipal.edu').trim().toLowerCase(),
  full_name: 'SMP Admin',
  login_id: 'ADM001'
};

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('\n  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('  Copy .env.example to .env and fill both in first.\n');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  const { data: existing, error: lookupError } = await db
    .from('user_profiles')
    .select('id, role, email')
    .ilike('email', ADMIN.email)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing) {
    if (existing.role === 'admin') {
      console.log(`\n  = ${ADMIN.email} is already the administrator. Nothing to do.\n`);
      return;
    }

    if (existing.role === 'student') {
      const { data: auth, error: authLookupError } = await db.auth.admin.getUserById(existing.id);
      if (authLookupError) throw authLookupError;
      // Made by an earlier run of this script (or the demo seed) and filed
      // as a student by Supabase Auth: finish it. A real student never asked
      // for the administrator role, and is left alone.
      if (!wasCreatedAsAdministrator(auth?.user)) {
        throw new Error(`${ADMIN.email} belongs to a student. Set SSMP_ADMIN_EMAIL to another address.`);
      }
      await makeAdministrator(db, existing.id);
      console.log(`\n  ~ Finished setting up the administrator: ${ADMIN.email}`);
      console.log('    Sign in with the temporary password; you will be asked to choose your own.\n');
      return;
    }

    const { count, error: countError } = await db
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_mentor_id', existing.id);
    if (countError) throw countError;
    if (count) {
      throw new Error(`${ADMIN.email} mentors ${count} student(s). Move them to another mentor first.`);
    }
    await makeAdministrator(db, existing.id);
    console.log(`\n  ~ ${ADMIN.email} was a ${existing.role} account and is now the administrator.\n`);
    return;
  }

  const { data: created, error } = await db.auth.admin.createUser({
    email: ADMIN.email,
    password: env.TEMPORARY_PASSWORD,
    email_confirm: true,
    user_metadata: {
      role: 'admin',
      full_name: ADMIN.full_name,
      login_id: ADMIN.login_id,
      department: 'IoT & IS',
      must_change_password: true
    },
    app_metadata: { role: 'admin' }
  });
  if (error) throw error;

  // handle_new_auth_user has filed the account as a student (see the
  // header); this makes it the administrator. Should it fail, running the
  // script again finishes the account.
  await makeAdministrator(db, created.user.id);

  console.log(`\n  + Created the administrator: ${ADMIN.email}`);
  console.log('    Sign in with the temporary password; you will be asked to choose your own.\n');
}

main().catch((error) => {
  console.error(`\n  Could not create the administrator: ${error.message}\n`);
  process.exit(1);
});
