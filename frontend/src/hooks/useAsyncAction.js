import { useCallback, useState } from 'react';
import { describeError } from '../lib/formatters.js';
import { useToast } from '../context/ToastProvider.jsx';

/**
 * Wraps an async action with a pending flag and consistent error toasts,
 * so every button in the app behaves the same way when something fails.
 */
export function useAsyncAction() {
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async (action, { successMessage, onSuccess, onError, errorMessage } = {}) => {
      setPending(true);
      try {
        const result = await action();
        // A function gets the action's result, so a toast can quote a count.
        if (successMessage)
          toast.success(typeof successMessage === 'function' ? successMessage(result) : successMessage);
        if (onSuccess) await onSuccess(result);
        return result;
      } catch (error) {
        toast.error(errorMessage ?? describeError(error));
        onError?.(error);
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [toast]
  );

  return { run, pending };
}
