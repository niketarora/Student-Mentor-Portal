/**
 * RaisedQueriesPage (migration 0042)
 *   /faculty/raised            Raised to Me: queries a senior mentor raised
 *                              to this faculty member (their mentee's).
 *   /hod/raised, /admin/raised Raised to HOD: queries escalated to the HOD,
 *                              by a faculty member or by a senior mentor.
 *
 * These are not in the Query Queue or All Queries. Each row says who raised
 * it and why; opening it gives the same conversation, where the faculty
 * member or HOD replies and can resolve it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonTable } from '../../components/ui/Skeleton.jsx';
import { FilterPills } from '../../components/ui/FormControls.jsx';
import {
  QueryStatusBadge, ResolutionBadge, RaisedByBadge, MentorKindBadge
} from '../../components/ui/StatusBadge.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { usePortalPaths } from '../../hooks/usePortalPaths.js';
import { describeError, formatRelativeTime } from '../../lib/formatters.js';

const STATUS_FILTERS = [
  { value: 'open', label: 'Needs action' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' }
];

const SOURCE_FILTERS = [
  { value: 'all', label: 'Everyone' },
  { value: 'faculty', label: 'Raised by faculty' },
  { value: 'senior', label: 'Raised by senior' }
];

export default function RaisedQueriesPage({ isHodView = false }) {
  const { departmentBase } = usePortalPaths();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('open');
  const [source, setSource] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_raised_queries');
    if (error) toast.error(describeError(error));
    const all = Array.isArray(data) ? data : [];
    // A HOD's page holds what was raised to the HOD; a faculty member's, what was raised to them.
    setRows(all.filter((row) => row.raised_to === (isHodView ? 'hod' : 'faculty')));
    setLoading(false);
  }, [toast, isHodView]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`raised-${isHodView ? 'hod' : 'faculty'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_queries' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, isHodView]);

  const byStatus = (value) => (row) =>
    value === 'all' || (value === 'resolved' ? row.status === 'Resolved' : row.status !== 'Resolved');
  const bySource = (value) => (row) => value === 'all' || row.raised_by_kind === value;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(byStatus(status)).filter(bySource(source)).filter((row) =>
      !term || [row.subject, row.query_code, row.student?.full_name, row.student?.login_id, row.raised_by?.full_name, row.reason]
        .some((value) => value?.toLowerCase().includes(term))
    );
  }, [rows, status, source, search]);

  const detailPath = (row) => (isHodView ? `${departmentBase}/queries/${row.id}` : `/faculty/queries/${row.id}`);

  const columns = [
    { key: 'query_code', header: 'Ref', render: (row) => <span className="whitespace-nowrap font-semibold text-primary">{row.query_code}</span> },
    {
      key: 'subject',
      header: 'Subject',
      render: (row) => (
        <span className="block min-w-[12rem]">
          <Link to={detailPath(row)} className="text-on-surface hover:text-primary hover:underline">
            {row.subject}
          </Link>
          <span className="mt-1 block">
            <MentorKindBadge kind={row.mentor_kind} />
          </span>
        </span>
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
    {
      key: 'raised_by',
      header: 'Raised by',
      render: (row) => (
        <span className="block min-w-[9rem]">
          <RaisedByBadge kind={row.raised_by_kind} />
          <span className="mt-1 block text-on-surface">{row.raised_by?.full_name ?? '—'}</span>
          <span className="text-label-sm text-tertiary">{formatRelativeTime(row.raised_at)}</span>
        </span>
      )
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (row) => (
        <span className="line-clamp-3 block min-w-[14rem] max-w-md whitespace-pre-wrap text-on-surface-variant">
          {row.reason || '—'}
        </span>
      )
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span className="flex min-w-[7rem] flex-wrap items-center gap-1.5 whitespace-nowrap">
          <QueryStatusBadge status={row.status} />
          <ResolutionBadge resolutionStatus={row.resolution_status} />
        </span>
      )
    }
  ];

  return (
    <PortalShell searchPlaceholder="Search by subject, reference, student, who raised it or reason..." onSearch={setSearch}>
      <PageHeader
        title={isHodView ? 'Raised to HOD' : 'Raised to me'}
        subtitle={
          isHodView
            ? 'Queries escalated to the HOD, by a faculty mentor or by a senior mentor, with their reason. Reply in the conversation or resolve them; they are not in All Queries.'
            : 'Queries a senior mentor raised to you about one of your mentees, with their reason. Reply in the same conversation or resolve them.'
        }
      />

      <Panel tab="Show" tabIcon="filter_alt" className="mb-4">
        <div className="space-y-3">
          <FilterPills
            ariaLabel="Status"
            value={status}
            onChange={setStatus}
            options={STATUS_FILTERS.map((f) => ({ ...f, count: rows.filter(byStatus(f.value)).length }))}
          />
          {isHodView && (
            <FilterPills
              ariaLabel="Raised by"
              value={source}
              onChange={setSource}
              options={SOURCE_FILTERS.map((f) => ({ ...f, count: rows.filter(byStatus(status)).filter(bySource(f.value)).length }))}
            />
          )}
        </div>
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
                icon="flag"
                title={rows.length ? 'Nothing in this filter' : 'Nothing raised yet'}
                description={
                  rows.length
                    ? 'Try another filter or clear the search.'
                    : isHodView
                      ? 'When a faculty mentor or a senior mentor escalates a query to the HOD, it appears here and you get a notification.'
                      : 'When a senior mentor raises one of your mentees’ queries to you, it appears here and you get a notification.'
                }
              />
            }
          />
        </Panel>
      )}
    </PortalShell>
  );
}
