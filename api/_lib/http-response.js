/**
 * http-response.js
 * Consistent JSON envelope, CORS handling and security headers for every
 * serverless endpoint.
 */

import { env } from './environment.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cache-Control': 'no-store, no-cache, must-revalidate, private'
};

function resolveAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;

  const allowList = env.ALLOWED_ORIGINS;

  // Same-origin deployments (frontend and API on one Vercel domain) do not
  // need CORS at all; the allow-list is for local dev and preview URLs.
  if (allowList.includes(origin)) return origin;

  if (!env.IS_PRODUCTION && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
    return origin;
  }
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin) && allowList.some((o) => o.endsWith('.vercel.app'))) {
    return origin;
  }
  return null;
}

export function applyBaseHeaders(req, res) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);

  const allowedOrigin = resolveAllowedOrigin(req);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function sendJson(res, statusCode, payload) {
  res.status(statusCode).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(payload));
}

export function sendSuccess(res, message, data = {}, statusCode = 200) {
  sendJson(res, statusCode, { success: true, message, data });
}

export function sendError(res, message, statusCode = 400, details = undefined) {
  sendJson(res, statusCode, { success: false, message, ...(details ? { details } : {}) });
}

/**
 * Wraps a handler with CORS pre-flight, method allow-listing, security
 * headers and a catch-all that never leaks a stack trace to the client.
 */
export function withApiDefaults(allowedMethods, handler) {
  return async function wrapped(req, res) {
    applyBaseHeaders(req, res);

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (!allowedMethods.includes(req.method)) {
      res.setHeader('Allow', allowedMethods.join(', '));
      sendError(res, `Method ${req.method} not allowed on this endpoint`, 405);
      return;
    }

    try {
      await handler(req, res);
    } catch (error) {
      const isClientError = typeof error?.statusCode === 'number' && error.statusCode < 500;
      // Server-side detail goes to the log, never to the response body.
      console.error('[api-error]', req.url, error?.message, isClientError ? '' : error?.stack);
      sendError(
        res,
        isClientError ? error.message : 'Something went wrong on our side. Please try again.',
        error?.statusCode ?? 500
      );
    }
  };
}

export class ApiError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
