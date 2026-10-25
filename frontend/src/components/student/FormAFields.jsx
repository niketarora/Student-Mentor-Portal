/**
 * FEATURE 1 — the Form A field set, extracted so exactly one implementation
 * backs both places it appears:
 *
 *   • StudentOnboardingFormPage — the compulsory first-time fill, shown on
 *     its own with no portal navigation around it
 *   • StudentProfilePage        — the same record afterwards, editable by
 *     the student at any time with no HOD approval needed
 *
 * Grouped exactly like the paper form: Student Details / MUJ Alumni /
 * Parents / Address / Uploads.
 */

import { useCallback, useEffect, useState } from 'react';
import Panel from '../ui/Panel.jsx';
import {
  TextField, TextAreaField, SelectField, RadioGroupField, CheckboxField, FileField
} from '../ui/FormControls.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { uploadPrivateFile, BUCKETS } from '../../lib/fileUpload.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { BLOOD_GROUPS, PARENT_OCCUPATIONS } from '../../lib/constants.js';
import { describeError } from '../../lib/formatters.js';

export const EMPTY_FORM_A = {
  full_name: '', registration_no: '', section: '', roll_no: '', branch: '',
  mobile_no: '', email: '', hostel_block: '', room_no: '', blood_group: '',
  date_of_birth: '', is_day_scholar: false,
  has_muj_alumni_in_family: false, alumni_name: '', alumni_branch: '',
  alumni_batch: '', alumni_institution: '', alumni_relationship: '',
  father_name: '', father_occupation: '', father_organization: '', father_designation: '',
  father_mobile: '', father_email: '',
  mother_name: '', mother_occupation: '', mother_organization: '', mother_designation: '',
  mother_mobile: '', mother_email: '',
  communication_address: '', communication_pin_code: '',
  permanent_same_as_communication: false, permanent_address: '', permanent_pin_code: '',
  parent_business_card_path: '', student_signature_path: ''
};

export function validateFormA(form) {
  const errors = {};
  const required = (key, message) => {
    if (!String(form[key] ?? '').trim()) errors[key] = message;
  };

  required('full_name', 'Your full name is required.');
  required('registration_no', 'Registration number is required.');
  required('father_name', "Father's name is required.");
  required('mother_name', "Mother's name is required.");
  required('communication_address', 'Address for communication is required.');

  if (!/^[0-9]{10}$/.test(form.mobile_no)) errors.mobile_no = 'Enter a 10-digit mobile number.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) errors.email = 'Enter a valid email address.';
  if (!/^[0-9]{6}$/.test(form.communication_pin_code)) errors.communication_pin_code = 'Enter a 6-digit pin code.';

  if (!form.permanent_same_as_communication) {
    if (!form.permanent_address.trim()) errors.permanent_address = 'Permanent address is required.';
    if (!/^[0-9]{6}$/.test(form.permanent_pin_code)) errors.permanent_pin_code = 'Enter a 6-digit pin code.';
  }
  if (!form.is_day_scholar && !form.hostel_block.trim()) {
    errors.hostel_block = 'Hostel block is required (or tick "I am a day scholar").';
  }
  if (form.has_muj_alumni_in_family && !form.alumni_name.trim()) {
    errors.alumni_name = 'Please give the name of your relative who studied at MUJ.';
  }
  for (const key of ['father_mobile', 'mother_mobile']) {
    if (form[key] && !/^[0-9]{10}$/.test(form[key])) errors[key] = 'Enter a 10-digit mobile number.';
  }
  for (const key of ['father_email', 'mother_email']) {
    if (form[key] && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form[key])) errors[key] = 'Enter a valid email address.';
  }
  if (form.date_of_birth && new Date(form.date_of_birth) >= new Date()) {
    errors.date_of_birth = 'Date of birth must be in the past.';
  }
  return errors;
}

/**
 * Owns loading, field state and uploads for Form A. Both pages use this so
 * the two never drift apart.
 */
export function useFormAState(profile) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM_A);
  const [record, setRecord] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState({ businessCard: '', signature: '' });
  const [uploading, setUploading] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('student_form_a_profiles')
      .select('*')
      .eq('student_id', profile.id)
      .maybeSingle();

    if (error) toast.error(describeError(error));

    if (data?.is_submitted) {
      setRecord(data);
      setForm({
        ...EMPTY_FORM_A,
        ...Object.fromEntries(
          Object.keys(EMPTY_FORM_A).map((key) => [key, data[key] ?? EMPTY_FORM_A[key]])
        )
      });
    } else {
      // Pre-fill what the department already knows about this student.
      setForm((current) => ({
        ...current,
        full_name: profile.full_name ?? '',
        registration_no: profile.login_id ?? '',
        email: profile.email ?? '',
        branch: profile.branch ?? '',
        section: profile.section ?? '',
        mobile_no: profile.phone ?? ''
      }));
    }
    setLoading(false);
  }, [profile, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const setField = useCallback((key) => (value) => {
    setForm((current) => ({ ...current, [key]: value?.target ? value.target.value : value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }, []);

  const upload = useCallback(async (kind, file) => {
    setUploading(kind);
    try {
      const path = await uploadPrivateFile(
        BUCKETS.FORM_A, profile.id, file,
        kind === 'businessCard' ? 'parent-business-card' : 'student-signature'
      );
      setForm((current) => ({
        ...current,
        [kind === 'businessCard' ? 'parent_business_card_path' : 'student_signature_path']: path
      }));
      setUploads((current) => ({ ...current, [kind]: file.name }));
      toast.success('File uploaded.');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setUploading(null);
    }
  }, [profile.id, toast]);

  /** Returns the payload if valid, or null after surfacing the errors. */
  const validate = useCallback(() => {
    const found = validateFormA(form);
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error('Please fix the highlighted fields before saving.');
      document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return null;
    }
    const payload = { ...form };
    if (payload.permanent_same_as_communication) {
      payload.permanent_address = payload.communication_address;
      payload.permanent_pin_code = payload.communication_pin_code;
    }
    if (!payload.date_of_birth) payload.date_of_birth = null;
    return payload;
  }, [form, toast]);

  return { form, record, errors, loading, uploads, uploading, setField, upload, validate, reload: load };
}

export default function FormAFields({ form, errors, setField, uploads, uploading, onUpload, disabled }) {
  const field = (key) => ({
    name: key,
    value: form[key] ?? '',
    onChange: setField(key),
    error: errors[key],
    disabled
  });

  return (
    <div className="space-y-5">
      <Panel tab="Student Details" tabIcon="person">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label="Name" required {...field('full_name')} />
          <TextField label="Registration no." required {...field('registration_no')} />
          <TextField label="Roll no." {...field('roll_no')} />
          <TextField label="Section" {...field('section')} />
          <TextField label="Branch" {...field('branch')} />
          <TextField label="Mobile no." required inputMode="numeric" maxLength={10} {...field('mobile_no')} />
          <TextField label="Email ID" type="email" required {...field('email')} />
          <TextField label="Date of birth" type="date" {...field('date_of_birth')} />
          <SelectField label="Blood group" placeholder="Select" options={BLOOD_GROUPS} {...field('blood_group')} />
        </div>

        <div className="mt-4 border-t border-surface-container pt-4">
          <CheckboxField
            label="I am a day scholar (I do not stay in a hostel)"
            checked={form.is_day_scholar}
            onChange={setField('is_day_scholar')}
            disabled={disabled}
          />
          {!form.is_day_scholar && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <TextField label="Hostel block no." required {...field('hostel_block')} />
              <TextField label="Room no." {...field('room_no')} />
            </div>
          )}
        </div>
      </Panel>

      <Panel tab="MUJ Alumni in Family" tabIcon="diversity_3">
        <RadioGroupField
          label="Any MUJ alumni in your family?"
          name="has_muj_alumni_in_family"
          columns={2}
          value={form.has_muj_alumni_in_family ? 'yes' : 'no'}
          onChange={(value) => setField('has_muj_alumni_in_family')(value === 'yes')}
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' }
          ]}
        />
        {form.has_muj_alumni_in_family && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextField label="Name" required {...field('alumni_name')} />
            <TextField label="Branch" {...field('alumni_branch')} />
            <TextField label="Batch" placeholder="e.g. 2018-22" {...field('alumni_batch')} />
            <TextField label="Institution" {...field('alumni_institution')} />
            <TextField label="Relationship" placeholder="e.g. Elder brother" {...field('alumni_relationship')} />
          </div>
        )}
      </Panel>

      <Panel tab="Details of the Parents" tabIcon="family_restroom">
        <div className="grid gap-6 lg:grid-cols-2">
          {[
            { prefix: 'father', title: "Father's details" },
            { prefix: 'mother', title: "Mother's details" }
          ].map(({ prefix, title }) => (
            <div key={prefix} className="rounded-lg border border-surface-container p-4">
              <h3 className="mb-3 text-label-md text-on-surface">{title}</h3>
              <div className="space-y-4">
                <TextField label="Name" required {...field(`${prefix}_name`)} />
                <SelectField
                  label="Occupation"
                  placeholder="Select occupation"
                  options={PARENT_OCCUPATIONS}
                  {...field(`${prefix}_occupation`)}
                />
                <TextField label="Name of the organization" {...field(`${prefix}_organization`)} />
                <TextField label="Designation" {...field(`${prefix}_designation`)} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Mobile no." inputMode="numeric" maxLength={10} {...field(`${prefix}_mobile`)} />
                  <TextField label="Email ID" type="email" {...field(`${prefix}_email`)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel tab="Address" tabIcon="home_pin">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <TextAreaField label="Address for communication" required rows={3} {...field('communication_address')} />
            <TextField label="Pin code" required inputMode="numeric" maxLength={6} {...field('communication_pin_code')} />
          </div>
          <div className="space-y-4">
            <CheckboxField
              label="Permanent address is the same as above"
              checked={form.permanent_same_as_communication}
              onChange={setField('permanent_same_as_communication')}
              disabled={disabled}
            />
            {!form.permanent_same_as_communication && (
              <>
                <TextAreaField label="Permanent address" required rows={3} {...field('permanent_address')} />
                <TextField label="Pin code" required inputMode="numeric" maxLength={6} {...field('permanent_pin_code')} />
              </>
            )}
          </div>
        </div>
      </Panel>

      <Panel tab="Optional Uploads" tabIcon="attach_file">
        <div className="grid gap-4 lg:grid-cols-2">
          <FileField
            label="Business card of the parent"
            hint={uploading === 'businessCard' ? 'Uploading...' : 'Optional. PNG, JPG or PDF.'}
            currentName={uploads.businessCard || (form.parent_business_card_path ? 'File on record' : '')}
            onFileSelected={(file) => onUpload('businessCard', file)}
            disabled={disabled || uploading !== null}
          />
          <FileField
            label="Signature of the student"
            hint={uploading === 'signature' ? 'Uploading...' : 'Optional. PNG, JPG or PDF.'}
            currentName={uploads.signature || (form.student_signature_path ? 'File on record' : '')}
            onFileSelected={(file) => onUpload('signature', file)}
            disabled={disabled || uploading !== null}
          />
        </div>
        <p className="mt-3 text-label-sm text-tertiary">
          Uploads are stored privately. Only you, your assigned mentor and the HOD can open them.
        </p>
      </Panel>
    </div>
  );
}
