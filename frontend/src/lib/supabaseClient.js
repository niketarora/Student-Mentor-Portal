/**
 * supabaseClient.js
 * The single Supabase browser client for the whole app.
 *
 * SECURITY NOTE — session storage
 * ------------------------------------------------------------------
 * The previous Express backend kept its JWT in an HttpOnly cookie, which
 * JavaScript cannot read. A static SPA talking straight to Supabase can't
 * do that: the access token has to be readable by JS to be attached to
 * PostgREST and Realtime requests. This is an accepted, deliberate
 * trade-off of the Supabase-Auth-on-the-client architecture, and it is
 * mitigated by:
 *
 *   1. Short-lived access tokens (1 hour) with refresh-token rotation.
 *   2. Row Level Security on every table, so a stolen token is still
 *      confined to exactly what that one user was already allowed to see.
 *   3. A strict Content-Security-Policy and zero use of
 *      dangerouslySetInnerHTML anywhere in this codebase, which is what
 *      keeps an attacker from running JS here in the first place.
 *   4. The service-role key never reaching the browser — privileged work
 *      happens in Vercel serverless functions.
 *
 * See docs/SECURITY.md for the full write-up.
 */

import { createClient } from '@supabase/supabase-js';

// Strip ALL whitespace, not just the ends: neither a project URL nor a JWT
// ever contains one, but pasting a 900-character key into an env file very
// often wraps it. The result is an "invalid header value" error on a screen
// that has nothing to do with configuration.
const clean = (value) => String(value ?? '').replace(/\s+/g, '');

const supabaseUrl = clean(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, '');
const supabaseAnonKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY);

// Fail loudly at boot rather than throwing a confusing error on first login.
if (!supabaseUrl || !supabaseAnonKey) {
  const message =
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Copy frontend/.env.example to frontend/.env.local and fill both in.';
  document.body.innerHTML =
    `<pre style="padding:32px;font:14px/1.6 monospace;color:#ba1a1a;white-space:pre-wrap">${message}</pre>`;
  throw new Error(message);
}

/**
 * SESSION LENGTH
 * ------------------------------------------------------------------
 * persistSession writes the session to localStorage rather than
 * sessionStorage, so closing the tab (or the whole browser) does not sign
 * anyone out — that alone was a large share of the "logged out again"
 * complaints. autoRefreshToken then swaps the 1-hour access token for a
 * fresh one in the background for as long as the refresh token lives.
 *
 * How long the refresh token lives is a SERVER setting, not a client one:
 * see [auth.sessions] in supabase/config.toml for local development, and
 * Authentication -> Sessions in the Supabase dashboard for a hosted
 * project. Both are set to a 30-day inactivity window. Nothing in this
 * file can extend a session past what the server allows.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'ssmp.auth.session'
  },
  realtime: {
    params: { eventsPerSecond: 8 }
  },
  global: {
    headers: { 'x-application-name': 'ssmp-portal' }
  }
});

/** Current access token, or null. Used when calling the serverless API. */
export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
