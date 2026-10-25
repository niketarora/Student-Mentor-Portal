/**
 * Step 2 of student onboarding: a profile photo, which is mandatory.
 *
 * Rendered without the portal shell for the same reason Form A is — until
 * both steps are done there is nothing else to navigate to, so showing a
 * menu would only invite dead ends.
 */

import { Navigate, useNavigate } from 'react-router-dom';
import mujLogo from '../../assets/manipal-university-jaipur-logo.png';
import ProfilePhotoUploader from '../../components/ui/ProfilePhotoUploader.jsx';
import { useAuth } from '../../context/AuthProvider.jsx';

export default function StudentProfilePhotoPage() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  // Form A comes first; a photo is pointless if they have not been through it.
  if (profile && !profile.form_a_completed) return <Navigate to="/student/onboarding" replace />;
  if (profile?.avatar_url) return <Navigate to="/student" replace />;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-topbar-border bg-topbar">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-4 px-4">
          <img src={mujLogo} alt="Manipal University Jaipur" className="h-10 w-auto object-contain" />
          <div className="ml-auto text-right">
            <p className="text-label-md leading-tight text-primary">{profile?.full_name?.toUpperCase()}</p>
            <button type="button" onClick={signOut} className="text-label-sm text-tertiary hover:text-error">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6 rounded-xl border-l-4 border-primary bg-primary-fixed p-5">
          <p className="text-label-sm uppercase tracking-wide text-on-primary-fixed-variant">
            Step 2 of 2 · Almost there
          </p>
          <h1 className="mt-1 text-headline-md text-on-surface">Add a profile photo</h1>
          <p className="mt-2 text-body-sm text-on-surface-variant">
            Your mentor sees this next to your name on every query, so they know who they are talking to.
            You can change it later from your profile.
          </p>
        </div>

        <div className="panel p-6">
          <ProfilePhotoUploader size={128} showRemove={false} onUploaded={() => navigate('/student', { replace: true })} />
        </div>
      </main>
    </div>
  );
}
