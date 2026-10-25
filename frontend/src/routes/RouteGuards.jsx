/**
 * Route guards.
 * These are convenience only — the real access control is the RLS policy
 * set in Supabase. A user who forces a URL they should not see gets an
 * empty result from the database, not somebody else's data.
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider.jsx';
import { PageLoader } from '../components/ui/Skeleton.jsx';
import { HOME_PATH } from '../lib/constants.js';

export function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader label="Restoring your session..." />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export function RequireRole({ role, children }) {
  const { profile, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!profile) return <Navigate to="/login" replace />;
  if (profile.role !== role) return <Navigate to={HOME_PATH[profile.role] ?? '/login'} replace />;
  return children;
}

/**
 * FEATURE 1 gate — student onboarding, in two compulsory steps:
 *   1. Form A          -> /student/onboarding
 *   2. Profile photo   -> /student/profile-photo
 * Neither is skippable, and both are checked here in the routing layer
 * rather than scattered through the pages.
 */
export function RequireOnboarding({ children }) {
  const { profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (!profile) return <Navigate to="/login" replace />;
  if (profile.role !== 'student') return children;

  if (!profile.form_a_completed && !location.pathname.startsWith('/student/onboarding')) {
    return <Navigate to="/student/onboarding" replace />;
  }
  if (profile.form_a_completed && !profile.avatar_url && location.pathname !== '/student/profile-photo') {
    return <Navigate to="/student/profile-photo" replace />;
  }
  return children;
}

/**
 * Senior mentor pages (0042): Peer Queries and Assigned Mentees. A student
 * without the senior flag goes back to their Home. The database still
 * decides what they could read (get_peer_queries() returns nothing).
 */
export function RequireSeniorMentor({ children }) {
  const { profile, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!profile) return <Navigate to="/login" replace />;
  if (profile.role !== 'student' || !profile.is_senior_mentor) return <Navigate to="/student" replace />;
  return children;
}

/**
 * Cluster Head gate — the one-time setup form.
 * Mirrors RequireOnboarding: the Cluster Head cannot reach any part of
 * their portal until they have told us which subjects they handle, because
 * the Course and Section dropdowns on every upload screen are built from
 * exactly that answer. Enforced here in the routing layer rather than in
 * each page; the real boundary is still submit_cluster_head_setup(), which
 * is the only thing that can flip the flag.
 */
export function RequireClusterHeadSetup({ children }) {
  const { profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (!profile) return <Navigate to="/login" replace />;
  if (profile.role !== 'cluster_head') return children;

  if (!profile.cluster_head_setup_completed && location.pathname !== '/cluster-head/setup') {
    return <Navigate to="/cluster-head/setup" replace />;
  }
  return children;
}

/** Forces a password change on first login with a temporary password. */
export function RequirePasswordChange({ children }) {
  const { profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (profile?.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}
