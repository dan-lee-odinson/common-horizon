// The assistant chat along the bottom. It answers in text only and never controls the interface:
// nothing it says changes the planner, the sites or the views.

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, isEmpty } from '../api/client';
import { ApiError, isAbortError } from '../api/errors';
import { appStore } from '../state/app';
import { useData } from '../state/data';
import { toIsoUtc } from '../util/time';
import { Icon } from './Icon';

type Status = 'waiting' | 'answer' | 'empty' | 'error' | 'unavailable' | 'stopped';

interface Exchange {
  id: number;
  question: string;
  status: Status;
  answer: string | null;
  example: boolean;
  error: string | null;
}

export function AssistantBar() {
  const { health, highlighted, hardwareChosen } = useData();
  const [question, setQuestion] = useState('');
  const [log, setLog] = useState<Exchange[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [offline, setOffline] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const ids = { input: useId(), log: useId() };
  const latestRef = useRef<HTMLDivElement>(null);

  const unavailable = offline || (health.status === 'answer' && health.data?.assistant_available === false);
  const latest = log[log.length - 1];

  useEffect(() => {
    // Show the start of the newest exchange (the question), not the end of a long answer.
    latestRef.current?.scrollIntoView({ block: 'start' });
  }, [log.length, expanded]);

  useEffect(() => () => controller.current?.abort(), []);

  function send(text: string, replaceId?: number) {
    const q = text.trim();
    if (!q || unavailable) return;
    controller.current?.abort();
    // A question still waiting is stopped by the new one; say so instead of leaving "Thinking…".
    setLog((l) => l.map((x) => (x.status === 'waiting' && x.id !== replaceId ? { ...x, status: 'stopped' } : x)));
    const c = new AbortController();
    controller.current = c;
    const id = replaceId ?? nextId.current++;
    const pending: Exchange = { id, question: q, status: 'waiting', answer: null, example: false, error: null };
    setLog((l) => (replaceId ? l.map((x) => (x.id === id ? pending : x)) : [...l.slice(-19), pending]));
    const s = appStore.get();
    api
      .ask(
        {
          question: q,
          context: { site_id: highlighted?.id ?? null, launch_utc: toIsoUtc(s.launchUtcMs), slip_days: s.slipDays, stay_days: s.stayDays, hardware: hardwareChosen },
        },
        c.signal,
      )
      .then((r) => {
        const empty = isEmpty.ask(r);
        setLog((l) => l.map((x) => (x.id === id ? { ...x, status: empty ? 'empty' : 'answer', answer: r.answer, example: Boolean(r.example) } : x)));
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        const isUnavailable = err instanceof ApiError && err.kind === 'unavailable';
        if (isUnavailable) setOffline(true);
        setLog((l) =>
          l.map((x) => (x.id === id ? { ...x, status: isUnavailable ? 'unavailable' : 'error', error: err instanceof Error ? err.message : 'Something went wrong.' } : x)),
        );
      });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(question);
    setQuestion('');
  }

  return (
    <section aria-label="Assistant" className="relative z-20 border-t border-line bg-surface" data-testid="assistant">
      {log.length > 0 ? (
        <div
          id={ids.log}
          className={`overflow-y-auto border-b border-line px-3 py-2 text-[13px] md:px-4 ${expanded ? 'max-h-[40vh]' : 'max-h-24'}`}
          aria-live="polite"
        >
          {(expanded ? log : latest ? [latest] : []).map((x) => (
            <div key={x.id} ref={x.id === latest?.id ? latestRef : undefined} className="mb-2 scroll-mt-2 last:mb-0">
              <p className="m-0 text-ink-2">
                <span className="text-muted">You: </span>
                {x.question}
              </p>
              <AnswerView x={x} onRetry={() => send(x.question, x.id)} />
            </div>
          ))}
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="flex items-center gap-2 px-3 py-2 md:px-4">
        <label htmlFor={ids.input} className="sr-only">
          Ask the assistant
        </label>
        <input
          id={ids.input}
          className="field min-w-0 flex-1 text-[13px]"
          placeholder={unavailable ? 'The assistant is unavailable right now' : 'Ask about these sites, the slip, power or Earth contact…'}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={unavailable}
          autoComplete="off"
          enterKeyHint="send"
        />
        <button type="submit" className="btn btn-primary" disabled={unavailable || question.trim() === ''}>
          <Icon name="send" size={14} />
          Ask
        </button>
        {log.length > 0 ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              controller.current?.abort();
              setLog([]);
              setExpanded(false);
            }}
          >
            Clear
          </button>
        ) : null}
        {log.length > 1 ? (
          <button type="button" className="btn" aria-expanded={expanded} aria-controls={ids.log} onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Less' : `All (${log.length})`}
          </button>
        ) : null}
      </form>
      {unavailable && log.length === 0 ? (
        <p className="m-0 px-3 pb-2 text-[12px] text-muted md:px-4" data-state="unavailable" role="status">
          The assistant is unavailable right now. Everything else on this page still works.
        </p>
      ) : (
        <p className="m-0 hidden px-4 pb-1.5 text-[12px] text-muted md:block">Answers in text only. The assistant never changes the planner or the views.</p>
      )}
    </section>
  );
}

function AnswerView({ x, onRetry }: { x: Exchange; onRetry: () => void }) {
  switch (x.status) {
    case 'waiting':
      return (
        <p className="m-0 mt-0.5 text-muted" role="status" data-state="waiting">
          Thinking…
        </p>
      );
    case 'empty':
      return (
        <p className="m-0 mt-0.5 text-muted" data-state="empty">
          No answer came back. Try asking another way.
        </p>
      );
    case 'error':
      return (
        <p className="m-0 mt-0.5 text-ink-2" role="alert" data-state="error">
          <span className="text-bad">The assistant could not answer.</span> {x.error}{' '}
          <button type="button" className="btn ml-1 h-6 min-h-6 px-2 text-[12px]" onClick={onRetry}>
            Try again
          </button>
        </p>
      );
    case 'stopped':
      return <p className="m-0 mt-0.5 text-muted">Stopped: a newer question was asked.</p>;
    case 'unavailable':
      return (
        <p className="m-0 mt-0.5 text-muted" data-state="unavailable">
          The assistant is unavailable right now. Everything else on this page still works.
        </p>
      );
    default:
      return (
        <p className="m-0 mt-0.5 whitespace-pre-line text-ink" data-state="answer">
          {x.example ? <span className="mr-1 rounded border border-line-strong px-1 text-[10px] text-muted">example</span> : null}
          {x.answer}
        </p>
      );
  }
}
