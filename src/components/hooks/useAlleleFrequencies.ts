import { useEffect, useMemo, useRef, useState } from 'react';
import { isAbortError } from '../../errors';
import type { AlleleFrequencies, PopulationFrequency } from '../../types';

export interface AlleleFrequencyState {
  /** Rows by variant id. An id present with an empty array has no frequency reported. */
  byId: ReadonlyMap<string, ReadonlyArray<PopulationFrequency>>;
  loading: boolean;
  /** Every id asked for has an answer. */
  done: boolean;
  /** More variants were listed than `maxAnnotated`; the rest carry no figure. */
  capped: boolean;
  /** The host supplied no frequency source. */
  unsupported: boolean;
  error: unknown;
}

/** Ids per request. Measured: 20 take about 1–2 s, 200 about 8–11 s. */
export const FREQUENCY_BATCH = 200;
/** Requests in flight at once. */
export const FREQUENCY_CONCURRENCY = 2;
/**
 * Variants annotated at most. A listing can run to thousands, and filling every
 * row would mean minutes of requests and megabytes of traffic for a table
 * nobody reads to the end.
 */
export const MAX_ANNOTATED = 600;

export interface AlleleFrequencyOptions {
  batchSize?: number;
  maxAnnotated?: number;
  debounceMs?: number;
}

/**
 * Allele frequencies for the listed variants, filled in batch by batch.
 *
 * Answers are kept by variant id for as long as the picker is mounted, because
 * a frequency belongs to the variant and not to the window it was listed in:
 * narrowing a filter, sorting, or panning back to a window already seen costs
 * nothing. An id that came back with nothing is remembered too, or it would be
 * asked for again on every render.
 */
export function useAlleleFrequencies(
  fetchFrequencies: AlleleFrequencies | undefined,
  systemName: string,
  ids: ReadonlyArray<string>,
  options: AlleleFrequencyOptions = {},
): AlleleFrequencyState {
  const batchSize = options.batchSize ?? FREQUENCY_BATCH;
  const maxAnnotated = options.maxAnnotated ?? MAX_ANNOTATED;
  const debounceMs = options.debounceMs ?? 250;

  const held = useRef(new Map<string, PopulationFrequency[]>());
  const [filled, setFilled] = useState(0);
  const [status, setStatus] = useState<{ loading: boolean; done: boolean; error: unknown }>({
    loading: false,
    done: false,
    error: null,
  });

  const capped = ids.length > maxAnnotated;
  // Stands in for the id list, whose identity changes on every render.
  const key = JSON.stringify({ systemName, ids: ids.slice(0, maxAnnotated) });

  useEffect(() => {
    if (!fetchFrequencies || !systemName) {
      setStatus({ loading: false, done: false, error: null });
      return;
    }
    const { ids: asked } = JSON.parse(key) as { ids: string[] };
    const missing = asked.filter((id) => !held.current.has(id));
    if (!missing.length) {
      setStatus({ loading: false, done: true, error: null });
      return;
    }
    const ctrl = new AbortController();
    setStatus({ loading: true, done: false, error: null });
    const timer = setTimeout(() => {
      const chunks: string[][] = [];
      for (let i = 0; i < missing.length; i += batchSize) chunks.push(missing.slice(i, i + batchSize));
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < chunks.length && !ctrl.signal.aborted) {
          const chunk = chunks[next++] as string[];
          const answer = await fetchFrequencies({ system_name: systemName, ids: chunk }, { signal: ctrl.signal });
          if (ctrl.signal.aborted) return;
          // An id missing from the answer has no frequency reported; remember
          // that, or it is asked for again for as long as the window is open.
          for (const id of chunk) held.current.set(id, answer?.[id] ?? []);
          setFilled((n) => n + 1);
        }
      };
      const pool = Array.from({ length: Math.min(FREQUENCY_CONCURRENCY, chunks.length) }, worker);
      Promise.all(pool).then(
        () => {
          if (!ctrl.signal.aborted) setStatus({ loading: false, done: true, error: null });
        },
        (error: unknown) => {
          // A missing frequency is a missing column, never a failed design.
          if (!ctrl.signal.aborted && !isAbortError(error)) setStatus({ loading: false, done: false, error });
        },
      );
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [fetchFrequencies, systemName, key, batchSize, debounceMs]);

  const byId = useMemo(() => {
    const out = new Map<string, ReadonlyArray<PopulationFrequency>>();
    for (const id of (JSON.parse(key) as { ids: string[] }).ids) {
      const rows = held.current.get(id);
      if (rows) out.set(id, rows);
    }
    return out;
    // `filled` counts batches landing; `key` is the ids asked for.
  }, [key, filled]);

  return { byId, ...status, capped, unsupported: !fetchFrequencies };
}
