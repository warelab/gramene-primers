import { isAbortError, makeAbortError, PrimersApiError, throwIfAborted } from './errors';
import { isTerminalJob, pollCheckJob } from './poll';
import type {
  ApiErrorBody,
  CheckJob,
  CheckRequest,
  DesignRequest,
  DesignResponse,
  GenomesResponse,
  GrameneGene,
  PollOptions,
  PrimersClient,
  PrimersClientOptions,
  RequestOptions,
} from './types';

export { PrimersApiError, isAbortError } from './errors';

export const DEFAULT_TIMEOUTS = Object.freeze({ design: 60_000, other: 15_000 });

type Method = 'GET' | 'POST';

interface CallResult<T> {
  status: number;
  body: T;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `Retry-After` as delta-seconds or an HTTP date → ms, else null. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - now);
}

/** Maps a non-2xx response (already read as text) to a PrimersApiError. */
export function toApiError(status: number, text: string, headers?: { get(name: string): string | null } | null, statusText = ''): PrimersApiError {
  let parsed: unknown;
  let isJson = false;
  try {
    parsed = JSON.parse(text);
    isJson = isObject(parsed);
  } catch {
    isJson = false;
  }
  const headerRetry = parseRetryAfter(headers?.get('Retry-After') ?? null);
  if (!isJson) {
    return new PrimersApiError({
      status,
      code: `HTTP_${status}`,
      message: `HTTP ${status}${statusText ? ` ${statusText}` : ''}`,
      retryAfterMs: headerRetry,
    });
  }
  const body = parsed as ApiErrorBody;
  const details = isObject(body.details) ? body.details : null;
  const retryS = details && typeof details.retry_after_s === 'number' && Number.isFinite(details.retry_after_s) ? details.retry_after_s : null;
  const retryAfterMs = retryS != null ? Math.round(retryS * 1000) : headerRetry;
  const errors = Array.isArray(body.errors) ? body.errors : null;
  let code: string;
  if (typeof body.code === 'string' && body.code) code = body.code;
  else if (errors) code = 'VALIDATION';
  else code = `HTTP_${status}`;
  const message = typeof body.message === 'string' && body.message ? body.message : `HTTP ${status}${statusText ? ` ${statusText}` : ''}`;
  return new PrimersApiError({ status, code, message, details, errors, retryAfterMs });
}

function invalidResponse(status: number, message: string): PrimersApiError {
  return new PrimersApiError({ status, code: `HTTP_${status}`, message });
}

export function createPrimersClient(options: PrimersClientOptions): PrimersClient {
  if (!options || typeof options.apiBase !== 'string') {
    throw new TypeError('createPrimersClient: apiBase is required');
  }
  const apiBase = options.apiBase.replace(/\/+$/, '');
  const fetchImpl: typeof fetch | undefined = options.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  const timeouts = {
    design: options.timeouts?.design ?? DEFAULT_TIMEOUTS.design,
    other: options.timeouts?.other ?? DEFAULT_TIMEOUTS.other,
  };
  const extraHeaders = options.headers ?? {};
  const genomesCache = new Map<string, Promise<GenomesResponse>>();

  async function call<T>(method: Method, path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<CallResult<T>> {
    if (!fetchImpl) throw new PrimersApiError({ status: 0, code: 'NETWORK', message: 'fetch is not available' });
    throwIfAborted(signal);

    const controller = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onCallerAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const headers: Record<string, string> = { ...extraHeaders, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    try {
      let res: Response;
      try {
        res = await fetchImpl(`${apiBase}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: 'no-store',
          credentials: 'omit',
          mode: 'cors',
          signal: controller.signal,
        });
      } catch (err) {
        throw mapTransportError(err);
      }

      let text: string;
      try {
        text = await res.text();
      } catch (err) {
        throw mapTransportError(err);
      }

      if (!res.ok) throw toApiError(res.status, text, res.headers, res.statusText);

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw invalidResponse(res.status, `HTTP ${res.status}: response is not JSON`);
      }
      return { status: res.status, body: parsed as T };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    }

    function mapTransportError(err: unknown): unknown {
      if (err instanceof PrimersApiError) return err;
      if (timedOut) {
        return new PrimersApiError({ status: 0, code: 'TIMEOUT', message: `Request timed out after ${timeoutMs} ms` });
      }
      if (signal?.aborted) return isAbortError(err) ? err : makeAbortError(signal.reason);
      if (isAbortError(err)) return err;
      const message = err instanceof Error && err.message ? err.message : 'Network request failed';
      return new PrimersApiError({ status: 0, code: 'NETWORK', message });
    }
  }

  function asObject(status: number, body: unknown, what: string): Record<string, unknown> {
    if (!isObject(body)) throw invalidResponse(status, `Unexpected ${what} response`);
    return body;
  }

  function asJob(status: number, body: unknown): CheckJob {
    const obj = asObject(status, body, 'check job');
    if (typeof obj.job_id !== 'string' || typeof obj.status !== 'string') {
      throw invalidResponse(status, 'Unexpected check job response');
    }
    if (!Array.isArray(obj.warnings)) obj.warnings = [];
    return obj as unknown as CheckJob;
  }

  const client: PrimersClient = {
    apiBase,

    async design(req: DesignRequest, o?: RequestOptions): Promise<DesignResponse> {
      const { status, body } = await call<unknown>('POST', '/primers/design', req, timeouts.design, o?.signal);
      const obj = asObject(status, body, 'design');
      if (!isObject(obj.template)) throw invalidResponse(status, 'Unexpected design response');
      if (!Array.isArray(obj.pairs)) obj.pairs = [];
      if (!Array.isArray(obj.warnings)) obj.warnings = [];
      return obj as unknown as DesignResponse;
    },

    async submitCheck(req: CheckRequest, o?: RequestOptions) {
      const { status, body } = await call<unknown>('POST', '/primers/check', req, timeouts.other, o?.signal);
      const job = asJob(status, body);
      return Object.assign(job, { created: status === 202 });
    },

    async getCheck(jobId: string, o?: RequestOptions): Promise<CheckJob> {
      const { status, body } = await call<unknown>('GET', `/primers/check/${encodeURIComponent(jobId)}`, undefined, timeouts.other, o?.signal);
      return asJob(status, body);
    },

    pollCheck(jobId: string, o?: PollOptions): Promise<CheckJob> {
      return pollCheckJob(client, jobId, o);
    },

    async runCheck(req: CheckRequest, o?: Omit<PollOptions, 'resubmit' | 'initialJob'>): Promise<CheckJob> {
      let job: CheckJob = await client.submitCheck(req, { signal: o?.signal });
      if (isTerminalJob(job)) {
        // An identical job already finished: the POST answer has no results, so read the job once.
        job = await client.getCheck(job.job_id, { signal: o?.signal });
      }
      o?.onUpdate?.(job);
      if (isTerminalJob(job)) return job;
      return pollCheckJob(client, job.job_id, { ...o, resubmit: req, initialJob: job });
    },

    listGenomes(systemName: string, o?: RequestOptions): Promise<GenomesResponse> {
      let shared = genomesCache.get(systemName);
      if (!shared) {
        shared = call<unknown>('GET', `/primers/genomes?system_name=${encodeURIComponent(systemName)}`, undefined, timeouts.other).then(({ status, body }) => {
          const obj = asObject(status, body, 'genomes');
          if (!Array.isArray(obj.genomes)) throw invalidResponse(status, 'Unexpected genomes response');
          return obj as unknown as GenomesResponse;
        });
        genomesCache.set(systemName, shared);
        const entry = shared;
        entry.catch(() => {
          if (genomesCache.get(systemName) === entry) genomesCache.delete(systemName);
        });
      }
      return withCallerSignal(shared, o?.signal);
    },

    async getGene(geneId: string, o?: RequestOptions): Promise<GrameneGene | null> {
      const { body } = await call<unknown>('GET', `/genes?idList=${encodeURIComponent(geneId)}`, undefined, timeouts.other, o?.signal);
      if (!Array.isArray(body) || body.length === 0) return null;
      const doc = body.find((g) => isObject(g) && g._id === geneId) ?? body[0];
      return isObject(doc) ? (doc as unknown as GrameneGene) : null;
    },
  };

  return client;
}

/** Lets one caller stop waiting on a shared promise without cancelling it for others. */
function withCallerSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(makeAbortError(signal.reason));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(makeAbortError(signal.reason));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}
