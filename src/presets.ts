import type { CheckParams, DesignMode, DesignParams, GenotypingAssay, GenotypingAssayType, GenotypingParams, PresetName } from './types';
import { GENOTYPING_NUMERIC_PARAM_KEYS, GENOTYPING_PARAM_LIMITS } from './validate';

export interface PresetDefinition {
  id: PresetName;
  label: string;
  description: string;
  /** Modes for which the server applies this preset by default. */
  modes: DesignMode[];
  junction_spanning: boolean;
  params: Readonly<Partial<DesignParams>>;
}

function freezeDeep<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) freezeDeep(v);
    Object.freeze(obj);
  }
  return obj;
}

/**
 * Server presets (spec §A.5). The server fills these before merging the
 * client's `params`, so a request only needs the values that differ from the
 * mode's default preset.
 */
export const PRESETS: Readonly<Record<PresetName, PresetDefinition>> = freezeDeep({
  pcr: {
    id: 'pcr',
    label: 'PCR',
    description: 'Genomic PCR: 18–25 nt, Tm 57–63 °C, 100–1000 bp products.',
    modes: ['gene', 'region', 'sequence'],
    junction_spanning: false,
    params: {
      opt_size: 20,
      min_size: 18,
      max_size: 25,
      opt_tm: 60,
      min_tm: 57,
      max_tm: 63,
      min_gc: 30,
      max_gc: 70,
      max_tm_diff: 3,
      max_poly_x: 4,
      product_size_ranges: [[100, 1000]],
      num_return: 5,
    },
  },
  qpcr: {
    id: 'qpcr',
    label: 'qPCR',
    description: 'qPCR on cDNA: 18–24 nt, Tm 58–62 °C, 70–150 bp, one primer spanning an exon–exon junction.',
    modes: ['transcript'],
    junction_spanning: true,
    params: {
      opt_size: 20,
      min_size: 18,
      max_size: 24,
      opt_tm: 60,
      min_tm: 58,
      max_tm: 62,
      min_gc: 35,
      max_gc: 65,
      max_tm_diff: 2,
      max_poly_x: 4,
      product_size_ranges: [[70, 150]],
      num_return: 5,
      min_3_prime_overlap_of_junction: 4,
      min_5_prime_overlap_of_junction: 7,
    },
  },
});

/**
 * Primer3 2.6.1 defaults (`pr_set_default_global_args_2`, libprimer3.cc) for
 * parameters the presets leave alone; useful as input placeholders before the
 * first design echoes `settings.params`. `opt_gc` is unset in Primer3 (null).
 */
export const PRIMER3_DEFAULTS: Readonly<{ [K in keyof DesignParams]?: DesignParams[K] | null }> = freezeDeep({
  opt_gc: null,
  gc_clamp: 0,
  max_end_stability: 100,
  max_ns: 0,
  salt_monovalent: 50,
  salt_divalent: 1.5,
  dntp_conc: 0.6,
  dna_conc: 50,
  min_3_prime_overlap_of_junction: 4,
  min_5_prime_overlap_of_junction: 7,
});

/** Defaults the check server fills (spec §A.2.3). */
export const CHECK_DEFAULTS: Readonly<CheckParams> = Object.freeze({
  max_product_size: 4000,
  ignore_mismatches: 6,
  max_amplifying_mismatches: 3,
  min_total_mismatches: 2,
  min_3p_mismatches: 2,
  three_prime_window: 5,
  include_unlikely: false,
  repeat_site_threshold: 5,
});

export function defaultPresetFor(mode: DesignMode): PresetName {
  return mode === 'transcript' ? 'qpcr' : 'pcr';
}

// ---------------------------------------------------------------------------
// Genotyping (KASP / AS-PCR)
// ---------------------------------------------------------------------------

export interface GenotypingPresetDefinition {
  id: GenotypingAssayType;
  label: string;
  description: string;
  /** The assay defaults the server applies for this type. */
  assay: Readonly<Omit<GenotypingAssay, 'type'>>;
}

export const GENOTYPING_PRESETS: Readonly<Record<GenotypingAssayType, GenotypingPresetDefinition>> = freezeDeep({
  kasp: {
    id: 'kasp',
    label: 'KASP',
    description: 'Tailed allele-specific primers read by FAM and HEX, plus one common primer.',
    assay: {
      orientation: 'both',
      tails: 'ref_fam_alt_hex',
      deliberate_mismatch: 'none',
      mismatch_position: 2,
      num_sets: 6,
      max_relaxation: 2,
      neighbour_policy: 'avoid_3p',
    },
  },
  as_pcr: {
    id: 'as_pcr',
    label: 'AS-PCR',
    description: 'Untailed allele-specific PCR scored on a gel; a deliberate mismatch sharpens discrimination.',
    assay: {
      orientation: 'both',
      tails: 'none',
      deliberate_mismatch: 'auto',
      mismatch_position: 2,
      num_sets: 6,
      max_relaxation: 2,
      neighbour_policy: 'avoid_3p',
    },
  },
});

/** Primer3 params of relaxation level 0, as the server echoes them in `settings.params` (display only). */
export const GENOTYPING_LEVEL0_PARAMS: Readonly<Partial<GenotypingParams>> = freezeDeep({
  opt_size: 22,
  min_size: 18,
  max_size: 30,
  opt_tm: 60,
  min_tm: 57,
  max_tm: 63,
  min_gc: 30,
  max_gc: 70,
  max_tm_diff: 3,
  max_poly_x: 5,
  product_size_ranges: [[61, 120]],
});

/** The relaxation ladder the server climbs when a level finds no set (`settings.ladder`). */
export const GENOTYPING_LADDER: ReadonlyArray<{ level: number; changes: Readonly<Partial<GenotypingParams>> }> = freezeDeep([
  { level: 1, changes: { max_size: 32, min_tm: 55, max_tm: 65, min_gc: 20, max_gc: 80, product_size_ranges: [[65, 150]] } },
  { level: 2, changes: { min_tm: 52, max_tm_diff: 6 } },
]);

/** Hard floors every allele-specific primer must clear (`settings.floors`). */
export const GENOTYPING_FLOORS = Object.freeze({ as_min_tm: 52, as_min_gc: 15 });

export function defaultGenotypingAssay(type: GenotypingAssayType = 'kasp'): GenotypingAssay {
  return { type, ...GENOTYPING_PRESETS[type].assay };
}

/** The assay as the server will read it: the type's defaults overlaid with the user's choices. */
export function effectiveGenotypingAssay(assay?: Partial<GenotypingAssay> | null): GenotypingAssay {
  const type: GenotypingAssayType = assay?.type === 'as_pcr' ? 'as_pcr' : 'kasp';
  const out = defaultGenotypingAssay(type);
  if (!assay) return out;
  if (assay.orientation) out.orientation = assay.orientation;
  if (assay.tails) out.tails = assay.tails;
  if (assay.deliberate_mismatch) out.deliberate_mismatch = assay.deliberate_mismatch;
  if (typeof assay.mismatch_position === 'number') out.mismatch_position = assay.mismatch_position;
  if (typeof assay.num_sets === 'number') out.num_sets = assay.num_sets;
  if (typeof assay.max_relaxation === 'number') out.max_relaxation = assay.max_relaxation;
  if (assay.neighbour_policy) out.neighbour_policy = assay.neighbour_policy;
  return out;
}

/** Assay fields that differ from the chosen type's defaults; only those need sending. */
export function changedGenotypingAssay(assay?: Partial<GenotypingAssay> | null): Partial<GenotypingAssay> {
  const effective = effectiveGenotypingAssay(assay);
  const defaults = defaultGenotypingAssay(effective.type);
  const out: Partial<GenotypingAssay> = {};
  if (effective.type !== 'kasp') out.type = effective.type;
  for (const key of Object.keys(defaults) as Array<keyof GenotypingAssay>) {
    if (key === 'type') continue;
    if (effective[key] !== defaults[key]) (out as Record<string, unknown>)[key] = effective[key];
  }
  return out;
}

/**
 * The params to send: the user's explicit edits only, never a diff against a
 * preset. Every param the client sends is **pinned** by the server and excluded
 * from the relaxation ladder, so sending a value that merely equals the preset
 * would still change the design.
 */
export function changedGenotypingParams(params?: Partial<GenotypingParams> | null): Partial<GenotypingParams> {
  const out: Record<string, unknown> = {};
  if (!params) return out;
  for (const key of GENOTYPING_NUMERIC_PARAM_KEYS) {
    const v = (params as Record<string, unknown>)[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const lim = GENOTYPING_PARAM_LIMITS[key];
    if (lim.integer && !Number.isInteger(v)) continue;
    if (v < lim.min || v > lim.max) continue;
    out[key] = v;
  }
  const ranges = params.product_size_ranges;
  if (Array.isArray(ranges) && ranges.length && ranges.every((r) => Array.isArray(r) && r.length === 2 && r.every((x) => Number.isInteger(x)))) {
    out.product_size_ranges = ranges.map((r) => [r[0], r[1]]);
  }
  return out as Partial<GenotypingParams>;
}

/** A mutable deep copy of a preset's params. */
export function presetParams(preset: PresetName): Partial<DesignParams> {
  const p = PRESETS[preset].params;
  const out: Partial<DesignParams> = { ...p } as Partial<DesignParams>;
  if (p.product_size_ranges) out.product_size_ranges = p.product_size_ranges.map((r) => [r[0], r[1]] as [number, number]);
  return out;
}

/** Effective params for display/validation: preset values overlaid with user overrides. */
export function effectiveDesignParams(preset: PresetName, overrides?: Partial<DesignParams> | null): Partial<DesignParams> {
  const out = presetParams(preset);
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) continue;
      (out as Record<string, unknown>)[k] = k === 'product_size_ranges' && Array.isArray(v) ? v.map((r) => (Array.isArray(r) ? [...r] : r)) : v;
    }
  }
  return out;
}
