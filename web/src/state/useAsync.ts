// Runs an API call and reports one of four states: waiting, answer, empty or error
// (plus "unavailable" for the assistant). While a new answer is on its way, the previous
// answer stays on screen and `refreshing` is true, so lists do not flash empty.
// `refreshing` turns true in the very render in which the inputs change, not one render later:
// nothing is ever drawn that pairs the previous answer with the new inputs as if it were current.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, isAbortError } from '../api/errors';

export type AsyncStatus = 'idle' | 'waiting' | 'answer' | 'empty' | 'error' | 'unavailable';

export interface AsyncResult<T> {
  status: AsyncStatus;
  data: T | null;
  error: string | null;
  refreshing: boolean;
  retry: () => void;
}

/**
 * @param key  A string that changes whenever the call's inputs change (null = do not call).
 * @param run  The call itself. It receives an AbortSignal so stale calls can be cancelled.
 * @param isEmpty  Says when a successful answer has nothing to show.
 * @param debounceMs  Wait this long after the key changes before calling (for sliders).
 */
export function useAsync<T>(
  key: string | null,
  run: (signal: AbortSignal) => Promise<T>,
  isEmpty: (data: T) => boolean = () => false,
  debounceMs = 0,
): AsyncResult<T> {
  // `forKey`: the inputs the answer in `data` belongs to.
  const [state, setState] = useState<Omit<AsyncResult<T>, 'retry'> & { forKey: string | null }>({
    status: key === null ? 'idle' : 'waiting',
    data: null,
    error: null,
    refreshing: false,
    forKey: null,
  });
  const [attempt, setAttempt] = useState(0);
  const runRef = useRef(run);
  const emptyRef = useRef(isEmpty);
  runRef.current = run;
  emptyRef.current = isEmpty;

  useEffect(() => {
    if (key === null) {
      setState({ status: 'idle', data: null, error: null, refreshing: false, forKey: null });
      return;
    }
    const controller = new AbortController();
    setState((s) =>
      s.data !== null && (s.status === 'answer' || s.status === 'empty') ? { ...s, refreshing: true } : { status: 'waiting', data: s.data, error: null, refreshing: false, forKey: s.forKey },
    );
    const timer = setTimeout(() => {
      runRef
        .current(controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          setState({ status: emptyRef.current(data) ? 'empty' : 'answer', data, error: null, refreshing: false, forKey: key });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || isAbortError(err)) return;
          const unavailable = err instanceof ApiError && err.kind === 'unavailable';
          const message = err instanceof Error ? err.message : 'Something went wrong.';
          // Keep the last good answer in `data` (for example the landing time) while showing the error.
          setState((s) => ({ status: unavailable ? 'unavailable' : 'error', data: s.data, error: message, refreshing: false, forKey: s.forKey }));
        });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, attempt, debounceMs]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // An answer still on screen for other inputs than the present ones is being replaced.
  const outdated = key !== null && state.data !== null && state.forKey !== key && (state.status === 'answer' || state.status === 'empty');
  return { status: state.status, data: state.data, error: state.error, refreshing: state.refreshing || outdated, retry };
}
