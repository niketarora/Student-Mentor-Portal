/**
 * Mentee detail — everything a mentor needs about one student in one
 * place. The HOD's student page is this same screen.
 *
 * The top is the Academic Performance Overview (attendance per subject,
 * GPA if shared, backlogs with their subjects, black dots), the same block
 * the student sees on their Academics page. Below it: the mentoring record
 * — queries, Form A (Feature 1), achievements with verification (Feature
 * 6) — plus the star toggle (Feature 7) and a one-click PDF (Feature 5).
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { PageLoader } from '../../components/ui/Skeleton.jsx';
import { QueryStatusBadge, CategoryBadge } from '../../components/ui/StatusBadge.jsx';
import { CategoryBarChart } from '../../components/charts/Charts.jsx';
import { countQueriesByCategory, queryCategoryChartData } from '../../lib/queryCategoryChart.js';
import AcademicOverview from '../../components/academics/AcademicOverview.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { apiClient } from '../../lib/apiClient.js';
import { createSignedUrl, BUCKETS } from '../../lib/fileUpload.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { ACHIEVEMENT_CATEGORIES } from '../../lib/constants.js';
import { describeError, formatDate, formatHours } from '../../lib/formatters.js';
import { usePortalPaths } from '../../hooks/usePortalPaths.js';

export default function FacultyMenteeDetailPage({ isHodView = false }) {
  const { departmentBase } = usePortalPaths();
  const { studentId } = useParams();
  const toast = useToast();
  const { run, pending } = useAsyncAction();
  const [dossier, setDossier] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // A reload after saving something is quiet: the page stays where it is
  // (and on the semester being looked at) instead of flashing the loader.
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    // Attendance is not in the dossier, so it is read alongside it. The
    // view is RLS-scoped: the student's mentor and the HOD can read it.
    const [dossierResult, attendanceResult] = await Promise.all([
      supabase.rpc('get_student_dossier', { p_student_id: studentId }),
      supabase
        .from('student_attendance_overview')
        .select('course_id, course_code, course_name, section_label, attendance_percent, classes_held, classes_attended, period_start, period_end')
        .eq('student_id', studentId)
        .order('course_code')
    ]);
    if (dossierResult.error) toast.error(describeError(dossierResult.error));
    else if (attendanceResult.error) toast.error(describeError(attendanceResult.error));
    // A quiet reload that fails keeps what is already on screen.
    if (!(quiet && (dossierResult.error || attendanceResult.error))) {
      setDossier(dossierResult.data ?? null);
      setAttendance(attendanceResult.data ?? []);
    }
    setLoading(false);
  }, [studentId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleVerify = (achievement) =>
    run(
      async () => {
        const { error } = await supabase.rpc('set_achievement_verification', {
          p_achievement_id: achievement.id,
          p_verified: !achievement.verified
        });
        if (error) throw error;
      },
      {
        successMessage: achievement.verified ? 'Verification removed.' : 'Achievement verified.',
        onSuccess: () => load({ quiet: true })
      }
    );

  const toggleStar = () =>
    run(
      async () => {
        const { error } = await supabase.rpc('set_star_mentee', {
          p_student_id: studentId,
          p_is_star: !dossier.student.is_star_mentee
        });
        if (error) throw error;
      },
      { successMessage: 'Representative updated.', onSuccess: () => load({ quiet: true }) }
    );

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      await apiClient.downloadFile(
        '/reports/student-dossier-report',
        { student_id: studentId, format: 'pdf' },
        'student-report.pdf'
      );
      toast.success('Report downloaded.');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setDownloading(false);
    }
  };

  const viewProof = async (path) => {
    try {
      const url = await createSignedUrl(BUCKETS.ACHIEVEMENTS, path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(describeError(error));
    }
  };

  if (loading) return <PortalShell><PageLoader label="Loading student record..." /></PortalShell>;

  if (!dossier) {
    return (
      <PortalShell>
        <EmptyState
          icon="person_off"
          title="Student not available"
          description="This student does not exist, or they are not in your mentor group."
          action={
            <Link to={isHodView ? `${departmentBase}/students` : '/faculty/mentees'} className="btn-primary">
              Back to the list
            </Link>
          }
        />
      </PortalShell>
    );
  }

  const { student, form_a: formA, query_summary: queries, gpa_stats: gpaStats } = dossier;
  const backPath = isHodView ? `${departmentBase}/students` : '/faculty/mentees';

  // The official CGPA from the ERP export when one has been uploaded; the
  // plain mean of the semester GPAs is only a stand-in until then, and with
  // no GPA at all there is no CGPA to show (the dossier reports 0).
  const hasCgpa = dossier.gpa_shared && gpaStats && (gpaStats.cgpa_official || Number(gpaStats.semesters_recorded) > 0);
  const cgpa = hasCgpa
    ? { value: gpaStats.cgpa, official: Boolean(gpaStats.cgpa_official), earnedCredits: gpaStats.total_earned_credits ?? null }
    : null;

  // Counted from the dossier's full query list: its query_summary counts
  // only the categories retired in 0026.
  const categoryChart = queryCategoryChartData(countQueriesByCategory(dossier.queries));

  return (
    <PortalShell>
      <PageHeader
        breadcrumb={
          <Link to={backPath} className="hover:text-primary hover:underline">
            ← {isHodView ? 'Students' : 'My mentees'}
          </Link>
        }
        title={student.name}
        subtitle={[
          student.registration_no ?? '—',
          student.branch ?? '—',
          `Section ${student.section ?? '—'}`,
          student.semester_label
        ].filter(Boolean).join(' · ')}
        actions={
          <>
            {!isHodView && (
              <button type="button" className="btn-secondary" onClick={toggleStar} disabled={pending}>
                <span
                  className="material-symbols-outlined text-[18px]"
                  style={{ fontVariationSettings: student.is_star_mentee ? "'FILL' 1" : "'FILL' 0" }}
                >
                  star
                </span>
                {student.is_star_mentee ? 'Remove as representative' : 'Make representative'}
              </button>
            )}
            <button type="button" className="btn-primary" onClick={downloadPdf} disabled={downloading}>
              <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
              {downloading ? 'Building report...' : 'Generate report'}
            </button>
          </>
        }
      />

      {/* key: a different student starts back on the current semester. */}
      <AcademicOverview
        key={studentId}
        audience="staff"
        semesterLabel={student.semester_label}
        attendance={attendance}
        semesterGpas={dossier.semester_gpas ?? []}
        cgpa={cgpa}
        gpaHidden={!dossier.gpa_shared}
        backlogs={dossier.backlogs ?? []}
        blackDots={dossier.black_dots ?? []}
      />

      <div className="mb-4 mt-8">
        <h2 className="text-headline-sm text-on-surface">Mentoring record</h2>
        <p className="mt-0.5 text-body-sm text-on-surface-variant">
          Queries raised, the Form A record and achievements.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Queries raised" value={queries.total} icon="confirmation_number" tone="secondary"
          caption={`${queries.resolved} resolved`} />
        <StatCard label="Achievements" value={dossier.achievements.length} icon="military_tech" tone="success"
          caption={`${dossier.achievements.filter((a) => a.verified).length} verified`} />
        <StatCard label="Avg resolution" value={formatHours(queries.avg_resolution_hours)} icon="timer" tone="info" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel tab="Queries by category" tabIcon="bar_chart">
          <CategoryBarChart data={categoryChart} height={260} allLabels />
        </Panel>

        <Panel tab="Query history" tabIcon="history" className="lg:col-span-2" bodyClassName="">
          <DataTable
            dense
            columns={[
              { key: 'query_code', header: 'Ref' },
              { key: 'subject', header: 'Subject' },
              { key: 'category', header: 'Category', render: (row) => <CategoryBadge category={row.category} /> },
              { key: 'status', header: 'Status', render: (row) => <QueryStatusBadge status={row.status} /> },
              { key: 'created_at', header: 'Raised', render: (row) => formatDate(row.created_at) }
            ]}
            rows={dossier.queries ?? []}
            rowKey={(row) => row.query_code}
            emptyState={<EmptyState icon="inbox" title="No queries" description="This student has not raised any queries." />}
          />
        </Panel>
      </div>

      <Panel tab="Form A record" tabIcon="assignment" className="mt-4">
        {formA ? (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Date of birth', formatDate(formA.date_of_birth)],
              ['Blood group', formA.blood_group],
              ['Mobile', formA.mobile_no],
              ['Email', formA.email],
              ['Hostel', formA.is_day_scholar ? 'Day scholar' : `${formA.hostel_block ?? '—'} / Room ${formA.room_no ?? '—'}`],
              ['MUJ alumni in family', formA.has_muj_alumni_in_family ? 'Yes' : 'No'],
              ["Father", `${formA.father.name}${formA.father.occupation ? ` (${formA.father.occupation})` : ''}`],
              ["Mother", `${formA.mother.name}${formA.mother.occupation ? ` (${formA.mother.occupation})` : ''}`],
              ['Communication address', `${formA.communication_address}, ${formA.communication_pin_code}`],
              ['Permanent address', `${formA.permanent_address}, ${formA.permanent_pin_code}`],
              ['Submitted', formatDate(formA.submitted_at)]
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-label-sm uppercase tracking-wide text-tertiary">{label}</dt>
                <dd className="mt-0.5 break-anywhere text-body-sm text-on-surface">{value || '—'}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <EmptyState
            icon="assignment_late"
            title="Form A not submitted"
            description="This student has not completed their one-time onboarding form yet."
          />
        )}
      </Panel>

      <Panel tab={`Achievements (${dossier.achievements.length})`} tabIcon="military_tech" className="mt-4" bodyClassName="">
        {dossier.achievements.length === 0 ? (
          <EmptyState icon="military_tech" title="No achievements recorded" description="Nothing added by the student yet." />
        ) : (
          <ul className="divide-y divide-surface-container">
            {dossier.achievements.map((achievement) => {
              const meta = ACHIEVEMENT_CATEGORIES.find((c) => c.value === achievement.category);
              return (
                <li key={achievement.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <span className="material-symbols-outlined mt-0.5 text-[20px] text-primary" aria-hidden="true">
                    {meta?.icon ?? 'star'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-label-md text-on-surface">{achievement.title}</span>
                    <span className="text-label-sm text-tertiary">
                      {meta?.label} · {formatDate(achievement.achieved_on)}
                    </span>
                    {achievement.description && (
                      <span className="mt-1 block text-body-sm text-on-surface-variant">{achievement.description}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    {achievement.proof_file_path && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => viewProof(achievement.proof_file_path)}>
                        Proof
                      </button>
                    )}
                    <button
                      type="button"
                      className={achievement.verified ? 'btn-ghost btn-sm text-success' : 'btn-secondary btn-sm'}
                      onClick={() => toggleVerify(achievement)}
                      disabled={pending}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {achievement.verified ? 'verified' : 'check'}
                      </span>
                      {achievement.verified ? 'Verified' : 'Verify'}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </PortalShell>
  );
}
