/**
 * AppRouter
 * One route table for every portal. Every authenticated branch is
 * wrapped in RequireAuth -> RequirePasswordChange -> RequireRole, and the
 * student branch adds RequireOnboarding (Feature 1's Form A gate).
 *
 * Since migration 0039 two sets of screens are mounted twice:
 *   * the department screens, under /hod (a HOD: their own faculty) and
 *     /admin (the administrator: the whole department);
 *   * the cluster head's upload screens, under /cluster-head and, minus
 *     the subject setup and My Subjects, under /hod/uploads.
 * The components are the same; lib/portalPaths.js keeps their links in
 * the portal they were opened from.
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import {
  RequireAuth,
  RequireRole,
  RequireOnboarding,
  RequirePasswordChange,
  RequireClusterHeadSetup,
  RequireSeniorMentor
} from './RouteGuards.jsx';
import { PageLoader } from '../components/ui/Skeleton.jsx';
import { useAuth } from '../context/AuthProvider.jsx';
import { HOME_PATH } from '../lib/constants.js';

import LoginPage from '../pages/auth/LoginPage.jsx';
import ChangePasswordPage from '../pages/auth/ChangePasswordPage.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';

// Code-split every portal so a student never downloads the HOD screens.
const StudentDashboardPage = lazy(() => import('../pages/student/StudentDashboardPage.jsx'));
const StudentQueriesPage = lazy(() => import('../pages/student/StudentQueriesPage.jsx'));
const StudentQueryDetailPage = lazy(() => import('../pages/student/StudentQueryDetailPage.jsx'));
const StudentOnboardingFormPage = lazy(() => import('../pages/student/StudentOnboardingFormPage.jsx'));
const StudentAcademicsPage = lazy(() => import('../pages/student/StudentAcademicsPage.jsx'));
const StudentAchievementsPage = lazy(() => import('../pages/student/StudentAchievementsPage.jsx'));
const StudentProfilePage = lazy(() => import('../pages/student/StudentProfilePage.jsx'));
const StudentGroupQueriesPage = lazy(() => import('../pages/student/StudentGroupQueriesPage.jsx'));
const StudentProfilePhotoPage = lazy(() => import('../pages/student/StudentProfilePhotoPage.jsx'));
const StudentSurveyPage = lazy(() => import('../pages/student/StudentSurveyPage.jsx'));
const StudentSurveyTrackingPage = lazy(() => import('../pages/student/StudentSurveyTrackingPage.jsx'));
const StudentCrReportPage = lazy(() => import('../pages/student/StudentCrReportPage.jsx'));
const StudentCounsellingPage = lazy(() => import('../pages/student/StudentCounsellingPage.jsx'));
const SeniorPeerQueriesPage = lazy(() => import('../pages/student/SeniorPeerQueriesPage.jsx'));
const SeniorPeerQueryDetailPage = lazy(() => import('../pages/student/SeniorPeerQueryDetailPage.jsx'));
const SeniorMenteesPage = lazy(() => import('../pages/student/SeniorMenteesPage.jsx'));

const FacultyDashboardPage = lazy(() => import('../pages/faculty/FacultyDashboardPage.jsx'));
const FacultyQueryQueuePage = lazy(() => import('../pages/faculty/FacultyQueryQueuePage.jsx'));
const FacultyQueryDetailPage = lazy(() => import('../pages/faculty/FacultyQueryDetailPage.jsx'));
const FacultyMenteesPage = lazy(() => import('../pages/faculty/FacultyMenteesPage.jsx'));
const FacultyMenteeDetailPage = lazy(() => import('../pages/faculty/FacultyMenteeDetailPage.jsx'));
const FacultyActivityReportPage = lazy(() => import('../pages/faculty/FacultyActivityReportPage.jsx'));
const FacultyProfilePage = lazy(() => import('../pages/faculty/FacultyProfilePage.jsx'));
const FacultyAtRiskPage = lazy(() => import('../pages/faculty/FacultyAtRiskPage.jsx'));
const FacultyCrReportsPage = lazy(() => import('../pages/faculty/FacultyCrReportsPage.jsx'));
const FacultyCounsellingPage = lazy(() => import('../pages/faculty/FacultyCounsellingPage.jsx'));
const RaisedQueriesPage = lazy(() => import('../pages/faculty/RaisedQueriesPage.jsx'));

const HodDashboardPage = lazy(() => import('../pages/hod/HodDashboardPage.jsx'));
const HodFacultyPerformancePage = lazy(() => import('../pages/hod/HodFacultyPerformancePage.jsx'));
const HodFacultyRosterPage = lazy(() => import('../pages/hod/HodFacultyRosterPage.jsx'));
const HodStudentsPage = lazy(() => import('../pages/hod/HodStudentsPage.jsx'));
const HodProfilePage = lazy(() => import('../pages/hod/HodProfilePage.jsx'));
const HodOperationsPage = lazy(() => import('../pages/hod/HodOperationsPage.jsx'));
const HodSeniorMentorsPage = lazy(() => import('../pages/hod/HodSeniorMentorsPage.jsx'));

const AdminHodMappingPage = lazy(() => import('../pages/admin/AdminHodMappingPage.jsx'));

const ClusterHeadSetupPage = lazy(() => import('../pages/clusterHead/ClusterHeadSetupPage.jsx'));
const ClusterHeadDashboardPage = lazy(() => import('../pages/clusterHead/ClusterHeadDashboardPage.jsx'));
const ClusterHeadAttendancePage = lazy(() => import('../pages/clusterHead/ClusterHeadAttendancePage.jsx'));
const ClusterHeadGpaPage = lazy(() => import('../pages/clusterHead/ClusterHeadGpaPage.jsx'));
const ClusterHeadBacklogPage = lazy(() => import('../pages/clusterHead/ClusterHeadBacklogPage.jsx'));
const ClusterHeadBlackDotPage = lazy(() => import('../pages/clusterHead/ClusterHeadBlackDotPage.jsx'));
const ClusterHeadCoursesPage = lazy(() => import('../pages/clusterHead/ClusterHeadCoursesPage.jsx'));
const ClusterHeadProfilePage = lazy(() => import('../pages/clusterHead/ClusterHeadProfilePage.jsx'));
const ClusterHeadRosterPage = lazy(() => import('../pages/clusterHead/ClusterHeadRosterPage.jsx'));
const ClusterHeadCyclesPage = lazy(() => import('../pages/clusterHead/ClusterHeadCyclesPage.jsx'));

/** Sends a signed-in user to their own portal root. */
function HomeRedirect() {
  const { profile, loading } = useAuth();
  if (loading) return <PageLoader />;
  return <Navigate to={profile ? (HOME_PATH[profile.role] ?? '/login') : '/login'} replace />;
}

function Protected({ role, children }) {
  return (
    <RequireAuth>
      <RequirePasswordChange>
        <RequireRole role={role}>{children}</RequireRole>
      </RequirePasswordChange>
    </RequireAuth>
  );
}

/** The department screens at `base`, for `role` (see the header). */
function departmentRoutes(base, role) {
  const page = (element) => <Protected role={role}>{element}</Protected>;
  return [
    <Route key={base} path={base} element={page(<HodDashboardPage />)} />,
    <Route key={`${base}/queries`} path={`${base}/queries`} element={page(<FacultyQueryQueuePage isHodView />)} />,
    <Route key={`${base}/queries/:queryId`} path={`${base}/queries/:queryId`} element={page(<FacultyQueryDetailPage isHodView />)} />,
    <Route key={`${base}/raised`} path={`${base}/raised`} element={page(<RaisedQueriesPage isHodView />)} />,
    <Route key={`${base}/seniors`} path={`${base}/seniors`} element={page(<HodSeniorMentorsPage />)} />,
    <Route key={`${base}/performance`} path={`${base}/performance`} element={page(<HodFacultyPerformancePage />)} />,
    <Route key={`${base}/reports`} path={`${base}/reports`} element={page(<FacultyActivityReportPage isHodView />)} />,
    <Route key={`${base}/roster`} path={`${base}/roster`} element={page(<HodFacultyRosterPage />)} />,
    <Route key={`${base}/students`} path={`${base}/students`} element={page(<HodStudentsPage />)} />,
    <Route key={`${base}/students/:studentId`} path={`${base}/students/:studentId`} element={page(<FacultyMenteeDetailPage isHodView />)} />,
    <Route key={`${base}/at-risk`} path={`${base}/at-risk`} element={page(<FacultyAtRiskPage isHodView />)} />,
    <Route key={`${base}/cr-reports`} path={`${base}/cr-reports`} element={page(<FacultyCrReportsPage isHodView />)} />,
    <Route key={`${base}/operations`} path={`${base}/operations`} element={page(<HodOperationsPage />)} />,
    <Route key={`${base}/profile`} path={`${base}/profile`} element={page(<HodProfilePage />)} />
  ];
}

export default function AppRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/change-password"
          element={
            <RequireAuth>
              <ChangePasswordPage />
            </RequireAuth>
          }
        />
        <Route path="/reset-password" element={<ChangePasswordPage />} />
        <Route path="/" element={<HomeRedirect />} />

        {/* ── Student portal ─────────────────────────────────────────── */}
        <Route
          path="/student/onboarding"
          element={
            <Protected role="student">
              <StudentOnboardingFormPage />
            </Protected>
          }
        />
        <Route
          path="/student/profile-photo"
          element={
            <Protected role="student">
              <StudentProfilePhotoPage />
            </Protected>
          }
        />
        <Route
          path="/student"
          element={
            <Protected role="student">
              <RequireOnboarding>
                <StudentDashboardPage />
              </RequireOnboarding>
            </Protected>
          }
        />
        <Route
          path="/student/queries"
          element={
            <Protected role="student">
              <RequireOnboarding>
                <StudentQueriesPage />
              </RequireOnboarding>
            </Protected>
          }
        />
        <Route
          path="/student/queries/:queryId"
          element={
            <Protected role="student">
              <RequireOnboarding>
                <StudentQueryDetailPage />
              </RequireOnboarding>
            </Protected>
          }
        />
        {/* A senior mentor's pages (0042). */}
        <Route
          path="/student/peer-queries"
          element={
            <Protected role="student">
              <RequireOnboarding>
                <RequireSeniorMentor>
                  <SeniorPeerQueriesPage />
                </RequireSeniorMentor>
              </RequireOnboarding>
            </Protected>
          }
        />
        <Route
          path="/student/peer-queries/:queryId"
          element={
            <Protected role="student">
              <RequireOnboarding>
                <RequireSeniorMentor>
                  <SeniorPeerQueryDetailPage />
                </RequireSeniorMentor>
              </RequireOnboarding>
            </Protected>
          }
        />
        <Route
          path="/student/senior-mentees"
          element={
            <Protected role="student">
              <RequireOnboarding>
                <RequireSeniorMentor>
                  <SeniorMenteesPage />
                </RequireSeniorMentor>
              </RequireOnboarding>
            </Protected>
          }
        />
        <Route
          path="/student/group-queries"
          element={
            <Protected role="student">
              <RequireOnboarding>
                <StudentGroupQueriesPage />
              </RequireOnboarding>
            </Protected>
          }
        />
        <Route
          path="/student/academics"
          element={
            <Protected role="student">
              <RequireOnboarding>
                <StudentAcademicsPage />
              </RequireOnboarding>
            </Protected>
          }
        />
        <Route
          path="/student/survey"
          element={
            <Protected role="student">
              <RequireOnboarding>
                <StudentSurveyPage />
              </RequireOnboarding>
            </Protected>
          }
        />
        <Route
          path="/student/survey-tracking"
          element={
            <Protected role="student">
              <RequireOnboarding>
                <StudentSurveyTrackingPage />
              </RequireOnboarding>
            </Protected>
          }
        />
        <Route
          path="/student/cr-report"
          element={
            <Protected role="student">
              <RequireOnboarding>
                <StudentCrReportPage />
              </RequireOnboarding>
            </Protected>
          }
        />
        <Route
          path="/student/counselling"
          element={
            <Protected role="student">
              <RequireOnboarding>
                <StudentCounsellingPage />
              </RequireOnboarding>
            </Protected>
          }
        />
        <Route
          path="/student/achievements"
          element={
            <Protected role="student">
              <RequireOnboarding>
                <StudentAchievementsPage />
              </RequireOnboarding>
            </Protected>
          }
        />
        <Route
          path="/student/profile"
          element={
            <Protected role="student">
              <RequireOnboarding>
                <StudentProfilePage />
              </RequireOnboarding>
            </Protected>
          }
        />

        {/* ── Faculty portal ─────────────────────────────────────────── */}
        <Route path="/faculty" element={<Protected role="faculty"><FacultyDashboardPage /></Protected>} />
        <Route path="/faculty/queries" element={<Protected role="faculty"><FacultyQueryQueuePage /></Protected>} />
        <Route path="/faculty/queries/:queryId" element={<Protected role="faculty"><FacultyQueryDetailPage /></Protected>} />
        <Route path="/faculty/raised" element={<Protected role="faculty"><RaisedQueriesPage /></Protected>} />
        <Route path="/faculty/mentees" element={<Protected role="faculty"><FacultyMenteesPage /></Protected>} />
        <Route path="/faculty/mentees/:studentId" element={<Protected role="faculty"><FacultyMenteeDetailPage /></Protected>} />
        <Route path="/faculty/at-risk" element={<Protected role="faculty"><FacultyAtRiskPage /></Protected>} />
        <Route path="/faculty/counselling" element={<Protected role="faculty"><FacultyCounsellingPage /></Protected>} />
        <Route path="/faculty/cr-reports" element={<Protected role="faculty"><FacultyCrReportsPage /></Protected>} />
        <Route path="/faculty/report" element={<Protected role="faculty"><FacultyActivityReportPage /></Protected>} />
        <Route path="/faculty/profile" element={<Protected role="faculty"><FacultyProfilePage /></Protected>} />

        {/* ── HOD portal ─────────────────────────────────────────────── */}
        {departmentRoutes('/hod', 'hod')}

        {/* Uploads: the cluster head's screens, without the subject setup
            gate or My Subjects (subjects come from the attendance files). */}
        <Route path="/hod/uploads" element={<Protected role="hod"><ClusterHeadDashboardPage /></Protected>} />
        <Route path="/hod/uploads/cycles" element={<Protected role="hod"><ClusterHeadCyclesPage /></Protected>} />
        <Route path="/hod/uploads/attendance" element={<Protected role="hod"><ClusterHeadAttendancePage /></Protected>} />
        <Route path="/hod/uploads/gpa" element={<Protected role="hod"><ClusterHeadGpaPage /></Protected>} />
        <Route path="/hod/uploads/backlogs" element={<Protected role="hod"><ClusterHeadBacklogPage /></Protected>} />
        <Route path="/hod/uploads/black-dots" element={<Protected role="hod"><ClusterHeadBlackDotPage /></Protected>} />
        <Route path="/hod/uploads/rosters" element={<Protected role="hod"><ClusterHeadRosterPage /></Protected>} />

        {/* ── Administrator portal ───────────────────────────────────── */}
        {departmentRoutes('/admin', 'admin')}
        <Route path="/admin/upload" element={<Protected role="admin"><AdminHodMappingPage /></Protected>} />

        {/* ── Cluster Head portal ────────────────────────────────────── */}
        {/* The setup form is the only route reachable before setup is done,
            and it renders without PortalShell so there is no sidebar to
            click past it — the same shape as the student Form A gate. */}
        <Route
          path="/cluster-head/setup"
          element={<Protected role="cluster_head"><ClusterHeadSetupPage /></Protected>}
        />
        <Route
          path="/cluster-head"
          element={
            <Protected role="cluster_head">
              <RequireClusterHeadSetup><ClusterHeadDashboardPage /></RequireClusterHeadSetup>
            </Protected>
          }
        />
        <Route
          path="/cluster-head/cycles"
          element={
            <Protected role="cluster_head">
              <RequireClusterHeadSetup><ClusterHeadCyclesPage /></RequireClusterHeadSetup>
            </Protected>
          }
        />
        <Route
          path="/cluster-head/attendance"
          element={
            <Protected role="cluster_head">
              <RequireClusterHeadSetup><ClusterHeadAttendancePage /></RequireClusterHeadSetup>
            </Protected>
          }
        />
        <Route
          path="/cluster-head/gpa"
          element={
            <Protected role="cluster_head">
              <RequireClusterHeadSetup><ClusterHeadGpaPage /></RequireClusterHeadSetup>
            </Protected>
          }
        />
        <Route
          path="/cluster-head/backlogs"
          element={
            <Protected role="cluster_head">
              <RequireClusterHeadSetup><ClusterHeadBacklogPage /></RequireClusterHeadSetup>
            </Protected>
          }
        />
        <Route
          path="/cluster-head/black-dots"
          element={
            <Protected role="cluster_head">
              <RequireClusterHeadSetup><ClusterHeadBlackDotPage /></RequireClusterHeadSetup>
            </Protected>
          }
        />
        <Route
          path="/cluster-head/rosters"
          element={
            <Protected role="cluster_head">
              <RequireClusterHeadSetup><ClusterHeadRosterPage /></RequireClusterHeadSetup>
            </Protected>
          }
        />
        <Route
          path="/cluster-head/courses"
          element={
            <Protected role="cluster_head">
              <RequireClusterHeadSetup><ClusterHeadCoursesPage /></RequireClusterHeadSetup>
            </Protected>
          }
        />
        <Route
          path="/cluster-head/profile"
          element={
            <Protected role="cluster_head">
              <RequireClusterHeadSetup><ClusterHeadProfilePage /></RequireClusterHeadSetup>
            </Protected>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
