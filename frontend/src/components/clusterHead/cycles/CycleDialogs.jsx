/**
 * CycleDialogs
 * Starting the next academic cycle, and correcting a cycle's dates.
 *
 * Starting a cycle is the one step here that cannot be taken back once
 * anything has been uploaded into it, so the dialog spells out what
 * changes and asks for a tick before it goes ahead.
 *
 * The page mounts each dialog only while it is open, so every opening
 * starts from fresh values without an effect to reset them.
 */

import { useState } from 'react';
import Modal from '../../ui/Modal.jsx';
import { SelectField, TextField, CheckboxField } from '../../ui/FormControls.jsx';
import {
  cycleLabel, defaultCycleDates, labelForYear, semesterTitle, validateCycleDates
} from '../../../lib/academicCycles.js';

function DateFields({ values, onChange, idPrefix }) {
  const field = (key) => (event) => onChange({ ...values, [key]: event.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <TextField id={`${idPrefix}-starts`} name="starts_on" type="date" label="Odd semester starts"
        value={values.starts_on} onChange={field('starts_on')} required />
      <TextField id={`${idPrefix}-even`} name="even_starts_on" type="date" label="Even semester starts"
        value={values.even_starts_on} onChange={field('even_starts_on')} required />
      <TextField id={`${idPrefix}-ends`} name="ends_on" type="date" label="Cycle ends"
        value={values.ends_on} onChange={field('ends_on')} required />
    </div>
  );
}

export function StartCycleModal({ onClose, activeCycle, suggestedYear, pending, progress, onSubmit }) {
  const [year, setYear] = useState(suggestedYear);
  const [dates, setDates] = useState(() => defaultCycleDates(suggestedYear));
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState(null);

  const chooseYear = (value) => {
    setYear(Number(value));
    setDates(defaultCycleDates(Number(value)));
    setError(null);
  };

  const submit = () => {
    const problem = validateCycleDates(year, dates);
    if (problem) {
      setError(problem);
      return;
    }
    onSubmit({ start_year: year, ...dates });
  };

  const label = cycleLabel(labelForYear(year));
  const previewCycle = { start_year: year };

  return (
    <Modal
      open
      onClose={pending ? () => {} : onClose}
      size="lg"
      title="Start the next academic cycle"
      description="Uploads, rosters and mentor assignments go into the new cycle from the moment it starts."
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={pending || !understood}>
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">event_repeat</span>
            {pending ? 'Starting...' : `Start ${label}`}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <SelectField
          id="cycle-year"
          name="start_year"
          label="Academic year"
          value={String(year)}
          onChange={(event) => chooseYear(event.target.value)}
          options={[suggestedYear, suggestedYear + 1].map((y) => ({ value: String(y), label: cycleLabel(labelForYear(y)) }))}
          hint="A cycle can only come after the latest one."
        />

        <div>
          <DateFields values={dates} onChange={(next) => { setDates(next); setError(null); }} idPrefix="new-cycle" />
          <p className="mt-2 text-label-sm text-tertiary">
            {semesterTitle(previewCycle, 'Odd')} runs until the day before the even semester starts;{' '}
            {semesterTitle(previewCycle, 'Even')} runs to the end of the cycle.
          </p>
          {error && <p className="field-error">{error}</p>}
        </div>

        <div className="rounded-xl bg-surface-container-low px-4 py-3">
          <p className="text-label-md text-on-surface">What happens</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-body-sm text-on-surface-variant">
            {activeCycle && (
              <li>
                <strong className="text-on-surface">{cycleLabel(activeCycle.label)}</strong> is closed and kept exactly as it
                is. Its uploads, attendance, students and mentors stay in its report.
              </li>
            )}
            <li>Every subject is copied into {label}; a cluster head can edit theirs under My Subjects.</li>
            <li>
              Attendance and black dots start again from nothing, for students and for the at-risk rule. GPA and any
              backlog still open carry on.
            </li>
            <li>
              Next: import this year&apos;s student roster, or carry last year&apos;s students over, then upload the mentor
              mapping.
            </li>
            <li>At-risk flags are re-checked straight away. Mentors are not sent a notice for every flag the new year lifts.</li>
          </ul>
        </div>

        <CheckboxField
          name="understood"
          label={`I understand that uploads will go into ${label} from now on`}
          checked={understood}
          onChange={setUnderstood}
          disabled={pending}
        />

        {progress && (
          <p className="text-body-sm text-on-surface-variant" role="status">
            {progress.stage === 'recheck'
              ? `Re-checking at-risk flags: ${progress.done.toLocaleString('en-IN')} of ${progress.total.toLocaleString('en-IN')} students...`
              : 'Starting the cycle...'}
          </p>
        )}
      </div>
    </Modal>
  );
}

export function EditCycleDatesModal({ onClose, cycle, pending, onSubmit }) {
  const [dates, setDates] = useState({
    starts_on: cycle.starts_on,
    even_starts_on: cycle.even_starts_on,
    ends_on: cycle.ends_on
  });
  const [error, setError] = useState(null);

  const submit = () => {
    const problem = validateCycleDates(cycle.start_year, dates);
    if (problem) {
      setError(problem);
      return;
    }
    onSubmit(dates);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Dates of ${cycleLabel(cycle.label)}`}
      description="Which semester an upload belongs to is worked out from these dates each time it is shown, so changing them re-files everything at once. Nothing is re-uploaded."
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={pending}>
            {pending ? 'Saving...' : 'Save dates'}
          </button>
        </>
      }
    >
      <DateFields values={dates} onChange={(next) => { setDates(next); setError(null); }} idPrefix="edit-cycle" />
      {error && <p className="field-error">{error}</p>}
    </Modal>
  );
}
