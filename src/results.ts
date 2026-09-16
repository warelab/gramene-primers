import { CHECK_DEFAULTS } from './presets';
import type {
  CheckJob,
  CheckParams,
  CheckPrimerInfo,
  CheckRequest,
  CheckResults,
  GenotypeSetResults,
  GenotypingSet,
  PangenomePairResult,
  PrimerPair,
  SpecificityPairResult,
  SubmittedGenotypingSet,
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

// ---------------------------------------------------------------------------
// Genotyping
// ---------------------------------------------------------------------------

/**
 * Identity of a genotyping set for matching: the REF and ALT pairs by UPPERCASE
 * target sequence. `S1`/`S2` are positional and change when a design is re-run,
 * and the tail is never part of a check, so neither id nor `order_seq` can be
 * used here.
 */
export function genotypingSetTriple(ref: { left: string; right: string }, alt: { left: string; right: string }): string {
  return `${pairKey(ref.left, ref.right)}#${pairKey(alt.left, alt.right)}`;
}

/** The triple of a designed set, taken from the check block the design handed back. */
export function designSetTriple(set: Pick<GenotypingSet, 'check'>): string | null {
  const plan = set.check;
  if (!plan?.set || !Array.isArray(plan.pairs)) return null;
  const ref = plan.pairs.find((p) => p.id === plan.set.ref_pair);
  const alt = plan.pairs.find((p) => p.id === plan.set.alt_pair);
  if (!ref || !alt) return null;
  return genotypingSetTriple(ref, alt);
}

export interface GenotypingSetMatch {
  /** The submitted set id (`S1`), which may differ from the current design's. */
  id: string;
  results: GenotypeSetResults | null;
}

export interface MatchedGenotypingResults {
  /** By `sets[].key` of the current design. */
  bySetKey: Map<string, GenotypingSetMatch>;
  /** Designed sets that were not part of this job. */
  notChecked: string[];
  /** Submitted set ids with no set in the current design ("results for primers not in this design"). */
  orphanIds: string[];
}

/**
 * Matches allele-call results to designed sets by their target-sequence triple,
 * so a re-design that renumbers sets still lines up. Submitted sets come from
 * `job.request` (the normalized echo), falling back to the saved state.
 */
export function matchGenotypingResults(
  sets: ReadonlyArray<Pick<GenotypingSet, 'key' | 'check'>>,
  job: Pick<CheckJob, 'request' | 'results'> | null | undefined,
  submitted?: ReadonlyArray<SubmittedGenotypingSet> | null,
): MatchedGenotypingResults {
  const idByTriple = new Map<string, string>();
  const request = job?.request;
  const requestSets = request?.genotyping?.sets ?? [];
  if (requestSets.length && request?.pairs?.length) {
    const byId = new Map(request.pairs.map((p) => [p.id, p]));
    for (const s of requestSets) {
      const ref = byId.get(s.ref_pair);
      const alt = byId.get(s.alt_pair);
      if (ref && alt) idByTriple.set(genotypingSetTriple(ref, alt), s.id);
    }
  }
  for (const s of submitted ?? []) {
    const triple = genotypingSetTriple(s.ref, s.alt);
    if (!idByTriple.has(triple)) idByTriple.set(triple, s.id);
  }

  const resultsById = new Map((job?.results?.genotyping?.sets ?? []).map((s) => [s.id, s]));
  const bySetKey = new Map<string, GenotypingSetMatch>();
  const notChecked: string[] = [];
  const used = new Set<string>();
  for (const set of sets) {
    const triple = designSetTriple(set);
    const id = triple ? idByTriple.get(triple) : undefined;
    if (!id) {
      notChecked.push(set.key);
      continue;
    }
    used.add(id);
    bySetKey.set(set.key, { id, results: resultsById.get(id) ?? null });
  }
  const orphanIds = [...new Set(idByTriple.values())].filter((id) => !used.has(id));
  return { bySetKey, notChecked, orphanIds };
}

/** The `submitted` sets to keep in state, by UPPERCASE target sequence. */
export function submittedGenotypingSets(req: Pick<CheckRequest, 'pairs' | 'genotyping'>): SubmittedGenotypingSet[] {
  const byId = new Map((req.pairs ?? []).map((p) => [p.id, p]));
  const out: SubmittedGenotypingSet[] = [];
  for (const s of req.genotyping?.sets ?? []) {
    const ref = byId.get(s.ref_pair);
    const alt = byId.get(s.alt_pair);
    if (!ref || !alt) continue;
    out.push({
      id: s.id,
      ref: { id: ref.id, left: ref.left.toUpperCase(), right: ref.right.toUpperCase() },
      alt: { id: alt.id, left: alt.left.toUpperCase(), right: alt.right.toUpperCase() },
    });
  }
  return out;
}
