import { useState } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonTable } from '../../components/ui/Skeleton.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { SelectField, TextAreaField, Pagination } from '../../components/ui/FormControls.jsx';
import {
  QueryStatusBadge, CategoryBadge, PriorityBadge, ResolutionBadge, MentorKindBadge
} from '../../components/ui/StatusBadge.jsx';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useRealtimeQueries } from '../../hooks/useRealtimeQueries.js';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { supabase } from '../../lib/supabaseClient.js';
import { formatRelativeTime } from '../../lib/formatters.js';
import { QUERY_CATEGORIES, QUERY_STATUSES } from '../../lib/constants.js';
import { usePortalPaths } from '../../hooks/usePortalPaths.js';

export default function FacultyQueryQueuePage({ isHodView = false }) {
  const { departmentBase } = usePortalPaths();
  const { profile } = useAuth();
  const [status, setStatus] = useState('All');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  // The queue is the queries sent to this faculty member; those a senior
  // raised to them are on Raised to Me. All Queries leaves out what was
  // escalated to the HOD, which is on Raised to HOD (0042).
  const { queries, loading, page, setPage, pageCount, total, reload } = useRealtimeQueries({
    status,
    category,
    search,
    mentorId: isHodView ? undefined : profile?.id,
    excludeEscalated: isHodView
  });
  const { run, pending } = useAsyncAction();
  const [raiseTarget, setRaiseTarget] = useState(null);
  const [raiseNote, setRaiseNote] = useState('');

  const basePath = isHodView ? `${departmentBase}/queries` : '/faculty/queries';

  // Goes to the HOD set on My Mentees, not to every HOD in the department.
  const raiseToHod = () =>
    run(
      async () => {
        const { error } = await supabase.rpc('escalate_query_to_hod', {
          p_query_id: raiseTarget.id,
          p_note: raiseNote.trim() || null
        });
        if (error) throw error;
      },
      {
        successMessage: `${raiseTarget?.query_code} sent to your HOD.`,
        onSuccess: () => {
          setRaiseTarget(null);
          setRaiseNote('');
          reload();
        }
      }
    );

  const columns = [
    { key: 'query_code', header: 'Ref', render: (row) => <span className="whitespace-nowrap font-semibold text-primary">{row.query_code}</span> },
    {
      key: 'subject',
      header: 'Subject',
      render: (row) => (
        <Link to={`${basePath}/${row.id}`} className="text-on-surface hover:text-primary hover:underline">
          {row.subject}
        </Link>
      )
    },
    {
      key: 'student',
      header: 'Student',
      render: (row) => (
        <span>
          <span className="block text-on-surface">{row.student?.full_name ?? '—'}</span>
          <span className="text-label-sm text-tertiary">{row.student?.login_id ?? ''}</span>
        </span>
      )
    },
    ...(isHodView
      ? [
          {
            key: 'mentor',
            header: 'Mentor',
            render: (row) => (
              <span>
                <span className="block text-on-surface">{row.mentor?.full_name ?? '—'}</span>
                {row.mentor_kind === 'senior' && <MentorKindBadge kind="senior" />}
              </span>
            )
          }
        ]
      : []),
    { key: 'category', header: 'Category', render: (row) => <CategoryBadge category={row.category} /> },
    { key: 'priority', header: 'Priority', render: (row) => <PriorityBadge priority={row.priority} /> },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span className="flex min-w-[7rem] flex-wrap items-center gap-1.5 whitespace-nowrap">
          <QueryStatusBadge status={row.status} />
          <ResolutionBadge resolutionStatus={row.resolution_status} />
        </span>
      )
    },
    ...(isHodView
      ? []
      : [
          {
            key: 'raise',
            header: 'Raise to HOD',
            render: (row) =>
              row.escalated_to_hod ? (
                <span className="chip bg-info-container text-on-info-container">Sent</span>
              ) : (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setRaiseTarget(row);
                    setRaiseNote('');
                  }}
                >
                  <span className="material-symbols-outlined text-[16px]">flag</span>
                  Raise
                </button>
              )
          }
        ]),
    {
      key: 'last_message_at',
      header: 'Last update',
      render: (row) => <span className="text-tertiary">{formatRelativeTime(row.last_message_at)}</span>
    }
  ];

  return (
    <PortalShell searchPlaceholder="Search queries by subject or reference..." onSearch={setSearch}>
      <PageHeader
        title={isHodView ? 'All queries' : 'Query queue'}
        subtitle={
          isHodView
            ? 'Every support query across your mentors. Queries escalated to the HOD are under Raised to HOD.'
            : 'Queries raised by your mentees. Updates arrive live — no need to refresh.'
        }
      />

      <Panel tab="Filters" tabIcon="filter_alt" className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <SelectField
            label="Status"
            className="w-full sm:w-56"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={['All', ...QUERY_STATUSES]}
          />
          <SelectField
            label="Category"
            className="w-full sm:w-56"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            options={['All', ...QUERY_CATEGORIES]}
          />
          {(status !== 'All' || category !== 'All') && (
            <button
              type="button"
              className="btn-ghost btn-sm mb-0.5"
              onClick={() => {
                setStatus('All');
                setCategory('All');
              }}
            >
              <span className="material-symbols-outlined text-[17px]">filter_alt_off</span>
              Clear filters
            </button>
          )}
        </div>
      </Panel>

      {loading ? (
        <SkeletonTable rows={8} columns={7} />
      ) : (
        <Panel bodyClassName="">
          <DataTable
            columns={columns}
            rows={queries}
            rowKey={(row) => row.id}
            emptyState={
              <EmptyState
                icon="inbox"
                title="No queries here"
                description="Nothing matches these filters right now."
                action={
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setStatus('All');
                      setCategory('All');
                    }}
                  >
                    Clear filters
                  </button>
                }
              />
            }
            footer={<Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} />}
          />
        </Panel>
      )}

      <Modal
        open={Boolean(raiseTarget)}
        onClose={() => setRaiseTarget(null)}
        size="sm"
        title={`Raise ${raiseTarget?.query_code ?? 'this query'} to the HOD?`}
        description="It goes to the HOD set on My Mentees, with your note attached."
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setRaiseTarget(null)} disabled={pending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={raiseToHod} disabled={pending}>
              {pending ? 'Sending...' : 'Raise to HOD'}
            </button>
          </>
        }
      >
        <p className="mb-3 text-body-sm text-on-surface-variant">
          {raiseTarget?.subject} — {raiseTarget?.student?.full_name ?? 'student'}
        </p>
        <TextAreaField
          label="What should the HOD know?"
          name="raise-note"
          rows={4}
          maxLength={1000}
          value={raiseNote}
          onChange={(event) => setRaiseNote(event.target.value)}
          hint="The student is told the query was referred, but is not shown this note."
        />
      </Modal>
    </PortalShell>
  );
}
