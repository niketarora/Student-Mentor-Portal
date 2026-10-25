/**
 * SeniorPeerQueriesPage — /student/peer-queries
 * A senior mentor's queue (migration 0042): the queries juniors in their
 * sections chose to send to them. Each opens the live conversation, where
 * the senior replies, resolves, or asks the faculty mentor or the HOD for
 * help.
 *
 * Read through get_peer_queries(), not the table: a senior cannot read
 * another student's profile, so the function supplies the name and section.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import { SkeletonCards, SkeletonTable } from '../../components/ui/Skeleton.jsx';
import { FilterPills } from '../../components/ui/FormControls.jsx';
import {
  QueryStatusBadge, CategoryBadge, ResolutionBadge, EscalationBadges
} from '../../components/ui/StatusBadge.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { describeError, formatRelativeTime } from '../../lib/formatters.js';

const FILTERS = [
  { value: 'open', label: 'Needs you' },
  { value: 'escalated', label: 'Raised for help' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' }
];

const matches = (filter) => (row) => {
  if (filter === 'open') return row.status !== 'Resolved';
  if (filter === 'escalated') return row.escalated_to_hod || Boolean(row.referred_to_faculty);
  if (filter === 'resolved') return row.status === 'Resolved';
  return true;
};

export default function SeniorPeerQueriesPage() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_peer_queries');
    if (error) toast.error(describeError(error));
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // A junior raising a query, or anyone replying, refreshes the list.
  useEffect(() => {
    const channel = supabase
      .channel('peer-queries')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_queries' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(matches(filter)).filter((row) =>
      !term || [row.subject, row.query_code, row.student?.full_name, row.student?.login_id]
        .some((value) => value?.toLowerCase().includes(term))
    );
  }, [rows, filter, search]);

  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, rows.filter(matches(f.value)).length]));
  const waiting = rows.filter((row) => row.status === 'Open').length;

  const columns = [
    { key: 'query_code', header: 'Ref', render: (row) => <span className="whitespace-nowrap font-semibold text-primary">{row.query_code}</span> },
    {
      key: 'subject',
      header: 'Subject',
      render: (row) => (
        <Link to={`/student/peer-queries/${row.id}`} className="text-on-surface hover:text-primary hover:underline">
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
          <span className="whitespace-nowrap text-label-sm text-tertiary">
            {row.student?.login_id ?? ''}
            {row.student?.section ? ` · ${row.student.section}` : ''}
          </span>
        </span>
      )
    },
    { key: 'category', header: 'Category', render: (row) => <CategoryBadge category={row.category} /> },
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
    <PortalShell searchPlaceholder="Search peer queries by subject, reference or student..." onSearch={setSearch}>
      <PageHeader
        title="Peer queries"
        subtitle="Queries juniors in your sections sent to you. Open one to chat live, resolve it, or ask for help."
      />

      {loading ? (
        <SkeletonCards count={3} />
      ) : (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="Waiting for you" value={waiting} icon="pending" tone={waiting ? 'error' : 'success'}
            caption={waiting ? 'No reply yet' : 'All picked up'} />
          <StatCard label="Raised for help" value={counts.escalated} icon="flag" tone="warning"
            caption="to a faculty mentor or the HOD" />
          <StatCard label="Resolved" value={counts.resolved} icon="task_alt" tone="slate" />
        </div>
      )}

      <Panel tab="Show" tabIcon="filter_alt" className="mb-4">
        <FilterPills
          ariaLabel="Filter peer queries"
          options={FILTERS.map((f) => ({ ...f, count: counts[f.value] }))}
          value={filter}
          onChange={setFilter}
        />
      </Panel>

      {loading ? (
        <SkeletonTable rows={5} columns={6} />
      ) : (
        <Panel bodyClassName="">
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row) => row.id}
            emptyState={
              <EmptyState
                icon="forum"
                title={rows.length ? 'Nothing in this filter' : 'No peer queries yet'}
                description={
                  rows.length
                    ? 'Try another filter or clear the search.'
                    : 'When a junior in one of your sections sends you a query, it appears here and you get a notification.'
                }
              />
            }
          />
        </Panel>
      )}
    </PortalShell>
  );
}
