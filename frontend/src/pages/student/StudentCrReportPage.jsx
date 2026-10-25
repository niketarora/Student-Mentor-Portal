/**
 * StudentCrReportPage — the class representative's meeting minutes.
 *
 * "Static context, dynamic entities": Section A is the meeting itself and
 * never changes once filed; Section B is a repeatable block where each
 * raised issue becomes its own trackable entity.
 *
 * Each of those entities is a support query. Not a lookalike — the same
 * table, so the mentor works them in the queue they already use, the
 * three-rejection cap applies, every hop is notified by the existing
 * triggers, and this page's follow-up list is a plain query rather than a
 * second state machine to keep in step.
 */

import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import { SkeletonCards } from '../../components/ui/Skeleton.jsx';
import { TextField, TextAreaField, SelectField } from '../../components/ui/FormControls.jsx';
import { QueryStatusBadge, CategoryBadge, ResolutionBadge } from '../../components/ui/StatusBadge.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useToast } from '../../context/ToastProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { QUERY_CATEGORIES } from '../../lib/constants.js';
import { describeError, formatDate, formatRelativeTime } from '../../lib/formatters.js';

const today = () => new Date().toISOString().slice(0, 10);
const blankItem = () => ({
  key: `item-${Math.random().toString(36).slice(2, 10)}`,
  title: '',
  category: 'Academics',
  description: ''
});

export default function StudentCrReportPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const { run, pending } = useAsyncAction();

  const [meeting, setMeeting] = useState({ date: today(), present: '', total: '', notes: '' });
  const [items, setItems] = useState([blankItem()]);
  const [errors, setErrors] = useState({});
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // RLS scopes both: the rep sees the meetings they filed and the
    // action items raised in them.
    const [{ data: moms, error }, { data: queries }] = await Promise.all([
      supabase.from('mom_records').select('*').order('meeting_date', { ascending: false }).limit(20),
      supabase
        .from('support_queries')
        .select('id, mom_id, query_code, subject, category, status, resolution_status, last_message_at')
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

  const updateItem = (key, field, value) =>
    setItems((current) => current.map((i) => (i.key === key ? { ...i, [field]: value } : i)));

  const addItem = () => setItems((current) => [...current, blankItem()]);
  const removeItem = (key) =>
    setItems((current) => (current.length <= 1 ? current : current.filter((i) => i.key !== key)));

  const submit = (event) => {
    event.preventDefault();
    const found = {};
    if (!meeting.notes.trim()) found.notes = 'Write up the general discussion.';

    // A blank block is ignored, so a rep with two issues need not delete
    // the third — but a half-filled one is a mistake worth catching.
    const filled = items.filter((i) => i.title.trim() || i.description.trim());
    filled.forEach((item) => {
      if (!item.title.trim()) found[`${item.key}-title`] = 'Give this issue a title.';
      if (!item.description.trim()) found[`${item.key}-description`] = 'Describe the issue.';
    });

    setErrors(found);
    if (Object.keys(found).length) {
      toast.error('Please fix the highlighted fields.');
      return;
    }

    run(
      async () => {
        const { error } = await supabase.rpc('submit_mom_report', {
          p_meeting_date: meeting.date,
          p_notes: meeting.notes.trim(),
          p_items: filled.map((i) => ({
            title: i.title.trim(),
            category: i.category,
            description: i.description.trim()
          })),
          p_students_present: meeting.present === '' ? null : Number(meeting.present),
          p_students_total: meeting.total === '' ? null : Number(meeting.total)
        });
        if (error) throw error;
      },
      {
        successMessage: filled.length
          ? `Report filed. ${filled.length} item${filled.length === 1 ? '' : 's'} sent to your mentor.`
          : 'Report filed.',
        onSuccess: () => {
          setMeeting({ date: today(), present: '', total: '', notes: '' });
          setItems([blankItem()]);
          load();
        }
      }
    );
  };

  if (profile && !profile.is_star_mentee) return <Navigate to="/student" replace />;

  const allItems = reports.flatMap((r) => r.items);
  const openCount = allItems.filter((i) => i.status !== 'Resolved').length;
  const awaitingMe = allItems.filter((i) => i.resolution_status === 'pending_confirmation').length;

  return (
    <PortalShell>
      <PageHeader
        title="CR report"
        subtitle="File your mentor-meeting minutes, then track each issue you raised until it is actually closed."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Reports filed" value={reports.length} icon="description" tone="primary" />
        <StatCard label="Issues raised" value={allItems.length} icon="checklist" tone="info" />
        <StatCard label="Still open" value={openCount} icon="pending_actions" tone={openCount ? 'warning' : 'success'} />
        <StatCard
          label="Waiting on you"
          value={awaitingMe}
          icon="how_to_reg"
          tone={awaitingMe ? 'error' : 'slate'}
          caption={awaitingMe ? 'Confirm or reopen' : 'Nothing to confirm'}
        />
      </div>

      {awaitingMe > 0 && (
        <div className="mb-4 rounded-lg border-l-4 border-info bg-info-container/50 p-4">
          <p className="text-label-md text-on-surface">
            {awaitingMe} issue{awaitingMe === 1 ? ' has' : 's have'} been marked resolved by your mentor
          </p>
          <p className="mt-0.5 text-body-sm text-on-surface-variant">
            Open the issue below and either acknowledge it or reopen it with a comment — the same
            confirmation step as any other query.
          </p>
        </div>
      )}

      <form onSubmit={submit} noValidate>
        {/* ── Section A: the meeting. Immutable once filed. ───────── */}
        <Panel tab="A · Meeting record" tabIcon="event_note">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TextField
              label="Meeting date"
              name="meeting-date"
              type="date"
              required
              max={today()}
              value={meeting.date}
              onChange={(event) => setMeeting((m) => ({ ...m, date: event.target.value }))}
            />
            <TextField
              label="Students present"
              name="present"
              inputMode="numeric"
              value={meeting.present}
              onChange={(event) =>
                setMeeting((m) => ({ ...m, present: event.target.value.replace(/\D/g, '') }))
              }
            />
            <TextField
              label="Students in group"
              name="total"
              inputMode="numeric"
              value={meeting.total}
              onChange={(event) =>
                setMeeting((m) => ({ ...m, total: event.target.value.replace(/\D/g, '') }))
              }
            />
          </div>
          <TextAreaField
            className="mt-4"
            label="General discussion"
            name="notes"
            required
            rows={4}
            maxLength={5000}
            value={meeting.notes}
            onChange={(event) => setMeeting((m) => ({ ...m, notes: event.target.value }))}
            error={errors.notes}
            hint="What was discussed. This is kept exactly as written and is never edited afterwards."
          />
        </Panel>

        {/* ── Section B: the entities. Each becomes its own item. ─── */}
        <div className="mt-4 space-y-3">
          {items.map((item, index) => (
            <Panel
              key={item.key}
              tab={`B · Raised issue ${index + 1}`}
              tabIcon="flag"
              actions={
                items.length > 1 ? (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => removeItem(item.key)}>
                    <span className="material-symbols-outlined text-[16px]">close</span>
                    Remove
                  </button>
                ) : null
              }
            >
              <div className="grid gap-4 md:grid-cols-3">
                <TextField
                  className="md:col-span-2"
                  label="Issue"
                  name={`${item.key}-title`}
                  maxLength={200}
                  value={item.title}
                  onChange={(event) => updateItem(item.key, 'title', event.target.value)}
                  error={errors[`${item.key}-title`]}
                  placeholder="e.g. Lab AC not working in CS-204"
                />
                <SelectField
                  label="Category"
                  name={`${item.key}-category`}
                  options={QUERY_CATEGORIES}
                  value={item.category}
                  onChange={(event) => updateItem(item.key, 'category', event.target.value)}
                />
              </div>
              <TextAreaField
                className="mt-4"
                label="Description"
                name={`${item.key}-description`}
                rows={3}
                maxLength={5000}
                value={item.description}
                onChange={(event) => updateItem(item.key, 'description', event.target.value)}
                error={errors[`${item.key}-description`]}
                hint="What the group reported, and what they have already tried."
              />
            </Panel>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-secondary" onClick={addItem}>
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add raised issue
          </button>
          <p className="text-label-sm text-tertiary">Leave a block empty and it is ignored. Up to 12 per meeting.</p>
          <button type="submit" className="btn-primary ml-auto" disabled={pending}>
            {pending ? 'Filing...' : 'File report'}
          </button>
        </div>
      </form>

      {/* ── Follow-up ────────────────────────────────────────────── */}
      <h2 className="mt-8 mb-3 text-headline-sm text-on-surface">Reports you have filed</h2>

      {loading ? (
        <SkeletonCards count={2} />
      ) : reports.length === 0 ? (
        <Panel>
          <EmptyState
            icon="description"
            title="No reports yet"
            description="File your first set of meeting minutes above. Every issue you raise becomes a tracked item your mentor has to act on."
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
                  {report.students_present != null && report.students_total != null
                    ? `${report.students_present}/${report.students_total} present · `
                    : ''}
                  {report.items.length} item{report.items.length === 1 ? '' : 's'}
                </span>
              }
            >
              <p className="whitespace-pre-wrap text-body-sm text-on-surface-variant">{report.notes}</p>

              {report.items.length > 0 && (
                <ul className="mt-4 divide-y divide-surface-container border-t border-surface-container">
                  {report.items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-2 py-3">
                      <span className="min-w-0 flex-1">
                        <a
                          href={`/student/queries/${item.id}`}
                          className="block truncate text-label-md text-on-surface hover:text-primary hover:underline"
                        >
                          {item.subject}
                        </a>
                        <span className="text-label-sm text-tertiary">
                          {item.query_code} · updated {formatRelativeTime(item.last_message_at)}
                        </span>
                      </span>
                      <CategoryBadge category={item.category} />
                      <QueryStatusBadge status={item.status} />
                      <ResolutionBadge resolutionStatus={item.resolution_status} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ))}
        </div>
      )}
    </PortalShell>
  );
}
