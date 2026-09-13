import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError, isPrimersApiError, type PrimersApiError } from '../../errors';
import { sleep } from '../../poll';
import type { DesignRequest, DesignResponse, PrimersClient } from '../../types';
import { useIsoLayoutEffect } from './useIsoLayoutEffect';

export interface DesignMeta {
  templateOnly: boolean;
  /** False for the automatic re-run when a saved state is restored. */
  userInitiated: boolean;
}

export interface BusyRetry {
  attempt: number;
  max: number;
  /** `Date.now()` at which the next attempt starts. */
  retryAt: number;
  error: PrimersApiError;
}

export interface DesignRunState {
  status: 'idle' | 'running' | 'done' | 'error';
  /** The latest successful response (kept while a new request runs or fails). */
  response: DesignResponse | null;
  /** The request that produced `response`. */
  responseRequest: DesignRequest | null;
  responseMeta: DesignMeta | null;
  /** The request currently running (or that failed last). */
  request: DesignRequest | null;
  error: unknown;
  busy: BusyRetry | null;
}

export const MAX_BUSY_RETRIES = 3;
export const DEFAULT_BUSY_RETRY_MS = 5000;

const IDLE: DesignRunState = { status: 'idle', response: null, responseRequest: null, responseMeta: null, request: null, error: null, busy: null };

export interface DesignHandlers {
  /** `previous` is the last non-template-only response (the one the current selections refer to). */
  onSuccess?: (res: DesignResponse, req: DesignRequest, meta: DesignMeta, previous: DesignResponse | null) => void;
  onError?: (e: PrimersApiError) => void;
}

/**
 * One design request at a time (spec §C.4): a new run aborts the previous
 * one, a monotonically increasing id drops stale responses, and `BUSY`
 * answers are retried up to 3 times after `retryAfterMs` (default 5 s).
 */
export function useDesign(client: PrimersClient, handlers: DesignHandlers) {
  const [state, setState] = useState<DesignRunState>(IDLE);
  const ctrlRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const responseRef = useRef<DesignResponse | null>(null);
  const handlersRef = useRef(handlers);
  useIsoLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  const abort = useCallback(() => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    seqRef.current += 1;
  }, []);

  const run = useCallback(
    async (req: DesignRequest, meta: DesignMeta): Promise<void> => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      const id = ++seqRef.current;
      setState((s) => ({ ...s, status: 'running', request: req, error: null, busy: null }));
      let attempt = 0;
      for (;;) {
        try {
          const res = await client.design(req, { signal: ctrl.signal });
          if (id !== seqRef.current) return;
          ctrlRef.current = null;
          const previous = responseRef.current;
          // Selections are remapped against the last response with pairs; a template-only preview has none.
          if (!meta.templateOnly) responseRef.current = res;
          setState({ status: 'done', response: res, responseRequest: req, responseMeta: meta, request: req, error: null, busy: null });
          handlersRef.current.onSuccess?.(res, req, meta, previous);
          return;
        } catch (err) {
          if (id !== seqRef.current || ctrl.signal.aborted || isAbortError(err)) return;
          if (isPrimersApiError(err) && err.code === 'BUSY' && attempt < MAX_BUSY_RETRIES) {
            attempt += 1;
            const wait = err.retryAfterMs ?? DEFAULT_BUSY_RETRY_MS;
            setState((s) => ({ ...s, busy: { attempt, max: MAX_BUSY_RETRIES, retryAt: Date.now() + wait, error: err } }));
            try {
              await sleep(wait, ctrl.signal);
            } catch {
              return;
            }
            if (id !== seqRef.current) return;
            continue;
          }
          ctrlRef.current = null;
          setState((s) => ({ ...s, status: 'error', error: err, busy: null }));
          if (isPrimersApiError(err)) handlersRef.current.onError?.(err);
          return;
        }
      }
    },
    [client],
  );

  /** Aborts the running request and keeps the last response. */
  const cancel = useCallback(() => {
    abort();
    setState((s) => ({ ...s, status: s.response ? 'done' : 'idle', request: s.responseRequest, error: null, busy: null }));
  }, [abort]);

  /** Aborts and forgets everything (identity change). */
  const reset = useCallback(() => {
    abort();
    responseRef.current = null;
    setState(IDLE);
  }, [abort]);

  const clearError = useCallback(() => {
    setState((s) => (s.status === 'error' ? { ...s, status: s.response ? 'done' : 'idle', error: null } : s));
  }, []);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  return { state, run, cancel, reset, abort, clearError };
}
