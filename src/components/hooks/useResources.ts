import { useEffect, useState } from 'react';
import { isAbortError } from '../../errors';
import type { GenomesResponse, GrameneGene, PrimersClient } from '../../types';

export interface GenomesState {
  systemName: string | null;
  data: GenomesResponse | null;
  error: unknown;
  loading: boolean;
}

/** `listGenomes(systemName)` (memoized by the client); aborted when the name changes. */
export function useGenomes(client: PrimersClient, systemName: string | null | undefined, enabled = true): GenomesState {
  const name = enabled && systemName ? systemName : null;
  const [state, setState] = useState<GenomesState>({ systemName: null, data: null, error: null, loading: false });
  useEffect(() => {
    if (!name) {
      setState({ systemName: null, data: null, error: null, loading: false });
      return;
    }
    const ctrl = new AbortController();
    setState({ systemName: name, data: null, error: null, loading: true });
    client.listGenomes(name, { signal: ctrl.signal }).then(
      (data) => {
        if (!ctrl.signal.aborted) setState({ systemName: name, data, error: null, loading: false });
      },
      (error) => {
        if (!ctrl.signal.aborted && !isAbortError(error)) setState({ systemName: name, data: null, error, loading: false });
      },
    );
    return () => ctrl.abort();
  }, [client, name]);
  return state.systemName === name ? state : { systemName: name, data: null, error: null, loading: !!name };
}

/** The gene doc: the `gene` prop, or `getGene(geneId)` when only an id was given. */
export function useGeneDoc(client: PrimersClient, gene: GrameneGene | null | undefined, geneId: string | null | undefined): GrameneGene | null {
  const [loaded, setLoaded] = useState<{ id: string; doc: GrameneGene | null } | null>(null);
  const needsFetch = !gene && !!geneId;
  useEffect(() => {
    if (!needsFetch || !geneId) return;
    const ctrl = new AbortController();
    client.getGene(geneId, { signal: ctrl.signal }).then(
      (doc) => {
        if (!ctrl.signal.aborted) setLoaded({ id: geneId, doc });
      },
      () => {
        // Gene and transcript designs still work with gene_id alone.
      },
    );
    return () => ctrl.abort();
  }, [client, geneId, needsFetch]);
  if (gene) return gene;
  return loaded && loaded.id === geneId ? loaded.doc : null;
}
