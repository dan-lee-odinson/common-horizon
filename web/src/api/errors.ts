// Errors the API layer can raise. The UI turns them into the "error" or "unavailable" state.

export type ApiErrorKind = 'network' | 'http' | 'parse' | 'unavailable';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;

  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError' : (err as { name?: string })?.name === 'AbortError';
}

export function abortError(): DOMException {
  return new DOMException('The request was cancelled.', 'AbortError');
}
