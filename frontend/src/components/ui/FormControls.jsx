/** Small, dependency-free form primitives used across every form. */

import { useState } from 'react';

export function TextField({ label, hint, error, required, className = '', ...props }) {
  const id = props.id ?? props.name;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="field-label">
          {label} {required && <span className="text-error">*</span>}
        </label>
      )}
      <input
        id={id}
        className="field-input"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        required={required}
        {...props}
      />
      {hint && !error && <p className="mt-1 text-label-sm text-tertiary">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A password input with a show/hide toggle.
 *
 * The eye sits inside the field rather than beside it so the control does
 * not change width when the icon swaps. `type` flips between password and
 * text, which is what lets a browser password manager still recognise the
 * field; rendering two inputs and swapping them would break autofill.
 */
export function PasswordField({ label, hint, error, required, className = '', ...props }) {
  const [visible, setVisible] = useState(false);
  const id = props.id ?? props.name;

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="field-label">
          {label} {required && <span className="text-error">*</span>}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className="field-input pr-11"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          required={required}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          // aria-pressed rather than a label change alone, so a screen
          // reader announces the state and not just the action.
          aria-pressed={visible}
          aria-label={visible ? 'Hide password' : 'Show password'}
          title={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r text-on-surface-variant transition-colors hover:text-primary"
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            {visible ? 'visibility_off' : 'visibility'}
          </span>
        </button>
      </div>
      {hint && !error && <p className="mt-1 text-label-sm text-tertiary">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextAreaField({ label, hint, error, required, rows = 4, className = '', ...props }) {
  const id = props.id ?? props.name;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="field-label">
          {label} {required && <span className="text-error">*</span>}
        </label>
      )}
      <textarea id={id} rows={rows} className="field-input resize-y" required={required} {...props} />
      {hint && !error && <p className="mt-1 text-label-sm text-tertiary">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function SelectField({ label, hint, error, required, options, placeholder, className = '', ...props }) {
  const id = props.id ?? props.name;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="field-label">
          {label} {required && <span className="text-error">*</span>}
        </label>
      )}
      <select id={id} className="field-input" required={required} {...props}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => {
          const value = typeof option === 'string' ? option : option.value;
          const optionLabel = typeof option === 'string' ? option : option.label;
          return (
            <option key={value} value={value}>
              {optionLabel}
            </option>
          );
        })}
      </select>
      {hint && !error && <p className="mt-1 text-label-sm text-tertiary">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function RadioGroupField({ label, name, value, onChange, options, columns = 3, required, hint }) {
  return (
    <fieldset>
      <legend className="field-label">
        {label} {required && <span className="text-error">*</span>}
      </legend>
      <div className={`grid gap-2 ${columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
        {options.map((option) => {
          const optionValue = typeof option === 'string' ? option : option.value;
          const optionLabel = typeof option === 'string' ? option : option.label;
          const checked = value === optionValue;
          return (
            <label
              key={optionValue}
              className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-body-sm transition-colors ${
                checked ? 'border-primary bg-primary-fixed/60 text-on-primary-fixed' : 'border-outline-variant hover:bg-surface-container-low'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={optionValue}
                checked={checked}
                onChange={(event) => onChange(event.target.value)}
                className="text-primary focus:ring-primary"
              />
              {optionLabel}
            </label>
          );
        })}
      </div>
      {hint && <p className="mt-1 text-label-sm text-tertiary">{hint}</p>}
    </fieldset>
  );
}

export function CheckboxField({ label, description, checked, onChange, name, disabled }) {
  return (
    <label className={`flex items-start gap-2.5 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        name={name}
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 rounded border-outline-variant text-primary focus:ring-primary"
      />
      <span>
        <span className="block text-body-sm text-on-surface">{label}</span>
        {description && <span className="block text-label-sm text-tertiary">{description}</span>}
      </span>
    </label>
  );
}

export function ToggleSwitch({ label, description, checked, onChange, disabled, onLabel = 'On', offLabel = 'Off' }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-label-md text-on-surface">{label}</p>
        {description && <p className="mt-0.5 text-body-sm text-on-surface-variant">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={Boolean(checked)}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-[52px] shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-primary' : 'bg-surface-container-highest'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[27px]' : 'translate-x-1'
          }`}
        />
        <span className="sr-only">{checked ? onLabel : offLabel}</span>
      </button>
    </div>
  );
}

export function FilterPills({ options, value, onChange, ariaLabel }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const optionValue = typeof option === 'string' ? option : option.value;
        const optionLabel = typeof option === 'string' ? option : option.label;
        const count = typeof option === 'object' ? option.count : undefined;
        const active = value === optionValue;
        return (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            aria-pressed={active}
            className={`chip border transition-colors ${
              active
                ? 'border-primary bg-primary text-on-primary'
                : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
            }`}
          >
            {optionLabel}
            {count != null && (
              <span className={active ? 'text-white/80' : 'text-tertiary'}>({count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Pagination({ page, pageCount, onPageChange, total }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-topbar-border px-4 py-3">
      <p className="text-label-sm text-tertiary">
        Page {page} of {pageCount}
        {total != null ? ` · ${total} record${total === 1 ? '' : 's'}` : ''}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function FileField({
  label,
  hint,
  accept,
  onFileSelected,
  currentName,
  error,
  disabled,
  // Callers that accept something other than images/PDF pass their own
  // prompt; the default is the profile-photo / Form A case.
  placeholder = 'Choose a file (PNG, JPG or PDF, max 5 MB)'
}) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <label
        className={`flex cursor-pointer items-center gap-3 rounded border border-dashed px-4 py-3 transition-colors ${
          disabled ? 'cursor-not-allowed border-outline-variant bg-surface-container' : 'border-outline hover:bg-surface-container-low'
        }`}
      >
        <span className="material-symbols-outlined text-[22px] text-primary" aria-hidden="true">
          upload_file
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm text-on-surface">
            {currentName || placeholder}
          </span>
          {hint && <span className="block text-label-sm text-tertiary">{hint}</span>}
        </span>
        <input
          type="file"
          accept={accept ?? 'image/png,image/jpeg,image/webp,application/pdf'}
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFileSelected(file);
            event.target.value = '';
          }}
        />
      </label>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
