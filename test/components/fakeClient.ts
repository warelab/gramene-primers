/**
 * A scriptable PrimersClient for component tests. Every call is recorded with
 * its AbortSignal; pending calls reject with an AbortError when aborted.
 */
import { PrimersApiError, type PrimersApiErrorInit } from '../../src/errors';
import type {
  CheckJob,
  CheckRequest,
  DesignRequest,
  DesignResponse,
  GenomesResponse,
  GrameneGene,
  PollOptions,
  PrimersClient,
  RequestOptions,
} from '../../src/types';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

export function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export function apiError(init: Partial<PrimersApiErrorInit> & { code: string }): PrimersApiError {
  return new PrimersApiError({ status: 400, message: init.code, ...init });
}

function abortable<T>(signal: AbortSignal | undefined, d: Deferred<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => reject(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    d.promise.then(
      (v) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal?.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

type Responder<Req, Res> = (req: Req, index: number) => Res | Promise<Res> | Error;

export interface Call<Req, Res> {
  req: Req;
  signal?: AbortSignal;
  resolve: (value: Res) => void;
  reject: (reason: unknown) => void;
}

export interface PollCall {
  jobId: string;
  options: PollOptions;
  signal?: AbortSignal;
  /** Delivers an update; `done`/`error` jobs resolve the poll. */
  push: (job: CheckJob) => void;
  fail: (reason: unknown) => void;
}

export class FakePrimersClient implements PrimersClient {
  readonly apiBase = 'http://fake.test/sorghum_v11';
  readonly designCalls: Array<Call<DesignRequest, DesignResponse>> = [];
  readonly submitCalls: Array<Call<CheckRequest, CheckJob & { created: boolean }>> = [];
  readonly getCheckCalls: Array<Call<string, CheckJob>> = [];
  readonly pollCalls: PollCall[] = [];
  readonly genomesCalls: string[] = [];
  readonly geneCalls: string[] = [];

  /** Answers design calls immediately when set; otherwise tests resolve `designCalls[i]`. */
  onDesign?: Responder<DesignRequest, DesignResponse>;
  onSubmit?: Responder<CheckRequest, CheckJob & { created: boolean }>;
  onGetCheck?: Responder<string, CheckJob>;
  genomes: GenomesResponse | Error | null = null;
  gene: GrameneGene | null = null;

  private record<Req, Res>(list: Array<Call<Req, Res>>, req: Req, o: RequestOptions | undefined, responder?: Responder<Req, Res>): Promise<Res> {
    const d = deferred<Res>();
    list.push({ req, signal: o?.signal, resolve: d.resolve, reject: d.reject });
    if (responder) {
      try {
        const r = responder(req, list.length - 1);
        if (r instanceof Error) d.reject(r);
        else Promise.resolve(r).then(d.resolve, d.reject);
      } catch (e) {
        d.reject(e);
      }
    }
    return abortable(o?.signal, d);
  }

  design(req: DesignRequest, o?: RequestOptions): Promise<DesignResponse> {
    return this.record(this.designCalls, req, o, this.onDesign);
  }

  submitCheck(req: CheckRequest, o?: RequestOptions): Promise<CheckJob & { created: boolean }> {
    return this.record(this.submitCalls, req, o, this.onSubmit);
  }

  getCheck(jobId: string, o?: RequestOptions): Promise<CheckJob> {
    return this.record(this.getCheckCalls, jobId, o, this.onGetCheck);
  }

  pollCheck(jobId: string, options: PollOptions = {}): Promise<CheckJob> {
    return new Promise<CheckJob>((resolve, reject) => {
      const signal = options.signal;
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => reject(abortError());
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pollCalls.push({
        jobId,
        options,
        signal,
        push: (job) => {
          if (signal?.aborted) return;
          options.onUpdate?.(job);
          if (job.status === 'done' || job.status === 'error') {
            signal?.removeEventListener('abort', onAbort);
            resolve(job);
          }
        },
        fail: (reason) => {
          signal?.removeEventListener('abort', onAbort);
          reject(reason);
        },
      });
    });
  }

  runCheck(): Promise<CheckJob> {
    return Promise.reject(new Error('runCheck is not used by the components'));
  }

  listGenomes(systemName: string, o?: RequestOptions): Promise<GenomesResponse> {
    this.genomesCalls.push(systemName);
    if (o?.signal?.aborted) return Promise.reject(abortError());
    if (this.genomes instanceof Error) return Promise.reject(this.genomes);
    if (!this.genomes) return new Promise<GenomesResponse>(() => {});
    return Promise.resolve(this.genomes);
  }

  getGene(geneId: string, o?: RequestOptions): Promise<GrameneGene | null> {
    this.geneCalls.push(geneId);
    if (o?.signal?.aborted) return Promise.reject(abortError());
    return Promise.resolve(this.gene && this.gene._id === geneId ? this.gene : null);
  }
}
