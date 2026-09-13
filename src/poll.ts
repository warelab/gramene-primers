import { isAbortError, isRetryableError, makeAbortError, PrimersApiError, throwIfAborted } from './errors';
import type { CheckJob, PollOptions, PrimersClient } from './types';

export const DEFAULT_POLL = Object.freeze({
  initialDelayMs: 1000,
  maxDelayMs: 10_000,
  factor: 1.5,
  queuedMinDelayMs: 2000,
  maxConsecutiveErrors: 5,
  pauseWhenHidden: true,
});

export function isTerminalJob(job: Pick<CheckJob, 'status'> | null | undefined): boolean {
  return !!job && (job.status === 'done' || job.status === 'error');
}

/**
 * True for a finished job that was not read with `GET /primers/check/{id}`:
 * `POST /primers/check` answers an existing job with its status only (no
 * `results`, `request` or `error`), so the job document must be fetched once.
 */
export function needsJobDocument(job: CheckJob | null | undefined): boolean {
  return !!job && isTerminalJob(job) && !Object.prototype.hasOwnProperty.call(job, 'results');
}

/** Next backoff step: `min(max, round(delay × factor))`. */
export function nextPollDelay(delay: number, factor: number = DEFAULT_POLL.factor, maxDelayMs: number = DEFAULT_POLL.maxDelayMs): number {
  return Math.min(maxDelayMs, Math.round(delay * factor));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError(signal.reason));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(makeAbortError(signal?.reason));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** Resolves once the document is visible (immediately outside browsers). */
export function waitUntilVisible(signal?: AbortSignal): Promise<void> {
  if (!documentHidden()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError(signal.reason));
      return;
    }
    const cleanup = () => {
      document.removeEventListener('visibilitychange', onChange);
      signal?.removeEventListener('abort', onAbort);
    };
    const onChange = () => {
      if (!documentHidden()) {
        cleanup();
        resolve();
      }
    };
    const onAbort = () => {
      cleanup();
      reject(makeAbortError(signal?.reason));
    };
    document.addEventListener('visibilitychange', onChange);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Polls `GET /primers/check/{id}` until `done` or `error`.
 *
 * - Delay starts at `initialDelayMs`, grows ×`factor` per poll up to `maxDelayMs`,
 *   resets when `progress.done` changes, and is ≥ `queuedMinDelayMs` while queued.
 * - 503/5xx/NETWORK/TIMEOUT: sleep `retryAfterMs ?? delay`; give up after
 *   `maxConsecutiveErrors` consecutive failures (the last error is thrown).
 * - 404: resubmit once when `resubmit` is given, else throw `UNKNOWN_JOB`.
 *   A resubmit (or an `initialJob` from `submitCheck`) that is already finished
 *   is fetched once with `getCheck`, because POST answers carry no results.
 * - Pauses while the document is hidden; rejects with AbortError on abort.
 */
export async function pollCheckJob(
  client: Pick<PrimersClient, 'getCheck' | 'submitCheck'>,
  jobId: string,
  options: PollOptions = {},
): Promise<CheckJob> {
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_POLL.initialDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_POLL.maxDelayMs;
  const factor = options.factor ?? DEFAULT_POLL.factor;
  const queuedMin = options.queuedMinDelayMs ?? DEFAULT_POLL.queuedMinDelayMs;
  const maxErrors = options.maxConsecutiveErrors ?? DEFAULT_POLL.maxConsecutiveErrors;
  const pauseWhenHidden = options.pauseWhenHidden ?? DEFAULT_POLL.pauseWhenHidden;
  const { signal, onUpdate, resubmit } = options;

  let id = jobId;
  let delay = initialDelayMs;
  let lastDone: number | undefined;
  let consecutiveErrors = 0;
  let resubmitted = false;
  let pending: CheckJob | undefined = options.initialJob;

  const handle = (job: CheckJob): CheckJob | null => {
    onUpdate?.(job);
    if (isTerminalJob(job)) return job;
    const done = job.progress?.done;
    if (lastDone !== undefined && done !== lastDone) delay = initialDelayMs;
    lastDone = done;
    return null;
  };

  if (pending) {
    id = pending.job_id || id;
    if (needsJobDocument(pending)) {
      // A finished job from submitCheck: fetch its results now (no sleep).
      pending = undefined;
    } else {
      // The caller already has (and has presumably rendered) this job.
      if (isTerminalJob(pending)) return pending;
      lastDone = pending.progress?.done;
    }
  }

  for (;;) {
    throwIfAborted(signal);
    if (pending) {
      const wait = pending.status === 'queued' ? Math.max(delay, queuedMin) : delay;
      await sleep(wait, signal);
      delay = nextPollDelay(delay, factor, maxDelayMs);
      pending = undefined;
    }

    if (pauseWhenHidden) await waitUntilVisible(signal);

    let job: CheckJob;
    try {
      job = await client.getCheck(id, { signal });
      consecutiveErrors = 0;
    } catch (err) {
      if (isAbortError(err)) throw err;
      if (err instanceof PrimersApiError && err.status === 404) {
        if (resubmit && !resubmitted) {
          resubmitted = true;
          const again = await client.submitCheck(resubmit, { signal });
          id = again.job_id;
          delay = initialDelayMs;
          lastDone = undefined;
          // An identical job may already be finished; its POST answer has no results, so GET it next.
          if (isTerminalJob(again)) continue;
          handle(again);
          pending = again;
          continue;
        }
        throw err.code === 'UNKNOWN_JOB'
          ? err
          : new PrimersApiError({ status: 404, code: 'UNKNOWN_JOB', message: err.message || 'Unknown or expired job', details: err.details });
      }
      if (isRetryableError(err)) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= maxErrors) throw err;
        const wait = (err as PrimersApiError).retryAfterMs ?? delay;
        await sleep(wait, signal);
        delay = nextPollDelay(delay, factor, maxDelayMs);
        continue;
      }
      throw err;
    }

    const terminal = handle(job);
    if (terminal) return terminal;
    pending = job;
  }
}
