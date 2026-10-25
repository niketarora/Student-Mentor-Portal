/**
 * HodSeniorMentorsPage — /hod/seniors, /admin/seniors (migration 0042)
 * Every senior mentor, with the sections they look after. The star opens
 * the section picker, as the star on My Mentees makes a CR: tick one or
 * more of A3 ... T4 and save. A student's senior is the senior of their
 * faculty mentor's section (the mentor-HOD mapping).
 *
 * Who is a senior is decided by the senior list (npm run db:seniors), not
 * here; this page assigns their sections.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { SkeletonCards, SkeletonTable } from '../../components/ui/Skeleton.jsx';
import SectionMultiSelect from '../../components/hod/SectionMultiSelect.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { describeError } from '../../lib/formatters.js';
import { SENIOR_SECTIONS } from '../../lib/constants.js';

export default function HodSeniorMentorsPage() {
  const toast = useToast();
  const { run, pending } = useAsyncAction();
  const [seniors, setSeniors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState(null);
  const [draft, setDraft] = useState([]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_senior_mentors');
    if (error) toast.error(describeError(error));
    setSeniors(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // section -> the senior who has it
  const owners = useMemo(() => {
    const map = {};
    for (const senior of seniors) for (const section of senior.sections ?? []) map[section] = senior;
    return map;
  }, [seniors]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return seniors.filter((senior) =>
      !term || [senior.full_name, senior.email, senior.login_id, ...(senior.sections ?? [])]
        .some((value) => value?.toLowerCase().includes(term))
    );
  }, [seniors, search]);

  const assignedCount = Object.keys(owners).length;
  const starred = seniors.filter((senior) => senior.sections?.length).length;

  const openPicker = (senior) => {
    setTarget(senior);
    setDraft(senior.sections ?? []);
  };

  const takenByOthers = useMemo(() => {
    const map = {};
    for (const [section, senior] of Object.entries(owners)) {
      if (senior.id !== target?.id) map[section] = senior.full_name;
    }
    return map;
  }, [owners, target]);

  const save = () =>
    run(
      async () => {
        const { error } = await supabase.rpc('set_senior_mentor_sections', {
          p_senior_id: target.id,
          p_sections: draft
        });
        if (error) throw error;
      },
      {
        successMessage: draft.length
          ? `${target.full_name} now looks after ${draft.join(', ')}.`
          : `${target.full_name} no longer has any sections.`,
        onSuccess: () => {
          setTarget(null);
          load();
        }
      }
    );

  const columns = [
    {
      key: 'star',
      header: 'Sections',
      render: (row) => {
        const has = Boolean(row.sections?.length);
        return (
          <button
            type="button"
            onClick={() => openPicker(row)}
            disabled={pending}
            aria-label={has ? `Change ${row.full_name}'s sections` : `Assign sections to ${row.full_name}`}
            title={has ? 'Change sections' : 'Assign sections'}
            className="p-1 text-warning transition-transform hover:scale-110 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: has ? "'FILL' 1" : "'FILL' 0" }}>
              star
            </span>
          </button>
        );
      }
    },
    {
      key: 'full_name',
      header: 'Senior mentor',
      render: (row) => (
        <span className="block min-w-[12rem]">
          <span className="block text-on-surface">{row.full_name}</span>
          <span className="block break-anywhere text-label-sm text-tertiary">{row.email}</span>
          {!row.is_active && <span className="chip mt-1 bg-surface-container-high text-on-surface-variant">Deactivated</span>}
        </span>
      )
    },
    {
      key: 'sections',
      header: 'Assigned sections',
      render: (row) =>
        row.sections?.length ? (
          <span className="flex max-w-xs flex-wrap gap-1">
            {row.sections.map((section) => (
              <span key={section} className="chip bg-primary-fixed text-on-primary-fixed">{section}</span>
            ))}
          </span>
        ) : (
          <button type="button" className="btn-ghost btn-sm" onClick={() => openPicker(row)}>
            Assign sections
          </button>
        )
    },
    { key: 'mentees', header: 'Mentees', render: (row) => row.mentees ?? 0 },
    {
      key: 'open_queries',
      header: 'Open peer queries',
      render: (row) =>
        row.open_queries ? (
          <span className="chip bg-error-container text-on-error-container">{row.open_queries}</span>
        ) : (
          <span className="text-tertiary">0</span>
        )
    },
    { key: 'escalations', header: 'Raised for help', render: (row) => row.escalations ?? 0 }
  ];

  return (
    <PortalShell searchPlaceholder="Search seniors by name, email or section..." onSearch={setSearch}>
      <PageHeader
        title="Senior mentors"
        subtitle="Click the star to choose the sections a senior looks after. The students of those sections get them as their senior mentor."
      />

      {loading ? (
        <SkeletonCards count={3} />
      ) : (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="Senior mentors" value={seniors.length} icon="workspace_premium" tone="primary"
            caption={`${starred} with sections`} />
          <StatCard label="Sections covered" value={assignedCount} icon="grid_view" tone="success"
            caption={`of ${SENIOR_SECTIONS.length}`} />
          <StatCard label="Sections without a senior" value={SENIOR_SECTIONS.length - assignedCount} icon="person_search"
            tone={SENIOR_SECTIONS.length - assignedCount ? 'warning' : 'slate'} />
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={6} columns={6} />
      ) : (
        <Panel bodyClassName="">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            emptyState={
              <EmptyState
                icon="workspace_premium"
                title={seniors.length ? 'Nobody matches' : 'No senior mentors yet'}
                description={
                  seniors.length
                    ? 'Try another search.'
                    : 'Senior mentors are added from the senior list by the administrator (npm run db:seniors). They appear here once added.'
                }
              />
            }
          />
        </Panel>
      )}

      <Panel className="mt-4" tab="How it works" tabIcon="info">
        <ul className="space-y-2 text-body-sm text-on-surface-variant">
          <li>
            <strong className="text-on-surface">One senior per section.</strong> A section another senior has is shown with their
            name; take it off them first.
          </li>
          <li>
            <strong className="text-on-surface">Which students.</strong> A student is in the section of their faculty mentor (the
            mentor–HOD sheet). They can then send queries to their senior mentor as well as their faculty mentor.
          </li>
          <li>
            <strong className="text-on-surface">Escalations.</strong> A senior can raise a query to the student&apos;s faculty mentor
            or to the HOD, with a reason. Those appear under Raised to HOD and Raised to Me.
          </li>
        </ul>
      </Panel>

      <Modal
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        size="md"
        title={`Sections for ${target?.full_name ?? 'this senior'}`}
        description="Tick one or more sections. The students of these sections get this senior as their senior mentor."
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setTarget(null)} disabled={pending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={pending}>
              {pending ? 'Saving...' : 'Save sections'}
            </button>
          </>
        }
      >
        <div className="min-h-[22rem]">
          <SectionMultiSelect value={draft} onChange={setDraft} takenBy={takenByOthers} disabled={pending} />
          {draft.length > 0 && (
            <p className="mt-3 text-body-sm text-on-surface-variant">
              Selected: <strong className="text-on-surface">{draft.join(', ')}</strong>
            </p>
          )}
        </div>
      </Modal>
    </PortalShell>
  );
}
