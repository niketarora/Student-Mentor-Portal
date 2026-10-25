/**
 * Avatar
 * Shows the user's uploaded profile photo, falling back to a neutral
 * person silhouette (never initials).
 *
 * Photos live in the private `profile-photos` bucket, so every one needs a
 * signed URL. Those are cached in a module-level map keyed by object path
 * — an avatar appears dozens of times on a busy screen and re-signing each
 * instance would be a request storm.
 */

import { useEffect, useState } from 'react';
import { createSignedUrl, BUCKETS } from '../../lib/fileUpload.js';

const SIGNED_URL_TTL_SECONDS = 3600;
const cache = new Map(); // objectPath -> { url, expiresAt }

export async function resolveAvatarUrl(objectPath) {
  if (!objectPath) return null;

  const cached = cache.get(objectPath);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  try {
    const url = await createSignedUrl(BUCKETS.PROFILE_PHOTOS, objectPath, SIGNED_URL_TTL_SECONDS);
    // Re-sign a minute early so a link never expires mid-render.
    cache.set(objectPath, { url, expiresAt: Date.now() + (SIGNED_URL_TTL_SECONDS - 60) * 1000 });
    return url;
  } catch (error) {
    console.warn('[avatar] could not sign photo URL:', error.message);
    return null;
  }
}

/** Drops a path from the cache so a freshly uploaded photo shows at once. */
export function forgetAvatar(objectPath) {
  if (objectPath) cache.delete(objectPath);
}

/** The fallback: a neutral grey person glyph, drawn inline. */
function PersonGlyph({ className = '' }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={`h-full w-full ${className}`}>
      <circle cx="24" cy="24" r="24" fill="#a8a29e" />
      <circle cx="24" cy="18.5" fill="#f2f0ef" r="7.6" />
      <ellipse cx="24" cy="40" fill="#f2f0ef" rx="13.2" ry="9.4" />
    </svg>
  );
}

export default function Avatar({ path, name, size = 36, className = '', ring = false }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    if (!path) {
      setUrl(null);
      return undefined;
    }
    resolveAvatarUrl(path).then((signed) => {
      if (active) setUrl(signed);
    });
    return () => {
      active = false;
    };
  }, [path]);

  const showPhoto = url && !failed;

  return (
    <span
      className={`inline-flex shrink-0 overflow-hidden rounded-full bg-surface-container ${
        ring ? 'ring-2 ring-white' : ''
      } ${className}`}
      style={{ width: size, height: size }}
      title={name ?? undefined}
    >
      {showPhoto ? (
        <img
          src={url}
          alt={name ? `${name}'s profile photo` : 'Profile photo'}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <PersonGlyph />
      )}
    </span>
  );
}
