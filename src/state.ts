import { CHECK_DEFAULTS, defaultPresetFor } from './presets';
import { regionFromGene } from './request';
import type {
  CheckName,
  CheckParams,
  DesignMode,
  DesignParams,
  GrameneGene,
  Interval,
  PresetName,
  PrimerDesignerState,
  RegionSpec,
  ResultsTab,
  Strand,
  SubmittedPair,
} from './types';
import { DESIGN_LIMITS, DESIGN_PARAM_LIMITS, NUMERIC_DESIGN_PARAM_KEYS } from './validate';

export const ALL_MODES: readonly DesignMode[] = Object.freeze(['gene', 'transcript', 'region', 'sequence']);
const RESULTS_TABS: readonly ResultsTab[] = ['pairs', 'specificity', 'transcriptome', 'pangenome'];
const JOB_ID = /^[0-9a-f]{32}$/;
const SYSTEM_NAME = /^[a-z0-9_]+$/;

export interface DesignerContext {
  gene?: GrameneGene | null;
  geneId?: string | null;
  systemName?: string | null;
  region?: RegionSpec | null;
  sequence?: string | null;
  modes?: ReadonlyArray<DesignMode> | null;
  defaultMode?: DesignMode | null;
  defaultParams?: Partial<DesignParams> | null;
  /** Default true; false drops `sequence` from emitted/normalized state. */
  persistSequence?: boolean;
}

/**
 * Modes offered by the host that have the inputs they need: gene/transcript
 * need a gene, region needs a genome (`systemName` or the gene's), sequence is
 * always possible.
 */
export function availableModes(ctx: DesignerContext = {}): DesignMode[] {
  const offered = (ctx.modes && ctx.modes.length ? ctx.modes : ALL_MODES).filter((m) => ALL_MODES.includes(m));
  const hasGene = !!(ctx.gene?._id || ctx.geneId);
  const hasGenome = !!(ctx.systemName || ctx.gene?.system_name);
  const out = offered.filter((m) => {
    if (m === 'gene' || m === 'transcript') return hasGene;
    if (m === 'region') return hasGenome;
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
    preset: defaultPresetFor(mode),
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
  const mode = typeof raw.mode === 'string' && modes.includes(raw.mode as DesignMode) ? (raw.mode as DesignMode) : base.mode;
  const s: PrimerDesignerState = { ...base, mode, preset: defaultPresetFor(mode) };

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
