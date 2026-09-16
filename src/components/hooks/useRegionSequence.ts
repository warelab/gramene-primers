import { useEffect, useState } from 'react';
import { isAbortError } from '../../errors';
import type { SequenceForRegion } from '../../types';

export interface RegionSequenceState {
  /** Plus-strand bases for `[start, end]`, or null while absent. */
  seq: string | null;
  /** 1-based genomic coordinate of `seq[0]`. */
  start: number;
  error: unknown;
  loading: boolean;
  /** The host supplied no sequence source, so CAPS cannot be annotated. */
  unsupported: boolean;
}

const IDLE: RegionSequenceState = { seq: null, start: 0, error: null, loading: false, unsupported: false };

/**
 * A window wider than this is not fetched. The listing is already capped well
 * below it; the guard is here so a host callback is never handed a query that
 * would pull down a chromosome.
 */
export const MAX_SEQUENCE_SPAN = 200_000;

/**
 * The longest recognition sequence in play. A site can start this many bases
 * before the window and still overlap a variant inside it, so the fetch is
 * padded rather than truncating the sites at both edges.
 */
export const SEQUENCE_PAD = 20;

/**
 * Reference sequence for the variant listing window, debounced and aborted on
 * change.
 *
 * This is keyed on the *listing* window, not the browsed view: panning the
 * browser changes which variants are drawn but not which ones are annotated, and
 * refetching on every frame of a drag would be pure waste.
 */
export function useRegionSequence(
  fetchSequence: SequenceForRegion | undefined,
  query: { system_name: string; region: string; start: number; end: number } | null,
  debounceMs = 250,
): RegionSequenceState {
  const padded = query
    ? { ...query, start: Math.max(1, query.start - SEQUENCE_PAD), end: query.end + SEQUENCE_PAD }
    : null;
  const tooWide = padded ? padded.end - padded.start + 1 > MAX_SEQUENCE_SPAN : false;
  const key = padded && !tooWide ? JSON.stringify(padded) : '';
  const [state, setState] = useState<RegionSequenceState>(IDLE);

  useEffect(() => {
    if (!key) {
      setState(IDLE);
      return;
    }
    if (!fetchSequence) {
      setState({ ...IDLE, unsupported: true });
      return;
    }
    const q = JSON.parse(key) as { system_name: string; region: string; start: number; end: number };
    const ctrl = new AbortController();
    setState((s) => ({ seq: s.seq, start: s.start, error: null, loading: true, unsupported: false }));
    const timer = setTimeout(() => {
      fetchSequence(q, { signal: ctrl.signal }).then(
        (seq) => {
          if (ctrl.signal.aborted) return;
          // A short read would be indexed into with genomic offsets and give
          // wrong answers quietly, so it is discarded rather than trusted.
          const expected = q.end - q.start + 1;
          const ok = typeof seq === 'string' && seq.length === expected;
          setState({
            seq: ok ? seq.toUpperCase() : null,
            start: ok ? q.start : 0,
            error: null,
            loading: false,
            unsupported: false,
          });
        },
        (error) => {
          // Missing sequence is a missing annotation, never a failed design.
          if (!ctrl.signal.aborted && !isAbortError(error)) {
            setState({ seq: null, start: 0, error, loading: false, unsupported: false });
          }
        },
      );
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [fetchSequence, key, debounceMs]);

  return state;
}
