// Shows the four states of an API call (and the assistant's fifth) in one consistent way.

import type { ReactNode } from 'react';
import type { AsyncResult } from '../state/useAsync';

interface Props<T> {
  result: AsyncResult<T>;
  /** What to show when there is an answer. */
  children: (data: T) => ReactNode;
  waiting?: ReactNode;
  empty?: ReactNode;
  idle?: ReactNode;
  unavailable?: ReactNode;
  /** Short name of what is loading, for screen readers: "ranked sites". */
  what: string;
}

export function AsyncView<T>({ result, children, waiting, empty, idle, unavailable, what }: Props<T>) {
  switch (result.status) {
    case 'idle':
      return <>{idle ?? null}</>;
    case 'waiting':
      return (
        <div role="status" aria-live="polite" data-state="waiting">
          {waiting ?? <SkeletonLines />}
          <span className="sr-only">Loading {what}…</span>
        </div>
      );
    case 'empty':
      return (
        <div role="status" data-state="empty" className="px-3 py-4 text-[13px] text-muted">
          {empty ?? `Nothing to show for ${what}.`}
        </div>
      );
    case 'error':
      return (
        <div role="alert" data-state="error" className="flex flex-col items-start gap-2 px-3 py-3 text-[13px]">
          <p className="text-ink-2">
            <span className="font-semibold text-bad">Could not load {what}.</span> {result.error}
          </p>
          <button type="button" className="btn" onClick={result.retry}>
            Try again
          </button>
        </div>
      );
    case 'unavailable':
      return (
        <div role="status" data-state="unavailable" className="px-3 py-3 text-[13px] text-ink-2">
          {unavailable ?? `${what} is unavailable right now.`}
        </div>
      );
    default:
      return result.data === null ? null : (
        <div data-state="answer" aria-busy={result.refreshing || undefined} className="contents">
          {children(result.data)}
        </div>
      );
  }
}

export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-3" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton h-3" style={{ width: `${88 - i * 14}%` }} />
      ))}
    </div>
  );
}
