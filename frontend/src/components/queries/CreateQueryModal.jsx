import { useEffect, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import { TextField, TextAreaField, SelectField } from '../ui/FormControls.jsx';
import { QUERY_CATEGORIES } from '../../lib/constants.js';
import { supabase } from '../../lib/supabaseClient.js';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { useAuth } from '../../context/AuthProvider.jsx';

/**
 * Priority is no longer asked for. Students were guessing at it and the
 * queue treated everything as Medium anyway. The column and the enum are
 * untouched — faculty and the HOD can still triage — so this is a UI
 * change only and every existing query keeps its priority.
 */
const DEFAULT_PRIORITY = 'Medium';

const EMPTY = { subject: '', category: 'Academics', description: '' };

/**
 * Whom the query goes to (0042): the faculty mentor or the senior mentor.
 * Either can be missing; a missing one is shown, greyed out, with why.
 */
function RecipientChoice({ value, onChange, facultyMentor, seniorMentor }) {
  const options = [
    {
      value: 'faculty',
      title: 'Faculty Mentor',
      person: facultyMentor,
      icon: 'badge',
      missing: 'No faculty mentor is assigned to you yet. Please contact the HOD office.'
    },
    {
      value: 'senior',
      title: 'Senior Mentor',
      person: seniorMentor,
      icon: 'workspace_premium',
      missing: 'No senior mentor is assigned to you yet, so this option is not available.'
    }
  ];
  return (
    <fieldset>
      <legend className="field-label">
        Send to <span className="text-error">*</span>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const available = Boolean(option.person);
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={`flex items-start gap-2.5 rounded border px-3 py-2.5 text-body-sm transition-colors ${
                !available
                  ? 'cursor-not-allowed border-outline-variant bg-surface-container-low opacity-70'
                  : checked
                    ? 'cursor-pointer border-primary bg-primary-fixed/60'
                    : 'cursor-pointer border-outline-variant hover:bg-surface-container-low'
              }`}
            >
              <input
                type="radio"
                name="recipient"
                value={option.value}
                checked={checked}
                disabled={!available}
                onChange={() => onChange(option.value)}
                className="mt-0.5 text-primary focus:ring-primary"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-label-md text-on-surface">
                  <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">{option.icon}</span>
                  {option.title}
                </span>
                {available ? (
                  <span className="block break-anywhere text-label-sm text-tertiary">{option.person.full_name}</span>
                ) : (
                  <span className="mt-0.5 block text-label-sm text-on-surface-variant">{option.missing}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function CreateQueryModal({ open, onClose, onCreated }) {
  const { profile } = useAuth();
  const { run, pending } = useAsyncAction();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const facultyMentor = profile?.assigned_mentor_id ? (profile?.mentor ?? { full_name: 'Your faculty mentor' }) : null;
  const seniorMentor = profile?.senior_mentor ?? null;
  const defaultRecipient = facultyMentor ? 'faculty' : seniorMentor ? 'senior' : 'faculty';
  const [recipient, setRecipient] = useState(defaultRecipient);

  // Each time the form opens, start from the faculty mentor (or whoever exists).
  useEffect(() => {
    if (open) setRecipient(defaultRecipient);
  }, [open, defaultRecipient]);

  const recipientPerson = recipient === 'senior' ? seniorMentor : facultyMentor;

  const update = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event?.target ? event.target.value : event }));

  const validate = () => {
    const next = {};
    if (form.subject.trim().length < 5) next.subject = 'Give your issue a clear subject (at least 5 characters).';
    if (form.subject.length > 200) next.subject = 'Keep the subject under 200 characters.';
    // No minimum length on the description. A student who can say what is
    // wrong in four words should not be blocked from asking for help; the
    // 5000-character cap stays because the column has one.
    if (!form.description.trim()) next.description = 'Please describe the issue.';
    if (!recipientPerson) next.recipient = 'Choose a mentor to send this to.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    await run(
      async () => {
        const { data, error } = await supabase.rpc('create_support_query', {
          p_subject: form.subject.trim(),
          p_category: form.category,
          p_description: form.description.trim(),
          p_priority: DEFAULT_PRIORITY,
          p_recipient: recipient
        });
        if (error) throw error;
        return data;
      },
      {
        successMessage: `Query raised. ${recipientPerson?.full_name ?? 'Your mentor'} has been notified.`,
        onSuccess: (query) => {
          setForm(EMPTY);
          setErrors({});
          onCreated?.(query);
          onClose();
        }
      }
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Raise a support query"
      description={
        recipientPerson
          ? `This will go to your ${recipient === 'senior' ? 'senior mentor' : 'faculty mentor'}, ${recipientPerson.full_name}.`
          : undefined
      }
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" form="create-query-form" className="btn-primary" disabled={pending || !recipientPerson}>
            {pending ? 'Submitting...' : 'Raise query'}
          </button>
        </>
      }
    >
      {/* Category first, then subject: picking the area of the problem is
          the easier question, and it primes what the subject line should
          say. */}
      <form id="create-query-form" onSubmit={submit} className="space-y-4">
        <RecipientChoice
          value={recipient}
          onChange={setRecipient}
          facultyMentor={facultyMentor}
          seniorMentor={seniorMentor}
        />
        {errors.recipient && <p className="field-error">{errors.recipient}</p>}
        <SelectField
          name="category"
          label="Category"
          required
          value={form.category}
          onChange={update('category')}
          options={QUERY_CATEGORIES}
        />
        <TextField
          name="subject"
          label="Subject"
          required
          maxLength={200}
          value={form.subject}
          onChange={update('subject')}
          error={errors.subject}
          placeholder="e.g. Unable to log in to the ERP portal"
        />
        <TextAreaField
          name="description"
          label="Describe the issue"
          required
          rows={5}
          maxLength={5000}
          value={form.description}
          onChange={update('description')}
          error={errors.description}
          hint="Include what you tried, any error message, and when it started."
        />
      </form>
    </Modal>
  );
}
