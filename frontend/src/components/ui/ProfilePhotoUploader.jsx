/**
 * ProfilePhotoUploader
 * Shared by all three portals' My Profile pages, and by the student's
 * mandatory onboarding step. Uploads to the private profile-photos bucket
 * and writes the object path to user_profiles.avatar_url.
 */

import { useRef, useState } from 'react';
import Avatar, { forgetAvatar } from './Avatar.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { uploadPrivateFile, validateProfilePhoto, BUCKETS } from '../../lib/fileUpload.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useToast } from '../../context/ToastProvider.jsx';
import { describeError } from '../../lib/formatters.js';

export default function ProfilePhotoUploader({ size = 96, onUploaded, showRemove = true }) {
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const choose = async (file) => {
    const problem = validateProfilePhoto(file);
    if (problem) {
      toast.error(problem);
      return;
    }

    setBusy(true);
    try {
      const path = await uploadPrivateFile(BUCKETS.PROFILE_PHOTOS, profile.id, file, 'avatar');
      const { error } = await supabase
        .from('user_profiles')
        .update({ avatar_url: path })
        .eq('id', profile.id);
      if (error) throw error;

      // Old photo is now orphaned; tidy it up but never fail the upload on it.
      if (profile.avatar_url && profile.avatar_url !== path) {
        forgetAvatar(profile.avatar_url);
        supabase.storage.from(BUCKETS.PROFILE_PHOTOS).remove([profile.avatar_url])
          .then(({ error: removeError }) => {
            if (removeError) console.warn('[avatar] old photo not removed:', removeError.message);
          });
      }

      await refreshProfile();
      toast.success('Profile photo updated.');
      onUploaded?.(path);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const previous = profile.avatar_url;
      const { error } = await supabase
        .from('user_profiles')
        .update({ avatar_url: null })
        .eq('id', profile.id);
      if (error) throw error;
      if (previous) {
        forgetAvatar(previous);
        await supabase.storage.from(BUCKETS.PROFILE_PHOTOS).remove([previous]);
      }
      await refreshProfile();
      toast.success('Profile photo removed.');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative">
        <Avatar path={profile?.avatar_url} name={profile?.full_name} size={size} />
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          </span>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <span className="material-symbols-outlined text-[17px]">photo_camera</span>
            {profile?.avatar_url ? 'Change photo' : 'Upload photo'}
          </button>
          {showRemove && profile?.avatar_url && (
            <button type="button" className="btn-ghost btn-sm text-error" disabled={busy} onClick={remove}>
              Remove
            </button>
          )}
        </div>
        <p className="mt-2 text-label-sm text-tertiary">
          A clear head-and-shoulders photo. PNG, JPG or WEBP, up to 3 MB.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) choose(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}
