import type { DesignerMode, DesignMode } from './types';

/**
 * Designer modes, kept in their own module because both `state.ts` and
 * `request.ts` need them (importing one from the other would be a cycle).
 */

/** The four modes `POST /primers/design` and `POST /primers/check` accept, in tab order. */
export const DESIGN_MODES: readonly DesignMode[] = Object.freeze(['gene', 'transcript', 'region', 'sequence']);

/** Every mode the designer can show; `genotyping` is offered only when a host asks for it. */
export const ALL_MODES: readonly DesignerMode[] = Object.freeze([...DESIGN_MODES, 'genotyping']);

export function isDesignMode(mode: DesignerMode | null | undefined): mode is DesignMode {
  return !!mode && (DESIGN_MODES as readonly string[]).includes(mode);
}

/**
 * The design mode behind a designer mode. Genotyping designs its own template
 * through `POST /primers/genotyping/design`, but where a plain design mode is
 * required (params, presets, check requests) it behaves like `region`.
 */
export function designModeOf(mode: DesignerMode | null | undefined): DesignMode {
  return isDesignMode(mode) ? mode : 'region';
}
