/**
 * HodOperationsPage
 * The manual trigger for everything that normally runs on the 15-day
 * cycle: opening a survey, re-sweeping at-risk flags, dispatching
 * mentor-owned meetings, and sending survey reminders.
 *
 * WHY THIS SCREEN EXISTS
 * Waiting 15 days to find out whether a recurring job works is not a
 * testing strategy. Each button runs the real job against real data, right
 * now, and the run log below shows exactly what it did.
 *
 * TWO THINGS THIS SCREEN DELIBERATELY DOES NOT DO
 *   1. A manual run does NOT advance next_run_due_on. Press a button ten
 *      times this afternoon and the 15-day rhythm is exactly where it was.
 *   2. None of this is tied to Cluster Head uploads. An attendance file
 *      arriving early, late or twice has no effect on when these are due.
 */

import { useCallback, useEffect, useState } from 'react';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonCards } from '../../components/ui/Skeleton.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { apiClient } from '../../lib/apiClient.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { describeError, formatDate, formatDateTime } from '../../lib/formatters.js';
import { CYCLE_JOBS } from '../../lib/constants.js';

const STATUS_CHIP = {
  succeeded: 'bg-success-container text-on-success-container',
  failed: 'bg-error-container text-on-error-container',
  running: 'bg-warning-container text-on-warning-container'
};

/** Turns a job's jsonb result into a one-line human summary. */
function summariseResult(result) {
  if (!result || typeof result !== 'object') return '—';
  const parts = [];
  if (result.cycle_number != null) parts.push(`Cycle #${result.cycle_number}`);
  if (result.students_notified != null) parts.push(`${result.students_notified} students notified`);
  if (result.evaluated != null) parts.push(`${result.evaluated} evaluated`);
  if (result.at_risk != null) parts.push(`${result.at_risk} at risk`);
  if (result.meetings_created != null) parts.push(`${result.meetings_created} meetings created`);
  if (result.already_open != null && result.already_open > 0) parts.push(`${result.already_open} already open`);
  if (result.without_mentor != null && result.without_mentor > 0) {
    parts.push(`${result.without_mentor} without a mentor`);
  }
  if (result.reminders_sent != null) parts.push(`${result.reminders_sent} reminders sent`);
  if (result.note) parts.push(result.note);
  return parts.length ? parts.join(' · ') : '—';
}

export default function HodOperationsPage() {
  const toast = useToast();
  const { run, pending } = useAsyncAction();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await apiClient.get('/admin/run-cycle-job'));
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const fire = (jobType) =>
    run(
      async () =>
        apiClient.post('/admin/run-cycle-job', {
          job_type: jobType,
          // 'manual' is what keeps the schedule untouched — see the header
          // comment. A real cron would send 'scheduled' instead.
          trigger_source: 'manual',
          note: 'Fired from the HOD operations panel'
        }),
      {
        successMessage: 'Job finished. The 15-day schedule was left unchanged.',
        onSuccess: async () => {
          setConfirming(null);
          await load();
        },
        onError: () => setConfirming(null)
      }
    );

  const jobs = status?.jobs ?? [];
  const runs = status?.recent_runs ?? [];
  const activeCycle = status?.active_survey_cycle;

  const scheduleFor = (jobType) => jobs.find((job) => job.job_type === jobType);

  return (
    <PortalShell>
      <PageHeader
        title="Scheduled jobs"
        subtitle="Everything that normally runs on the 15-day cycle, plus a button to run each of them right now. Manual runs do the real work but never move the schedule."
        actions={
          <button type="button" className="btn-secondary btn-sm" onClick={load} disabled={loading || pending}>
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Refresh
          </button>
        }
      />

      {loading ? (
        <SkeletonCards count={4} />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Students at risk"
              value={status?.at_risk_count ?? 0}
              icon="e911_emergency"
              tone="error"
            />
            <StatCard
              label="Open meetings"
              value={status?.open_meeting_count ?? 0}
              icon="event_available"
              tone="warning"
              caption="Awaiting a link or scheduled"
            />
            <StatCard
              label="Active survey"
              value={activeCycle ? `#${activeCycle.cycle_number}` : 'None'}
              icon="ballot"
              tone="info"
              caption={activeCycle ? `Closes ${formatDate(activeCycle.closes_on)}` : 'Open one below'}
            />
            <StatCard
              label="Runs logged"
              value={runs.length}
              icon="history"
              tone="slate"
              caption="Last 25 shown"
            />
          </div>

          <div className="mb-4 grid gap-3 lg:grid-cols-2">
            {CYCLE_JOBS.map((job) => {
              const schedule = scheduleFor(job.value);
              return (
                <Panel key={job.value} tab={job.label} tabIcon={job.icon}>
                  <p className="text-body-sm text-on-surface-variant">{job.description}</p>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                    {[
                      ['Every', schedule ? `${schedule.interval_days} days` : '—'],
                      ['Next due', schedule?.next_run_due_on ? formatDate(schedule.next_run_due_on) : '—'],
                      ['Last run', schedule?.last_run_at ? formatDateTime(schedule.last_run_at) : 'Never']
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-label-sm uppercase tracking-wide text-tertiary">{label}</dt>
                        <dd className="mt-0.5 text-body-sm text-on-surface">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <button
                    type="button"
                    className="btn-primary btn-sm mt-4"
                    onClick={() => setConfirming(job)}
                    disabled={pending}
                  >
                    <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                    Run now
                  </button>
                </Panel>
              );
            })}
          </div>

          <Panel
            className="mb-4"
            tab="Run everything"
            tabIcon="bolt"
            actions={
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() =>
                  setConfirming({
                    value: 'all',
                    label: 'All three cycle jobs',
                    description:
                      'Re-evaluates every student, dispatches meetings for whoever is flagged, then opens a fresh survey cycle — in that order, so the meetings act on current data.'
                  })
                }
                disabled={pending}
              >
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                Run all now
              </button>
            }
          >
            <p className="text-body-sm text-on-surface-variant">
              Runs the at-risk sweep, then the meeting dispatch, then opens a new survey cycle. This is the
              one-button end-to-end test: after it finishes, check a mentor&apos;s At-Risk Students page and
              a student&apos;s Feedback Survey page.
            </p>
          </Panel>

          <Panel tab="Recent runs" tabIcon="history" bodyClassName="">
            <DataTable
              dense
              columns={[
                {
                  key: 'job_type',
                  header: 'Job',
                  render: (row) => CYCLE_JOBS.find((j) => j.value === row.job_type)?.label ?? row.job_type
                },
                {
                  key: 'trigger_source',
                  header: 'Trigger',
                  render: (row) => (
                    <span className="chip bg-surface-container-high text-on-surface-variant">
                      {row.trigger_source}
                    </span>
                  )
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (row) => (
                    <span className={`chip ${STATUS_CHIP[row.status] ?? ''}`}>{row.status}</span>
                  )
                },
                {
                  key: 'result',
                  header: 'What it did',
                  render: (row) => (
                    <span className="break-anywhere">{row.error_message || summariseResult(row.result)}</span>
                  )
                },
                {
                  key: 'duration_ms',
                  header: 'Took',
                  align: 'right',
                  render: (row) => (row.duration_ms != null ? `${row.duration_ms} ms` : '—')
                },
                {
                  key: 'started_at',
                  header: 'When',
                  render: (row) => formatDateTime(row.started_at)
                }
              ]}
              rows={runs}
              rowKey={(row) => row.id}
              emptyState={
                <EmptyState
                  icon="history"
                  title="Nothing has run yet"
                  description="Fire a job above and it will be logged here with everything it changed."
                />
              }
            />
          </Panel>
        </>
      )}

      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={() => fire(confirming.value)}
        pending={pending}
        title={`Run "${confirming?.label ?? ''}" now?`}
        confirmLabel="Run now"
        message={`${confirming?.description ?? ''} This runs against live data and sends real notifications. The 15-day schedule will not be advanced.`}
      />
    </PortalShell>
  );
}
