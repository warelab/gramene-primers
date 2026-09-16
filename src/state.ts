import { ALL_MODES, DESIGN_MODES, designModeOf, isDesignMode } from './modes';
import { CHECK_DEFAULTS, changedGenotypingParams, defaultPresetFor } from './presets';
import { GENOTYPING_CHECK_LIMITS, regionFromGene } from './request';
import type {
  CheckName,
  CheckParams,
  DesignerMode,
  DesignMode,
  DesignParams,
  GenotypingAssay,
  GenotypingParams,
  GenotypingTab,
  GrameneGene,
  Interval,
  PresetName,
  PrimerDesignerState,
  RegionSpec,
  ResultsTab,
  Strand,
  SubmittedPair,
  VariantKind,
} from './types';
import { DESIGN_LIMITS, DESIGN_PARAM_LIMITS, GENOTYPING_LIMITS, NUMERIC_DESIGN_PARAM_KEYS } from './validate';

export { ALL_MODES, DESIGN_MODES, designModeOf, isDesignMode };

const RESULTS_TABS: readonly ResultsTab[] = ['pairs', 'specificity', 'transcriptome', 'pangenome'];
const JOB_ID = /^[0-9a-f]{32}$/;
const SYSTEM_NAME = /^[a-z0-9_]+$/;

export interface DesignerContext {
  gene?: GrameneGene | null;
  geneId?: string | null;
  systemName?: string | null;
  region?: RegionSpec | null;
  sequence?: string | null;
  modes?: ReadonlyArray<DesignerMode> | null;
  defaultMode?: DesignerMode | null;
  defaultParams?: Partial<DesignParams> | null;
  /** Default true; false drops `sequence` from emitted/normalized state. */
  persistSequence?: boolean;
}

/**
 * Modes offered by the host that have the inputs they need: gene/transcript
 * need a gene, region and genotyping need a genome (`systemName` or the gene's),
 * sequence is always possible. Genotyping is opt-in — a host that does not list
 * it keeps the four design modes it had before.
 */
export function availableModes(ctx: DesignerContext = {}): DesignerMode[] {
  const offered = (ctx.modes && ctx.modes.length ? ctx.modes : DESIGN_MODES).filter((m) => ALL_MODES.includes(m));
  const hasGene = !!(ctx.gene?._id || ctx.geneId);
  const hasGenome = !!(ctx.systemName || ctx.gene?.system_name);
  const out = offered.filter((m) => {
    if (m === 'gene' || m === 'transcript') return hasGene;
    if (m === 'region' || m === 'genotyping') return hasGenome;
    return true;
  });
  return out.length ? [...new Set(out)] : ['sequence'];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function cleanParams(raw: unknown): Partial<DesignParams> | undefined {
  if (!isObj(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of NUMERIC_DESIGN_PARAM_KEYS) {
    const v = raw[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const lim = DESIGN_PARAM_LIMITS[key];
    if (lim.integer && !Number.isInteger(v)) continue;
    out[key] = v;
  }
  const ranges = raw.product_size_ranges;
  if (Array.isArray(ranges) && ranges.length >= 1 && ranges.length <= DESIGN_LIMITS.maxProductRanges && ranges.every((r) => Array.isArray(r) && r.length === 2 && isInt(r[0]) && isInt(r[1]))) {
    out.product_size_ranges = ranges.map((r) => [r[0], r[1]]);
  }
  return Object.keys(out).length ? (out as Partial<DesignParams>) : undefined;
}

function cleanCheckParams(raw: unknown): Partial<CheckParams> | undefined {
  if (!isObj(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(CHECK_DEFAULTS) as Array<keyof CheckParams>) {
    const v = raw[key];
    if (key === 'include_unlikely') {
      if (typeof v === 'boolean') out[key] = v;
    } else if (isInt(v)) {
      out[key] = v;
    }
  }
  return Object.keys(out).length ? (out as Partial<CheckParams>) : undefined;
}

function cleanInterval(raw: unknown): Interval | undefined {
  if (!Array.isArray(raw) || raw.length !== 2 || !isInt(raw[0]) || !isInt(raw[1])) return undefined;
  if (raw[0] < 1 || raw[1] < 1) return undefined;
  return [raw[0], raw[1]];
}

function cleanRegion(raw: unknown): PrimerDesignerState['region'] | undefined {
  if (!isObj(raw)) return undefined;
  const region = raw.region;
  if ((typeof region !== 'string' && typeof region !== 'number') || String(region).length === 0 || String(region).length > 255) return undefined;
  if (!isInt(raw.start) || !isInt(raw.end) || raw.start < 1 || raw.end < 1) return undefined;
  const strand: Strand = raw.strand === -1 ? -1 : 1;
  return { region: String(region), start: raw.start, end: raw.end, strand };
}

function clampFlank(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.min(DESIGN_LIMITS.maxFlank, Math.max(0, Math.round(v)));
}

/** A fresh v1 state for the host's props. */
export function initialDesignerState(ctx: DesignerContext = {}): PrimerDesignerState {
  const modes = availableModes(ctx);
  const mode = ctx.defaultMode && modes.includes(ctx.defaultMode) ? ctx.defaultMode : (modes[0] as DesignMode);
  const state: PrimerDesignerState = {
    v: 1,
    mode,
    preset: defaultPresetFor(designModeOf(mode)),
    flankUp: 0,
    flankDown: 0,
    junctionSpanning: true,
    avoidRepeats: false,
    repeatMaskMode: 'n_mask',
    designed: false,
    checkedRanks: [],
    check: { checks: ['specificity'] },
    view: { resultsTab: 'pairs' },
  };
  const systemName = ctx.systemName ?? ctx.gene?.system_name;
  if (systemName) state.systemName = systemName;
  const region = ctx.region ? { region: String(ctx.region.region), start: ctx.region.start, end: ctx.region.end, strand: (ctx.region.strand === -1 ? -1 : 1) as Strand } : regionFromGene(ctx.gene);
  if (region) state.region = region;
  if (ctx.sequence && ctx.persistSequence !== false) state.sequence = ctx.sequence;
  const params = cleanParams(ctx.defaultParams);
  if (params) state.params = params;
  return state;
}

/**
 * Tolerant reader for saved state: anything that is not a v1 object yields
 * `initialDesignerState(ctx)`; invalid fields are dropped or clamped; the mode
 * falls back to an available one. Changing mode away from the saved preset's
 * mode keeps the saved preset (users may pick PCR params in transcript mode).
 */
export function normalizeDesignerState(raw: unknown, ctx: DesignerContext = {}): PrimerDesignerState {
  const base = initialDesignerState(ctx);
  if (!isObj(raw) || raw.v !== 1) return base;
  const modes = availableModes(ctx);
  const mode = typeof raw.mode === 'string' && modes.includes(raw.mode as DesignerMode) ? (raw.mode as DesignerMode) : base.mode;
  const s: PrimerDesignerState = { ...base, mode, preset: defaultPresetFor(designModeOf(mode)) };

  if (raw.preset === 'pcr' || raw.preset === 'qpcr') s.preset = raw.preset as PresetName;
  if (typeof raw.transcriptId === 'string' && raw.transcriptId.length > 0 && raw.transcriptId.length <= 255) s.transcriptId = raw.transcriptId;
  const up = clampFlank(raw.flankUp);
  if (up !== undefined) s.flankUp = up;
  const down = clampFlank(raw.flankDown);
  if (down !== undefined) s.flankDown = down;
  const region = cleanRegion(raw.region);
  if (region) s.region = region;
  if (typeof raw.sequence === 'string' && raw.sequence.length <= DESIGN_LIMITS.maxSequenceInput) s.sequence = raw.sequence;
  if (typeof raw.systemName === 'string' && SYSTEM_NAME.test(raw.systemName) && raw.systemName.length <= 128) s.systemName = raw.systemName;

  const target = cleanInterval(raw.target);
  if (target) s.target = target;
  const included = cleanInterval(raw.included);
  if (included) s.included = included;
  if (Array.isArray(raw.excluded)) {
    const ex = raw.excluded.map(cleanInterval).filter((x): x is Interval => !!x).slice(0, DESIGN_LIMITS.maxExcluded);
    if (ex.length) s.excluded = ex;
  }
  if (typeof raw.junctionSpanning === 'boolean') s.junctionSpanning = raw.junctionSpanning;
  if (typeof raw.avoidRepeats === 'boolean') s.avoidRepeats = raw.avoidRepeats;
  if (raw.repeatMaskMode === 'n_mask' || raw.repeatMaskMode === 'three_prime') s.repeatMaskMode = raw.repeatMaskMode;
  const params = cleanParams(raw.params);
  if (params) s.params = params;
  else delete s.params;
  if (typeof raw.designed === 'boolean') s.designed = raw.designed;
  if (isInt(raw.selectedRank) && raw.selectedRank >= 0) s.selectedRank = raw.selectedRank;
  if (Array.isArray(raw.checkedRanks)) {
    s.checkedRanks = [...new Set(raw.checkedRanks.filter((r): r is number => isInt(r) && r >= 0))].sort((a, b) => a - b);
  }

  if (isObj(raw.check)) {
    const c = raw.check;
    const checks: CheckName[] = ['specificity'];
    if (Array.isArray(c.checks) && c.checks.includes('pangenome')) checks.push('pangenome');
    const check: NonNullable<PrimerDesignerState['check']> = { checks };
    if (Array.isArray(c.genomes)) {
      check.genomes = [...new Set(c.genomes.filter((g): g is string => typeof g === 'string' && SYSTEM_NAME.test(g) && g.length <= 128))].slice(0, 150);
    }
    const cp = cleanCheckParams(c.params);
    if (cp) check.params = cp;
    if (typeof c.jobId === 'string' && JOB_ID.test(c.jobId)) check.jobId = c.jobId;
    if (Array.isArray(c.submitted)) {
      const submitted = c.submitted
        .filter((p): p is SubmittedPair => isObj(p) && typeof p.id === 'string' && typeof p.left === 'string' && typeof p.right === 'string')
        .slice(0, 10)
        .map((p) => ({ id: p.id, left: p.left.toUpperCase(), right: p.right.toUpperCase() }));
      if (submitted.length) check.submitted = submitted;
    }
    s.check = check;
  }

  const genotyping = cleanGenotyping(raw.genotyping);
  if (genotyping) s.genotyping = genotyping;

  if (isObj(raw.view)) {
    const tab = RESULTS_TABS.includes(raw.view.resultsTab as ResultsTab) ? (raw.view.resultsTab as ResultsTab) : 'pairs';
    s.view = { resultsTab: tab };
    if (typeof raw.view.explainOpen === 'boolean') s.view.explainOpen = raw.view.explainOpen;
    if (typeof raw.view.formWidth === 'number' && Number.isFinite(raw.view.formWidth)) s.view.formWidth = clampFormWidth(raw.view.formWidth);
  }

  return ctx.persistSequence === false ? toPersistedState(s, { persistSequence: false }) : s;
}

/** Form-column limits (px) for `view.formWidth`; the results column keeps at least `resultsMin` beside the splitter. */
export const LAYOUT_LIMITS = Object.freeze({ formMin: 300, formDefault: 380, formMax: 2400, splitter: 18, resultsMin: 360 });

/** A form-column width rounded and kept within `LAYOUT_LIMITS`. */
export function clampFormWidth(width: number): number {
  return Math.min(LAYOUT_LIMITS.formMax, Math.max(LAYOUT_LIMITS.formMin, Math.round(width)));
}

const SET_KEY = /^[0-9a-f]{12}$/;
const VARIANT_ALLELE = /^([ACGTacgt]{1,50}|-)$/;
const VARIANT_KINDS: readonly VariantKind[] = ['snv', 'mnv', 'insertion', 'deletion', 'complex'];
const GENOTYPING_TABS: readonly GenotypingTab[] = ['sets', 'alleles', 'specificity', 'pangenome', 'order'];

/**
 * Tolerant reader for the genotyping slice: inputs and selections only, never
 * response data. Unknown or malformed fields are dropped, so an older saved view
 * (or a newer one read by an older build) degrades to "pick a variant again"
 * rather than failing.
 */
function cleanGenotyping(raw: unknown): PrimerDesignerState['genotyping'] {
  if (!isObj(raw)) return undefined;
  const g: NonNullable<PrimerDesignerState['genotyping']> = {};

  if (typeof raw.variantId === 'string' && raw.variantId.length > 0 && raw.variantId.length <= DESIGN_LIMITS.maxIdLength) g.variantId = raw.variantId;
  if (typeof raw.variantKey === 'string' && raw.variantKey.length > 0 && raw.variantKey.length <= 600) g.variantKey = raw.variantKey;
  if (typeof raw.alt === 'string' && VARIANT_ALLELE.test(raw.alt)) g.alt = raw.alt;
  if (typeof raw.label === 'string' && raw.label.length > 0 && raw.label.length <= 128) g.label = raw.label;

  if (isObj(raw.manual)) {
    const m = raw.manual;
    if (typeof m.region === 'string' && m.region.length > 0 && m.region.length <= 255 && isInt(m.position) && m.position >= 1 && typeof m.ref === 'string' && typeof m.alt === 'string' && VARIANT_ALLELE.test(m.ref) && VARIANT_ALLELE.test(m.alt)) {
      g.manual = { region: m.region, position: m.position, ref: m.ref, alt: m.alt };
    }
  }
  if (isObj(raw.window)) {
    const w = raw.window;
    if (typeof w.region === 'string' && w.region.length > 0 && isInt(w.start) && isInt(w.end) && w.start >= 1 && w.end >= w.start && w.end - w.start + 1 <= GENOTYPING_LIMITS.maxWindow) {
      g.window = { region: w.region, start: w.start, end: w.end };
    }
  }
  if (isObj(raw.filters)) {
    const f = raw.filters;
    const filters: NonNullable<typeof g.filters> = {};
    if (Array.isArray(f.types)) {
      const types = [...new Set(f.types.filter((t): t is VariantKind => typeof t === 'string' && VARIANT_KINDS.includes(t as VariantKind)))];
      if (types.length) filters.types = types;
    }
    if (typeof f.includeEms === 'boolean') filters.includeEms = f.includeEms;
    if (typeof f.query === 'string' && f.query.length <= 255) filters.query = f.query;
    if (Object.keys(filters).length) g.filters = filters;
  }

  if (isObj(raw.assay)) {
    const a = raw.assay;
    const assay: Partial<GenotypingAssay> = {};
    if (a.type === 'kasp' || a.type === 'as_pcr') assay.type = a.type;
    if (a.orientation === 'both' || a.orientation === 'forward' || a.orientation === 'reverse') assay.orientation = a.orientation;
    if (a.tails === 'none' || a.tails === 'ref_fam_alt_hex' || a.tails === 'ref_hex_alt_fam') assay.tails = a.tails;
    if (a.deliberate_mismatch === 'none' || a.deliberate_mismatch === 'auto') assay.deliberate_mismatch = a.deliberate_mismatch;
    if (a.mismatch_position === 2 || a.mismatch_position === 3) assay.mismatch_position = a.mismatch_position;
    if (isInt(a.num_sets) && a.num_sets >= GENOTYPING_LIMITS.minSets && a.num_sets <= GENOTYPING_LIMITS.maxSets) assay.num_sets = a.num_sets;
    if (isInt(a.max_relaxation) && a.max_relaxation >= 0 && a.max_relaxation <= GENOTYPING_LIMITS.maxRelaxation) assay.max_relaxation = a.max_relaxation;
    if (a.neighbour_policy === 'avoid_3p' || a.neighbour_policy === 'ignore') assay.neighbour_policy = a.neighbour_policy;
    if (Object.keys(assay).length) g.assay = assay;
  }
  const params = changedGenotypingParams(isObj(raw.params) ? (raw.params as Partial<GenotypingParams>) : undefined);
  if (Object.keys(params).length) g.params = params;

  if (typeof raw.avoidRepeats === 'boolean') g.avoidRepeats = raw.avoidRepeats;
  if (raw.repeatMaskMode === 'n_mask' || raw.repeatMaskMode === 'three_prime') g.repeatMaskMode = raw.repeatMaskMode;
  if (typeof raw.designed === 'boolean') g.designed = raw.designed;
  if (typeof raw.selectedSetKey === 'string' && SET_KEY.test(raw.selectedSetKey)) g.selectedSetKey = raw.selectedSetKey;
  if (Array.isArray(raw.checkedSetKeys)) {
    const keys = [...new Set(raw.checkedSetKeys.filter((k): k is string => typeof k === 'string' && SET_KEY.test(k)))].slice(0, GENOTYPING_CHECK_LIMITS.maxSets);
    if (keys.length) g.checkedSetKeys = keys;
  }

  if (isObj(raw.check)) {
    const c = raw.check;
    const checks: CheckName[] = ['specificity'];
    if (Array.isArray(c.checks) && c.checks.includes('pangenome')) checks.push('pangenome');
    const check: NonNullable<typeof g.check> = { checks };
    if (Array.isArray(c.genomes)) {
      check.genomes = [...new Set(c.genomes.filter((x): x is string => typeof x === 'string' && SYSTEM_NAME.test(x) && x.length <= 128))].slice(0, 150);
    }
    const cp = cleanCheckParams(c.params);
    if (cp) check.params = cp;
    if (typeof c.jobId === 'string' && JOB_ID.test(c.jobId)) check.jobId = c.jobId;
    if (Array.isArray(c.submitted)) {
      const submitted = c.submitted
        .filter((s): s is Record<string, unknown> => isObj(s) && typeof s.id === 'string' && isObj(s.ref) && isObj(s.alt))
        .slice(0, GENOTYPING_CHECK_LIMITS.maxSets)
        .map((s) => {
          const pair = (p: Record<string, unknown>) => ({
            id: typeof p.id === 'string' ? p.id : '',
            left: typeof p.left === 'string' ? p.left.toUpperCase() : '',
            right: typeof p.right === 'string' ? p.right.toUpperCase() : '',
          });
          return { id: s.id as string, ref: pair(s.ref as Record<string, unknown>), alt: pair(s.alt as Record<string, unknown>) };
        })
        .filter((s) => s.ref.left && s.ref.right && s.alt.left && s.alt.right);
      if (submitted.length) check.submitted = submitted;
    }
    g.check = check;
  }

  if (isObj(raw.view) && typeof raw.view.tab === 'string' && GENOTYPING_TABS.includes(raw.view.tab as GenotypingTab)) {
    g.view = { tab: raw.view.tab as GenotypingTab };
  }
  return Object.keys(g).length ? g : undefined;
}

/** The state to emit to the host (`persistSequence: false` drops `sequence`); always JSON-serializable. */
export function toPersistedState(state: PrimerDesignerState, opts: { persistSequence?: boolean } = {}): PrimerDesignerState {
  const copy = JSON.parse(JSON.stringify(state)) as PrimerDesignerState;
  if (opts.persistSequence === false) delete copy.sequence;
  return copy;
}

/** FNV-1a 32-bit hash as 8 hex chars. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Designer identity (spec §C.4): `gene._id ?? geneId ?? systemName+region ?? hash(sequence)`.
 * A change means: reset state and abort design and polling.
 */
export function designerIdentity(ctx: Pick<DesignerContext, 'gene' | 'geneId' | 'systemName' | 'region' | 'sequence'>): string {
  const geneId = ctx.gene?._id ?? ctx.geneId;
  if (geneId) return `gene:${geneId}`;
  if (ctx.systemName && ctx.region) {
    const r = ctx.region;
    return `region:${ctx.systemName}:${r.region}:${r.start}-${r.end}:${r.strand === -1 ? -1 : 1}`;
  }
  if (ctx.sequence) return `sequence:${hashString(ctx.sequence)}`;
  return ctx.systemName ? `genome:${ctx.systemName}` : 'empty';
}
