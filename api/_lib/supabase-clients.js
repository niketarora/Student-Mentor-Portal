/**
 * supabase-clients.js
 * Two clients, two very different trust levels.
 *
 *  createAdminClient()  — service_role key. Bypasses RLS entirely.
 *                         Only ever constructed inside a serverless
 *                         function, never sent to the browser.
 *
 *  createUserClient(jwt) — the caller's own access token. RLS applies, so
 *                         even a bug in this layer cannot leak another
 *                         user's rows. Prefer this whenever the operation
 *                         does not genuinely need elevated rights.
 */

import { createClient } from '@supabase/supabase-js';
import { env } from './environment.js';

const NO_SESSION = { auth: { autoRefreshToken: false, persistSession: false } };

export function createAdminClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, NO_SESSION);
}

export function createUserClient(accessToken) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...NO_SESSION,
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}
