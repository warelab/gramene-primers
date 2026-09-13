import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError, isPrimersApiError, type PrimersApiError } from '../../errors';
import { isTerminalJob } from '../../poll';
import type { CheckJob, CheckRequest, PollOptions, PrimersClient } from '../../types';
import { useIsoLayoutEffect } from './useIsoLayoutEffect';

export type CheckRunStatus =
  | 'idle'
  | 'submitting'
  | 'restoring'
  | 'watching'
  /** "Stop watching": polling detached, the job keeps running server-side. */
  | 'detached'
  | 'done'
  /** The job finished with `status: 'error'`. */
  | 'failed'
  /** 404 `UNKNOWN_JOB`: results expired. */
  | 'expired'
  /** A request failed (submit or poll). */
  | 'error';

export interface CheckRunState {
  status: CheckRunStatus;
  job: CheckJob | null;
  /** The request submitted in this mount (null after a restore). */
  request: CheckRequest | null;
  error: unknown;
  /** Jobs started in this mount may be resubmitted automatically on 404. */
  startedHere: boolean;
  created: boolean | null;
}

export interface CheckHandlers {
  poll?: Partial<Pick<PollOptions, 'initialDelayMs' | 'maxDelayMs' | 'factor'>>;
  onUpdate?: (job: CheckJob) => void;
  onError?: (e: PrimersApiError) => void;
  /** A job id to remember (submit, or a resubmit after 404). */
  onJobId?: (jobId: string, request: CheckRequest | null) => void;
}

const IDLE: CheckRunState = { status: 'idle', job: null, request: null, error: null, startedHere: false, created: null };

export function isCheckActive(status: CheckRunStatus): boolean {
  return status === 'submitting' || status === 'restoring' || status === 'watching';
}

/** Submits, restores and polls one check job at a time (spec §C.3 CheckPanel, §C.4 Restore). */
export function useCheckJob(client: PrimersClient, handlers: CheckHandlers) {
  const [state, setState] = useState<CheckRunState>(IDLE);
  const ctrlRef = useRef<AbortController | null>(null);
  const handlersRef = useRef(handlers);
  useIsoLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  const stop = useCallback(() => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
  }, []);

  const fail = useCallback((ctrl: AbortController, err: unknown) => {
    if (ctrl.signal.aborted || isAbortError(err)) return;
    if (ctrlRef.current === ctrl) ctrlRef.current = null;
    if (isPrimersApiError(err) && (err.code === 'UNKNOWN_JOB' || err.status === 404)) {
      setState((s) => ({ ...s, status: 'expired', error: err }));
      return;
    }
    setState((s) => ({ ...s, status: 'error', error: err }));
    if (isPrimersApiError(err)) handlersRef.current.onError?.(err);
  }, []);

  const finish = useCallback((ctrl: AbortController, job: CheckJob) => {
    if (ctrl.signal.aborted) return;
    if (ctrlRef.current === ctrl) ctrlRef.current = null;
    setState((s) => ({ ...s, job, status: job.status === 'done' ? 'done' : 'failed' }));
  }, []);

  const watch = useCallback(
    async (ctrl: AbortController, job: CheckJob, resubmit: CheckRequest | null) => {
      let currentId = job.job_id;
      const final = await client.pollCheck(job.job_id, {
        ...(handlersRef.current.poll ?? {}),
        signal: ctrl.signal,
        initialJob: job,
        resubmit: resubmit ?? undefined,
        onUpdate: (j) => {
          if (ctrl.signal.aborted) return;
          if (j.job_id && j.job_id !== currentId) {
            currentId = j.job_id;
            handlersRef.current.onJobId?.(j.job_id, resubmit);
          }
          setState((s) => ({ ...s, job: j }));
          handlersRef.current.onUpdate?.(j);
        },
      });
      finish(ctrl, final);
    },
    [client, finish],
  );

  const begin = useCallback(
    (next: CheckRunState): AbortController => {
      stop();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      setState(next);
      return ctrl;
    },
    [stop],
  );

  const submit = useCallback(
    async (request: CheckRequest): Promise<void> => {
      const ctrl = begin({ status: 'submitting', job: null, request, error: null, startedHere: true, created: null });
      try {
        const job = await client.submitCheck(request, { signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        handlersRef.current.onJobId?.(job.job_id, request);
        if (isTerminalJob(job)) {
          // An identical job already finished (ids are shared): the POST answer carries its status
          // but no results, request or error, so read the job document once.
          setState((s) => ({ ...s, created: job.created }));
          const full = await client.getCheck(job.job_id, { signal: ctrl.signal });
          if (ctrl.signal.aborted) return;
          handlersRef.current.onUpdate?.(full);
          setState((s) => ({ ...s, job: full, status: isTerminalJob(full) ? s.status : 'watching' }));
          if (isTerminalJob(full)) finish(ctrl, full);
          else await watch(ctrl, full, request);
          return;
        }
        handlersRef.current.onUpdate?.(job);
        setState((s) => ({ ...s, job, created: job.created, status: 'watching' }));
        await watch(ctrl, job, request);
      } catch (err) {
        fail(ctrl, err);
      }
    },
    [begin, client, fail, finish, watch],
  );

  /** Saved `check.jobId`: one GET, then poll while queued/running; 404 → expired (no automatic resubmit). */
  const restore = useCallback(
    async (jobId: string, request: CheckRequest | null = null, startedHere = false): Promise<void> => {
      const ctrl = begin({ status: 'restoring', job: null, request, error: null, startedHere, created: null });
      try {
        const job = await client.getCheck(jobId, { signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        handlersRef.current.onUpdate?.(job);
        setState((s) => ({ ...s, job, status: isTerminalJob(job) ? s.status : 'watching' }));
        if (isTerminalJob(job)) {
          finish(ctrl, job);
          return;
        }
        await watch(ctrl, job, startedHere ? request : null);
      } catch (err) {
        fail(ctrl, err);
      }
    },
    [begin, client, fail, finish, watch],
  );

  /** "Stop watching": detaches polling only. */
  const detach = useCallback(() => {
    stop();
    setState((s) => (isCheckActive(s.status) ? { ...s, status: 'detached' } : s));
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    setState(IDLE);
  }, [stop]);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  return { state, submit, restore, detach, reset, stop };
}
