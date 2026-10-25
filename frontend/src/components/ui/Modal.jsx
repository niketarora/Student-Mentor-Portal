import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** Accessible modal: focus trap on open, Escape to close, scroll lock. */
export default function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  const panelRef = useRef(null);

  // Callers pass an inline arrow for onClose, so its identity changes on
  // every render. Keeping it in a ref lets the effect below depend on
  // `open` alone — otherwise every keystroke in the dialog re-ran the
  // whole setup and stole focus back to the first focusable element.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    // Land on the first real form field. A plain
    // querySelector('input, textarea, select, button') matches whichever
    // comes first in the DOM, which is the header's close button — so the
    // cursor landed on the ✕ instead of the first input.
    const focusTimer = setTimeout(() => {
      const field = panelRef.current?.querySelector(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])'
      );
      (field ?? panelRef.current?.querySelector('button:not([disabled])'))?.focus();
    }, 30);

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:items-center">
      <button type="button" aria-label="Close dialog" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`animate-scale-in relative z-10 my-auto w-full ${widths[size]} overflow-hidden rounded-xl bg-surface-container-lowest shadow-dropdown`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-topbar-border px-5 py-4">
          <div>
            <h2 className="text-headline-sm text-on-surface">{title}</h2>
            {description && <p className="mt-1 text-body-sm text-on-surface-variant">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-tertiary hover:bg-surface-container hover:text-on-surface"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </header>
        <div className="custom-scrollbar max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-topbar-border bg-surface-container-low px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', tone = 'primary', pending }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? 'Working...' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-body-sm text-on-surface-variant">{message}</p>
    </Modal>
  );
}
