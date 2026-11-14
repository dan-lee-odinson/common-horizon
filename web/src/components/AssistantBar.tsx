// The assistant chat along the bottom. It answers in text only and never controls the interface:
// nothing it says changes the planner, the sites or the views.
//
// The question box is a fixed-height bar. The conversation opens as a semi-opaque panel that floats
// over the bottom of the workspace, above the question box: nothing behind it resizes or moves when
// it opens, grows or closes. It holds the history of questions and answers, scrolls, and is at least
// six lines tall (with content) and at most 40 % of the window height. Hide it with its button or
// Escape; clear it with its other button. New answers are announced to screen readers.

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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

/** How many exchanges the history keeps. */
const HISTORY = 20;

export function AssistantBar() {
  const { health, highlighted, hardwareChosen } = useData();
  const [question, setQuestion] = useState('');
  const [log, setLog] = useState<Exchange[]>([]);
  const [open, setOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  // What the screen-reader live region says; the counter makes a repeated message count as new.
  const [announcement, setAnnouncement] = useState({ text: '', n: 0 });
  const controller = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const ids = { input: useId(), panel: useId(), heading: useId() };
  const sectionRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<'toggle' | 'log' | null>(null);

  const unavailable = offline || (health.status === 'answer' && health.data?.assistant_available === false);
  const showPanel = open && log.length > 0;
  const newest = log[log.length - 1];

  const announce = (text: string) => setAnnouncement((a) => ({ text, n: a.n + 1 }));

  // Show the start of the newest exchange (the question), not the end of a long answer. Again when
  // its answer arrives: before that there is too little below the question to scroll it to the top.
  useLayoutEffect(() => {
    const box = logRef.current;
    if (!box || !showPanel) return;
    const items = box.querySelectorAll<HTMLElement>('[data-exchange]');
    const last = items[items.length - 1];
    if (last) box.scrollTop = Math.max(0, last.offsetTop - 8);
  }, [newest?.id, newest?.status, showPanel]);

  // Move focus where it makes sense after the panel opens or closes from one of its own controls.
  useEffect(() => {
    if (focusAfter.current === 'toggle' && !showPanel) toggleRef.current?.focus();
    if (focusAfter.current === 'log' && showPanel) logRef.current?.focus();
    focusAfter.current = null;
  }, [showPanel]);

  // Escape hides the conversation. Inside the assistant this is handled on the section; elsewhere it
  // only applies when no drawer or compare panel (which have their own Escape) is open. Capture phase:
  // read the state before those other handlers change it.
  useEffect(() => {
    if (!showPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || sectionRef.current?.contains(e.target as Node)) return;
      const s = appStore.get();
      if (s.drawer === 'none' && !s.compareOpen) setOpen(false);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [showPanel]);

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
    setLog((l) => (replaceId ? l.map((x) => (x.id === id ? pending : x)) : [...l.slice(-(HISTORY - 1)), pending]));
    setOpen(true);
    const s = appStore.get();
    api
      .ask(
        {
          question: q,
          context: {
            site_id: highlighted?.id ?? null,
            launch_utc: toIsoUtc(s.launchUtcMs),
            slip_days: s.slipDays,
            stay_days: s.stayDays,
            hardware: hardwareChosen,
            storage_kwh: s.storageKwh,
          },
        },
        c.signal,
      )
      .then((r) => {
        const empty = isEmpty.ask(r);
        setLog((l) => l.map((x) => (x.id === id ? { ...x, status: empty ? 'empty' : 'answer', answer: r.answer, example: Boolean(r.example) } : x)));
        announce(empty ? 'No answer came back. Try asking another way.' : `Assistant${r.example ? ' (example answer)' : ''}: ${r.answer}`);
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        const isUnavailable = err instanceof ApiError && err.kind === 'unavailable';
        const message = err instanceof Error ? err.message : 'Something went wrong.';
        if (isUnavailable) setOffline(true);
        setLog((l) => l.map((x) => (x.id === id ? { ...x, status: isUnavailable ? 'unavailable' : 'error', error: message } : x)));
        announce(isUnavailable ? 'The assistant is unavailable right now.' : `The assistant could not answer. ${message}`);
      });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(question);
    setQuestion('');
  }

  function collapse() {
    if (panelRef.current?.contains(document.activeElement)) focusAfter.current = 'toggle';
    setOpen(false);
  }

  function expand() {
    focusAfter.current = 'log';
    setOpen(true);
  }

  function clear() {
    controller.current?.abort();
    setLog([]);
    setOpen(false);
    announce('Conversation cleared.');
    inputRef.current?.focus();
  }

  function onSectionKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape' && showPanel) {
      // Keep this Escape from also closing a drawer or the compare panel.
      e.stopPropagation();
      collapse();
    }
  }

  return (
    <section ref={sectionRef} aria-label="Assistant" className="relative z-20 border-t border-line bg-surface" data-testid="assistant" onKeyDown={onSectionKeyDown}>
      {log.length > 0 ? (
        <div
          ref={panelRef}
          id={ids.panel}
          role="region"
          aria-labelledby={ids.heading}
          hidden={!showPanel}
          className="chat-panel enter absolute inset-x-0 bottom-full flex flex-col overflow-hidden rounded-t-xl border border-b-0 border-line md:left-3 md:right-[352px]"
          data-testid="chat-panel"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
            <h2 id={ids.heading} className="m-0 text-[13px] font-semibold">
              Assistant
            </h2>
            <span className="num text-[12px] text-muted">
              {log.length} {log.length === 1 ? 'question' : 'questions'}
            </span>
            <div className="ml-auto flex shrink-0 gap-1">
              <button type="button" className="btn h-7 min-h-7 px-2 text-[12px]" onClick={clear} data-testid="chat-clear">
                <Icon name="close" size={13} />
                Clear
              </button>
              <button type="button" className="btn h-7 min-h-7 px-2 text-[12px]" onClick={collapse} aria-expanded={showPanel} aria-controls={ids.panel} title="Hide the conversation (Escape)" data-testid="chat-collapse">
                <Icon name="chevron-down" size={14} />
                Hide
              </button>
            </div>
          </div>
          <div
            ref={logRef}
            className="chat-log relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 text-[13px] outline-none md:px-4"
            tabIndex={-1}
            aria-label="Conversation with the assistant"
            data-testid="chat-log"
          >
            {log.map((x) => (
              <div key={x.id} data-exchange className="mb-3 last:mb-0">
                <p className="m-0 text-ink-2">
                  <span className="text-muted">You: </span>
                  {x.question}
                </p>
                <AnswerView x={x} onRetry={() => send(x.question, x.id)} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="chat-announcer">
        {announcement.text}
        {announcement.n % 2 ? '​' : ''}
      </p>
      <form onSubmit={onSubmit} className="flex items-center gap-2 px-3 py-2 md:px-4">
        <label htmlFor={ids.input} className="sr-only">
          Ask the assistant
        </label>
        <input
          ref={inputRef}
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
        {log.length > 0 && !showPanel ? (
          <button
            ref={toggleRef}
            type="button"
            className="btn shrink-0 px-2 md:px-2.5"
            onClick={expand}
            aria-expanded={false}
            aria-controls={ids.panel}
            aria-label={`Show the conversation (${log.length} ${log.length === 1 ? 'question' : 'questions'})`}
            data-testid="chat-expand"
          >
            <Icon name="chat" size={15} />
            <span className="num text-[12px]">{log.length}</span>
            <span className="hidden md:inline">Show conversation</span>
          </button>
        ) : null}
      </form>
      {/* One line, the same height whatever it says, so the bar never changes height. */}
      <p className="m-0 hidden truncate px-4 pb-1.5 text-[12px] text-muted md:block" data-state={unavailable ? 'unavailable' : undefined}>
        {unavailable ? 'The assistant is unavailable right now. Everything else on this page still works.' : 'Answers in text only. The assistant never changes the planner or the views.'}
      </p>
      {unavailable ? (
        <p className="sr-only" role="status">
          The assistant is unavailable right now. Everything else on this page still works.
        </p>
      ) : null}
    </section>
  );
}

function AnswerView({ x, onRetry }: { x: Exchange; onRetry: () => void }) {
  switch (x.status) {
    case 'waiting':
      return (
        <p className="m-0 mt-0.5 text-muted" data-state="waiting">
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
        <p className="m-0 mt-0.5 text-ink-2" data-state="error">
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
