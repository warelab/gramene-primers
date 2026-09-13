import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrimersClient, parseRetryAfter, toApiError } from '../src/client';
import { isAbortError, PrimersApiError } from '../src/errors';
import type { CheckJob, CheckRequest } from '../src/types';
import { gene200, genomesResponse, P2_REQUEST } from './fixtures/samples';

const BASE = 'https://data.example.org/sorghum_v11';

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init ?? {}));
}

/** A fetch that never answers but rejects with AbortError when its signal aborts. */
function hangingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  );
}

const job = (over: Record<string, unknown> = {}) => ({
  job_id: '9f2c0a4be1d34c7a8e5f00112233aabb',
  status: 'queued',
  kind: 'specificity',
  queue_position: 0,
  progress: { done: 0, total: 1, stage: 'queued', running: [] },
  estimate: { cpu_s: 37 },
  created_at: '2026-09-12T20:01:02.000Z',
  warnings: [],
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createPrimersClient transport', () => {
  it('POSTs design requests with JSON headers, no-store, omit credentials, cors', async () => {
    const f = mockFetch(() => json({ template: { mode: 'gene', length: 10, seq: 'ACGT' }, pairs: [], warnings: [] }));
    const client = createPrimersClient({ apiBase: `${BASE}//`, fetch: f, headers: { 'X-Trace': 'abc' } });
    expect(client.apiBase).toBe(BASE);
    const req = { mode: 'gene' as const, gene_id: 'SORBI_3001G000200' };
    const res = await client.design(req);
    expect(res.pairs).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/primers/design`);
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('omit');
    expect(init.mode).toBe('cors');
    expect(init.headers).toEqual({ 'X-Trace': 'abc', Accept: 'application/json', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual(req);
    expect(init.signal).toBeDefined();
  });

  it('fills missing arrays in design responses and rejects non-design bodies', async () => {
    const ok = createPrimersClient({ apiBase: BASE, fetch: mockFetch(() => json({ template: { mode: 'gene' } })) });
    const res = await ok.design({ mode: 'gene', gene_id: 'x' });
    expect(res.pairs).toEqual([]);
    expect(res.warnings).toEqual([]);
    const bad = createPrimersClient({ apiBase: BASE, fetch: mockFetch(() => json([1, 2])) });
    await expect(bad.design({ mode: 'gene', gene_id: 'x' })).rejects.toMatchObject({ code: 'HTTP_200' });
  });

  it('GETs a check job with an encoded id, no body and no Content-Type', async () => {
    const f = mockFetch(() => json(job({ status: 'running' })));
    const client = createPrimersClient({ apiBase: BASE, fetch: f });
    const j = await client.getCheck('a/b c');
    expect(j.status).toBe('running');
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/primers/check/a%2Fb%20c`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('submitCheck marks 202 as created and 200 as existing', async () => {
    let status = 202;
    const f = mockFetch(() => json(job(), status));
    const client = createPrimersClient({ apiBase: BASE, fetch: f });
    const first = await client.submitCheck(P2_REQUEST);
    expect(first.created).toBe(true);
    expect(first.job_id).toBe('9f2c0a4be1d34c7a8e5f00112233aabb');
    status = 200;
    const second = await client.submitCheck(P2_REQUEST);
    expect(second.created).toBe(false);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/primers/check`);
    expect(JSON.parse(String(init.body))).toEqual(P2_REQUEST);
  });

  it('listGenomes adds only system_name, memoizes, and evicts on error', async () => {
    let fail = true;
    const f = mockFetch(() => (fail ? json({ message: 'down', code: 'MONGO_UNAVAILABLE' }, 503) : json(genomesResponse())));
    const client = createPrimersClient({ apiBase: BASE, fetch: f });
    await expect(client.listGenomes('sorghum_bicolor')).rejects.toMatchObject({ code: 'MONGO_UNAVAILABLE', status: 503 });
    fail = false;
    const a = await client.listGenomes('sorghum_bicolor');
    const b = await client.listGenomes('sorghum_bicolor');
    expect(a).toBe(b);
    expect(f).toHaveBeenCalledTimes(2);
    expect(String(f.mock.calls[1]?.[0])).toBe(`${BASE}/primers/genomes?system_name=sorghum_bicolor`);
    await client.listGenomes('a&b=c');
    expect(String(f.mock.calls[2]?.[0])).toBe(`${BASE}/primers/genomes?system_name=a%26b%3Dc`);
  });

  it('one caller aborting listGenomes does not cancel the shared request', async () => {
    let release: (r: Response) => void = () => {};
    const f = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    const client = createPrimersClient({ apiBase: BASE, fetch: f });
    const ac = new AbortController();
    const p1 = client.listGenomes('sorghum_bicolor', { signal: ac.signal });
    const p2 = client.listGenomes('sorghum_bicolor');
    ac.abort();
    await expect(p1).rejects.toSatisfy(isAbortError);
    release(json(genomesResponse()));
    await expect(p2).resolves.toMatchObject({ system_name: 'sorghum_bicolor' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('getGene uses /genes?idList= and returns the doc or null', async () => {
    const f = mockFetch((url) => (url.includes('NOPE') ? json([]) : json([gene200])));
    const client = createPrimersClient({ apiBase: BASE, fetch: f });
    const g = await client.getGene('SORBI_3001G000200');
    expect(g?._id).toBe('SORBI_3001G000200');
    expect(String(f.mock.calls[0]?.[0])).toBe(`${BASE}/genes?idList=SORBI_3001G000200`);
    expect(await client.getGene('NOPE')).toBeNull();
  });
});

describe('error mapping', () => {
  const run = async (res: Response | (() => never)) => {
    const f = typeof res === 'function' ? vi.fn(async () => res()) : mockFetch(() => res);
    const client = createPrimersClient({ apiBase: BASE, fetch: f as unknown as typeof fetch });
    try {
      await client.design({ mode: 'gene', gene_id: 'x' });
    } catch (e) {
      return e as PrimersApiError;
    }
    throw new Error('expected a rejection');
  };

  it('maps handler bodies {message, code, details}', async () => {
    const e = await run(json({ message: 'unknown gene', code: 'UNKNOWN_GENE', details: { gene_id: 'x' } }, 404));
    expect(e).toBeInstanceOf(PrimersApiError);
    expect(e).toMatchObject({ status: 404, code: 'UNKNOWN_GENE', message: 'unknown gene', details: { gene_id: 'x' }, errors: null, retryAfterMs: null });
  });

  it('maps the swagger validator shape to VALIDATION', async () => {
    const errors = [{ code: 'OBJECT_ADDITIONAL_PROPERTIES', message: 'Additional properties not allowed: bogus', path: [] }];
    const e = await run(json({ message: 'Validation errors', errors }, 400));
    expect(e.code).toBe('VALIDATION');
    expect(e.errors).toEqual(errors);
    expect(e.message).toBe('Validation errors');
  });

  it('maps an HTML 502 to HTTP_502', async () => {
    const e = await run(new Response('<html><body>Bad gateway</body></html>', { status: 502, statusText: 'Bad Gateway', headers: { 'Content-Type': 'text/html' } }));
    expect(e).toMatchObject({ status: 502, code: 'HTTP_502' });
    expect(e.message).toContain('502');
  });

  it('maps a fetch TypeError to NETWORK', async () => {
    const e = await run(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(e).toMatchObject({ status: 0, code: 'NETWORK', message: 'Failed to fetch' });
  });

  it('takes retryAfterMs from details.retry_after_s before the header', async () => {
    const e = await run(json({ message: 'busy', code: 'BUSY', details: { retry_after_s: 5 } }, 503, { 'Retry-After': '30' }));
    expect(e).toMatchObject({ code: 'BUSY', retryAfterMs: 5000 });
  });

  it('falls back to the Retry-After header, then null', async () => {
    const e1 = await run(json({ message: 'full', code: 'QUEUE_FULL' }, 503, { 'Retry-After': '60' }));
    expect(e1.retryAfterMs).toBe(60000);
    const e2 = await run(json({ message: 'store down', code: 'JOB_STORE_UNAVAILABLE' }, 503));
    expect(e2.retryAfterMs).toBeNull();
    const e3 = await run(new Response('Service Unavailable', { status: 503 }));
    expect(e3).toMatchObject({ code: 'HTTP_503', retryAfterMs: null });
  });

  it('parses HTTP-date Retry-After values', () => {
    const now = Date.parse('2026-09-12T20:00:00Z');
    expect(parseRetryAfter('Sat, 12 Sep 2026 20:00:10 GMT', now)).toBe(10000);
    expect(parseRetryAfter('2.5', now)).toBe(2500);
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });

  it('toApiError keeps an unknown JSON error as HTTP_<status>', () => {
    const e = toApiError(500, JSON.stringify({ error: 'boom' }), null, 'Internal Server Error');
    expect(e).toMatchObject({ status: 500, code: 'HTTP_500', message: 'HTTP 500 Internal Server Error' });
  });

  it('maps a client timeout to TIMEOUT', async () => {
    vi.useFakeTimers();
    const f = hangingFetch();
    const client = createPrimersClient({ apiBase: BASE, fetch: f as unknown as typeof fetch, timeouts: { design: 100 } });
    const p = client.design({ mode: 'gene', gene_id: 'x' });
    const assertion = expect(p).rejects.toMatchObject({ code: 'TIMEOUT', status: 0 });
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
  });

  it('rethrows AbortError untouched when the caller aborts', async () => {
    const f = hangingFetch();
    const client = createPrimersClient({ apiBase: BASE, fetch: f as unknown as typeof fetch });
    const ac = new AbortController();
    const p = client.getCheck('9f2c0a4be1d34c7a8e5f00112233aabb', { signal: ac.signal });
    ac.abort();
    const err = await p.catch((e) => e);
    expect(isAbortError(err)).toBe(true);
    expect(err).not.toBeInstanceOf(PrimersApiError);
  });

  it('does not call fetch when the signal is already aborted', async () => {
    const f = mockFetch(() => json({}));
    const client = createPrimersClient({ apiBase: BASE, fetch: f });
    const ac = new AbortController();
    ac.abort();
    await expect(client.design({ mode: 'gene', gene_id: 'x' }, { signal: ac.signal })).rejects.toSatisfy(isAbortError);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('runCheck', () => {
  it('submits, polls until done, and reports every update', async () => {
    vi.useFakeTimers();
    const states = [job({ status: 'running', progress: { done: 0, total: 2, stage: 'reference' } }), job({ status: 'done', progress: { done: 2, total: 2, stage: 'done' }, results: { specificity: null } })];
    const f = mockFetch((_url, init) => {
      if (init.method === 'POST') return json(job(), 202);
      return json(states.shift());
    });
    const client = createPrimersClient({ apiBase: BASE, fetch: f });
    const updates: string[] = [];
    const p = client.runCheck(P2_REQUEST as CheckRequest, { onUpdate: (j) => updates.push(j.status), pauseWhenHidden: false });
    await vi.runAllTimersAsync();
    const done = await p;
    expect(done.status).toBe('done');
    expect(updates).toEqual(['queued', 'running', 'done']);
    expect(f.mock.calls.map((c) => (c[1] as RequestInit).method)).toEqual(['POST', 'GET', 'GET']);
  });

  it('reads the job once when the submitted job already finished (POST answers carry no results)', async () => {
    const full = job({ status: 'done', progress: { done: 1, total: 1, stage: 'done' }, request: P2_REQUEST, results: { specificity: null }, error: null });
    // jobs/index.js submit(): {job_id, status, kind, queue_position, progress, estimate, created_at, warnings} only.
    const f = mockFetch((_url, init) => (init.method === 'POST' ? json(job({ status: 'done', progress: { done: 1, total: 1, stage: 'done' } }), 200) : json(full)));
    const client = createPrimersClient({ apiBase: BASE, fetch: f });
    const updates: CheckJob[] = [];
    const done = await client.runCheck(P2_REQUEST, { onUpdate: (j) => updates.push(j) });
    expect(done).toEqual(full);
    expect(f.mock.calls.map((c) => `${(c[1] as RequestInit).method} ${String(c[0])}`)).toEqual([`POST ${BASE}/primers/check`, `GET ${BASE}/primers/check/9f2c0a4be1d34c7a8e5f00112233aabb`]);
    expect(updates).toEqual([full]);
  });
});
