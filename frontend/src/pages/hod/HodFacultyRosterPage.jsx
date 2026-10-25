/**
 * FEATURE 8 — HOD faculty roster and reassignment on departure.
 *
 * Flow: mark a faculty member as departed -> the portal surfaces their
 * full mentee list -> pick target mentors from the reserve pool (with live
 * capacity) -> confirm -> mentees and their unresolved queries move over,
 * everyone involved is notified, and the move is written to the audit log.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { SkeletonTable } from '../../components/ui/Skeleton.jsx';
import { EmploymentBadge } from '../../components/ui/StatusBadge.jsx';
import { SelectField, TextAreaField, CheckboxField } from '../../components/ui/FormControls.jsx';
import { apiClient } from '../../lib/apiClient.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { describeError } from '../../lib/formatters.js';
import { EMPLOYMENT_STATUS_LABELS } from '../../lib/constants.js';

export default function HodFacultyRosterPage() {
  const toast = useToast();
  const { run, pending } = useAsyncAction();

  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [statusTarget, setStatusTarget] = useState(null);
  const [nextStatus, setNextStatus] = useState('departed');

  const [reassignFor, setReassignFor] = useState(null);
  const [mentees, setMentees] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [targetFaculty, setTargetFaculty] = useState('');
  const [reason, setReason] = useState('');
  const [loadingMentees, setLoadingMentees] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get('/admin/manage-faculty-roster', { action: 'roster' });
      setRoster(data.faculty ?? []);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openReassign = async (faculty) => {
    setReassignFor(faculty);
    setSelected(new Set());
    setTargetFaculty('');
    setReason('');
    setLoadingMentees(true);
    try {
      const data = await apiClient.get('/admin/manage-faculty-roster', {
        action: 'mentees',
        faculty_id: faculty.faculty_id
      });
      setMentees(data.mentees ?? []);
      setSelected(new Set((data.mentees ?? []).map((m) => m.id)));
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setLoadingMentees(false);
    }
  };

  const changeStatus = () =>
    run(
      async () => {
        const result = await apiClient.post('/admin/manage-faculty-roster', {
          action: 'set-status',
          faculty_id: statusTarget.faculty_id,
          employment_status: nextStatus
        });
        return result;
      },
      {
        successMessage: 'Status updated.',
        onSuccess: async (result) => {
          const target = statusTarget;
          setStatusTarget(null);
          await load();
          if (result?.needs_reassignment) {
            toast.warning(`${target.full_name} still has ${result.mentee_count} mentees. Reassign them now.`);
            openReassign(target);
          }
        }
      }
    );

  const submitReassignment = () =>
    run(
      async () => {
        if (!targetFaculty) throw new Error('Choose a faculty member to receive these mentees.');
        if (selected.size === 0) throw new Error('Select at least one student.');
        return apiClient.post('/admin/manage-faculty-roster', {
          action: 'reassign',
          student_ids: [...selected],
          from_faculty_id: reassignFor.faculty_id,
          to_faculty_id: targetFaculty,
          reason: reason.trim() || null
        });
      },
      {
        successMessage: 'Mentees reassigned. Everyone involved has been notified.',
        onSuccess: async () => {
          setReassignFor(null);
          await load();
        }
      }
    );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return roster;
    return roster.filter(
      (f) => f.full_name?.toLowerCase().includes(term) || f.email?.toLowerCase().includes(term)
    );
  }, [roster, search]);

  const reservePool = useMemo(
    () =>
      roster
        .filter(
          (f) =>
            f.employment_status === 'active' &&
            f.available_for_reassignment &&
            f.faculty_id !== reassignFor?.faculty_id
        )
        .map((f) => ({
          value: f.faculty_id,
          label: `${f.full_name} — ${f.current_mentees}/${f.mentee_capacity} mentees (${f.remaining_capacity} free)`
        })),
    [roster, reassignFor]
  );

  const toggleAll = (checked) =>
    setSelected(checked ? new Set(mentees.map((m) => m.id)) : new Set());

  const toggleOne = (id, checked) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const summary = useMemo(
    () => ({
      total: roster.length,
      active: roster.filter((f) => f.employment_status === 'active').length,
      departed: roster.filter((f) => f.employment_status === 'departed').length,
      available: roster.filter((f) => f.employment_status === 'active' && f.available_for_reassignment).length,
      orphaned: roster
        .filter((f) => f.employment_status === 'departed')
        .reduce((sum, f) => sum + f.current_mentees, 0)
    }),
    [roster]
  );

  return (
    <PortalShell searchPlaceholder="Search faculty by name or email..." onSearch={setSearch}>
      <PageHeader
        title="Faculty roster"
        subtitle="Manage employment status, see mentee load, and reassign mentees when a faculty member leaves."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Faculty" value={summary.total} icon="badge" tone="primary" caption={`${summary.active} active`} />
        <StatCard label="Reserve pool" value={summary.available} icon="how_to_reg" tone="success"
          caption="available to take mentees" />
        <StatCard label="Departed" value={summary.departed} icon="logout" tone={summary.departed ? 'error' : 'slate'} />
        <StatCard label="Mentees needing a new mentor" value={summary.orphaned} icon="group_off"
          tone={summary.orphaned ? 'warning' : 'success'} caption="under departed faculty" />
      </div>

      {loading ? (
        <SkeletonTable rows={8} columns={7} />
      ) : (
        <Panel bodyClassName="">
          <DataTable
            columns={[
              {
                key: 'full_name',
                header: 'Faculty',
                render: (row) => (
                  <span>
                    <span className="block text-on-surface">{row.full_name}</span>
                    <span className="text-label-sm text-tertiary">{row.email}</span>
                  </span>
                )
              },
              { key: 'login_id', header: 'Faculty ID' },
              { key: 'branch', header: 'Branch' },
              { key: 'employment_status', header: 'Status', render: (row) => <EmploymentBadge status={row.employment_status} /> },
              {
                key: 'current_mentees',
                header: 'Mentees',
                align: 'right',
                render: (row) => `${row.current_mentees} / ${row.mentee_capacity}`
              },
              {
                key: 'available_for_reassignment',
                header: 'Accepting',
                render: (row) =>
                  row.available_for_reassignment && row.employment_status === 'active' ? (
                    <span className="chip bg-success-container text-on-success-container">Yes</span>
                  ) : (
                    <span className="chip bg-surface-container-high text-on-surface-variant">No</span>
                  )
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) => (
                  <span className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => {
                        setStatusTarget(row);
                        setNextStatus(row.employment_status === 'active' ? 'departed' : 'active');
                      }}
                    >
                      Change status
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => openReassign(row)}
                      disabled={row.current_mentees === 0}
                    >
                      Reassign mentees
                    </button>
                  </span>
                )
              }
            ]}
            rows={filtered}
            rowKey={(row) => row.faculty_id}
            emptyState={<EmptyState icon="badge" title="No faculty found" description="Import the faculty roster from Semester setup." />}
          />
        </Panel>
      )}

      {/* Status change */}
      <Modal
        open={Boolean(statusTarget)}
        onClose={() => setStatusTarget(null)}
        title={`Change status — ${statusTarget?.full_name ?? ''}`}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setStatusTarget(null)} disabled={pending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={changeStatus} disabled={pending}>
              {pending ? 'Saving...' : 'Update status'}
            </button>
          </>
        }
      >
        <SelectField
          label="Employment status"
          value={nextStatus}
          onChange={(event) => setNextStatus(event.target.value)}
          options={Object.entries(EMPLOYMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <p className="mt-3 text-body-sm text-on-surface-variant">
          Marking someone as departed does not move their mentees automatically — you will be taken to the
          reassignment step so you stay in control of who gets whom.
        </p>
        {statusTarget?.current_mentees > 0 && nextStatus === 'departed' && (
          <p className="mt-2 rounded bg-warning-container/60 px-3 py-2 text-body-sm text-on-warning-container">
            {statusTarget.full_name} currently mentors {statusTarget.current_mentees} student(s).
          </p>
        )}
      </Modal>

      {/* Reassignment */}
      <Modal
        open={Boolean(reassignFor)}
        onClose={() => setReassignFor(null)}
        size="lg"
        title={`Reassign mentees from ${reassignFor?.full_name ?? ''}`}
        description="Select the students to move and choose their new mentor. Unresolved queries move with them."
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setReassignFor(null)} disabled={pending}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={submitReassignment}
              disabled={pending || !targetFaculty || selected.size === 0}
            >
              {pending ? 'Reassigning...' : `Reassign ${selected.size} student(s)`}
            </button>
          </>
        }
      >
        {loadingMentees ? (
          <SkeletonTable rows={5} columns={4} />
        ) : mentees.length === 0 ? (
          <EmptyState icon="groups" title="No mentees" description="This faculty member has no assigned students." />
        ) : (
          <div className="space-y-4">
            <SelectField
              label="New mentor (reserve pool — active faculty accepting mentees)"
              required
              placeholder="Choose a faculty member"
              value={targetFaculty}
              onChange={(event) => setTargetFaculty(event.target.value)}
              options={reservePool}
              hint={
                reservePool.length === 0
                  ? 'No faculty are currently marked as available. Update someone’s status first.'
                  : undefined
              }
            />

            <TextAreaField
              label="Reason (optional, recorded in the audit log)"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Faculty resigned effective 31 August 2026"
            />

            <div className="rounded border border-topbar-border">
              <div className="flex items-center justify-between border-b border-topbar-border bg-surface-container-low px-3 py-2">
                <CheckboxField
                  label={`Select all (${mentees.length})`}
                  checked={selected.size === mentees.length}
                  onChange={toggleAll}
                />
                <span className="text-label-sm text-tertiary">{selected.size} selected</span>
              </div>
              <ul className="custom-scrollbar max-h-64 divide-y divide-surface-container overflow-y-auto">
                {mentees.map((mentee) => (
                  <li key={mentee.id} className="flex items-center gap-3 px-3 py-2">
                    <CheckboxField
                      label=""
                      checked={selected.has(mentee.id)}
                      onChange={(checked) => toggleOne(mentee.id, checked)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm text-on-surface">{mentee.full_name}</span>
                      <span className="text-label-sm text-tertiary">
                        {mentee.login_id ?? '—'} · Section {mentee.section ?? '—'} · {mentee.branch ?? '—'}
                      </span>
                    </span>
                    {mentee.open_queries > 0 && (
                      <span className="chip bg-warning-container text-on-warning-container">
                        {mentee.open_queries} open
                      </span>
                    )}
                    {mentee.is_star_mentee && (
                      <span className="chip bg-primary-fixed text-on-primary-fixed">Rep</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Modal>
    </PortalShell>
  );
}
