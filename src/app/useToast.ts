import { useEffect, useState } from 'react';

/**
 * The toast line, moved out of App.tsx verbatim (app-split step 3): the message
 * state, the 2800 ms clear effect and `showToast`.
 *
 * `showToast` is a plain function, not a useCallback, exactly as it was: it was
 * a new function every render, and effects downstream list it in their deps.
 * Memoising it would change when they re-fire.
 */
export function useToast(): { toastMessage: string | null; showToast: (message: string) => void } {
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function showToast(message: string) {
    setToastMessage(message);
  }

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timeout = setTimeout(() => setToastMessage(null), 2800);
    return () => clearTimeout(timeout);
  }, [toastMessage]);

  return { toastMessage, showToast };
}