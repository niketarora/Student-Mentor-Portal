import { useState } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonTable } from '../../components/ui/Skeleton.jsx';
import { SelectField, Pagination } from '../../components/ui/FormControls.jsx';
import {
  QueryStatusBadge, CategoryBadge, PriorityBadge, ResolutionBadge, MentorKindBadge, EscalationBadges
} from '../../components/ui/StatusBadge.jsx';
import CreateQueryModal from '../../components/queries/CreateQueryModal.jsx';
import { useRealtimeQueries } from '../../hooks/useRealtimeQueries.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { formatRelativeTime } from '../../lib/formatters.js';
import { QUERY_CATEGORIES, QUERY_STATUSES } from '../../lib/constants.js';

export default function StudentQueriesPage() {
  const { profile } = useAuth();
  const [status, setStatus] = useState('All');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // Only the queries this student raised: a senior mentor also sees the
  // queries sent to them, which live under Peer Queries.
  const { queries, loading, page, setPage, pageCount, total, reload } = useRealtimeQueries({
    status, category, search, studentId: profile?.id
  });

  const columns = [
    {
      key: 'query_code',
      header: 'Ref',
      render: (row) => <span className="whitespace-nowrap font-semibold text-primary">{row.query_code}</span>
    },
    {
      key: 'subject',
      header: 'Subject',
      render: (row) => (
        <Link to={`/student/queries/${row.id}`} className="text-on-surface hover:text-primary hover:underline">
          {row.subject}
        </Link>
      )
    },
    { key: 'mentor_kind', header: 'Sent to', render: (row) => <MentorKindBadge kind={row.mentor_kind} /> },
    { key: 'category', header: 'Category', render: (row) => <CategoryBadge category={row.category} /> },
    { key: 'priority', header: 'Priority', render: (row) => <PriorityBadge priority={row.priority} /> },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span className="flex min-w-[7rem] flex-wrap items-center gap-1.5 whitespace-nowrap">
          <QueryStatusBadge status={row.status} />
          <ResolutionBadge resolutionStatus={row.resolution_status} />
          <EscalationBadges query={row} />
        </span>
      )
    },
    {
      key: 'last_message_at',
      header: 'Last update',
      render: (row) => <span className="whitespace-nowrap text-tertiary">{formatRelativeTime(row.last_message_at)}</span>
    }
  ];

  return (
    <PortalShell searchPlaceholder="Search my queries by subject or reference..." onSearch={setSearch}>
      <PageHeader
        title="My queries"
        subtitle="Everything you have raised, to your faculty mentor or your senior mentor, with live status."
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <span className="material-symbols-outlined text-[18px]">add</span>
            Raise a query
          </button>
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
        <SkeletonTable rows={6} columns={6} />
      ) : (
        <Panel bodyClassName="">
          <DataTable
            columns={columns}
            rows={queries}
            rowKey={(row) => row.id}
            emptyState={
              <EmptyState
                icon="search_off"
                title="No queries match these filters"
                description="Try clearing the filters, or raise a new query."
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

      <CreateQueryModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
      />
    </PortalShell>
  );
}
