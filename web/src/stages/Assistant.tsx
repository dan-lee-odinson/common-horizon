// The Mission Assistant. It answers in text only and never controls the interface: nothing it says
// changes the planner, the sites or the stages.
//
// In mission select it is a translucent section along the bottom. Asking opens the history above
// the question box: at least six lines tall, at most 40 % of the window height, scrolling beyond
// that, with Hide (or Escape) and Clear. It rises over the scene only; the rest of the HUD is laid
// out beside it, so it never covers a control. In the other stages the same conversation opens as
// a sheet from "Assistant" in the top bar. New answers are announced to screen readers.

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon } from '../components/Icon';
import { Sheet } from '../hud/Sheet';
import { actions, appStore } from '../state/app';
import { assistant, assistantStore, type Exchange } from '../state/assistant';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { toIsoUtc } from '../util/time';

function useAssistant() {
  const { health, focus, hardwareChosen } = useData();
  const log = useStore(assistantStore, (s) => s.log);
  const historyOpen = useStore(assistantStore, (s) => s.historyOpen);
  const offline = useStore(assistantStore, (s) => s.offline);
  const announcement = useStore(assistantStore, (s) => s.announcement);
  const unavailable = offline || (health.status === 'answer' && health.data?.assistant_available === false);
  const send = (text: string, replaceId?: number) => {
    if (unavailable) return;
    const s = appStore.get();
    assistant.ask(
      text,
      { site_id: focus?.id ?? null, launch_utc: toIsoUtc(s.launchUtcMs), slip_days: s.slipDays, stay_days: s.stayDays, hardware: hardwareChosen, storage_kwh: s.storageKwh },
      replaceId,
    );
  };
  return { log, historyOpen, unavailable, announcement, send };
}

const UNAVAILABLE = 'The assistant is unavailable right now. Everything else on this page still works.';

/** Mission select: the assistant along the bottom. */
export function AssistantDock({ className = '' }: { className?: string }) {
  const { log, historyOpen, unavailable, announcement, send } = useAssistant();
  const ids = { panel: useId(), heading: useId() };
  const sectionRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<'toggle' | 'log' | null>(null);
  const showPanel = historyOpen && log.length > 0;

  // Move focus where it makes sense after the history opens or closes from one of its own controls.
  useEffect(() => {
    if (focusAfter.current === 'toggle' && !showPanel) toggleRef.current?.focus();
    if (focusAfter.current === 'log' && showPanel) logRef.current?.focus();
    focusAfter.current = null;
  }, [showPanel]);

  // Escape hides the history: inside the assistant always; elsewhere only when no other layer is open.
  useEffect(() => {
    if (!showPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || sectionRef.current?.contains(e.target as Node)) return;
      const s = appStore.get();
      if (!s.drawerOpen && !s.missionOpen && !s.compareOpen && !s.cardOpen) assistant.setHistoryOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPanel]);

  function collapse() {
    if (panelRef.current?.contains(document.activeElement)) focusAfter.current = 'toggle';
    assistant.setHistoryOpen(false);
  }
  function onSectionKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape' && showPanel) {
      e.stopPropagation();
      collapse();
    }
  }

  return (
    <section ref={sectionRef} aria-label="Mission Assistant" className={`glass glass-strong flex flex-col ${className}`} data-testid="assistant" data-panel onKeyDown={onSectionKeyDown}>
      {log.length > 0 ? (
        <div ref={panelRef} id={ids.panel} role="region" aria-labelledby={ids.heading} hidden={!showPanel} className="chat-panel flex min-h-0 flex-col border-b border-line" data-testid="chat-panel">
          <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-1.5">
            <h2 id={ids.heading} className="panel-title m-0">
              Mission Assistant
            </h2>
            <span className="num text-[12px] text-muted">
              {log.length} {log.length === 1 ? 'question' : 'questions'}
            </span>
            <div className="ml-auto flex shrink-0 gap-1.5">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  assistant.clear();
                  inputRef.current?.focus();
                }}
                data-testid="chat-clear"
              >
                <Icon name="close" size={13} />
                Clear
              </button>
              <button type="button" className="btn" onClick={collapse} aria-expanded={showPanel} aria-controls={ids.panel} title="Hide the conversation (Escape)" data-testid="chat-collapse">
                <Icon name="chevron-down" size={14} />
                Hide
              </button>
            </div>
          </div>
          <ChatLog logRef={logRef} log={log} active={showPanel} onRetry={send} />
        </div>
      ) : null}
      <Announcer announcement={announcement} />
      <AskForm
        inputRef={inputRef}
        unavailable={unavailable}
        onAsk={send}
        trailing={
          log.length > 0 && !showPanel ? (
            <button
              ref={toggleRef}
              type="button"
              className="btn shrink-0"
              onClick={() => {
                focusAfter.current = 'log';
                assistant.setHistoryOpen(true);
              }}
              aria-expanded={false}
              aria-controls={ids.panel}
              aria-label={`Show the conversation (${log.length} ${log.length === 1 ? 'question' : 'questions'})`}
              data-testid="chat-expand"
            >
              <Icon name="chat" size={15} />
              <span className="num">{log.length}</span>
              <span className="max-lg:hidden">Show conversation</span>
            </button>
          ) : null
        }
      />
      {unavailable ? (
        <p className="sr-only" role="status" data-state="unavailable">
          {UNAVAILABLE}
        </p>
      ) : null}
    </section>
  );
}

/** Orbit and site stages: the same conversation, opened as a sheet from the top bar. */
export function AssistantSheet({ phone }: { phone: boolean }) {
  const open = useStore(appStore, (s) => s.assistantOpen);
  const { log, unavailable, announcement, send } = useAssistant();
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Sheet open={open} onClose={() => actions.setAssistantOpen(false)} title="Mission Assistant" note="Answers in text only. It never changes the planner or the stages." testId="assistant-sheet" phone={phone}>
      {open ? (
        <>
          {log.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <ChatLog logRef={logRef} log={log} active onRetry={send} />
            </div>
          ) : (
            <p className="m-0 px-5 py-4 text-[15px] leading-normal text-ink-2">Ask about these sites, the launch delay, power or Earth contact.</p>
          )}
          <Announcer announcement={announcement} />
          <div className="shrink-0 border-t border-line">
            <AskForm
              inputRef={inputRef}
              unavailable={unavailable}
              onAsk={send}
              trailing={
                log.length > 0 ? (
                  <button type="button" className="btn shrink-0" onClick={() => assistant.clear()}>
                    <Icon name="close" size={13} />
                    Clear
                  </button>
                ) : null
              }
            />
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

function Announcer({ announcement }: { announcement: { text: string; n: number } }) {
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="chat-announcer">
      {announcement.text}
      {announcement.n % 2 ? '​' : ''}
    </p>
  );
}

function AskForm({
  inputRef,
  unavailable,
  onAsk,
  trailing,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  unavailable: boolean;
  onAsk: (text: string) => void;
  trailing: React.ReactNode;
}) {
  const [question, setQuestion] = useState('');
  const inputId = useId();
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    onAsk(question);
    setQuestion('');
  }
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2 px-3 py-2">
      <label htmlFor={inputId} className="label shrink-0 pl-1 max-md:sr-only">
        Assistant
      </label>
      <input
        ref={inputRef}
        id={inputId}
        aria-label="Ask the assistant"
        className="field min-w-0 flex-1 font-sans text-[15px]"
        placeholder={unavailable ? 'The assistant is unavailable right now' : 'Ask about these sites, the delay, power or Earth contact'}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        disabled={unavailable}
        autoComplete="off"
        enterKeyHint="send"
        data-testid="chat-input"
      />
      <button type="submit" className="btn btn-primary shrink-0" disabled={unavailable || question.trim() === ''} data-testid="chat-ask">
        <Icon name="send" size={14} />
        Ask
      </button>
      {trailing}
    </form>
  );
}

function ChatLog({ logRef, log, active, onRetry }: { logRef: React.RefObject<HTMLDivElement | null>; log: Exchange[]; active: boolean; onRetry: (text: string, replaceId?: number) => void }) {
  const newest = log[log.length - 1];
  // Show the start of the newest exchange (the question), not the end of a long answer. Again when
  // its answer arrives: before that there is too little below the question to scroll it to the top.
  useLayoutEffect(() => {
    const box = logRef.current;
    if (!box || !active) return;
    const items = box.querySelectorAll<HTMLElement>('[data-exchange]');
    const last = items[items.length - 1];
    if (last) box.scrollTop = Math.max(0, last.offsetTop - 8);
  }, [newest?.id, newest?.status, active, logRef]);
  return (
    <div
      ref={logRef}
      className="chat-log relative flex-1 overflow-y-auto overscroll-contain px-4 py-2.5"
      // In the Tab order so keyboard users can scroll the history. New answers are announced by the
      // live region, so the log itself stays quiet.
      tabIndex={0}
      role="log"
      aria-live="off"
      aria-label="Conversation with the assistant"
      data-testid="chat-log"
    >
      {log.map((x) => (
        <div key={x.id} data-exchange className="mb-3 max-w-[72ch] last:mb-0">
          <p className="m-0 break-words text-ink-2">
            <span className="label mr-2">You</span>
            {x.question}
          </p>
          <AnswerView x={x} onRetry={() => onRetry(x.question, x.id)} />
        </div>
      ))}
    </div>
  );
}

function AnswerView({ x, onRetry }: { x: Exchange; onRetry: () => void }) {
  switch (x.status) {
    case 'waiting':
      return (
        <p className="m-0 mt-1 text-ink-2" data-state="waiting">
          Thinking…
        </p>
      );
    case 'empty':
      return (
        <p className="m-0 mt-1 text-ink-2" data-state="empty">
          No answer came back. Try asking another way.
        </p>
      );
    case 'error':
      return (
        <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2" data-state="error">
          <span>
            <span data-tone="bad">The assistant could not answer.</span> {x.error}
          </span>
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        </p>
      );
    case 'stopped':
      return <p className="m-0 mt-1 text-ink-2">Stopped: a newer question was asked.</p>;
    case 'unavailable':
      return (
        <p className="m-0 mt-1 text-ink-2" data-state="unavailable">
          {UNAVAILABLE}
        </p>
      );
    default:
      return (
        <p className="m-0 mt-1 whitespace-pre-line break-words text-ink" data-state="answer">
          {x.example ? <span className="tag mr-2 align-baseline">example</span> : null}
          {x.answer}
        </p>
      );
  }
}
