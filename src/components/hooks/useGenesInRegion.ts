import { useEffect, useState } from 'react';
import { isAbortError } from '../../errors';
import type { GenesInRegion, RegionGene } from '../../types';

export interface GenesInRegionState {
  genes: RegionGene[];
  error: unknown;
  loading: boolean;
  /** The host supplied no gene search, so no gene track is drawn. */
  unsupported: boolean;
}

const IDLE: GenesInRegionState = { genes: [], error: null, loading: false, unsupported: false };

/**
 * Gene models for the browsed region, debounced and aborted on change: panning
 * would otherwise fire a request per frame, and a slow earlier response could
 * land after a newer one.
 */
export function useGenesInRegion(
  fetchGenes: GenesInRegion | undefined,
  query: { system_name: string; region: string; start: number; end: number } | null,
  debounceMs = 250,
): GenesInRegionState {
  const key = query ? JSON.stringify(query) : '';
  const [state, setState] = useState<GenesInRegionState>(IDLE);

  useEffect(() => {
    if (!key) {
      setState(IDLE);
      return;
    }
    if (!fetchGenes) {
      setState({ ...IDLE, unsupported: true });
      return;
    }
    const q = JSON.parse(key) as { system_name: string; region: string; start: number; end: number };
    const ctrl = new AbortController();
    setState((s) => ({ genes: s.genes, error: null, loading: true, unsupported: false }));
    const timer = setTimeout(() => {
      fetchGenes(q, { signal: ctrl.signal }).then(
        (genes) => {
          if (!ctrl.signal.aborted) setState({ genes: genes ?? [], error: null, loading: false, unsupported: false });
        },
        (error) => {
          // A missing gene track is a degraded view, never a failed design.
          if (!ctrl.signal.aborted && !isAbortError(error)) setState({ genes: [], error, loading: false, unsupported: false });
        },
      );
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [fetchGenes, key, debounceMs]);

  return state;
}
