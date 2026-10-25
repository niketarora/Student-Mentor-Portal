/**
 * environment.js
 * Reads and validates every server-side environment variable exactly once,
 * at module load. If something required is missing the function crashes
 * immediately with a clear message instead of silently falling back to a
 * default — the exact failure mode called out in the Phase 1 review.
 */

/**
 * Strips ALL whitespace, not just the ends.
 *
 * Supabase URLs and JWT keys never legitimately contain a space, tab or
 * newline — but pasting a 900-character key into a dashboard textarea very
 * often introduces one in the middle. Node's fetch then rejects the header
 * with "... is an invalid header value", which surfaces as a baffling error
 * on an unrelated screen. Removing whitespace here makes that impossible.
 */
function sanitizeSecret(value) {
  return String(value ?? '').replace(/\s+/g, '');
}

function required(name, { secret = true } = {}) {
  const raw = process.env[name];
  const value = secret ? sanitizeSecret(raw) : String(raw ?? '').trim();

  if (!value) {
    throw new Error(
      `FATAL: required environment variable ${name} is not set. ` +
        'Add it in Vercel → Project → Settings → Environment Variables (or your local .env).'
    );
  }
  return value;
}

function optional(name, fallback = '') {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

/** A Supabase key is a JWT: three dot-separated base64url segments. */
function assertLooksLikeKey(name, value) {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(
      `FATAL: ${name} does not look like a Supabase API key. ` +
        'Copy it again from Project Settings → API Keys, making sure the whole value is on one line.'
    );
  }
  return value;
}

function assertLooksLikeUrl(name, value) {
  if (!/^https?:\/\/[^\s/]+$/.test(value.replace(/\/+$/, ''))) {
    throw new Error(
      `FATAL: ${name} must be your Supabase project URL, e.g. https://abcdefgh.supabase.co`
    );
  }
  return value.replace(/\/+$/, '');
}

export const env = {
  get SUPABASE_URL() {
    return assertLooksLikeUrl('SUPABASE_URL', required('SUPABASE_URL'));
  },
  get SUPABASE_SERVICE_ROLE_KEY() {
    return assertLooksLikeKey('SUPABASE_SERVICE_ROLE_KEY', required('SUPABASE_SERVICE_ROLE_KEY'));
  },
  get SUPABASE_ANON_KEY() {
    return assertLooksLikeKey('SUPABASE_ANON_KEY', required('SUPABASE_ANON_KEY'));
  },
  get ALLOWED_ORIGINS() {
    return optional('ALLOWED_ORIGINS', '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean);
  },
  get IS_PRODUCTION() {
    return optional('VERCEL_ENV', optional('NODE_ENV', 'development')) === 'production';
  },
  /**
   * The password every account is created with — rosters, the mentor
   * mapping and the provisioning endpoint all use this one, so the
   * department can announce a single value instead of handing out a
   * different random string per person.
   *
   * It is only a way to distribute a first sign-in: must_change_password
   * is set on every account and RouteGuards refuses to let anyone past
   * /change-password until they pick their own. It is optional rather
   * than hard-coded because the default is in a public repository —
   * set SSMP_TEMPORARY_PASSWORD in Vercel to use a value that is not.
   */
  get TEMPORARY_PASSWORD() {
    return optional('SSMP_TEMPORARY_PASSWORD', 'SsmpDemo@2026');
  }
};

/** Never log a secret. Used by the health endpoint to report readiness. */
export function describeConfigHealth() {
  const check = (name, validator) => {
    if (!process.env[name]) return 'missing';
    try {
      validator();
      return 'ok';
    } catch {
      return 'malformed';
    }
  };

  return {
    supabase_url: check('SUPABASE_URL', () => env.SUPABASE_URL),
    supabase_service_role_key: check('SUPABASE_SERVICE_ROLE_KEY', () => env.SUPABASE_SERVICE_ROLE_KEY),
    supabase_anon_key: check('SUPABASE_ANON_KEY', () => env.SUPABASE_ANON_KEY)
  };
}
