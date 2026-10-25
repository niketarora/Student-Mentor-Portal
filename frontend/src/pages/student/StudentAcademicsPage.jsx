/**
 * Academics — the student's own academic record.
 *
 * The whole page is the Academic Performance Overview (attendance per
 * subject, GPA, backlogs with their subjects, black dots): the same block
 * the mentor and the HOD see on this student's page, with its heading
 * moved up to be the page title. The overview's own header, and with it
 * the semester picker, is switched off here, so the student always sees
 * the current semester.
 *
 * EVERYTHING HERE IS WHAT THE DEPARTMENT RECORDED.
 * Students used to be able to record the GPA of a semester the department
 * had not published ("Record your GPA", below the overview). That panel
 * was removed, and migration 0037 closes the database paths to it as well
 * (upsert_semester_gpa and the direct-write policies on
 * student_semester_gpas). A GPA a student recorded before then is still
 * shown, marked as theirs, until a department upload replaces it.
 *
 * Every read here is RLS-scoped to the caller: attendance through
 * student_attendance_overview (the current academic cycle's), GPA and CGPA
 * through can_view_student_gpa(), backlogs and black dots through
 * can_access_student(). The explicit student_id filters only keep the
 * queries narrow.
 *
 * THE SHARING TOGGLE WAS REMOVED FROM THIS SCREEN.
 * gpa_sharing_enabled still exists on student_form_a_profiles, still
 * defaults to true, and can_view_student_gpa() in migration 0007 still
 * reads it — so the mechanism is intact and could be re-exposed without a
 * migration. What changed is that a student is no longer offered the
 * choice: mentors now need GPA to do the at-risk work, and a per-student
 * opt-out made the At-Risk Students page inconsistent about who it could
 * explain. set_gpa_sharing() is left in place and simply not called.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { PageLoader } from '../../components/ui/Skeleton.jsx';
import AcademicOverview, { OVERVIEW_DESCRIPTION } from '../../components/academics/AcademicOverview.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useToast } from '../../context/ToastProvider.jsx';
import { describeError } from '../../lib/formatters.js';

export default function StudentAcademicsPage() {
  const { profile } = useAuth();
  const toast = useToast();

  const [record, setRecord] = useState({ gpas: [], cgpa: null, attendance: [], backlogs: [], blackDots: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [gpaResult, cgpaResult, attendanceResult, backlogResult, blackDotResult] = await Promise.all([
      supabase
        .from('student_semester_gpas')
        .select('semester_number, gpa, earned_credits, source')
        .eq('student_id', profile.id)
        .order('semester_number'),
      // The official CGPA, once the department has uploaded the ERP export.
      supabase
        .from('student_cgpas')
        .select('cgpa, total_earned_credits, updated_at')
        .eq('student_id', profile.id)
        .maybeSingle(),
      // One row per subject, most recent reporting period.
      supabase
        .from('student_attendance_overview')
        .select('course_id, course_code, course_name, section_label, attendance_percent, classes_held, classes_attended, period_start, period_end')
        .eq('student_id', profile.id)
        .order('course_code'),
      supabase
        .from('student_backlogs')
        .select('subject_code, subject_name, semester_number, grade, credits, exam_session, is_cleared, cleared_at')
        .eq('student_id', profile.id),
      supabase
        .from('student_black_dots')
        .select('case_number, case_details, incident_date, incident_date_text, hostel_block, room_no, course_branch, previous_record, created_at')
        .eq('student_id', profile.id)
    ]);

    for (const result of [gpaResult, cgpaResult, attendanceResult, backlogResult, blackDotResult]) {
      if (result.error) toast.error(describeError(result.error));
    }

    setRecord({
      gpas: gpaResult.data ?? [],
      cgpa: cgpaResult.data ?? null,
      attendance: attendanceResult.data ?? [],
      backlogs: backlogResult.data ?? [],
      blackDots: blackDotResult.data ?? []
    });
    setLoading(false);
  }, [profile.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // The overview takes one shape for all three pages that show it.
  const overview = useMemo(() => {
    const semesterGpas = record.gpas.map((row) => ({
      semester: row.semester_number,
      gpa: row.gpa,
      earned_credits: row.earned_credits,
      source: row.source
    }));
    // The published CGPA is credit-weighted, so once the department has
    // uploaded it, it replaces the plain average of the semesters.
    let cgpa = null;
    if (record.cgpa) {
      cgpa = { value: record.cgpa.cgpa, official: true, earnedCredits: record.cgpa.total_earned_credits };
    } else if (semesterGpas.length) {
      const mean = semesterGpas.reduce((sum, row) => sum + Number(row.gpa), 0) / semesterGpas.length;
      cgpa = { value: Math.round(mean * 100) / 100, official: false, earnedCredits: null };
    }
    return {
      semesterGpas,
      cgpa,
      backlogs: record.backlogs.map((row) => ({ ...row, semester: row.semester_number })),
      blackDots: record.blackDots.map((row) => ({ ...row, recorded_at: row.created_at }))
    };
  }, [record]);

  if (loading) return <PortalShell><PageLoader label="Loading your academic record..." /></PortalShell>;

  return (
    <PortalShell>
      <PageHeader title="Academic performance overview" subtitle={OVERVIEW_DESCRIPTION} />

      <AcademicOverview
        audience="student"
        showHeader={false}
        semesterLabel={profile.semester_label}
        attendance={record.attendance}
        semesterGpas={overview.semesterGpas}
        cgpa={overview.cgpa}
        backlogs={overview.backlogs}
        blackDots={overview.blackDots}
      />
    </PortalShell>
  );
}
