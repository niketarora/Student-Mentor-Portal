/**
 * ClusterHeadSetupPage
 * The one-time form a Cluster Head fills in before their portal opens.
 *
 * Renders WITHOUT PortalShell, deliberately: like the student Form A gate,
 * there is no sidebar to click past while the form is outstanding. The
 * route guard (RequireClusterHeadSetup) sends them here until
 * submit_cluster_head_setup() flips the flag.
 *
 * Two questions per subject — course name (dropdown) and course code
 * (text) — repeated five times to start, with "Add another subject"
 * appending one more block for as many subjects as they actually handle.
 * Sections used to be a third question; they are read from the ERP
 * export now (0032), which is the only place that knows them.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import mujLogo from '../../assets/manipal-university-jaipur-logo.png';
import Panel from '../../components/ui/Panel.jsx';
import { TextField, SelectField } from '../../components/ui/FormControls.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import {
  COURSE_CATALOGUE,
  OTHER_COURSE_OPTION,
  CLUSTER_HEAD_DEFAULT_SUBJECT_ROWS
} from '../../lib/constants.js';

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

/** A row counts as "filled in" once either of its fields has content. */
function isTouched(subject) {
  return Boolean(resolvedName(subject) || subject.course_code.trim());
}

export default function ClusterHeadSetupPage() {
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { run, pending } = useAsyncAction();

  const [subjects, setSubjects] = useState(() =>
    Array.from({ length: CLUSTER_HEAD_DEFAULT_SUBJECT_ROWS }, emptySubject)
  );
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);

  // Re-submitting replaces the list, so pre-fill from whatever is already
  // saved — that is what makes this screen usable for fixing a typo later.
  const load = useCallback(async () => {
    const { data } = await supabase
      .from('current_cycle_courses')
      .select('course_name, course_code')
      .order('display_order');

    if (data?.length) {
      setSubjects(
        data.map((row) => ({
          key: `subject-${row.course_code}`,
          course_name: COURSE_CATALOGUE.includes(row.course_name) ? row.course_name : OTHER_COURSE_OPTION,
          custom_course_name: COURSE_CATALOGUE.includes(row.course_name) ? '' : row.course_name,
          course_code: row.course_code
        }))
      );
    }
    setLoading(false);
  }, []);

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

  const validate = (filled) => {
    const found = {};
    const seenCodes = new Set();

    filled.forEach((subject) => {
      if (!resolvedName(subject)) found[`${subject.key}-name`] = 'Pick or type a course name';
      if (!subject.course_code.trim()) found[`${subject.key}-code`] = 'Course code is required';

      const code = subject.course_code.trim().toLowerCase();
      if (code && seenCodes.has(code)) {
        found[`${subject.key}-code`] = 'This course code is already used above';
      }
      if (code) seenCodes.add(code);
    });

    return found;
  };

  const submit = (event) => {
    event.preventDefault();

    // Blank rows are ignored rather than rejected: five blocks appear by
    // default and a Cluster Head who handles three subjects should not
    // have to delete two of them.
    const filled = subjects.filter(isTouched);
    if (!filled.length) {
      setErrors({ form: 'Add at least one subject before continuing.' });
      return;
    }

    const found = validate(filled);
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
      {
        successMessage: 'Setup saved. Your portal is ready.',
        onSuccess: async () => {
          await refreshProfile();
          navigate('/cluster-head', { replace: true });
        }
      }
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-body-sm text-on-surface-variant">Loading your setup...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 lg:px-6">
        <header className="mb-6">
          <img src={mujLogo} alt="Manipal University Jaipur" className="h-10 w-auto object-contain" />
          <h1 className="mt-5 text-headline-md text-on-surface">Cluster Head setup</h1>
          <p className="mt-1.5 max-w-2xl text-body-sm text-on-surface-variant">
            Tell us which subjects you handle. An upload is matched to one of them by its course
            code, and the sections come out of the file itself. You can come back and change this
            later.
          </p>
          {profile?.full_name && (
            <p className="mt-2 text-label-sm text-tertiary">Signed in as {profile.full_name}</p>
          )}
        </header>

        <form onSubmit={submit} noValidate>
          <div className="space-y-4">
            {subjects.map((subject, index) => (
              <Panel
                key={subject.key}
                tab={`Subject ${index + 1}`}
                tabIcon="menu_book"
                actions={
                  subjects.length > 1 ? (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => removeSubject(subject.key)}
                    >
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
              {pending ? 'Saving...' : 'Save and open my portal'}
            </button>
          </div>

          <p className="mt-3 text-label-sm text-tertiary">
            Leave any subject blocks you do not need empty — they are ignored.
          </p>
        </form>
      </div>
    </div>
  );
}
