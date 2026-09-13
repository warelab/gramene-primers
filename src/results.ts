import { CHECK_DEFAULTS } from './presets';
import type {
  CheckJob,
  CheckParams,
  CheckPrimerInfo,
  CheckResults,
  PangenomePairResult,
  PrimerPair,
  SpecificityPairResult,
  SubmittedPair,
  TranscriptomePairResult,
} from './types';

/** Match key for a pair: UPPERCASE `left|right`. */
export function pairKey(left: string, right: string): string {
  return `${left.toUpperCase()}|${right.toUpperCase()}`;
}

export interface PairCheckResult {
  /** The id the pair was submitted under (e.g. `P3`). */
  id: string;
  specificity: SpecificityPairResult | null;
  transcriptome: TranscriptomePairResult | null;
  pangenome: PangenomePairResult | null;
  leftPrimer: CheckPrimerInfo | null;
  rightPrimer: CheckPrimerInfo | null;
}

export interface MatchedCheckResults {
  /** By designed pair rank. */
  byRank: Map<number, PairCheckResult>;
  /** Designed pairs without a result ("not checked"). */
  notChecked: number[];
  /** Submitted ids that no longer match any designed pair. */
  orphanIds: string[];
}

/**
 * Maps check results to designed pairs by primer sequence (UPPERCASE
 * left+right), never by rank, so a re-run design with different ranks still
 * lines up. Submitted pairs come from `job.request.pairs` (normalized echo),
 * falling back to `submitted` from the saved state.
 */
export function matchCheckResults(
  pairs: ReadonlyArray<Pick<PrimerPair, 'rank' | 'left' | 'right'>>,
  job: Pick<CheckJob, 'request' | 'results'> | null | undefined,
  submitted?: ReadonlyArray<SubmittedPair> | null,
): MatchedCheckResults {
  const results: CheckResults | null | undefined = job?.results;
  const sent: ReadonlyArray<SubmittedPair> = job?.request?.pairs?.length ? job.request.pairs : submitted ?? [];
  const idByKey = new Map<string, string>();
  for (const s of sent) {
    if (typeof s.left === 'string' && typeof s.right === 'string') idByKey.set(pairKey(s.left, s.right), s.id);
  }
  const spec = new Map((results?.specificity?.pairs ?? []).map((p) => [p.id, p]));
  const tx = new Map((results?.transcriptome?.pairs ?? []).map((p) => [p.id, p]));
  const pan = new Map((results?.pangenome?.pairs ?? []).map((p) => [p.id, p]));
  const primers = results?.primers ?? {};

  const byRank = new Map<number, PairCheckResult>();
  const notChecked: number[] = [];
  const used = new Set<string>();
  for (const p of pairs) {
    const id = idByKey.get(pairKey(p.left.seq, p.right.seq));
    if (!id) {
      notChecked.push(p.rank);
      continue;
    }
    used.add(id);
    byRank.set(p.rank, {
      id,
      specificity: spec.get(id) ?? null,
      transcriptome: tx.get(id) ?? null,
      pangenome: pan.get(id) ?? null,
      leftPrimer: primers[p.left.seq.toUpperCase()] ?? null,
      rightPrimer: primers[p.right.seq.toUpperCase()] ?? null,
    });
  }
  const orphanIds = sent.map((s) => s.id).filter((id) => !used.has(id));
  return { byRank, notChecked, orphanIds };
}

/** The `submitted` list to keep in state after a check is submitted. */
export function submittedPairs(req: { pairs: ReadonlyArray<{ id: string; left: string; right: string }> }): SubmittedPair[] {
  return req.pairs.map((p) => ({ id: p.id, left: p.left.toUpperCase(), right: p.right.toUpperCase() }));
}

export type UnlikelyReason = 'mismatch_cap' | 'three_prime';

/** `max_amplifying_mismatches`, else the server default 3 lowered to `ignore_mismatches − 1` when needed. */
function amplifyingCap(params: Partial<CheckParams> | null | undefined): number {
  const cap = params?.max_amplifying_mismatches;
  if (typeof cap === 'number' && Number.isFinite(cap)) return cap;
  const ignore = typeof params?.ignore_mismatches === 'number' && Number.isFinite(params.ignore_mismatches) ? params.ignore_mismatches : CHECK_DEFAULTS.ignore_mismatches;
  return Math.min(CHECK_DEFAULTS.max_amplifying_mismatches, ignore - 1);
}

/**
 * Why a product is `unlikely`, from its mismatch counts and the check params
 * (server defaults when absent): `mismatch_cap` when a primer has more than
 * `max_amplifying_mismatches`; `three_prime` when a primer has at least
 * `min_total_mismatches`, of which `min_3p_mismatches` fall in the 3′ window
 * (the Primer-BLAST rule). Null for other likelihoods or unknown counts.
 * Counts marked `approx` (cDNA hits) make the reason approximate too.
 */
export function unlikelyReason(
  a: { likelihood?: string; left_mm?: number | null; right_mm?: number | null; left_3p_mm?: number | null; right_3p_mm?: number | null },
  params?: Partial<CheckParams> | null,
): UnlikelyReason | null {
  if (a.likelihood !== 'unlikely') return null;
  const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const cap = amplifyingCap(params);
  const minTotal = num(params?.min_total_mismatches) ?? CHECK_DEFAULTS.min_total_mismatches;
  const min3p = num(params?.min_3p_mismatches) ?? CHECK_DEFAULTS.min_3p_mismatches;
  const sides = [
    [num(a.left_mm), num(a.left_3p_mm)],
    [num(a.right_mm), num(a.right_3p_mm)],
  ] as const;
  if (sides.some(([mm]) => mm !== null && mm > cap)) return 'mismatch_cap';
  if (sides.some(([mm, mm3]) => mm !== null && mm3 !== null && mm >= minTotal && mm3 >= min3p)) return 'three_prime';
  return null;
}

/** "unlikely: a primer has more than 3 mismatches" and similar, for tables and details. */
export function unlikelyText(reason: UnlikelyReason | null, params?: Partial<CheckParams> | null): string {
  if (reason === 'mismatch_cap') {
    const cap = amplifyingCap(params);
    return `unlikely: a primer has more than ${cap} mismatch${cap === 1 ? '' : 'es'}`;
  }
  if (reason === 'three_prime') return 'unlikely: mismatches near the 3′ end';
  return 'unlikely';
}

/** Whether a primer is flagged repetitive in the results. */
export function isRepetitivePrimer(results: CheckResults | null | undefined, seq: string): boolean {
  return !!results?.primers?.[seq.toUpperCase()]?.repetitive;
}
