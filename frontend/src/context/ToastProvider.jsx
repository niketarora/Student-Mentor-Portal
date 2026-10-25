import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);

const TONE_STYLES = {
  success: { bar: 'bg-success', icon: 'check_circle', text: 'text-on-success-container' },
  error: { bar: 'bg-error', icon: 'error', text: 'text-on-error-container' },
  warning: { bar: 'bg-warning', icon: 'warning', text: 'text-on-warning-container' },
  info: { bar: 'bg-info', icon: 'info', text: 'text-on-info-container' }
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message, tone = 'info', durationMs = 4500) => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((current) => [...current, { id, message, tone }]);
      if (durationMs > 0) setTimeout(() => dismiss(id), durationMs);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      show,
      dismiss,
      success: (message) => show(message, 'success'),
      error: (message) => show(message, 'error', 6500),
      warning: (message) => show(message, 'warning'),
      info: (message) => show(message, 'info')
    }),
    [show, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-6 right-6 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
        role="region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {toasts.map((toast) => {
          const style = TONE_STYLES[toast.tone] ?? TONE_STYLES.info;
          return (
            <div
              key={toast.id}
              role="status"
              className="animate-slide-in-right flex items-start gap-3 overflow-hidden rounded-xl border border-topbar-border bg-surface-container-lowest shadow-dropdown"
            >
              <span className={`w-1 self-stretch ${style.bar}`} aria-hidden="true" />
              <span className={`material-symbols-outlined mt-3 text-[20px] ${style.text}`} aria-hidden="true">
                {style.icon}
              </span>
              <p className="flex-1 py-3 pr-2 text-body-sm text-on-surface">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="p-2 text-tertiary hover:text-on-surface"
                aria-label="Dismiss notification"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
