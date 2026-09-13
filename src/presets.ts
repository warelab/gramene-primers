import type { CheckParams, DesignMode, DesignParams, PresetName } from './types';

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
