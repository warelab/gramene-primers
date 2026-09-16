import { estimateCheckCpu } from './cost';
import { designModeOf } from './modes';
import { CHECK_DEFAULTS, changedGenotypingAssay, changedGenotypingParams, defaultPresetFor, effectiveDesignParams, PRESETS } from './presets';
import type {
  CheckGenotypingSet,
  CheckName,
  CheckPairInput,
  CheckParams,
  CheckRequest,
  DesignMode,
  DesignParams,
  DesignRequest,
  GenomeEntry,
  GenomesResponse,
  GenotypingDesignRequest,
  GenotypingSet,
  GenotypingVariantInput,
  GrameneGene,
  Interval,
  PrimerDesignerState,
  PrimerPair,
  RegionSpec,
  Strand,
  VariantEntry,
} from './types';
import { DESIGN_PARAM_LIMITS, NUMERIC_DESIGN_PARAM_KEYS } from './validate';

/** Check submission limits (spec §A.2.3, §A.6, plan overrides). */
export const CHECK_LIMITS = Object.freeze({
  maxPairs: 10,
  maxUniquePrimers: 20,
  maxGenomes: 150,
  minPrimerLength: 15,
  maxPrimerLength: 36,
  primerPattern: /^[ACGTacgt]{15,36}$/,
  pairIdPattern: /^[A-Za-z0-9_.:-]+$/,
  pairIdMaxLength: 64,
  defaultMaxProductSize: CHECK_DEFAULTS.max_product_size,
  /** Products longer than this cannot be checked (server 400 `PRODUCT_TOO_LONG_TO_CHECK`). */
  maxProductSize: 10_000,
  /** Automatic raise: `ceil(raiseFactor × largest expected size)`. */
  raiseFactor: 1.2,
  maxJobCpuS: 6000,
});

export type CheckRequestErrorCode =
  | 'NO_SYSTEM_NAME'
  | 'GENE_ID_REQUIRED'
  | 'NO_PAIRS'
  | 'TOO_MANY_PAIRS'
  | 'TOO_MANY_PRIMERS'
  | 'PRIMER_NOT_CHECKABLE'
  | 'PRODUCT_TOO_LONG_TO_CHECK'
  | 'TOO_MANY_GENOMES'
  /** A saved genome selection none of whose genomes can be searched in this mode. */
  | 'NO_GENOMES'
  /** Genotyping: more than `GENOTYPING_CHECK_LIMITS.maxSets` sets selected. */
  | 'TOO_MANY_SETS'
  /** The mirrored cost estimate is above the server's job limit. */
  | 'OVER_CPU_LIMIT';

export class CheckRequestError extends Error {
  readonly code: CheckRequestErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: CheckRequestErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'CheckRequestError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Design
// ---------------------------------------------------------------------------

export interface DesignContext {
  gene?: GrameneGene | null;
  geneId?: string | null;
  systemName?: string | null;
  region?: RegionSpec | null;
  sequence?: string | null;
  /** Adds `template_only: true` (Preview template). */
  templateOnly?: boolean;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameValue(v, b[i]));
  }
  return a === b;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Params that differ from the server's default preset for `mode`.
 * `preset` is the preset the user picked (defaults to the mode's preset);
 * `overrides` are the user's edits on top of it. Unknown keys and
 * non-numeric values are dropped.
 */
export function changedDesignParams(mode: DesignMode, preset?: keyof typeof PRESETS | null, overrides?: Partial<DesignParams> | null): Partial<DesignParams> {
  const serverDefault = PRESETS[defaultPresetFor(mode)].params as Record<string, unknown>;
  const effective = effectiveDesignParams(preset ?? defaultPresetFor(mode), overrides) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of NUMERIC_DESIGN_PARAM_KEYS) {
    const v = effective[key];
    if (v === undefined || v === null) continue;
    if (!isFiniteNumber(v)) continue;
    if (DESIGN_PARAM_LIMITS[key].integer && !Number.isInteger(v)) continue;
    if (!sameValue(v, serverDefault[key])) out[key] = v;
  }
  const ranges = effective.product_size_ranges;
  if (Array.isArray(ranges) && ranges.length > 0 && ranges.every((r) => Array.isArray(r) && r.length === 2 && r.every((x) => Number.isInteger(x)))) {
    if (!sameValue(ranges, serverDefault.product_size_ranges)) {
      out.product_size_ranges = ranges.map((r) => [r[0], r[1]]);
    }
  }
  return out as Partial<DesignParams>;
}

function cleanInterval(iv: Interval | null | undefined): Interval | undefined {
  if (!Array.isArray(iv) || iv.length !== 2) return undefined;
  const [s, l] = iv;
  if (!Number.isInteger(s) || !Number.isInteger(l)) return undefined;
  return [s, l];
}

/** Region prefilled from a gene's location (spec §C.3). */
export function regionFromGene(gene: GrameneGene | null | undefined): { region: string; start: number; end: number; strand: Strand } | null {
  const loc = gene?.location;
  if (!loc || typeof loc.region !== 'string') return null;
  return { region: loc.region, start: loc.start, end: loc.end, strand: loc.strand === -1 ? -1 : 1 };
}

/** Builds a `POST /primers/design` body from designer state; only mode-relevant fields and changed params are sent. */
export function buildDesignRequest(state: PrimerDesignerState, ctx: DesignContext = {}): DesignRequest {
  // Genotyping designs go through `buildGenotypingRequest`; this builder only
  // ever sends a mode `POST /primers/design` accepts.
  const mode: DesignMode = designModeOf(state.mode);
  const req: DesignRequest = { mode };
  const geneId = ctx.gene?._id ?? ctx.geneId ?? undefined;

  switch (mode) {
    case 'gene': {
      if (geneId) req.gene_id = geneId;
      if (ctx.gene?.system_name) req.system_name = ctx.gene.system_name;
      if (state.transcriptId) req.transcript_id = state.transcriptId;
      if (isFiniteNumber(state.flankUp) && state.flankUp > 0) req.flank_up = Math.round(state.flankUp);
      if (isFiniteNumber(state.flankDown) && state.flankDown > 0) req.flank_down = Math.round(state.flankDown);
      break;
    }
    case 'transcript': {
      if (geneId) req.gene_id = geneId;
      if (state.transcriptId) req.transcript_id = state.transcriptId;
      if (typeof state.junctionSpanning === 'boolean') req.junction_spanning = state.junctionSpanning;
      break;
    }
    case 'region': {
      const systemName = state.systemName ?? ctx.systemName ?? ctx.gene?.system_name ?? undefined;
      if (systemName) req.system_name = systemName;
      const r = state.region ?? (ctx.region ? { ...ctx.region, strand: ctx.region.strand ?? 1 } : null) ?? regionFromGene(ctx.gene);
      if (r) req.region = { region: String(r.region), start: r.start, end: r.end, strand: r.strand === -1 ? -1 : 1 };
      break;
    }
    case 'sequence': {
      const seq = state.sequence ?? ctx.sequence ?? '';
      req.sequence = seq;
      const systemName = state.systemName ?? ctx.systemName ?? undefined;
      if (systemName) req.system_name = systemName;
      break;
    }
  }

  const target = cleanInterval(state.target);
  if (target) req.target = target;
  const included = cleanInterval(state.included);
  if (included) req.included = included;
  const excluded = (state.excluded ?? []).map(cleanInterval).filter((x): x is Interval => !!x);
  if (excluded.length) req.excluded = excluded;

  if (state.avoidRepeats) {
    req.avoid_repeats = true;
    if (state.repeatMaskMode) req.repeat_mask_mode = state.repeatMaskMode;
  }
  if (ctx.templateOnly) req.template_only = true;

  const params = changedDesignParams(mode, state.preset, state.params);
  if (Object.keys(params).length) req.params = params;
  return req;
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

export function isCheckablePrimer(seq: string | null | undefined): boolean {
  return typeof seq === 'string' && CHECK_LIMITS.primerPattern.test(seq);
}

export type PairCheckability =
  | { ok: true }
  | { ok: false; reason: 'PRIMER_NOT_CHECKABLE' | 'PRODUCT_TOO_LONG_TO_CHECK'; message: string };

/** Both primers `^[ACGTacgt]{15,36}$` and product ≤ 10,000 bp. */
export function pairCheckability(pair: Pick<PrimerPair, 'left' | 'right' | 'product_size'>): PairCheckability {
  if (!isCheckablePrimer(pair.left?.seq) || !isCheckablePrimer(pair.right?.seq)) {
    return { ok: false, reason: 'PRIMER_NOT_CHECKABLE', message: 'Primers must be 15–36 nt of A/C/G/T to be checked' };
  }
  if (isFiniteNumber(pair.product_size) && pair.product_size > CHECK_LIMITS.maxProductSize) {
    return { ok: false, reason: 'PRODUCT_TOO_LONG_TO_CHECK', message: `Products longer than ${CHECK_LIMITS.maxProductSize} bp cannot be checked` };
  }
  return { ok: true };
}

export function isCheckablePair(pair: Pick<PrimerPair, 'left' | 'right' | 'product_size'>): boolean {
  return pairCheckability(pair).ok;
}

/** Distinct UPPERCASE primer sequences of a set of pairs. */
export function uniquePrimers(pairs: ReadonlyArray<{ left: string | { seq: string }; right: string | { seq: string } }>): string[] {
  const set = new Set<string>();
  for (const p of pairs) {
    set.add((typeof p.left === 'string' ? p.left : p.left.seq).toUpperCase());
    set.add((typeof p.right === 'string' ? p.right : p.right.seq).toUpperCase());
  }
  return [...set];
}

export interface CheckSelectionSummary {
  pairs: number;
  uniquePrimers: number;
  withinLimits: boolean;
}

export function checkSelectionSummary(pairs: ReadonlyArray<Pick<PrimerPair, 'left' | 'right'>>): CheckSelectionSummary {
  const u = uniquePrimers(pairs).length;
  return { pairs: pairs.length, uniquePrimers: u, withinLimits: pairs.length <= CHECK_LIMITS.maxPairs && u <= CHECK_LIMITS.maxUniquePrimers };
}

/** Whether `candidate` can be added to `selected` without exceeding 10 pairs / 20 unique primers. */
export function canAddPairToCheck(selected: ReadonlyArray<Pick<PrimerPair, 'left' | 'right' | 'product_size'>>, candidate: Pick<PrimerPair, 'left' | 'right' | 'product_size'>): boolean {
  if (!isCheckablePair(candidate)) return false;
  return checkSelectionSummary([...selected, candidate]).withinLimits;
}

export function checkPairId(pair: Pick<PrimerPair, 'rank'>): string {
  return `P${pair.rank + 1}`;
}

/** Genomes the server uses when `genomes` is omitted: same species, not the query, with the needed DB. */
export function defaultPangenomeGenomes(genomes: GenomesResponse | ReadonlyArray<GenomeEntry>, mode: DesignMode, systemName?: string): GenomeEntry[] {
  const list = Array.isArray(genomes) ? genomes : (genomes as GenomesResponse).genomes;
  const query = systemName ?? (Array.isArray(genomes) ? undefined : (genomes as GenomesResponse).system_name);
  return list.filter((g) => !g.is_query && g.system_name !== query && (mode === 'transcript' ? g.has_cdna_blastdb : g.has_blastdb));
}

/**
 * Sorted names of the pan-genome genomes a check can search: for catalog entries
 * (`GenomesResponse` or `GenomeEntry[]`) the same set as `defaultPangenomeGenomes`;
 * for a plain name list, that list. Null when no list is given.
 */
export function availableGenomeNames(
  source: ReadonlyArray<string> | GenomesResponse | ReadonlyArray<GenomeEntry> | null | undefined,
  mode: DesignMode,
  systemName?: string | null,
): string[] | null {
  if (!source) return null;
  let names: string[];
  if (Array.isArray(source) && source.every((g) => typeof g === 'string')) {
    names = [...(source as ReadonlyArray<string>)];
  } else {
    const entries = (Array.isArray(source) ? source : (source as GenomesResponse).genomes) as ReadonlyArray<GenomeEntry>;
    const query = systemName ?? (Array.isArray(source) ? undefined : (source as GenomesResponse).system_name);
    names = defaultPangenomeGenomes(entries, mode, query).map((g) => g.system_name);
  }
  return [...new Set(names)].filter((g) => g !== systemName).sort();
}

/**
 * The genome entries behind an `allGenomes` source, or null when the host passed
 * bare names: sizes live only on the entries, and a job cannot be priced without
 * them.
 */
function genomeEntriesOf(
  source: ReadonlyArray<string> | GenomesResponse | ReadonlyArray<GenomeEntry> | null | undefined,
): ReadonlyArray<GenomeEntry> | null {
  if (!source) return null;
  if (Array.isArray(source)) {
    if (source.every((g) => typeof g === 'string')) return null;
    return source as ReadonlyArray<GenomeEntry>;
  }
  return (source as GenomesResponse).genomes ?? null;
}

/** Per-field limits of `PrimerCheckRequest.params` (spec §A.2.3). */
export const CHECK_PARAM_LIMITS: Readonly<Record<Exclude<keyof CheckParams, 'include_unlikely'>, { min: number; max: number }>> = Object.freeze({
  max_product_size: { min: 50, max: 10_000 },
  ignore_mismatches: { min: 3, max: 6 },
  max_amplifying_mismatches: { min: 0, max: 5 },
  min_total_mismatches: { min: 0, max: 6 },
  min_3p_mismatches: { min: 1, max: 5 },
  three_prime_window: { min: 3, max: 10 },
  repeat_site_threshold: { min: 1, max: 100 },
});

/**
 * The per-primer mismatch cap the server applies (check/normalize.js): an explicit
 * `max_amplifying_mismatches`, else the default 3 lowered to `ignore_mismatches − 1`
 * when needed. Null when the given value is not an integer.
 */
export function effectiveMaxAmplifyingMismatches(params: Partial<CheckParams> | null | undefined): number | null {
  const cap = params?.max_amplifying_mismatches;
  if (cap !== undefined && cap !== null) return Number.isInteger(cap) ? cap : null;
  const ignore = params?.ignore_mismatches ?? CHECK_DEFAULTS.ignore_mismatches;
  if (!Number.isInteger(ignore)) return null;
  return Math.min(CHECK_DEFAULTS.max_amplifying_mismatches, ignore - 1);
}

/**
 * Mirrors the swagger schema and the handler's cross-field rule for check params:
 * an explicit `max_amplifying_mismatches` must be below `ignore_mismatches` (400
 * `INVALID_PARAMS`); an omitted one is lowered by the server, so it never conflicts.
 * Returns `{field, code, message}` issues.
 */
export function validateCheckParams(params: Partial<CheckParams> | null | undefined): Array<{ field: string; code: string; message: string }> {
  const issues: Array<{ field: string; code: string; message: string }> = [];
  if (!params) return issues;
  const valid = new Set<string>();
  for (const [key, lim] of Object.entries(CHECK_PARAM_LIMITS)) {
    const v = (params as Record<string, unknown>)[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      issues.push({ field: key, code: 'NOT_AN_INTEGER', message: `${key} must be a whole number` });
    } else if (v < lim.min || v > lim.max) {
      issues.push({ field: key, code: 'OUT_OF_RANGE', message: `${key} must be between ${lim.min} and ${lim.max}` });
    } else {
      valid.add(key);
    }
  }
  const inc = (params as Record<string, unknown>).include_unlikely;
  if (inc !== undefined && inc !== null && typeof inc !== 'boolean') {
    issues.push({ field: 'include_unlikely', code: 'NOT_A_BOOLEAN', message: 'include_unlikely must be true or false' });
  }
  const cap = params.max_amplifying_mismatches;
  const ignoreGiven = params.ignore_mismatches !== undefined && params.ignore_mismatches !== null;
  const ignore = !ignoreGiven ? CHECK_DEFAULTS.ignore_mismatches : valid.has('ignore_mismatches') ? (params.ignore_mismatches as number) : null;
  if (typeof cap === 'number' && valid.has('max_amplifying_mismatches') && ignore !== null && cap >= ignore) {
    issues.push({
      field: 'max_amplifying_mismatches',
      code: 'NOT_BELOW_IGNORE_MISMATCHES',
      message: `max_amplifying_mismatches (${cap}) must be less than ignore_mismatches (${ignore})`,
    });
  }
  return issues;
}

/** Check params that differ from the server defaults (integers only, `include_unlikely` boolean). */
export function changedCheckParams(params?: Partial<CheckParams> | null): Partial<CheckParams> {
  const out: Partial<CheckParams> = {};
  if (!params) return out;
  for (const key of Object.keys(CHECK_DEFAULTS) as Array<keyof CheckParams>) {
    const v = params[key];
    if (v === undefined || v === null) continue;
    if (key === 'include_unlikely') {
      if (typeof v === 'boolean' && v !== CHECK_DEFAULTS.include_unlikely) out.include_unlikely = v;
      continue;
    }
    if (!Number.isInteger(v)) continue;
    if (v !== CHECK_DEFAULTS[key]) (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

export interface MaxProductSizeInfo {
  /** `params.max_product_size` or the default 4000. */
  requested: number;
  /** What the server will use. */
  effective: number;
  /** Server adds warning `MAX_PRODUCT_SIZE_RAISED`. */
  raised: boolean;
  /** Server answers 400 `PRODUCT_TOO_LONG_TO_CHECK`. */
  tooLong: boolean;
  largestExpected: number | null;
}

/**
 * Mirrors the server rule: with `expected` (gene/region modes only),
 * `max_product_size` is raised to `min(10000, max(requested, ceil(1.2 × largest expected)))`;
 * an expected product over 10 kb is rejected.
 */
export function checkMaxProductSize(req: Pick<CheckRequest, 'mode' | 'params' | 'pairs'>): MaxProductSizeInfo {
  const requested = req.params?.max_product_size ?? CHECK_LIMITS.defaultMaxProductSize;
  const mode = req.mode ?? 'region';
  let largest: number | null = null;
  if (mode === 'gene' || mode === 'region') {
    for (const p of req.pairs) {
      if (!p.expected) continue;
      const size = p.expected.end - p.expected.start + 1;
      if (largest === null || size > largest) largest = size;
    }
  }
  if (largest !== null && largest > CHECK_LIMITS.maxProductSize) {
    return { requested, effective: requested, raised: false, tooLong: true, largestExpected: largest };
  }
  const needed = largest === null ? requested : Math.max(requested, Math.ceil(CHECK_LIMITS.raiseFactor * largest));
  const effective = Math.min(CHECK_LIMITS.maxProductSize, needed);
  return { requested, effective, raised: effective > requested, tooLong: false, largestExpected: largest };
}

export interface BuildCheckRequestInput {
  mode: DesignMode;
  /** Reference genome (required; in sequence mode, the genome picked by the user). */
  systemName: string | null | undefined;
  geneId?: string | null;
  transcriptId?: string | null;
  /** The checked pairs, in display order. */
  pairs: ReadonlyArray<PrimerPair>;
  /** Default `['specificity']`; specificity is always included. */
  checks?: ReadonlyArray<CheckName>;
  /** Selected pan-genome genomes (used only with `pangenome`). */
  genomes?: ReadonlyArray<string> | null;
  /**
   * The full default set; when the selection equals it, `genomes` is omitted.
   * A selection is first narrowed to this set, and with catalog entries
   * (`GenomesResponse` / `GenomeEntry[]`) to the genomes searchable in `mode`,
   * so a saved list never names a genome the server would reject.
   */
  allGenomes?: ReadonlyArray<string> | GenomesResponse | ReadonlyArray<GenomeEntry> | null;
  params?: Partial<CheckParams> | null;
}

/**
 * Builds a `POST /primers/check` body (spec §C.3):
 * ids `P{rank+1}`; `expected` only in gene/region modes; changed params only;
 * genomes omitted when all are selected. In sequence mode (no `expected`) the
 * client raises `max_product_size` itself so the designed product is visible.
 * Throws `CheckRequestError` when the selection cannot be checked.
 */
export function buildCheckRequest(input: BuildCheckRequestInput): CheckRequest {
  const { mode } = input;
  const systemName = input.systemName ?? '';
  if (!systemName) throw new CheckRequestError('NO_SYSTEM_NAME', 'Choose a genome to check against');
  if ((mode === 'gene' || mode === 'transcript') && !input.geneId) {
    throw new CheckRequestError('GENE_ID_REQUIRED', `A gene id is required in ${mode} mode`);
  }
  const pairs = input.pairs ?? [];
  if (pairs.length === 0) throw new CheckRequestError('NO_PAIRS', 'Select at least one primer pair');
  if (pairs.length > CHECK_LIMITS.maxPairs) {
    throw new CheckRequestError('TOO_MANY_PAIRS', `At most ${CHECK_LIMITS.maxPairs} pairs can be checked at once`, { pairs: pairs.length });
  }
  for (const p of pairs) {
    const c = pairCheckability(p);
    if (!c.ok) throw new CheckRequestError(c.reason, c.message, { id: checkPairId(p) });
  }
  const unique = uniquePrimers(pairs).length;
  if (unique > CHECK_LIMITS.maxUniquePrimers) {
    throw new CheckRequestError('TOO_MANY_PRIMERS', `At most ${CHECK_LIMITS.maxUniquePrimers} distinct primers can be checked at once`, { unique });
  }

  const req: Omit<CheckRequest, 'pairs'> & { pairs?: CheckPairInput[] } = { system_name: systemName, mode };
  if ((mode === 'gene' || mode === 'transcript') && input.geneId) req.gene_id = input.geneId;
  if (mode === 'transcript' && input.transcriptId) req.transcript_id = input.transcriptId;

  const checks: CheckName[] = ['specificity'];
  if (input.checks?.includes('pangenome')) checks.push('pangenome');
  req.checks = checks;

  if (checks.includes('pangenome') && input.genomes) {
    let selected = [...new Set(input.genomes)].filter((g) => g !== systemName).sort();
    const all = availableGenomeNames(input.allGenomes, mode, systemName);
    if (all !== null) {
      const known = new Set(all);
      const usable = selected.filter((g) => known.has(g));
      if (selected.length > 0 && usable.length === 0) {
        throw new CheckRequestError('NO_GENOMES', 'None of the selected genomes can be searched; select genomes again', { genomes: selected });
      }
      selected = usable;
    }
    const allSelected = all !== null && all.length === selected.length && all.every((g, i) => g === selected[i]);
    if (!allSelected) {
      if (selected.length > CHECK_LIMITS.maxGenomes) {
        throw new CheckRequestError('TOO_MANY_GENOMES', `At most ${CHECK_LIMITS.maxGenomes} genomes`, { genomes: selected.length });
      }
      req.genomes = selected;
    }
  }

  const params = changedCheckParams(input.params);
  if (mode === 'sequence') {
    const largest = Math.max(...pairs.map((p) => (isFiniteNumber(p.product_size) ? p.product_size : 0)));
    const requested = params.max_product_size ?? CHECK_LIMITS.defaultMaxProductSize;
    const needed = Math.min(CHECK_LIMITS.maxProductSize, Math.ceil(CHECK_LIMITS.raiseFactor * largest));
    if (needed > requested) params.max_product_size = needed;
  }
  if (Object.keys(params).length) req.params = params;

  req.pairs = pairs.map((p): CheckPairInput => {
    const out: CheckPairInput = { id: checkPairId(p), left: p.left.seq, right: p.right.seq };
    const g = p.product?.genomic;
    if ((mode === 'gene' || mode === 'region') && g) {
      out.expected = { region: String(g.region), start: g.start, end: g.end };
    }
    return out;
  });

  const built = req as CheckRequest;
  const info = checkMaxProductSize(built);
  if (info.tooLong) {
    throw new CheckRequestError('PRODUCT_TOO_LONG_TO_CHECK', `Products longer than ${CHECK_LIMITS.maxProductSize} bp cannot be checked`, { largest: info.largestExpected });
  }
  return built;
}

// ---------------------------------------------------------------------------
// Genotyping
// ---------------------------------------------------------------------------

/**
 * What `POST /primers/check` accepts for a genotyping job. These are the
 * endpoint's caps; the design's own packing caps (5 sets, 13 distinct primers)
 * only bound the request the server hands back, and never block Submit.
 *
 * `maxUniquePrimers` cannot bind here, and is kept only to mirror the endpoint.
 * The server requires a set's two pairs to share exactly one primer on the same
 * side (`check/genotype.js`, else 400 `GENOTYPING_SET_INVALID` with
 * `reason: "no_shared_common"`), so a set is exactly three distinct primers and
 * N sets give 2N pairs and at most 3N primers: the 5-set ceiling is 10 pairs and
 * 15 primers. Only the set cap and the cost guard can actually block a
 * genotyping check.
 */
export const GENOTYPING_CHECK_LIMITS = Object.freeze({
  maxSets: 5,
  maxPairs: CHECK_LIMITS.maxPairs,
  maxUniquePrimers: CHECK_LIMITS.maxUniquePrimers,
});

export interface GenotypingRequestContext {
  /** The reference genome; the gene's when the host passed a gene. */
  systemName?: string | null;
  /** Returns the template, variant and neighbours without designing. */
  templateOnly?: boolean;
}

/**
 * The `POST /primers/genotyping/design` body for a genotyping state, or null
 * when no variant has been chosen yet. The variant is sent as VCF fields from
 * `variantKey`/`manual` where possible, since ids are for lookup only.
 */
export function buildGenotypingRequest(state: PrimerDesignerState, ctx: GenotypingRequestContext = {}): GenotypingDesignRequest | null {
  const g = state.genotyping;
  const systemName = ctx.systemName ?? state.systemName ?? '';
  if (!g || !systemName) return null;

  let variant: GenotypingVariantInput | null = null;
  if (g.manual && typeof g.manual.region === 'string' && Number.isInteger(g.manual.position)) {
    variant = { region: String(g.manual.region), position: g.manual.position, ref: g.manual.ref, alt: g.manual.alt };
  } else if (g.variantKey) {
    // `region:position:REF:ALT`; the region itself may contain colons, so split from the right.
    const parts = g.variantKey.split(':');
    if (parts.length >= 4) {
      const alt = parts[parts.length - 1] as string;
      const ref = parts[parts.length - 2] as string;
      const position = Number(parts[parts.length - 3]);
      const region = parts.slice(0, parts.length - 3).join(':');
      if (region && Number.isInteger(position)) variant = { region, position, ref, alt };
    }
  }
  if (!variant && g.variantId) {
    variant = g.alt ? { id: g.variantId, alt: g.alt } : { id: g.variantId };
  }
  if (!variant) return null;

  const req: GenotypingDesignRequest = { system_name: systemName, variant };
  const assay = changedGenotypingAssay(g.assay);
  if (Object.keys(assay).length) req.assay = assay;
  const params = changedGenotypingParams(g.params);
  if (Object.keys(params).length) req.params = params;
  if (g.avoidRepeats) {
    req.avoid_repeats = true;
    if (g.repeatMaskMode) req.repeat_mask_mode = g.repeatMaskMode;
  }
  if (g.label) req.label = g.label;
  if (ctx.templateOnly) req.template_only = true;
  return req;
}

export interface BuildGenotypingCheckInput {
  /** The designed sets the user ticked, in display order. */
  sets: ReadonlyArray<GenotypingSet>;
  /** The design's variant (its `vcf` and `region` become the check's `genotyping.variant`). */
  variant: Pick<VariantEntry, 'region' | 'vcf'>;
  systemName: string | null | undefined;
  /** `gene` when a gene is in hand, else `region`; genotyping is rejected in other modes. */
  mode?: Extract<DesignMode, 'gene' | 'region'>;
  geneId?: string | null;
  checks?: ReadonlyArray<CheckName>;
  genomes?: ReadonlyArray<string> | null;
  allGenomes?: ReadonlyArray<string> | GenomesResponse | ReadonlyArray<GenomeEntry> | null;
  params?: Partial<CheckParams> | null;
}

/**
 * Builds a `POST /primers/check` body for genotyping sets. Pairs come from each
 * set's own `check` block, so the check always receives untailed `target_seq`
 * values with their REF-product `expected`; `order_seq` would fail the endpoint's
 * primer pattern. Throws `CheckRequestError` when the selection exceeds a cap.
 */
export function buildGenotypingCheckRequest(input: BuildGenotypingCheckInput): CheckRequest {
  const systemName = input.systemName ?? '';
  if (!systemName) throw new CheckRequestError('NO_SYSTEM_NAME', 'Choose a genome to check against');
  const sets = input.sets ?? [];
  if (!sets.length) throw new CheckRequestError('NO_PAIRS', 'Select at least one set');
  if (sets.length > GENOTYPING_CHECK_LIMITS.maxSets) {
    throw new CheckRequestError('TOO_MANY_SETS', `At most ${GENOTYPING_CHECK_LIMITS.maxSets} sets can be checked at once`, { sets: sets.length });
  }
  const mode = input.mode ?? (input.geneId ? 'gene' : 'region');
  if (mode === 'gene' && !input.geneId) throw new CheckRequestError('GENE_ID_REQUIRED', 'A gene id is required in gene mode');

  const pairs: CheckPairInput[] = [];
  const genotypingSets: CheckGenotypingSet[] = [];
  for (const set of sets) {
    const plan = set.check;
    if (!plan?.set || !Array.isArray(plan.pairs)) continue;
    genotypingSets.push({ id: plan.set.id, ref_pair: plan.set.ref_pair, alt_pair: plan.set.alt_pair });
    for (const p of plan.pairs) pairs.push({ ...p, ...(p.expected ? { expected: { ...p.expected } } : {}) });
  }
  if (!pairs.length) throw new CheckRequestError('NO_PAIRS', 'These sets carry no check pairs');
  if (pairs.length > GENOTYPING_CHECK_LIMITS.maxPairs) {
    throw new CheckRequestError('TOO_MANY_PAIRS', `At most ${GENOTYPING_CHECK_LIMITS.maxPairs} pairs can be checked at once`, { pairs: pairs.length });
  }
  const unique = uniquePrimers(pairs).length;
  if (unique > GENOTYPING_CHECK_LIMITS.maxUniquePrimers) {
    throw new CheckRequestError('TOO_MANY_PRIMERS', `At most ${GENOTYPING_CHECK_LIMITS.maxUniquePrimers} distinct primers can be checked at once`, { unique });
  }

  const req: CheckRequest = { system_name: systemName, mode, pairs };
  if (mode === 'gene' && input.geneId) req.gene_id = input.geneId;

  const checks: CheckName[] = ['specificity'];
  if (input.checks?.includes('pangenome')) checks.push('pangenome');
  req.checks = checks;

  if (checks.includes('pangenome') && input.genomes) {
    let selected = [...new Set(input.genomes)].filter((g) => g !== systemName).sort();
    const all = availableGenomeNames(input.allGenomes, mode, systemName);
    if (all !== null) {
      const known = new Set(all);
      const usable = selected.filter((g) => known.has(g));
      if (selected.length > 0 && usable.length === 0) {
        throw new CheckRequestError('NO_GENOMES', 'None of the selected genomes can be searched; select genomes again', { genomes: selected });
      }
      selected = usable;
    }
    const allSelected = all !== null && all.length === selected.length && all.every((g, i) => g === selected[i]);
    if (!allSelected) {
      if (selected.length > CHECK_LIMITS.maxGenomes) {
        throw new CheckRequestError('TOO_MANY_GENOMES', `At most ${CHECK_LIMITS.maxGenomes} genomes`, { genomes: selected.length });
      }
      req.genomes = selected;
    }
  }

  const params = changedCheckParams(input.params);
  if (Object.keys(params).length) req.params = params;

  req.genotyping = {
    variant: { region: String(input.variant.region), position: input.variant.vcf.position, ref: input.variant.vcf.ref, alt: input.variant.vcf.alt },
    sets: genotypingSets,
  };

  // Cost guard, last because it prices the finished request. Allele calling adds a
  // per-genome term, so on a full pan-genome panel the 6,000 CPU-s budget binds
  // before any count cap does, while on a small subset a count cap binds first —
  // whichever it is, the caller gets that code. Priced only when sizes are known.
  const entries = genomeEntriesOf(input.allGenomes);
  if (entries) {
    const searchable = checks.includes('pangenome') ? defaultPangenomeGenomes(entries, mode, systemName) : [];
    const panEntries = input.genomes ? searchable.filter((g) => input.genomes?.includes(g.system_name)) : searchable;
    const estimate = estimateCheckCpu({
      primers: pairs.map((p) => ({ left: p.left, right: p.right })),
      mode,
      referenceTotalBases: entries.find((g) => g.system_name === systemName)?.total_bases ?? null,
      pangenome: checks.includes('pangenome') ? panEntries : null,
      genotyping: true,
    });
    if (estimate.over_limit) {
      throw new CheckRequestError(
        'OVER_CPU_LIMIT',
        `This check needs about ${estimate.cpu_s.toLocaleString('en-US')} CPU-seconds, over the ${estimate.limit.toLocaleString('en-US')} limit; check fewer sets or fewer genomes`,
        { estimate_cpu_s: estimate.cpu_s, limit: estimate.limit },
      );
    }
  }
  return req;
}
