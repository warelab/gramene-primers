import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAbortError, PrimersApiError } from '../src/errors';
import { nextPollDelay, pollCheckJob } from '../src/poll';
import type { CheckJob, CheckRequest, CheckStatus } from '../src/types';
import { P2_REQUEST } from './fixtures/samples';

const ID = '9f2c0a4be1d34c7a8e5f00112233aabb';

function mk(status: CheckStatus, done = 0, id = ID): CheckJob {
  return { job_id: id, status, progress: { done, total: 10, stage: status }, warnings: [] };
}

type Step = CheckJob | PrimersApiError;

/** Fake client whose getCheck replays `steps` and records the fake-clock time of each call. */
function fakeClient(steps: Step[], submitted: CheckJob = mk('queued')) {
  const times: number[] = [];
  const start = Date.now();
  const getCheck = vi.fn(async (id: string) => {
    times.push(Date.now() - start);
    const s = steps.shift();
    if (!s) throw new Error(`no more steps (id ${id})`);
    if (s instanceof PrimersApiError) throw s;
    return s;
  });
  const submitCheck = vi.fn(async (_req: CheckRequest) => ({ ...submitted, created: true }));
  return { client: { getCheck, submitCheck }, times, getCheck, submitCheck };
}

const gaps = (times: number[]) => times.slice(1).map((t, i) => t - (times[i] as number));

const apiErr = (status: number, code: string, retryAfterMs: number | null = null) => new PrimersApiError({ status, code, message: code, retryAfterMs });

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pollCheckJob backoff', () => {
  it('starts at 1000 ms, grows ×1.5 and caps at 10000 ms', async () => {
    const steps: Step[] = [...Array.from({ length: 9 }, () => mk('running', 3)), mk('done', 10)];
    const { client, times } = fakeClient(steps);
    const p = pollCheckJob(client, ID);
    await vi.runAllTimersAsync();
    expect((await p).status).toBe('done');
    expect(gaps(times)).toEqual([1000, 1500, 2250, 3375, 5063, 7595, 10000, 10000, 10000]);
  });

  it('nextPollDelay rounds and caps', () => {
    expect(nextPollDelay(1000)).toBe(1500);
    expect(nextPollDelay(3375)).toBe(5063);
    expect(nextPollDelay(9000)).toBe(10000);
    expect(nextPollDelay(1000, 2, 1500)).toBe(1500);
  });

  it('resets the delay when progress.done changes', async () => {
    const steps: Step[] = [mk('running', 0), mk('running', 0), mk('running', 1), mk('running', 1), mk('running', 1), mk('running', 2), mk('done', 10)];
    const { client, times } = fakeClient(steps);
    const p = pollCheckJob(client, ID);
    await vi.runAllTimersAsync();
    await p;
    expect(gaps(times)).toEqual([1000, 1500, 1000, 1500, 2250, 1000]);
  });

  it('waits at least 2000 ms while queued', async () => {
    const steps: Step[] = [mk('queued'), mk('queued'), mk('queued'), mk('queued'), mk('done')];
    const { client, times } = fakeClient(steps);
    const p = pollCheckJob(client, ID);
    await vi.runAllTimersAsync();
    await p;
    expect(gaps(times)).toEqual([2000, 2000, 2250, 3375]);
  });

  it('honours custom initial delay, factor and cap', async () => {
    const steps: Step[] = [mk('running'), mk('running'), mk('running'), mk('done')];
    const { client, times } = fakeClient(steps);
    const p = pollCheckJob(client, ID, { initialDelayMs: 500, factor: 2, maxDelayMs: 1500 });
    await vi.runAllTimersAsync();
    await p;
    expect(gaps(times)).toEqual([500, 1000, 1500]);
  });
});

describe('pollCheckJob terminal states and updates', () => {
  it('resolves with done and error jobs and reports each update', async () => {
    for (const status of ['done', 'error'] as const) {
      const final = { ...mk(status), error: status === 'error' ? { code: 'JOB_TIMEOUT', message: 'check exceeded 30 min' } : null };
      const { client } = fakeClient([mk('queued'), mk('running', 1), final]);
      const seen: CheckStatus[] = [];
      const p = pollCheckJob(client, ID, { onUpdate: (j) => seen.push(j.status) });
      await vi.runAllTimersAsync();
      const res = await p;
      expect(res.status).toBe(status);
      expect(seen).toEqual(['queued', 'running', status]);
    }
  });

  it('starts with a sleep when given initialJob and returns a terminal initialJob at once', async () => {
    const { client, times, getCheck } = fakeClient([mk('done')]);
    const p = pollCheckJob(client, ID, { initialJob: mk('running', 2) });
    await vi.advanceTimersByTimeAsync(999);
    expect(getCheck).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await p;
    expect(times).toEqual([1000]);

    // A job read with GET (it has a `results` key) is returned at once.
    const other = fakeClient([]);
    const done = await pollCheckJob(other.client, ID, { initialJob: { ...mk('done'), results: null } });
    expect(done.status).toBe('done');
    expect(other.getCheck).not.toHaveBeenCalled();
  });

  it('a finished initialJob from submitCheck (no results key) is read once, without sleeping', async () => {
    const full: CheckJob = { ...mk('done', 10), request: P2_REQUEST, results: { specificity: null } };
    const { client, times, getCheck } = fakeClient([full]);
    const seen: CheckJob[] = [];
    const res = await pollCheckJob(client, ID, { initialJob: mk('done', 10), onUpdate: (j) => seen.push(j) });
    expect(res).toEqual(full);
    expect(getCheck).toHaveBeenCalledTimes(1);
    expect(times).toEqual([0]);
    expect(seen).toEqual([full]);
  });
});

describe('pollCheckJob errors', () => {
  it('retries 503/5xx/NETWORK/TIMEOUT and gives up after 5 consecutive errors', async () => {
    const errs = [apiErr(503, 'JOB_STORE_UNAVAILABLE'), apiErr(0, 'NETWORK'), apiErr(502, 'HTTP_502'), apiErr(0, 'TIMEOUT'), apiErr(500, 'INTERNAL')];
    const { client, getCheck, times } = fakeClient([...errs]);
    const p = pollCheckJob(client, ID);
    const assertion = expect(p).rejects.toMatchObject({ code: 'INTERNAL' });
    await vi.runAllTimersAsync();
    await assertion;
    expect(getCheck).toHaveBeenCalledTimes(5);
    expect(gaps(times)).toEqual([1000, 1500, 2250, 3375]);
  });

  it('resets the error count after a successful poll', async () => {
    const e = () => apiErr(503, 'BUSY');
    const steps: Step[] = [e(), e(), e(), e(), mk('running'), e(), e(), e(), e(), mk('done')];
    const { client, getCheck } = fakeClient(steps);
    const p = pollCheckJob(client, ID);
    await vi.runAllTimersAsync();
    expect((await p).status).toBe('done');
    expect(getCheck).toHaveBeenCalledTimes(10);
  });

  it('sleeps retryAfterMs when the error carries it', async () => {
    const { client, times } = fakeClient([apiErr(503, 'QUEUE_FULL', 7000), mk('done')]);
    const p = pollCheckJob(client, ID);
    await vi.runAllTimersAsync();
    await p;
    expect(gaps(times)).toEqual([7000]);
  });

  it('throws non-retryable errors immediately', async () => {
    const { client, getCheck } = fakeClient([apiErr(400, 'INVALID_REQUEST'), mk('done')]);
    await expect(pollCheckJob(client, ID)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(getCheck).toHaveBeenCalledTimes(1);
  });

  it('404 without resubmit throws UNKNOWN_JOB', async () => {
    const { client, submitCheck } = fakeClient([apiErr(404, 'NOT_FOUND')]);
    await expect(pollCheckJob(client, ID)).rejects.toMatchObject({ status: 404, code: 'UNKNOWN_JOB' });
    expect(submitCheck).not.toHaveBeenCalled();
  });

  it('404 with resubmit resubmits once and keeps polling the new job', async () => {
    const newId = 'ffffffffffffffffffffffffffffffff';
    const { client, submitCheck, getCheck } = fakeClient([apiErr(404, 'UNKNOWN_JOB'), mk('done', 10, newId)], mk('queued', 0, newId));
    const seen: string[] = [];
    const p = pollCheckJob(client, ID, { resubmit: P2_REQUEST, onUpdate: (j) => seen.push(`${j.job_id.slice(0, 4)}:${j.status}`) });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.job_id).toBe(newId);
    expect(submitCheck).toHaveBeenCalledTimes(1);
    expect(submitCheck.mock.calls[0]?.[0]).toBe(P2_REQUEST);
    expect(getCheck.mock.calls.map((c) => c[0])).toEqual([ID, newId]);
    expect(seen).toEqual(['ffff:queued', 'ffff:done']);
  });

  it('404 with resubmit: an identical job that already finished is read once (the POST answer has no results)', async () => {
    const newId = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const full: CheckJob = { ...mk('done', 10, newId), results: { specificity: null } };
    const { client, submitCheck, getCheck } = fakeClient([apiErr(404, 'UNKNOWN_JOB'), full], mk('done', 10, newId));
    const seen: string[] = [];
    const p = pollCheckJob(client, ID, { resubmit: P2_REQUEST, onUpdate: (j) => seen.push(`${j.job_id.slice(0, 4)}:${j.status}:${'results' in j}`) });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res).toEqual(full);
    expect(submitCheck).toHaveBeenCalledTimes(1);
    expect(getCheck.mock.calls.map((c) => c[0])).toEqual([ID, newId]);
    expect(seen).toEqual(['eeee:done:true']);
  });

  it('a second 404 after resubmitting throws UNKNOWN_JOB', async () => {
    const { client, submitCheck } = fakeClient([apiErr(404, 'UNKNOWN_JOB'), apiErr(404, 'UNKNOWN_JOB')]);
    const p = pollCheckJob(client, ID, { resubmit: P2_REQUEST });
    const assertion = expect(p).rejects.toMatchObject({ code: 'UNKNOWN_JOB' });
    await vi.runAllTimersAsync();
    await assertion;
    expect(submitCheck).toHaveBeenCalledTimes(1);
  });
});

describe('pollCheckJob visibility and abort', () => {
  it('pauses while the document is hidden and resumes on visibilitychange', async () => {
    visibility = 'hidden';
    const { client, getCheck } = fakeClient([mk('done')]);
    const p = pollCheckJob(client, ID);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getCheck).not.toHaveBeenCalled();
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.runAllTimersAsync();
    expect((await p).status).toBe('done');
    expect(getCheck).toHaveBeenCalledTimes(1);
  });

  it('does not pause when pauseWhenHidden is false', async () => {
    visibility = 'hidden';
    const { client } = fakeClient([mk('done')]);
    await expect(pollCheckJob(client, ID, { pauseWhenHidden: false })).resolves.toMatchObject({ status: 'done' });
  });

  it('rejects with AbortError when aborted during a sleep and stops polling', async () => {
    const { client, getCheck } = fakeClient([mk('running'), mk('running'), mk('done')]);
    const ac = new AbortController();
    const p = pollCheckJob(client, ID, { signal: ac.signal });
    const assertion = expect(p).rejects.toSatisfy(isAbortError);
    await vi.advanceTimersByTimeAsync(500);
    ac.abort();
    await assertion;
    await vi.runAllTimersAsync();
    expect(getCheck).toHaveBeenCalledTimes(1);
  });

  it('rejects with AbortError when aborted while hidden', async () => {
    visibility = 'hidden';
    const { client, getCheck } = fakeClient([mk('done')]);
    const ac = new AbortController();
    const p = pollCheckJob(client, ID, { signal: ac.signal });
    const assertion = expect(p).rejects.toSatisfy(isAbortError);
    ac.abort();
    await assertion;
    expect(getCheck).not.toHaveBeenCalled();
  });

  it('propagates an AbortError thrown by getCheck', async () => {
    const client = { getCheck: vi.fn(async () => Promise.reject(new DOMException('x', 'AbortError'))), submitCheck: vi.fn() };
    await expect(pollCheckJob(client as never, ID, { maxConsecutiveErrors: 1 })).rejects.toSatisfy(isAbortError);
  });
});
