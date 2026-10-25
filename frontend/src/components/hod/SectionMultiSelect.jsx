/**
 * SectionMultiSelect
 * A dropdown of the sections A3 ... T4 where any number can be ticked.
 * A section another senior already has is shown with their name and
 * cannot be ticked (one senior per section, migration 0042).
 */

import { useEffect, useId, useRef, useState } from 'react';
import { SENIOR_SECTIONS } from '../../lib/constants.js';

export default function SectionMultiSelect({ value, onChange, takenBy = {}, disabled = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listId = useId();
  const selected = new Set(value);

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (section) => {
    const next = new Set(selected);
    if (next.has(section)) next.delete(section);
    else next.add(section);
    onChange(SENIOR_SECTIONS.filter((code) => next.has(code)));
  };

  const summary = value.length ? value.join(', ') : 'Choose sections';

  return (
    <div ref={rootRef} className="relative">
      <span className="field-label">Sections</span>
      <button
        type="button"
        className="field-input flex w-full items-center justify-between gap-2 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`truncate ${value.length ? 'text-on-surface' : 'text-tertiary'}`}>{summary}</span>
        <span className="material-symbols-outlined text-[18px] text-tertiary" aria-hidden="true">
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-lowest p-2 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-label-sm text-tertiary">{value.length} selected</span>
            {value.length > 0 && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => onChange([])}>
                Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {SENIOR_SECTIONS.map((section) => {
              const owner = takenBy[section];
              const checked = selected.has(section);
              return (
                <label
                  key={section}
                  role="option"
                  aria-selected={checked}
                  title={owner ? `${section} belongs to ${owner}` : undefined}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-body-sm ${
                    owner ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-surface-container-low'
                  } ${checked ? 'bg-primary-fixed/60' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={Boolean(owner)}
                    onChange={() => toggle(section)}
                    className="rounded border-outline-variant text-primary focus:ring-primary"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-on-surface">{section}</span>
                    {owner && <span className="block truncate text-label-sm text-tertiary">{owner}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
