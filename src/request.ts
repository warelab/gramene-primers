import { CHECK_DEFAULTS, defaultPresetFor, effectiveDesignParams, PRESETS } from './presets';
import type {
  CheckName,
  CheckPairInput,
  CheckParams,
  CheckRequest,
  DesignMode,
  DesignParams,
  DesignRequest,
  GenomeEntry,
  GenomesResponse,
  GrameneGene,
  Interval,
  PrimerDesignerState,
  PrimerPair,
  RegionSpec,
  Strand,
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
  | 'NO_GENOMES';

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
  const mode = state.mode;
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
