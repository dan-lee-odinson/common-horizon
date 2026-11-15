// The Mission Assistant's conversation. It lives outside any one component so the same history
// shows wherever the assistant is opened (docked along the bottom of mission select, or as a sheet
// in the other stages). The assistant answers in text only and never controls the interface.

import { api, isEmpty } from '../api/client';
import { ApiError, isAbortError } from '../api/errors';
import type { AskRequest } from '../api/types';
import { createStore } from './store';

export type ExchangeStatus = 'waiting' | 'answer' | 'empty' | 'error' | 'unavailable' | 'stopped';

export interface Exchange {
  id: number;
  question: string;
  status: ExchangeStatus;
  answer: string | null;
  example: boolean;
  error: string | null;
}

/** How many exchanges the history keeps. */
export const HISTORY = 20;

export interface AssistantState {
  log: Exchange[];
  /** The history is showing (when there is one). */
  historyOpen: boolean;
  /** The backend said the assistant is unavailable. */
  offline: boolean;
  /** What the screen-reader live region says; the counter makes a repeated message count as new. */
  announcement: { text: string; n: number };
}

export const assistantStore = createStore<AssistantState>({ log: [], historyOpen: false, offline: false, announcement: { text: '', n: 0 } });

let controller: AbortController | null = null;
let nextId = 1;

function announce(text: string) {
  assistantStore.set((s) => ({ announcement: { text, n: s.announcement.n + 1 } }));
}

function patch(id: number, change: Partial<Exchange>) {
  assistantStore.set((s) => ({ log: s.log.map((x) => (x.id === id ? { ...x, ...change } : x)) }));
}

export const assistant = {
  /** Ask a question (or ask one again, replacing its old answer). */
  ask(text: string, context: AskRequest['context'], replaceId?: number) {
    const question = text.trim();
    if (!question || assistantStore.get().offline) return;
    controller?.abort();
    const c = new AbortController();
    controller = c;
    const id = replaceId ?? nextId++;
    const pending: Exchange = { id, question, status: 'waiting', answer: null, example: false, error: null };
    assistantStore.set((s) => {
      // A question still waiting is stopped by the new one; say so instead of leaving "Thinking…".
      const stopped = s.log.map((x) => (x.status === 'waiting' && x.id !== replaceId ? { ...x, status: 'stopped' as const } : x));
      return { log: replaceId ? stopped.map((x) => (x.id === id ? pending : x)) : [...stopped.slice(-(HISTORY - 1)), pending], historyOpen: true };
    });
    api
      .ask({ question, context }, c.signal)
      .then((r) => {
        const empty = isEmpty.ask(r);
        patch(id, { status: empty ? 'empty' : 'answer', answer: r.answer, example: Boolean(r.example) });
        announce(empty ? 'No answer came back. Try asking another way.' : `Assistant${r.example ? ' (example answer)' : ''}: ${r.answer}`);
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        const unavailable = err instanceof ApiError && err.kind === 'unavailable';
        const message = err instanceof Error ? err.message : 'Something went wrong.';
        if (unavailable) assistantStore.set({ offline: true });
        patch(id, { status: unavailable ? 'unavailable' : 'error', error: message });
        announce(unavailable ? 'The assistant is unavailable right now.' : `The assistant could not answer. ${message}`);
      });
  },
  clear() {
    controller?.abort();
    assistantStore.set({ log: [], historyOpen: false });
    announce('Conversation cleared.');
  },
  setHistoryOpen(historyOpen: boolean) {
    assistantStore.set({ historyOpen });
  },
};
