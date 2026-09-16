import { designModeOf } from '../modes';
import { defaultPresetFor, effectiveDesignParams } from '../presets';
import type { DesignParams, GrameneGene, PresetName, PrimerDesignerState } from '../types';
import { cleanSequenceInput, DESIGN_LIMITS, validateDesignParams, validateIntervals, type CleanedSequence, type ValidationIssue } from '../validate';
import { isSingleExon } from './inputs/TranscriptInputs';
import { estimateTemplateLength, geneTooLong } from './util';

export interface DesignInputContext {
  /** The gene doc (the `gene` prop or the fetched one). */
  gene: GrameneGene | null;
  geneId: string | null;
  /** The `systemName` prop. */
  systemName?: string | null;
  /** The `sequence` prop. */
  sequence?: string | null;
}

export interface DesignInputAnalysis {
  cleaned: CleanedSequence;
  templateLength: number | null;
  singleExon: boolean;
  junctionSpanning: boolean;
  preset: PresetName;
  effective: Partial<DesignParams>;
  /** `validateDesignParams` on the effective params. */
  paramIssues: ValidationIssue[];
  /** Mode-level problems (no gene, no region, invalid genome name, bad sequence, …). */
  modeIssues: string[];
  /** The gene is longer than the template limit (gene mode is disabled). */
  tooLong: boolean;
}

/** Param issue codes that do not block Preview template: `template_only` skips the product-range-fits-template check. */
export const PREVIEW_IGNORED_PARAM_CODES: ReadonlySet<string> = new Set(['LONGER_THAN_TEMPLATE']);

function validGenomeName(name: string): boolean {
  return DESIGN_LIMITS.systemNamePattern.test(name) && name.length <= 128;
}

/**
 * The checks behind the Design and Preview buttons, as a pure function of the
 * state, so the same rules decide whether a restored `designed: true` state is
 * re-run. Pass `cleaned` when it is already computed (it scans the whole sequence).
 */
export function analyzeDesignInputs(state: PrimerDesignerState, ctx: DesignInputContext, cleaned?: CleanedSequence): DesignInputAnalysis {
  const seq = cleaned ?? cleanSequenceInput(state.sequence ?? ctx.sequence ?? '');
  const gene = ctx.gene;
  const templateLength = estimateTemplateLength(state, gene, state.mode === 'sequence' ? seq.length : null);
  const singleExon = isSingleExon(gene, state.transcriptId);
  const junctionSpanning = state.mode === 'transcript' && !singleExon && state.junctionSpanning !== false;
  const designMode = designModeOf(state.mode);
  const preset = state.preset ?? defaultPresetFor(designMode);
  const effective = effectiveDesignParams(preset, state.params);
  const paramIssues = validateDesignParams(effective, { mode: designMode, junctionSpanning, templateLength });
  const tooLong = geneTooLong(gene);
  const modeIssues: string[] = [];
  switch (state.mode) {
    case 'gene':
      if (!ctx.geneId) modeIssues.push('No gene is selected.');
      else if (tooLong) modeIssues.push('The gene is longer than 50,000 bp; use Transcript or Region mode.');
      else if (templateLength !== null && templateLength > DESIGN_LIMITS.maxTemplateLength) modeIssues.push('The gene plus flanks is longer than 50,000 bp.');
      break;
    case 'transcript':
      if (!ctx.geneId) modeIssues.push('No gene is selected.');
      break;
    case 'region': {
      if (!state.region) modeIssues.push('Enter a genomic region.');
      const systemName = state.systemName ?? ctx.systemName ?? gene?.system_name ?? null;
      if (!systemName) modeIssues.push('Choose a genome.');
      else if (!validGenomeName(systemName)) modeIssues.push('The genome name is not valid.');
      break;
    }
    case 'sequence':
      if (!seq.ok) modeIssues.push(seq.length ? 'Fix the pasted sequence.' : 'Paste a sequence.');
      if (state.systemName && !validGenomeName(state.systemName)) modeIssues.push('The genome name is not valid.');
      break;
  }
  return { cleaned: seq, templateLength, singleExon, junctionSpanning, preset, effective, paramIssues, modeIssues, tooLong };
}

/**
 * Why a saved state must not be re-designed automatically: the problems that
 * would disable the Design button (mode, params, intervals against the template).
 * Empty when the restored design can run.
 */
export function restoreBlockers(state: PrimerDesignerState, ctx: DesignInputContext): string[] {
  const a = analyzeDesignInputs(state, ctx);
  const intervals = validateIntervals({ target: state.target, included: state.included, excluded: state.excluded }, a.templateLength);
  return [...new Set([...a.modeIssues, ...a.paramIssues.map((i) => i.message), ...intervals.map((i) => i.message)])];
}
