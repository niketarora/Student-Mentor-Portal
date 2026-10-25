/**
 * FEATURE 6 — Non-academic achievements, student maintained.
 * Visible to the assigned mentor, who may verify an entry (a badge only —
 * verification never hides or blocks anything).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Modal, { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { PageLoader } from '../../components/ui/Skeleton.jsx';
import { TextField, TextAreaField, SelectField, FilterPills, FileField } from '../../components/ui/FormControls.jsx';
import { DonutChart } from '../../components/charts/Charts.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { uploadPrivateFile, createSignedUrl, BUCKETS } from '../../lib/fileUpload.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useToast } from '../../context/ToastProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { ACHIEVEMENT_CATEGORIES, CHART_COLORS } from '../../lib/constants.js';
import { describeError, formatDate } from '../../lib/formatters.js';

const EMPTY = { title: '', category: 'technical', description: '', achieved_on: '', proof_file_path: '' };

export default function StudentAchievementsPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const { run, pending } = useAsyncAction();

  const [achievements, setAchievements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [proofName, setProofName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('student_achievements')
      .select('*')
      .eq('student_id', profile.id)
      .order('achieved_on', { ascending: false, nullsFirst: false });
    if (error) toast.error(describeError(error));
    setAchievements(data ?? []);
    setLoading(false);
  }, [profile.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setProofName('');
    setModalOpen(true);
  };

  const openEdit = (achievement) => {
    setEditing(achievement);
    setForm({
      title: achievement.title,
      category: achievement.category,
      description: achievement.description ?? '',
      achieved_on: achievement.achieved_on ?? '',
      proof_file_path: achievement.proof_file_path ?? ''
    });
    setProofName(achievement.proof_file_path ? 'File on record' : '');
    setModalOpen(true);
  };

  const uploadProof = async (file) => {
    setUploading(true);
    try {
      const path = await uploadPrivateFile(BUCKETS.ACHIEVEMENTS, profile.id, file, 'proof');
      setForm((current) => ({ ...current, proof_file_path: path }));
      setProofName(file.name);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setUploading(false);
    }
  };

  const viewProof = async (path) => {
    try {
      const url = await createSignedUrl(BUCKETS.ACHIEVEMENTS, path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(describeError(error));
    }
  };

  const save = (event) => {
    event.preventDefault();
    if (form.title.trim().length < 3) {
      toast.error('Give the achievement a title of at least 3 characters.');
      return;
    }
    run(
      async () => {
        const payload = {
          student_id: profile.id,
          title: form.title.trim(),
          category: form.category,
          description: form.description.trim() || null,
          achieved_on: form.achieved_on || null,
          proof_file_path: form.proof_file_path || null
        };
        const query = editing
          ? supabase.from('student_achievements').update(payload).eq('id', editing.id)
          : supabase.from('student_achievements').insert(payload);
        const { error } = await query;
        if (error) throw error;
      },
      {
        successMessage: editing ? 'Achievement updated.' : 'Achievement added.',
        onSuccess: () => {
          setModalOpen(false);
          load();
        }
      }
    );
  };

  const remove = () =>
    run(
      async () => {
        const { error } = await supabase.from('student_achievements').delete().eq('id', deleteTarget.id);
        if (error) throw error;
      },
      {
        successMessage: 'Achievement removed.',
        onSuccess: () => {
          setDeleteTarget(null);
          load();
        }
      }
    );

  const filtered = useMemo(
    () => (filter === 'all' ? achievements : achievements.filter((a) => a.category === filter)),
    [achievements, filter]
  );

  const chartData = useMemo(() => {
    const counts = {};
    for (const achievement of achievements) {
      counts[achievement.category] = (counts[achievement.category] ?? 0) + 1;
    }
    return ACHIEVEMENT_CATEGORIES.filter((c) => counts[c.value]).map((c, index) => ({
      name: c.label,
      value: counts[c.value],
      color: CHART_COLORS.series[index % CHART_COLORS.series.length]
    }));
  }, [achievements]);

  const filterOptions = useMemo(
    () => [
      { value: 'all', label: 'All', count: achievements.length },
      ...ACHIEVEMENT_CATEGORIES.map((category) => ({
        value: category.value,
        label: category.label,
        count: achievements.filter((a) => a.category === category.value).length
      })).filter((option) => option.count > 0)
    ],
    [achievements]
  );

  if (loading) return <PortalShell><PageLoader label="Loading your achievements..." /></PortalShell>;

  return (
    <PortalShell>
      <PageHeader
        title="Achievements"
        subtitle="Sports, clubs, hackathons, volunteering, certifications — everything outside the classroom that your mentor should know about."
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add achievement
          </button>
        }
      />

      {achievements.length === 0 ? (
        <Panel>
          <EmptyState
            icon="military_tech"
            title="No achievements recorded yet"
            description="Add your first one — it shows up in the mentorship report your faculty generates."
            action={
              <button type="button" className="btn-primary" onClick={openCreate}>
                Add achievement
              </button>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Panel tab="Filter" tabIcon="filter_alt">
              <FilterPills ariaLabel="Filter achievements" options={filterOptions} value={filter} onChange={setFilter} />
            </Panel>

            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((achievement) => {
                const meta = ACHIEVEMENT_CATEGORIES.find((c) => c.value === achievement.category);
                return (
                  <article key={achievement.id} className="panel flex flex-col p-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-fixed">
                        <span className="material-symbols-outlined text-[20px] text-primary" aria-hidden="true">
                          {meta?.icon ?? 'star'}
                        </span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-label-md text-on-surface">{achievement.title}</h3>
                        <p className="text-label-sm text-tertiary">
                          {meta?.label ?? achievement.category} · {formatDate(achievement.achieved_on)}
                        </p>
                      </div>
                      {achievement.verified_by_faculty && (
                        <span className="chip bg-success-container text-on-success-container">
                          <span className="material-symbols-outlined text-[14px]">verified</span>
                          Verified
                        </span>
                      )}
                    </div>

                    {achievement.description && (
                      <p className="mt-3 whitespace-pre-wrap text-body-sm text-on-surface-variant">
                        {achievement.description}
                      </p>
                    )}

                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                      {achievement.proof_file_path && (
                        <button type="button" className="btn-ghost btn-sm" onClick={() => viewProof(achievement.proof_file_path)}>
                          <span className="material-symbols-outlined text-[16px]">visibility</span>
                          View proof
                        </button>
                      )}
                      {!achievement.verified_by_faculty && (
                        <>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => openEdit(achievement)}>
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-ghost btn-sm text-error"
                            onClick={() => setDeleteTarget(achievement)}
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                            Delete
                          </button>
                        </>
                      )}
                      {achievement.verified_by_faculty && (
                        <p className="text-label-sm text-tertiary">
                          Verified entries are locked. Ask your mentor if a change is needed.
                        </p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <Panel tab="Breakdown" tabIcon="donut_small">
            <DonutChart data={chartData} centerLabel="achievements" height={280} />
            <p className="mt-3 text-label-sm text-tertiary">
              {achievements.filter((a) => a.verified_by_faculty).length} of {achievements.length} verified by your mentor.
            </p>
          </Panel>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit achievement' : 'Add an achievement'}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)} disabled={pending}>
              Cancel
            </button>
            <button type="submit" form="achievement-form" className="btn-primary" disabled={pending || uploading}>
              {pending ? 'Saving...' : editing ? 'Save changes' : 'Add achievement'}
            </button>
          </>
        }
      >
        <form id="achievement-form" onSubmit={save} className="space-y-4">
          <TextField
            name="title"
            label="Title"
            required
            maxLength={200}
            value={form.title}
            onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
            placeholder="e.g. Smart India Hackathon — National Finalist"
          />
          <SelectField
            name="category"
            label="Category"
            required
            value={form.category}
            onChange={(event) => setForm((f) => ({ ...f, category: event.target.value }))}
            options={ACHIEVEMENT_CATEGORIES}
          />
          <TextField
            name="achieved_on"
            type="date"
            label="Date achieved"
            max={new Date().toISOString().slice(0, 10)}
            value={form.achieved_on}
            onChange={(event) => setForm((f) => ({ ...f, achieved_on: event.target.value }))}
          />
          <TextAreaField
            name="description"
            label="Description"
            rows={3}
            maxLength={2000}
            value={form.description}
            onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
            hint="What was it, and what did you do?"
          />
          <FileField
            label="Proof (optional)"
            hint={uploading ? 'Uploading...' : 'Certificate or photo. PNG, JPG or PDF, max 5 MB.'}
            currentName={proofName}
            onFileSelected={uploadProof}
            disabled={uploading}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        pending={pending}
        tone="danger"
        confirmLabel="Delete"
        title="Delete this achievement?"
        message={`"${deleteTarget?.title}" will be removed permanently. This cannot be undone.`}
      />
    </PortalShell>
  );
}
