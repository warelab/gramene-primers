import type { ValidationErrorItem } from './types';

export interface PrimersApiErrorInit {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
  errors?: ValidationErrorItem[] | null;
  retryAfterMs?: number | null;
}

/**
 * Error thrown by the client for every non-abort failure.
 *
 * - Handler bodies `{message, code, details}` map directly.
 * - The swagger validator body `{message, errors}` becomes `code: 'VALIDATION'`.
 * - A non-JSON body becomes `HTTP_<status>`; a network failure `NETWORK`
 *   (status 0); a client timeout `TIMEOUT` (status 0).
 */
export class PrimersApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | null;
  readonly errors: ValidationErrorItem[] | null;
  readonly retryAfterMs: number | null;

  constructor(init: PrimersApiErrorInit) {
    super(init.message);
    this.name = 'PrimersApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? null;
    this.errors = init.errors ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isPrimersApiError(e: unknown): e is PrimersApiError {
  return e instanceof PrimersApiError;
}

/**
 * The swagger validator nests the real reasons: `errors[]` holds a generic
 * `INVALID_REQUEST_PARAMETER` entry (path `paths./primers/…/parameters/0`)
 * whose own `errors[]` says what is wrong (`OBJECT_ADDITIONAL_PROPERTIES`,
 * `PATTERN`, … with a path inside the body). Returns the innermost entries,
 * recursively; entries without nested errors are kept as they are.
 */
export function flattenValidationErrors(errors: ReadonlyArray<ValidationErrorItem> | null | undefined): ValidationErrorItem[] {
  const out: ValidationErrorItem[] = [];
  for (const e of errors ?? []) {
    if (!e || typeof e !== 'object') continue;
    const inner = Array.isArray(e.errors) ? (e.errors as ValidationErrorItem[]) : [];
    if (inner.length) out.push(...flattenValidationErrors(inner));
    else out.push(e);
  }
  return out;
}

/** True for `AbortError`s (from `AbortController.abort()` or a DOMException). */
export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/** Errors worth retrying while polling: 503, other 5xx, NETWORK, TIMEOUT. */
export function isRetryableError(e: unknown): boolean {
  if (!(e instanceof PrimersApiError)) return false;
  if (e.code === 'NETWORK' || e.code === 'TIMEOUT') return true;
  return e.status >= 500 && e.status <= 599;
}

export function makeAbortError(reason?: unknown): Error {
  if (isAbortError(reason)) return reason as Error;
  const message = typeof reason === 'string' && reason ? reason : 'The operation was aborted.';
  if (typeof DOMException === 'function') {
    return new DOMException(message, 'AbortError');
  }
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

/** Throws the signal's abort reason (as an AbortError) when the signal is aborted. */
export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw makeAbortError(signal.reason);
}
