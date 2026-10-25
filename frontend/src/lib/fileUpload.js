/**
 * fileUpload.js
 * Client-side validation + upload to the private Supabase Storage buckets.
 *
 * Object paths always begin with the uploader's user id, which is what the
 * storage RLS policies key off (see migration 0014).
 */

import { supabase } from './supabaseClient.js';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];

export function validateUpload(file) {
  if (!file) return 'Please choose a file.';
  if (file.size > MAX_BYTES) return 'File must be 5 MB or smaller.';
  if (!ALLOWED_MIME.includes(file.type)) {
    return 'Only PNG, JPG, WEBP or PDF files are accepted.';
  }
  return null;
}

/** Strips anything that could be used for path traversal or header tricks. */
function safeFileName(name) {
  const extension = (name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'file';
  return `${base}-${Date.now()}.${extension}`;
}

export async function uploadPrivateFile(bucket, userId, file, prefix = '') {
  const problem = validateUpload(file);
  if (problem) throw new Error(problem);

  const objectPath = `${userId}/${prefix ? `${prefix}-` : ''}${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(bucket).upload(objectPath, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type
  });
  if (error) throw error;
  return objectPath;
}

/** Buckets are private, so viewing always goes through a short-lived link. */
export async function createSignedUrl(bucket, objectPath, expiresInSeconds = 300) {
  if (!objectPath) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export const BUCKETS = {
  FORM_A: 'form-a-uploads',
  ACHIEVEMENTS: 'achievement-proofs',
  ROSTERS: 'roster-imports',
  PROFILE_PHOTOS: 'profile-photos'
};

/** Profile photos are images only, and smaller than the document buckets. */
export function validateProfilePhoto(file) {
  if (!file) return 'Please choose an image.';
  if (file.size > 3 * 1024 * 1024) return 'The photo must be 3 MB or smaller.';
  if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
    return 'Use a PNG, JPG or WEBP image.';
  }
  return null;
}
