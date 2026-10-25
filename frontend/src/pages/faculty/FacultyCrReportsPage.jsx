/**
 * FacultyCrReportsPage — the mentor's side of the CR report.
 *
 * The point of the brief: the mentor never re-uploads or edits the
 * minutes. They act on individual items in place, and the minutes stay
 * exactly as the representative wrote them.
 *
 * "Update Status" is two calls that already existed for queries, because
 * the items ARE queries: set_query_in_progress() and, with the mandatory
 * remarks, resolve_support_query(). Resolving hands it to the rep to
 * confirm or reopen — the mentor does not get to close their own work.
 *
 * Mounted twice with isHodView, like the other four shared pages.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { SkeletonCards } from '../../components/ui/Skeleton.jsx';
import { SelectField, TextAreaField } from '../../components/ui/FormControls.jsx';
import { QueryStatusBadge, CategoryBadge, ResolutionBadge } from '../../components/ui/StatusBadge.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { describeError, formatDate, formatRelativeTime } from '../../lib/formatters.js';
import { usePortalPaths } from '../../hooks/usePortalPaths.js';

export default function FacultyCrReportsPage({ isHodView = false }) {
  const { departmentBase } = usePortalPaths();
  const toast = useToast();
  const { run, pending } = useAsyncAction();

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(null);
  const [nextStatus, setNextStatus] = useState('Resolved');
  const [remarks, setRemarks] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: moms, error }, { data: queries }] = await Promise.all([
      supabase
        .from('mom_records')
        .select('*, reporter:reported_by (full_name, login_id)')
        .order('meeting_date', { ascending: false })
        .limit(20),
      supabase
        .from('support_queries')
        .select('id, mom_id, query_code, subject, category, status, resolution_status, last_message_at, reopen_count')
        .not('mom_id', 'is', null)
        .order('created_at')
    ]);
    if (error) toast.error(describeError(error));

    const byMom = new Map();
    for (const t of queries ?? []) {
      if (!byMom.has(t.mom_id)) byMom.set(t.mom_id, []);
      byMom.get(t.mom_id).push(t);
    }
    setReports((moms ?? []).map((m) => ({ ...m, items: byMom.get(m.id) ?? [] })));
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openUpdate = (item) => {
    setTarget(item);
    setNextStatus(item.status === 'Open' ? 'In Progress' : 'Resolved');
    setRemarks('');
  };

  const save = () =>
    run(
      async () => {
        if (nextStatus === 'In Progress') {
          const { error } = await supabase.rpc('set_query_in_progress', { p_query_id: target.id });
          if (error) throw error;
          return;
        }
        // Resolving REQUIRES remarks — the brief's "mandatory input", and
        // the database enforces the rest of the transition.
        if (!remarks.trim()) throw new Error('Add the resolution remarks before marking this resolved.');
        const { error } = await supabase.rpc('resolve_support_query', {
          p_query_id: target.id,
          p_note: remarks.trim()
        });
        if (error) throw error;
      },
      {
        successMessage:
          nextStatus === 'In Progress'
            ? 'Marked as in progress.'
            : 'Marked resolved. The representative has been asked to confirm.',
        onSuccess: () => {
          setTarget(null);
          load();
        }
      }
    );

  const allItems = reports.flatMap((r) => r.items);
  const openItems = allItems.filter((i) => i.status !== 'Resolved').length;
  const awaitingRep = allItems.filter((i) => i.resolution_status === 'pending_confirmation').length;
  const reopened = allItems.filter((i) => i.resolution_status === 'reopened').length;

  return (
    <PortalShell>
      <PageHeader
        title="CR reports"
        subtitle={
          isHodView
            ? 'Meeting minutes filed by every student representative, with the status of each issue raised.'
            : 'Meeting minutes from your student representative. Update each issue in place — the minutes are never edited.'
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Reports" value={reports.length} icon="description" tone="primary" />
        <StatCard label="Issues raised" value={allItems.length} icon="checklist" tone="info" />
        <StatCard
          label="Needing action"
          value={openItems}
          icon="pending_actions"
          tone={openItems ? 'warning' : 'success'}
        />
        <StatCard
          label="Reopened"
          value={reopened}
          icon="replay"
          tone={reopened ? 'error' : 'slate'}
          caption={awaitingRep ? `${awaitingRep} awaiting the rep` : 'Nothing disputed'}
        />
      </div>

      {loading ? (
        <SkeletonCards count={2} />
      ) : reports.length === 0 ? (
        <Panel>
          <EmptyState
            icon="description"
            title="No CR reports yet"
            description="When your student representative files their meeting minutes, every issue they raise appears here as its own item."
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <Panel
              key={report.id}
              tab={`Meeting of ${formatDate(report.meeting_date)}`}
              tabIcon="event_available"
              actions={
                <span className="text-label-sm text-tertiary">
                  {report.reporter?.full_name ?? 'Representative'}
                  {report.students_present != null && report.students_total != null
                    ? ` · ${report.students_present}/${report.students_total} present`
                    : ''}
                </span>
              }
            >
              <p className="whitespace-pre-wrap text-body-sm text-on-surface-variant">{report.notes}</p>

              {report.items.length === 0 ? (
                <p className="mt-4 border-t border-surface-container pt-3 text-label-sm text-tertiary">
                  No issues were raised in this meeting.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-surface-container border-t border-surface-container">
                  {report.items.map((item) => {
                    const closed = item.resolution_status === 'confirmed';
                    return (
                      <li key={item.id} className="flex flex-wrap items-center gap-2 py-3">
                        <span className="min-w-0 flex-1">
                          <Link
                            to={`${isHodView ? departmentBase : '/faculty'}/queries/${item.id}`}
                            className="block truncate text-label-md text-on-surface hover:text-primary hover:underline"
                          >
                            {item.subject}
                          </Link>
                          <span className="text-label-sm text-tertiary">
                            {item.query_code} · updated {formatRelativeTime(item.last_message_at)}
                            {item.reopen_count > 0 ? ` · reopened ${item.reopen_count}×` : ''}
                          </span>
                        </span>
                        <CategoryBadge category={item.category} />
                        <QueryStatusBadge status={item.status} />
                        <ResolutionBadge resolutionStatus={item.resolution_status} />
                        {!closed && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => openUpdate(item)}
                            disabled={pending}
                          >
                            Update status
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        size="sm"
        title="Update status"
        description={target?.subject}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setTarget(null)} disabled={pending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={pending}>
              {pending ? 'Saving...' : 'Save'}
            </button>
          </>
        }
      >
        <SelectField
          label="Status"
          name="cr-status"
          value={nextStatus}
          onChange={(event) => setNextStatus(event.target.value)}
          options={['In Progress', 'Resolved']}
        />
        {nextStatus === 'Resolved' && (
          <TextAreaField
            className="mt-4"
            label="Resolution remarks / actions taken"
            name="cr-remarks"
            required
            rows={4}
            maxLength={5000}
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            placeholder="e.g. Contacted the IT department; a new network switch was installed on 12 August."
            hint="Recorded on the item and shown to the representative, who then confirms or reopens it."
          />
        )}
        {nextStatus === 'In Progress' && (
          <p className="mt-3 text-body-sm text-on-surface-variant">
            The representative sees that you have picked this up. Nothing closes until you mark it resolved
            and they acknowledge it.
          </p>
        )}
      </Modal>
    </PortalShell>
  );
}
