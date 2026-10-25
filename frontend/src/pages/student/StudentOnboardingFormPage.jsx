/**
 * FEATURE 1 — the compulsory first fill of Form A.
 *
 * Rendered WITHOUT the portal shell on purpose: no sidebar, no menu, no
 * notification bell. Until this is submitted there is nothing else the
 * student can usefully do, and showing navigation they cannot follow just
 * invites them to try. Once submitted they are sent straight to the
 * dashboard, and the form lives on their profile page from then on.
 */

import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import mujLogo from '../../assets/manipal-university-jaipur-logo.png';
import FormAFields, { useFormAState } from '../../components/student/FormAFields.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { PageLoader } from '../../components/ui/Skeleton.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';

export default function StudentOnboardingFormPage() {
  const { profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const { run, pending } = useAsyncAction();
  const formA = useFormAState(profile);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Already done? This page has no further purpose — editing happens on
  // the profile page now.
  if (profile?.form_a_completed) return <Navigate to="/student/profile" replace />;

  const openConfirm = (event) => {
    event.preventDefault();
    if (formA.validate()) setConfirmOpen(true);
  };

  const submit = () =>
    run(
      async () => {
        const payload = formA.validate();
        if (!payload) throw new Error('Please fix the highlighted fields.');
        const { error } = await supabase.rpc('submit_student_form_a', { p_payload: payload });
        if (error) throw error;
      },
      {
        successMessage: 'Form A submitted. Welcome to the portal!',
        onSuccess: async () => {
          setConfirmOpen(false);
          await refreshProfile();
          // Step 2 of onboarding: the mandatory profile photo.
          navigate('/student/profile-photo', { replace: true });
        }
      }
    );

  if (formA.loading) return <PageLoader label="Loading Form A..." />;

  return (
    <div className="min-h-screen bg-background">
      {/* Minimal header — brand and sign-out only. No navigation. */}
      <header className="sticky top-0 z-20 border-b border-topbar-border bg-topbar">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4">
          <img src={mujLogo} alt="Manipal University Jaipur" className="h-10 w-auto object-contain" />
          <div className="ml-auto text-right">
            <p className="text-label-md leading-tight text-primary">{profile?.full_name?.toUpperCase()}</p>
            <button type="button" onClick={signOut} className="text-label-sm text-tertiary hover:text-error">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 rounded-lg border-l-4 border-primary bg-primary-fixed/40 p-5">
          <p className="text-label-sm uppercase tracking-wide text-on-primary-fixed-variant">
            Step 1 of 2 · One-time setup
          </p>
          <h1 className="mt-1 text-headline-md text-on-surface">Form A — Mentor-Mentee Scheme</h1>
          <p className="mt-2 max-w-3xl text-body-sm text-on-surface-variant">
            Before you can use the portal, the department needs your mentorship record. It takes about five
            minutes. You can correct any of it later from your profile page — no approval needed.
          </p>
        </div>

        <form onSubmit={openConfirm}>
          <FormAFields
            form={formA.form}
            errors={formA.errors}
            setField={formA.setField}
            uploads={formA.uploads}
            uploading={formA.uploading}
            onUpload={formA.upload}
          />

          <div className="mt-6 flex flex-wrap items-center justify-end gap-3 pb-10">
            <p className="mr-auto text-label-sm text-tertiary">
              Fields marked <span className="text-error">*</span> are required.
            </p>
            <button type="submit" className="btn-primary" disabled={pending || formA.uploading !== null}>
              {pending ? 'Submitting...' : 'Submit and continue'}
            </button>
          </div>
        </form>
      </main>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={submit}
        pending={pending}
        title="Submit Form A?"
        confirmLabel="Yes, submit"
        message="Next you will be asked for a profile photo, then the portal opens. If anything here needs correcting later, you can edit it yourself from your profile page."
      />
    </div>
  );
}
