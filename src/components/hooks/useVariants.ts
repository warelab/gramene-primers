import { useEffect, useState } from 'react';
import { isAbortError } from '../../errors';
import type { PrimersClient, VariantListQuery, VariantListResponse } from '../../types';

export interface VariantListState {
  data: VariantListResponse | null;
  error: unknown;
  loading: boolean;
  /** The client cannot list variants (an older host, or a test double). */
  unsupported: boolean;
}

const IDLE: VariantListState = { data: null, error: null, loading: false, unsupported: false };

/**
 * `listVariants` for a window, debounced and aborted on change: typing in the
 * window fields would otherwise fire a request per keystroke, and a slow earlier
 * response could land after a newer one.
 */
export function useVariantList(client: PrimersClient, query: VariantListQuery | null, debounceMs = 300): VariantListState {
  const key = query ? JSON.stringify(query) : '';
  const supported = typeof client.listVariants === 'function';
  const [state, setState] = useState<VariantListState>(IDLE);

  useEffect(() => {
    if (!key) {
      setState(IDLE);
      return;
    }
    if (!supported) {
      setState({ ...IDLE, unsupported: true });
      return;
    }
    const q = JSON.parse(key) as VariantListQuery;
    const ctrl = new AbortController();
    setState((s) => ({ data: s.data, error: null, loading: true, unsupported: false }));
    const timer = setTimeout(() => {
      client.listVariants?.(q, { signal: ctrl.signal }).then(
        (data) => {
          if (!ctrl.signal.aborted) setState({ data, error: null, loading: false, unsupported: false });
        },
        (error) => {
          if (!ctrl.signal.aborted && !isAbortError(error)) setState({ data: null, error, loading: false, unsupported: false });
        },
      );
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [client, key, supported, debounceMs]);

  return state;
}
