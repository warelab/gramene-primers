import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError, isPrimersApiError, PrimersApiError } from '../../errors';
import { sleep } from '../../poll';
import type { GenotypingDesignRequest, GenotypingDesignResponse, PrimersClient } from '../../types';
import { DEFAULT_BUSY_RETRY_MS, MAX_BUSY_RETRIES, type BusyRetry, type DesignMeta } from './useDesign';
import { useIsoLayoutEffect } from './useIsoLayoutEffect';

export interface GenotypingRunState {
  status: 'idle' | 'running' | 'done' | 'error';
  /** The latest successful response (kept while a new request runs or fails). */
  response: GenotypingDesignResponse | null;
  /** The request that produced `response`. */
  responseRequest: GenotypingDesignRequest | null;
  responseMeta: DesignMeta | null;
  /** The request currently running (or that failed last). */
  request: GenotypingDesignRequest | null;
  error: unknown;
  busy: BusyRetry | null;
}

const IDLE: GenotypingRunState = { status: 'idle', response: null, responseRequest: null, responseMeta: null, request: null, error: null, busy: null };

export interface GenotypingDesignHandlers {
  onSuccess?: (res: GenotypingDesignResponse, req: GenotypingDesignRequest, meta: DesignMeta, previous: GenotypingDesignResponse | null) => void;
  onError?: (e: PrimersApiError) => void;
}

/**
 * One genotyping design at a time, mirroring `useDesign`: a new run aborts the
 * previous one, a monotonic id drops stale responses, and `BUSY` is retried up
 * to 3 times. `designGenotyping` is optional on the client, so `supported` says
 * whether the mode can run at all rather than failing at the first click.
 */
export function useGenotypingDesign(client: PrimersClient, handlers: GenotypingDesignHandlers) {
  const [state, setState] = useState<GenotypingRunState>(IDLE);
  const ctrlRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const responseRef = useRef<GenotypingDesignResponse | null>(null);
  const handlersRef = useRef(handlers);
  useIsoLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  const supported = typeof client.designGenotyping === 'function';

  const abort = useCallback(() => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    seqRef.current += 1;
  }, []);

  const run = useCallback(
    async (req: GenotypingDesignRequest, meta: DesignMeta): Promise<void> => {
      if (typeof client.designGenotyping !== 'function') {
        const err = new PrimersApiError({ status: 501, code: 'NOT_SUPPORTED', message: 'This server cannot design genotyping assays.' });
        setState((s) => ({ ...s, status: 'error', error: err, busy: null }));
        handlersRef.current.onError?.(err);
        return;
      }
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      const id = ++seqRef.current;
      setState((s) => ({ ...s, status: 'running', request: req, error: null, busy: null }));
      let attempt = 0;
      for (;;) {
        try {
          const res = await client.designGenotyping(req, { signal: ctrl.signal });
          if (id !== seqRef.current) return;
          ctrlRef.current = null;
          const previous = responseRef.current;
          // A template-only preview carries no sets, so selections still refer to the last real design.
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

  /** Aborts and forgets everything (a new variant, or an identity change). */
  const reset = useCallback(() => {
    abort();
    responseRef.current = null;
    setState(IDLE);
  }, [abort]);

  const clearError = useCallback(() => {
    setState((s) => (s.status === 'error' ? { ...s, status: s.response ? 'done' : 'idle', error: null } : s));
  }, []);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  return { state, run, cancel, reset, abort, clearError, supported };
}
