/** Presentation helpers. Pure functions, no side effects. */

const INDIA_LOCALE = 'en-IN';

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(INDIA_LOCALE, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(INDIA_LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

/** "3 hours ago", "just now", "in 2 days" */
export function formatRelativeTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60]
  ];
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, secondsInUnit] of units) {
    if (Math.abs(seconds) >= secondsInUnit) {
      return rtf.format(Math.round(seconds / secondsInUnit), unit);
    }
  }
  return 'just now';
}

export function formatHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours === 0) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours >= 24) return `${(hours / 24).toFixed(1)} d`;
  return `${hours.toFixed(1)} h`;
}

export function formatNumber(value, fallback = '0') {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(INDIA_LOCALE) : fallback;
}

export function initialsOf(name) {
  return String(name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

/** Turns a thrown error (or Supabase error object) into a readable string. */
export function describeError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  const message = error.message || error.error_description || error.hint;
  if (!message) return fallback;

  // Postgres check-constraint violations are unreadable to end users.
  if (message.includes('violates check constraint')) {
    return 'Some of the values entered are not valid. Please review the highlighted fields.';
  }
  if (message.includes('duplicate key value')) {
    return 'That record already exists.';
  }
  if (message.toLowerCase().includes('invalid login credentials')) {
    return 'Incorrect email or password.';
  }
  if (message.toLowerCase().includes('email not confirmed')) {
    return 'This account has not been confirmed yet. Please contact your HOD.';
  }
  return message;
}

/** Sums a percentage safely (avoids divide-by-zero NaN in the UI). */
export function percentage(part, total, decimals = 0) {
  const p = Number(part);
  const t = Number(total);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t === 0) return 0;
  return Number(((p / t) * 100).toFixed(decimals));
}
