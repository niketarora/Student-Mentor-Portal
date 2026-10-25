/**
 * ClusterHeadCoursesPage
 * The setup form again, this time inside the portal shell — same RPC, same
 * validation, so the two cannot drift. The setup screen is a gate you pass
 * through once; this is where you come back to fix a code or add a subject
 * mid-semester.
 *
 * Subjects are kept per academic cycle (migration 0036): this edits the
 * active cycle's list, which started as a copy of the previous cycle's,
 * and nothing here can reach a closed cycle's subjects or attendance.
 */

import { useCallback, useEffect, useState } from 'react';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import { TextField, SelectField } from '../../components/ui/FormControls.jsx';
import { SkeletonCards } from '../../components/ui/Skeleton.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { useActiveCycle } from '../../hooks/useActiveCycle.js';
import { cycleLabel } from '../../lib/academicCycles.js';
import { describeError } from '../../lib/formatters.js';
import { COURSE_CATALOGUE, OTHER_COURSE_OPTION } from '../../lib/constants.js';

const emptySubject = () => ({
  key: `subject-${Math.random().toString(36).slice(2, 10)}`,
  course_name: '',
  custom_course_name: '',
  course_code: ''
});

function resolvedName(subject) {
  return subject.course_name === OTHER_COURSE_OPTION
    ? subject.custom_course_name.trim()
    : subject.course_name.trim();
}

function isTouched(subject) {
  return Boolean(resolvedName(subject) || subject.course_code.trim());
}

export default function ClusterHeadCoursesPage() {
  const toast = useToast();
  const { run, pending } = useAsyncAction();
  const { cycle } = useActiveCycle();
  const [subjects, setSubjects] = useState([]);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('current_cycle_courses')
      .select('course_name, course_code')
      .order('display_order');
    if (error) toast.error(describeError(error));

    setSubjects(
      (data ?? []).length
        ? data.map((row) => ({
            key: `subject-${row.course_code}`,
            course_name: COURSE_CATALOGUE.includes(row.course_name) ? row.course_name : OTHER_COURSE_OPTION,
            custom_course_name: COURSE_CATALOGUE.includes(row.course_name) ? '' : row.course_name,
            course_code: row.course_code
          }))
        : [emptySubject()]
    );
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const update = (key, field, value) =>
    setSubjects((current) =>
      current.map((subject) => (subject.key === key ? { ...subject, [field]: value } : subject))
    );

  const addSubject = () => setSubjects((current) => [...current, emptySubject()]);

  const removeSubject = (key) =>
    setSubjects((current) => (current.length <= 1 ? current : current.filter((s) => s.key !== key)));

  const save = (event) => {
    event.preventDefault();
    const filled = subjects.filter(isTouched);
    if (!filled.length) {
      setErrors({ form: 'Keep at least one subject.' });
      return;
    }

    const found = {};
    const seenCodes = new Set();
    filled.forEach((subject) => {
      if (!resolvedName(subject)) found[`${subject.key}-name`] = 'Pick or type a course name';
      if (!subject.course_code.trim()) found[`${subject.key}-code`] = 'Course code is required';
      const code = subject.course_code.trim().toLowerCase();
      if (code && seenCodes.has(code)) found[`${subject.key}-code`] = 'This course code is already used above';
      if (code) seenCodes.add(code);
    });

    setErrors(found);
    if (Object.keys(found).length) return;

    run(
      async () => {
        const { error } = await supabase.rpc('submit_cluster_head_setup', {
          p_courses: filled.map((subject) => ({
            course_name: resolvedName(subject),
            course_code: subject.course_code.trim()
          }))
        });
        if (error) throw error;
      },
      { successMessage: 'Subjects updated.', onSuccess: load }
    );
  };

  return (
    <PortalShell>
      <PageHeader
        title={cycle ? `My subjects · ${cycleLabel(cycle.label)}` : 'My subjects'}
        subtitle="An upload is matched to one of these by its course code. Each academic cycle keeps its own list, so changes here never touch last year's subjects or attendance. Within this cycle, removing a subject also removes the attendance uploaded for it, so correct a code rather than deleting and re-adding it."
      />

      {loading ? (
        <SkeletonCards count={3} />
      ) : (
        <form onSubmit={save} noValidate>
          <div className="space-y-4">
            {subjects.map((subject, index) => (
              <Panel
                key={subject.key}
                tab={`Subject ${index + 1}`}
                tabIcon="menu_book"
                actions={
                  subjects.length > 1 ? (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => removeSubject(subject.key)}>
                      <span className="material-symbols-outlined text-[16px]">close</span>
                      Remove
                    </button>
                  ) : null
                }
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <SelectField
                    label="Course name"
                    name={`${subject.key}-name`}
                    placeholder="Select a course"
                    options={COURSE_CATALOGUE}
                    value={subject.course_name}
                    onChange={(event) => update(subject.key, 'course_name', event.target.value)}
                    error={errors[`${subject.key}-name`]}
                  />
                  <TextField
                    label="Course code"
                    name={`${subject.key}-code`}
                    placeholder="e.g. CS2001"
                    maxLength={40}
                    value={subject.course_code}
                    onChange={(event) => update(subject.key, 'course_code', event.target.value)}
                    error={errors[`${subject.key}-code`]}
                  />
                </div>

                {subject.course_name === OTHER_COURSE_OPTION && (
                  <TextField
                    className="mt-4"
                    label="Course name (not in the list)"
                    name={`${subject.key}-custom`}
                    maxLength={160}
                    value={subject.custom_course_name}
                    onChange={(event) => update(subject.key, 'custom_course_name', event.target.value)}
                  />
                )}
              </Panel>
            ))}
          </div>

          {errors.form && <p className="mt-4 field-error">{errors.form}</p>}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary" onClick={addSubject}>
              <span className="material-symbols-outlined text-[18px]">add</span>
              Add another subject
            </button>
            <button type="submit" className="btn-primary ml-auto" disabled={pending}>
              {pending ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
    </PortalShell>
  );
}
