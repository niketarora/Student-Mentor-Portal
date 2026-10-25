/**
 * ClusterHeadCyclesPage — Academic Cycles.
 *
 * One cycle per academic year ("2026–27"), each with an odd and an even
 * semester. Kept apart from a student's programme semester (1 to 8) on
 * purpose: the cycle is the department's year, the semester number is the
 * student's.
 *
 * The page follows the year's workflow:
 *   1. start the cycle
 *   2. import the roster, or carry last year's students over
 *   3. upload the mentor mapping
 *   4. upload data as it arrives (the upload screens file it here)
 *   5. download the cycle report
 * and underneath shows the whole cycle, or one semester, module by module.
 *
 * Starting the next cycle closes this one and leaves it exactly as it is,
 * so nothing from 2026–27 is overwritten by 2027–28. See migration 0036
 * for what moves and what carries on.
 *
 * Everything here comes from get_cycle_overview(): counts and averages,
 * never a student's name, and nothing about GPA values or at-risk flags,
 * which a cluster head cannot read.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { SkeletonCards } from '../../components/ui/Skeleton.jsx';
import { FilterPills } from '../../components/ui/FormControls.jsx';
import {
  StudentsModule, AttendanceModule, GpaModule, BacklogsModule, BlackDotsModule, UploadsModule
} from '../../components/clusterHead/cycles/CycleModules.jsx';
import { StartCycleModal, EditCycleDatesModal } from '../../components/clusterHead/cycles/CycleDialogs.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { apiClient } from '../../lib/apiClient.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { refreshActiveCycle } from '../../hooks/useActiveCycle.js';
import { describeError, formatDate } from '../../lib/formatters.js';
import {
  SEMESTERS, cycleLabel, nextCycleYear, semesterRange, semesterTitle
} from '../../lib/academicCycles.js';
import { usePortalPaths } from '../../hooks/usePortalPaths.js';

const count = (value) => Number(value ?? 0).toLocaleString('en-IN');

const TABS = [
  { key: 'students', label: 'Students', icon: 'group' },
  { key: 'attendance', label: 'Attendance', icon: 'fact_check' },
  { key: 'gpa', label: 'GPA', icon: 'grade' },
  { key: 'backlogs', label: 'Backlogs', icon: 'assignment_late' },
  { key: 'black_dots', label: 'Black dots', icon: 'gavel' },
  { key: 'uploads', label: 'Uploads', icon: 'history' }
];

/** Re-evaluates every student's at-risk flags in slices, reporting progress. */
async function recheckAtRiskFlags(onProgress) {
  let after = null;
  for (;;) {
    const { data, error } = await supabase.rpc('reevaluate_students_batch', { p_after: after, p_limit: 300 });
    if (error) throw error;
    onProgress?.({ done: data?.done ?? 0, total: data?.total ?? 0 });
    if (!data?.next_after) return data;
    after = data.next_after;
  }
}

const STEP_TONES = {
  done: 'bg-success-container text-on-success-container',
  attention: 'bg-warning-container text-on-warning-container',
  todo: 'bg-surface-container-high text-on-surface-variant'
};

function WorkflowStep({ number, title, status, detail, children }) {
  return (
    <li className="panel flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-label-md ${STEP_TONES[status]}`}
          aria-label={status === 'done' ? 'Done' : status === 'attention' ? 'Needs attention' : 'To do'}
        >
          {status === 'done' ? (
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">check</span>
          ) : (
            number
          )}
        </span>
        <p className="text-label-md text-on-surface">{title}</p>
      </div>
      <p className="text-body-sm text-on-surface-variant">{detail}</p>
      {children && <div className="mt-auto flex flex-wrap gap-2">{children}</div>}
    </li>
  );
}

function SemesterCard({ cycle, semester, isCurrent }) {
  const range = semesterRange(cycle, semester);
  return (
    <div className={`rounded-xl border px-4 py-3 ${isCurrent ? 'border-primary bg-primary-fixed/40' : 'border-outline-variant bg-surface-container-lowest'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">{semesterTitle(cycle, semester)}</p>
        {isCurrent && <span className="chip bg-primary text-on-primary">Now</span>}
      </div>
      <p className="mt-1 text-body-sm text-on-surface">
        {formatDate(range.from)} – {formatDate(range.to)}
      </p>
    </div>
  );
}

export default function ClusterHeadCyclesPage() {
  const { uploadsBase } = usePortalPaths();
  const toast = useToast();

  const [cycles, setCycles] = useState([]);
  const [viewId, setViewId] = useState(null);
  const [semester, setSemester] = useState('all');
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('students');
  const [dialog, setDialog] = useState(null); // 'start' | 'dates' | { delete: cycle }
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const loadCycles = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_academic_cycles');
    if (error) toast.error(describeError(error));
    setCycles(data ?? []);
  }, [toast]);

  const loadOverview = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_cycle_overview', {
      p_cycle_id: viewId,
      p_semester: semester === 'all' ? null : semester
    });
    if (error) toast.error(describeError(error));
    setOverview(data ?? null);
    setLoading(false);
  }, [viewId, semester, toast]);

  useEffect(() => {
    loadCycles();
  }, [loadCycles]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const reloadAll = () => Promise.all([loadCycles(), loadOverview(), refreshActiveCycle()]);

  const cycle = overview?.cycle ?? null;
  const activeCycle = cycles.find((row) => row.is_active) ?? null;
  const viewingActive = Boolean(cycle?.is_active);
  const students = overview?.students ?? {};
  const uploads = overview?.uploads ?? {};
  const previous = overview?.previous_cycle ?? null;
  const suggestedYear = useMemo(() => nextCycleYear(cycles), [cycles]);

  const semesterOptions = [
    { value: 'all', label: 'Whole cycle' },
    ...SEMESTERS.map((value) => ({ value, label: cycle ? semesterTitle(cycle, value) : value }))
  ];

  const tabCounts = {
    students: students.activated,
    attendance: (overview?.attendance?.by_subject ?? []).length,
    gpa: overview?.gpa?.uploads,
    backlogs: overview?.backlogs?.open,
    black_dots: overview?.black_dots?.black_dots,
    uploads: uploads.total
  };

  /* ── Actions ─────────────────────────────────────────────────────── */

  const recheck = async () => {
    setProgress({ stage: 'recheck', done: 0, total: 0 });
    await recheckAtRiskFlags((next) => setProgress({ stage: 'recheck', ...next }));
    setProgress(null);
  };

  const startCycle = async (values) => {
    setWorking(true);
    setProgress({ stage: 'start' });
    try {
      const { data, error } = await supabase.rpc('create_academic_cycle', {
        p_start_year: values.start_year,
        p_starts_on: values.starts_on,
        p_even_starts_on: values.even_starts_on,
        p_ends_on: values.ends_on
      });
      if (error) throw error;
      await recheck();
      setDialog(null);
      setViewId(null);
      setSemester('all');
      await reloadAll();
      toast.success(
        `${cycleLabel(data?.cycle?.label)} has started.` +
          (data?.subjects_copied ? ` ${data.subjects_copied} subject(s) copied across.` : '') +
          ' Next: import the student roster or carry students over.'
      );
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setWorking(false);
      setProgress(null);
    }
  };

  const saveDates = async (dates) => {
    setWorking(true);
    try {
      const { error } = await supabase.rpc('update_academic_cycle_dates', {
        p_cycle_id: cycle.id,
        p_starts_on: dates.starts_on,
        p_even_starts_on: dates.even_starts_on,
        p_ends_on: dates.ends_on
      });
      if (error) throw error;
      setDialog(null);
      await reloadAll();
      toast.success('Dates saved. Uploads are re-filed under the semesters the new dates give them.');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setWorking(false);
    }
  };

  const deleteCycle = async (target) => {
    setWorking(true);
    try {
      const { data, error } = await supabase.rpc('delete_academic_cycle', { p_cycle_id: target.id });
      if (error) throw error;
      if (target.is_active) await recheck();
      setDialog(null);
      if (viewId === target.id) setViewId(null);
      await reloadAll();
      toast.success(`${cycleLabel(data?.deleted)} removed. ${cycleLabel(data?.active?.label)} is the active cycle.`);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setWorking(false);
      setProgress(null);
    }
  };

  const carryOver = async () => {
    setWorking(true);
    try {
      const { data, error } = await supabase.rpc('carry_over_cycle_students', { p_from_cycle_id: previous.id });
      if (error) throw error;
      await loadOverview();
      await loadCycles();
      toast.success(`${count(data?.carried_over)} student(s) carried over from ${cycleLabel(previous.label)}.`);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setWorking(false);
    }
  };

  const recheckNow = async () => {
    setWorking(true);
    try {
      await recheck();
      await loadOverview();
      toast.success('At-risk flags re-checked against this cycle.');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setWorking(false);
      setProgress(null);
    }
  };

  const downloadReport = async () => {
    if (!cycle) return;
    setDownloading(true);
    try {
      const suffix = semester === 'all' ? '' : `-${semester.toLowerCase()}-semester`;
      await apiClient.downloadFile(
        '/reports/academic-cycle-report',
        { cycle_id: cycle.id, ...(semester === 'all' ? {} : { semester }) },
        `cycle-report-${cycle.label}${suffix}.xlsx`
      );
      toast.success('Cycle report downloaded.');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setDownloading(false);
    }
  };

  /* ── Workflow status ─────────────────────────────────────────────── */

  const studentStatus = students.activated > 0 ? (students.not_activated > 0 ? 'attention' : 'done') : 'todo';
  const mentorStatus = !students.activated ? 'todo' : students.without_mentor > 0 ? 'attention' : 'done';
  const dataStatus = uploads.total > 0 ? 'done' : 'todo';

  return (
    <PortalShell>
      <PageHeader
        title="Academic cycles"
        subtitle="One cycle per academic year, each with an odd and an even semester. Everything uploaded is kept against the cycle it belongs to, so starting the next one never overwrites this one."
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={downloadReport} disabled={!cycle || downloading}>
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">download</span>
              {downloading ? 'Preparing...' : 'Download report'}
            </button>
            <button type="button" className="btn-primary" onClick={() => setDialog('start')} disabled={working}>
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">event_repeat</span>
              Start next cycle
            </button>
          </>
        }
      />

      {loading ? (
        <SkeletonCards count={4} />
      ) : !cycle ? (
        <Panel>
          <EmptyState icon="event_repeat" title="No academic cycle yet"
            description="Start one to begin filing uploads, rosters and mentor assignments under it." />
        </Panel>
      ) : (
        <>
          {/* What is being looked at */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <span className="text-label-sm uppercase tracking-wide text-on-surface-variant">Cycle</span>
              <select
                className="field-input w-auto min-w-[10rem] py-2"
                value={cycle.id}
                onChange={(event) => {
                  const next = cycles.find((row) => row.id === event.target.value);
                  setViewId(next?.is_active ? null : event.target.value);
                }}
              >
                {cycles.map((row) => (
                  <option key={row.id} value={row.id}>
                    {cycleLabel(row.label)}{row.is_active ? ' (active)' : ' (closed)'}
                  </option>
                ))}
              </select>
            </label>
            <FilterPills ariaLabel="Semester" value={semester} onChange={setSemester} options={semesterOptions} />
          </div>

          {/* The cycle and its two semesters */}
          <section className="panel mb-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-fixed text-primary">
                  <span className="material-symbols-outlined text-[24px]" aria-hidden="true">event_repeat</span>
                </span>
                <div>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-headline-md leading-none text-on-surface">{cycleLabel(cycle.label)}</span>
                    {viewingActive ? (
                      <span className="chip bg-success-container text-on-success-container">Active</span>
                    ) : (
                      <span className="chip bg-surface-container-high text-on-surface-variant">Closed</span>
                    )}
                  </p>
                  <p className="mt-1 text-body-sm text-on-surface-variant">
                    {formatDate(cycle.starts_on)} – {formatDate(cycle.ends_on)}
                    {viewingActive && cycle.activated_at ? ` · started ${formatDate(cycle.activated_at)}` : ''}
                    {!viewingActive && cycle.closed_at ? ` · closed ${formatDate(cycle.closed_at)}` : ''}
                  </p>
                </div>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setDialog('dates')} disabled={working}>
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">edit_calendar</span>
                Edit dates
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {SEMESTERS.map((value) => (
                <SemesterCard key={value} cycle={cycle} semester={value} isCurrent={cycle.current_semester === value} />
              ))}
            </div>
            {!viewingActive && (
              <p className="mt-4 rounded-lg bg-surface-container-low px-4 py-3 text-body-sm text-on-surface-variant">
                A closed cycle is kept exactly as it was. Uploads go into{' '}
                <strong className="text-on-surface">{cycleLabel(activeCycle?.label)}</strong>.
              </p>
            )}
          </section>

          {viewingActive && overview?.stale_risk_flags > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning-container bg-warning-container/40 px-4 py-3">
              <span className="material-symbols-outlined text-[20px] text-warning" aria-hidden="true">sync_problem</span>
              <p className="min-w-0 flex-1 text-body-sm text-on-surface-variant">
                At-risk flags for {count(overview.stale_risk_flags)} students were last checked before{' '}
                {cycleLabel(cycle.label)} started, so they may still count last year&apos;s attendance or black dots.
                {progress?.stage === 'recheck' && progress.total > 0 && (
                  <span role="status"> Re-checking: {count(progress.done)} of {count(progress.total)}...</span>
                )}
              </p>
              <button type="button" className="btn-secondary btn-sm" onClick={recheckNow} disabled={working}>
                {working ? 'Re-checking...' : 'Re-check now'}
              </button>
            </div>
          )}

          {/* The year's workflow */}
          {viewingActive && (
            <ol className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <WorkflowStep number={1} title="Create the cycle" status="done"
                detail={`Started ${formatDate(cycle.activated_at ?? cycle.created_at)}. Uploads are filed under it.`} />
              <WorkflowStep number={2} title="Import or activate students" status={studentStatus}
                detail={
                  students.activated
                    ? `${count(students.activated)} students in this cycle` +
                      (students.not_activated ? `; ${count(students.not_activated)} accounts not activated yet.` : '.')
                    : 'Import this year\'s roster, or bring last year\'s students across.'
                }
              >
                <Link to={`${uploadsBase}/rosters`} className="btn-secondary btn-sm">Import roster</Link>
                {previous && overview?.students?.previous_not_here > 0 && (
                  <button type="button" className="btn-ghost btn-sm" onClick={carryOver} disabled={working}>
                    Carry over {count(overview.students.previous_not_here)} from {cycleLabel(previous.label)}
                  </button>
                )}
              </WorkflowStep>
              <WorkflowStep number={3} title="Assign mentors" status={mentorStatus}
                detail={
                  students.activated
                    ? `${count(students.with_mentor)} of ${count(students.activated)} have a mentor` +
                      (students.without_mentor ? `; ${count(students.without_mentor)} still need one.` : '.')
                    : 'Upload the mentor–mentee mapping once students are in.'
                }
              >
                <Link to={`${uploadsBase}/rosters`} className="btn-secondary btn-sm">Upload mapping</Link>
              </WorkflowStep>
              <WorkflowStep number={4} title="Track data" status={dataStatus}
                detail={
                  uploads.total
                    ? `${count(uploads.total)} upload(s) in ${semester === 'all' ? 'this cycle' : semesterTitle(cycle, semester)}.`
                    : 'Attendance, GPA, backlogs and black dots, whenever they arrive.'
                }
              >
                <Link to={`${uploadsBase}/attendance`} className="btn-ghost btn-sm">Attendance</Link>
                <Link to={`${uploadsBase}/gpa`} className="btn-ghost btn-sm">GPA</Link>
                <Link to={`${uploadsBase}/backlogs`} className="btn-ghost btn-sm">Backlogs</Link>
                <Link to={`${uploadsBase}/black-dots`} className="btn-ghost btn-sm">Black dots</Link>
              </WorkflowStep>
              <WorkflowStep number={5} title="Generate the report" status="todo"
                detail={`An Excel report of ${semester === 'all' ? 'the whole cycle' : semesterTitle(cycle, semester)}: students, mentors, attendance, backlogs, black dots and uploads.`}
              >
                <button type="button" className="btn-secondary btn-sm" onClick={downloadReport} disabled={downloading}>
                  {downloading ? 'Preparing...' : 'Download .xlsx'}
                </button>
              </WorkflowStep>
            </ol>
          )}

          {/* Module by module */}
          <div role="tablist" aria-label="Cycle modules" className="mb-4 flex gap-1 overflow-x-auto border-b border-topbar-border">
            {TABS.map((item) => {
              const selected = tab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(item.key)}
                  className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-label-md transition-colors ${
                    selected
                      ? 'border-primary text-primary'
                      : 'border-transparent text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{item.icon}</span>
                  {item.label}
                  {tabCounts[item.key] != null && (
                    <span className={`rounded-full px-2 text-label-sm ${selected ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container text-tertiary'}`}>
                      {count(tabCounts[item.key])}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div role="tabpanel" className="mb-6">
            {semester !== 'all' && tab === 'students' && (
              <p className="mb-3 text-body-sm text-tertiary">Students and mentors belong to the whole cycle, so the semester does not change them.</p>
            )}
            {tab === 'students' && <StudentsModule overview={overview} />}
            {tab === 'attendance' && <AttendanceModule overview={overview} />}
            {tab === 'gpa' && <GpaModule overview={overview} />}
            {tab === 'backlogs' && <BacklogsModule overview={overview} />}
            {tab === 'black_dots' && <BlackDotsModule overview={overview} />}
            {tab === 'uploads' && <UploadsModule overview={overview} />}
          </div>

          <Panel tab="All cycles" tabIcon="calendar_month" bodyClassName="">
            <DataTable
              dense
              columns={[
                {
                  key: 'label',
                  header: 'Cycle',
                  render: (row) => (
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <span className="text-label-md text-on-surface">{cycleLabel(row.label)}</span>
                      {row.is_active && <span className="chip bg-success-container text-on-success-container">Active</span>}
                    </span>
                  )
                },
                { key: 'dates', header: 'Dates', render: (row) => `${formatDate(row.starts_on)} – ${formatDate(row.ends_on)}` },
                { key: 'students', header: 'Students', align: 'right', render: (row) => count(row.students) },
                { key: 'uploads', header: 'Uploads', align: 'right', render: (row) => count(row.uploads) },
                { key: 'roster_imports', header: 'Roster imports', align: 'right', render: (row) => count(row.roster_imports) },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  render: (row) => (
                    <span className="flex justify-end gap-1">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => setViewId(row.is_active ? null : row.id)}
                        disabled={row.id === cycle.id}
                      >
                        {row.id === cycle.id ? 'Viewing' : 'View'}
                      </button>
                      {row.can_delete && (
                        <button type="button" className="btn-ghost btn-sm text-error" onClick={() => setDialog({ delete: row })}>
                          Remove
                        </button>
                      )}
                    </span>
                  )
                }
              ]}
              rows={cycles}
              rowKey={(row) => row.id}
            />
          </Panel>
        </>
      )}

      {dialog === 'start' && (
        <StartCycleModal
          onClose={() => setDialog(null)}
          activeCycle={activeCycle}
          suggestedYear={suggestedYear}
          pending={working}
          progress={progress}
          onSubmit={startCycle}
        />
      )}
      {dialog === 'dates' && cycle && (
        <EditCycleDatesModal onClose={() => setDialog(null)} cycle={cycle} pending={working} onSubmit={saveDates} />
      )}
      <ConfirmDialog
        open={Boolean(dialog?.delete)}
        onClose={() => setDialog(null)}
        onConfirm={() => deleteCycle(dialog.delete)}
        title={`Remove ${cycleLabel(dialog?.delete?.label)}?`}
        message={
          dialog?.delete?.is_active
            ? `Nothing has been uploaded into it, so it can still be removed. Its copied subjects and its student list go with it, and the latest remaining cycle becomes active again.`
            : 'Nothing has been uploaded into it, so it can still be removed.'
        }
        confirmLabel="Remove cycle"
        tone="danger"
        pending={working}
      />
    </PortalShell>
  );
}
