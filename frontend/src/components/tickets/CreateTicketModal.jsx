import { useState } from 'react';
import Modal from '../ui/Modal.jsx';
import { TextField, TextAreaField, SelectField } from '../ui/FormControls.jsx';
import { TICKET_CATEGORIES } from '../../lib/constants.js';
import { supabase } from '../../lib/supabaseClient.js';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';

/**
 * Priority is no longer asked for. Students were guessing at it and the
 * queue treated everything as Medium anyway. The column and the enum are
 * untouched — faculty and the HOD can still triage — so this is a UI
 * change only and every existing ticket keeps its priority.
 */
const DEFAULT_PRIORITY = 'Medium';

const EMPTY = { subject: '', category: 'Academics', description: '' };

export default function CreateTicketModal({ open, onClose, onCreated, mentorName }) {
  const { run, pending } = useAsyncAction();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});

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
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    await run(
      async () => {
        const { data, error } = await supabase.rpc('create_support_ticket', {
          p_subject: form.subject.trim(),
          p_category: form.category,
          p_description: form.description.trim(),
          p_priority: DEFAULT_PRIORITY
        });
        if (error) throw error;
        return data;
      },
      {
        successMessage: 'Ticket raised. Your mentor has been notified.',
        onSuccess: (ticket) => {
          setForm(EMPTY);
          setErrors({});
          onCreated?.(ticket);
          onClose();
        }
      }
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Raise a support ticket"
      description={mentorName ? `This will go to your mentor, ${mentorName}.` : undefined}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" form="create-ticket-form" className="btn-primary" disabled={pending}>
            {pending ? 'Submitting...' : 'Raise ticket'}
          </button>
        </>
      }
    >
      {/* Category first, then subject: picking the area of the problem is
          the easier question, and it primes what the subject line should
          say. */}
      <form id="create-ticket-form" onSubmit={submit} className="space-y-4">
        <SelectField
          name="category"
          label="Category"
          required
          value={form.category}
          onChange={update('category')}
          options={TICKET_CATEGORIES}
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
