import { useCallback, useMemo, useRef, useState } from 'react';
import { normalizeDesignerState, toPersistedState, type DesignerContext } from '../../state';
import type { PrimerDesignerState } from '../../types';
import { designerReducer, type DesignerAction } from '../reducer';
import { useIsoLayoutEffect } from './useIsoLayoutEffect';

export interface DesignerStateOptions {
  /** Controlled when defined (spec §C.4). */
  stateProp: PrimerDesignerState | undefined;
  onStateChange?: (s: PrimerDesignerState) => void;
  persistSequence: boolean;
  ctx: DesignerContext;
  identity: string;
}

/**
 * Controlled/uncontrolled designer state. Every change emits a JSON-safe copy
 * (without `sequence` when `persistSequence` is false; the sequence is then
 * kept locally so typing survives a controlled round trip). Several dispatches
 * before the host re-renders chain on the pending state.
 */
export function useDesignerState(opts: DesignerStateOptions) {
  const { stateProp, persistSequence, ctx, identity } = opts;
  const controlled = stateProp !== undefined;
  const internalCtx: DesignerContext = { ...ctx, persistSequence: true };
  const ctxRef = useRef(internalCtx);
  ctxRef.current = internalCtx;

  const [inner, setInner] = useState<PrimerDesignerState>(() => normalizeDesignerState(stateProp ?? null, internalCtx));
  const [localSequence, setLocalSequence] = useState<string | undefined>(undefined);

  const modesKey = (ctx.modes ?? []).join(',');
  const normalizedProp = useMemo(
    () => (stateProp !== undefined ? normalizeDesignerState(stateProp, ctxRef.current) : null),
    // ctx is summarized by identity + modes + defaultMode
    [stateProp, identity, modesKey, ctx.defaultMode],
  );

  const state = useMemo<PrimerDesignerState>(() => {
    if (!normalizedProp) return inner;
    if (!persistSequence && localSequence !== undefined && normalizedProp.sequence !== localSequence) {
      return { ...normalizedProp, sequence: localSequence };
    }
    return normalizedProp;
  }, [normalizedProp, inner, persistSequence, localSequence]);

  const stateRef = useRef(state);
  const pendingRef = useRef<PrimerDesignerState | null>(null);
  const onChangeRef = useRef(opts.onStateChange);
  const persistRef = useRef(persistSequence);
  useIsoLayoutEffect(() => {
    stateRef.current = state;
    pendingRef.current = null;
    onChangeRef.current = opts.onStateChange;
    persistRef.current = persistSequence;
  });

  const emit = useCallback((next: PrimerDesignerState) => {
    onChangeRef.current?.(toPersistedState(next, { persistSequence: persistRef.current }));
  }, []);

  const dispatch = useCallback(
    (action: DesignerAction) => {
      const base = pendingRef.current ?? stateRef.current;
      const next = designerReducer(base, action);
      if (next === base) return;
      pendingRef.current = next;
      setInner(next);
      if (!persistRef.current) setLocalSequence(next.sequence);
      emit(next);
    },
    [emit],
  );

  /** Replace the whole state (identity reset); `notify` emits it to the host. */
  const replace = useCallback(
    (next: PrimerDesignerState, notify: boolean) => {
      pendingRef.current = next;
      setInner(next);
      setLocalSequence(next.sequence);
      if (notify) emit(next);
    },
    [emit],
  );

  /** The newest state, including dispatches not yet rendered. */
  const getState = useCallback(() => pendingRef.current ?? stateRef.current, []);

  return { state, dispatch, replace, getState, controlled };
}
