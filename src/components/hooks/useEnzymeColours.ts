import { useMemo, useRef } from 'react';
import { allocateEnzymeColours } from '../../enzymes';

/**
 * Colours for the selected enzymes, remembered across renders so that each one
 * keeps its colour while it stays selected.
 *
 * Whoever owns the selection should own this too, and hand the map down. Two
 * views allocating separately would agree only if they had seen the same
 * history of ticks — a pair detail opened after the map has not — and the whole
 * point is that a mark and its key entry are the same colour everywhere.
 */
export function useEnzymeColours(selected: ReadonlyArray<string>): ReadonlyMap<string, string> {
  const previous = useRef<ReadonlyMap<string, string>>(new Map());
  // Stands in for `selected`, whose identity changes on every render.
  const key = JSON.stringify(selected);
  return useMemo(() => {
    const next = allocateEnzymeColours(selected, previous.current);
    previous.current = next;
    return next;
  }, [key]);
}
