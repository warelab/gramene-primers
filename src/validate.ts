import type { DesignMode, DesignParams, GenotypingParamKey, GenotypingParams, Interval, NumericDesignParamKey } from './types';

/** Server-side design limits (spec §A.2.1, §A.6). */
export const DESIGN_LIMITS = Object.freeze({
  maxTemplateLength: 50_000,
  minSequenceLength: 20,
  maxSequenceLength: 50_000,
  maxSequenceInput: 60_000,
  maxFlank: 10_000,
  maxExcluded: 50,
  maxProductRanges: 10,
  minProductSize: 20,
  maxProductSize: 50_000,
  maxIdLength: 255,
  systemNamePattern: /^[a-z0-9_]+$/,
});

export interface ParamLimit {
  min: number;
  max: number;
  integer: boolean;
}

/** Per-field limits of `PrimerDesignParams` (spec §A.2.1). */
export const DESIGN_PARAM_LIMITS: Readonly<Record<NumericDesignParamKey, ParamLimit>> = Object.freeze({
  opt_size: { min: 15, max: 36, integer: true },
  min_size: { min: 15, max: 36, integer: true },
  max_size: { min: 15, max: 36, integer: true },
  opt_tm: { min: 30, max: 90, integer: false },
  min_tm: { min: 30, max: 90, integer: false },
  max_tm: { min: 30, max: 90, integer: false },
  opt_gc: { min: 0, max: 100, integer: false },
  min_gc: { min: 0, max: 100, integer: false },
  max_gc: { min: 0, max: 100, integer: false },
  max_tm_diff: { min: 0, max: 30, integer: false },
  max_poly_x: { min: 0, max: 10, integer: true },
  gc_clamp: { min: 0, max: 5, integer: true },
  max_end_stability: { min: 0, max: 100, integer: false },
  max_ns: { min: 0, max: 5, integer: true },
  salt_monovalent: { min: 0, max: 1000, integer: false },
  salt_divalent: { min: 0, max: 100, integer: false },
  dntp_conc: { min: 0, max: 100, integer: false },
  dna_conc: { min: 0, max: 10000, integer: false },
  num_return: { min: 1, max: 20, integer: true },
  min_3_prime_overlap_of_junction: { min: 1, max: 20, integer: true },
  min_5_prime_overlap_of_junction: { min: 1, max: 20, integer: true },
});

export const NUMERIC_DESIGN_PARAM_KEYS = Object.freeze(Object.keys(DESIGN_PARAM_LIMITS) as NumericDesignParamKey[]);

export interface ValidationIssue {
  /** Param key, `product_size_ranges[i]`, `target`, `included`, `excluded[i]`, `sequence`, … */
  field: string;
  code: string;
  message: string;
}

export interface ValidateParamsContext {
  mode?: DesignMode;
  /** Transcript mode sends a junction list unless this is false. */
  junctionSpanning?: boolean;
  /** When known, at least one product range must start at or below it. */
  templateLength?: number | null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Mirrors the server's param validation (field limits plus the cross-field
 * checks that return 400 `INVALID_PARAMS`). Pass the *effective* params
 * (preset + overrides) for the cross-field checks to be meaningful.
 */
export function validateDesignParams(params: Partial<DesignParams>, ctx: ValidateParamsContext = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const p = params as Record<string, unknown>;

  for (const key of NUMERIC_DESIGN_PARAM_KEYS) {
    const v = p[key];
    if (v === undefined || v === null) continue;
    const lim = DESIGN_PARAM_LIMITS[key];
    if (!isFiniteNumber(v)) {
      issues.push({ field: key, code: 'NOT_A_NUMBER', message: `${key} must be a number` });
      continue;
    }
    if (lim.integer && !Number.isInteger(v)) {
      issues.push({ field: key, code: 'NOT_AN_INTEGER', message: `${key} must be a whole number` });
    }
    if (v < lim.min || v > lim.max) {
      issues.push({ field: key, code: 'OUT_OF_RANGE', message: `${key} must be between ${lim.min} and ${lim.max}` });
    }
  }

  for (const [label, lo, opt, hi] of [
    ['size', 'min_size', 'opt_size', 'max_size'],
    ['Tm', 'min_tm', 'opt_tm', 'max_tm'],
    ['GC', 'min_gc', 'opt_gc', 'max_gc'],
  ] as const) {
    const a = p[lo];
    const o = p[opt];
    const b = p[hi];
    if (isFiniteNumber(a) && isFiniteNumber(b) && a > b) {
      issues.push({ field: lo, code: 'MIN_GT_MAX', message: `Minimum ${label} must not exceed maximum ${label}` });
    }
    if (isFiniteNumber(o) && isFiniteNumber(a) && o < a) {
      issues.push({ field: opt, code: 'OPT_LT_MIN', message: `Optimal ${label} must be at least the minimum` });
    }
    if (isFiniteNumber(o) && isFiniteNumber(b) && o > b) {
      issues.push({ field: opt, code: 'OPT_GT_MAX', message: `Optimal ${label} must not exceed the maximum` });
    }
  }

  const ranges = p.product_size_ranges;
  if (ranges !== undefined) {
    if (!Array.isArray(ranges) || ranges.length < 1) {
      issues.push({ field: 'product_size_ranges', code: 'REQUIRED', message: 'At least one product size range is required' });
    } else {
      if (ranges.length > DESIGN_LIMITS.maxProductRanges) {
        issues.push({ field: 'product_size_ranges', code: 'TOO_MANY', message: `At most ${DESIGN_LIMITS.maxProductRanges} product size ranges` });
      }
      ranges.forEach((r, i) => {
        const field = `product_size_ranges[${i}]`;
        if (!Array.isArray(r) || r.length !== 2 || !r.every((x) => isFiniteNumber(x) && Number.isInteger(x))) {
          issues.push({ field, code: 'INVALID_RANGE', message: 'Product size range must be two whole numbers' });
          return;
        }
        const [a, b] = r as [number, number];
        if (a < DESIGN_LIMITS.minProductSize || b > DESIGN_LIMITS.maxProductSize || b < DESIGN_LIMITS.minProductSize || a > DESIGN_LIMITS.maxProductSize) {
          issues.push({ field, code: 'OUT_OF_RANGE', message: `Product sizes must be between ${DESIGN_LIMITS.minProductSize} and ${DESIGN_LIMITS.maxProductSize}` });
        }
        if (!(a < b)) issues.push({ field, code: 'MIN_GE_MAX', message: 'Range start must be smaller than its end' });
      });
      const starts = ranges.filter((r) => Array.isArray(r) && isFiniteNumber(r[0])).map((r) => (r as number[])[0] as number);
      if (isFiniteNumber(p.max_size) && starts.length && p.max_size > Math.min(...starts)) {
        const smallest = Math.min(...starts);
        issues.push({ field: 'max_size', code: 'MAX_SIZE_GT_PRODUCT', message: `Maximum primer size (${p.max_size}) must not exceed the smallest product size (${smallest})` });
      }
      const len = ctx.templateLength;
      if (isFiniteNumber(len) && ranges.every((r) => Array.isArray(r) && isFiniteNumber(r[0]) && r[0] > len)) {
        issues.push({ field: 'product_size_ranges', code: 'LONGER_THAN_TEMPLATE', message: `No product size range starts at or below the template length (${len})` });
      }
    }
  }

  if (ctx.mode === 'transcript' && ctx.junctionSpanning !== false && isFiniteNumber(p.max_size)) {
    const half = Math.floor(p.max_size / 2);
    for (const key of ['min_5_prime_overlap_of_junction', 'min_3_prime_overlap_of_junction'] as const) {
      const v = p[key];
      if (isFiniteNumber(v) && v > half) {
        issues.push({ field: key, code: 'JUNCTION_OVERLAP_TOO_LARGE', message: `${key} must be at most floor(max_size/2) = ${half}` });
      }
    }
  }
  return issues;
}

/** Validates a 1-based `[start, length]` interval, optionally against a template length. */
export function validateInterval(field: string, iv: unknown, templateLength?: number | null): ValidationIssue[] {
  if (!Array.isArray(iv) || iv.length !== 2 || !iv.every((x) => isFiniteNumber(x) && Number.isInteger(x))) {
    return [{ field, code: 'INVALID_INTERVAL', message: 'Interval must be [start, length] whole numbers' }];
  }
  const [start, length] = iv as Interval;
  const issues: ValidationIssue[] = [];
  if (start < 1) issues.push({ field, code: 'OUT_OF_RANGE', message: 'Interval start must be ≥ 1' });
  if (length < 1) issues.push({ field, code: 'OUT_OF_RANGE', message: 'Interval length must be ≥ 1' });
  if (isFiniteNumber(templateLength) && start + length - 1 > templateLength) {
    issues.push({ field, code: 'INTERVAL_OUT_OF_BOUNDS', message: `Interval ends past the template (length ${templateLength})` });
  }
  return issues;
}

export function validateIntervals(
  intervals: { target?: Interval | null; included?: Interval | null; excluded?: Interval[] | null },
  templateLength?: number | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (intervals.target) issues.push(...validateInterval('target', intervals.target, templateLength));
  if (intervals.included) issues.push(...validateInterval('included', intervals.included, templateLength));
  const ex = intervals.excluded ?? [];
  if (ex.length > DESIGN_LIMITS.maxExcluded) {
    issues.push({ field: 'excluded', code: 'TOO_MANY', message: `At most ${DESIGN_LIMITS.maxExcluded} excluded intervals` });
  }
  ex.forEach((iv, i) => issues.push(...validateInterval(`excluded[${i}]`, iv, templateLength)));
  return issues;
}

export interface CleanedSequence {
  /** Cleaned sequence; IUPAC codes kept as typed (the server converts them to N). */
  seq: string;
  length: number;
  /** Distinct characters that the server would reject. */
  invalidChars: string[];
  /** Non-ACGTN IUPAC codes present (server warns `IUPAC_CONVERTED`). */
  iupacConverted: boolean;
  hasLowercase: boolean;
  tooShort: boolean;
  tooLong: boolean;
  /**
   * FASTA records that contain sequence (headers with no sequence after them do
   * not count), as the server counts them. Above 1 the records are joined into
   * one template (server warning `MULTIPLE_RECORDS`), so a product may span a join.
   */
  records: number;
  ok: boolean;
}

// ---------------------------------------------------------------------------
// Genotyping (KASP / AS-PCR)
// ---------------------------------------------------------------------------

/** An allele: 1–50 bases of A/C/G/T, or `-` in the Ensembl style. */
export const VARIANT_ALLELE_PATTERN = /^([ACGTacgt]{1,50}|-)$/;

/** Server limits of the variant and genotyping endpoints. */
export const GENOTYPING_LIMITS = Object.freeze({
  /** `400 VARIANT_WINDOW_TOO_LONG` above this. */
  maxWindow: 50_000,
  maxAlleleLength: 50,
  defaultVariantLimit: 2000,
  maxVariantLimit: 5000,
  minSets: 1,
  maxSets: 10,
  maxRelaxation: 2,
  minProductSize: 20,
  maxProductSize: 1000,
  maxProductRanges: 4,
  /** An indel that slides further is `400 VARIANT_TOO_REPETITIVE`. */
  maxShift: 1000,
});

/** The design params `POST /primers/genotyping/design` accepts (no `num_return`, `max_ns` or junction params). */
export const GENOTYPING_PARAM_LIMITS: Readonly<Record<Exclude<GenotypingParamKey, 'product_size_ranges'>, ParamLimit>> = Object.freeze({
  opt_size: DESIGN_PARAM_LIMITS.opt_size,
  min_size: DESIGN_PARAM_LIMITS.min_size,
  max_size: DESIGN_PARAM_LIMITS.max_size,
  opt_tm: DESIGN_PARAM_LIMITS.opt_tm,
  min_tm: DESIGN_PARAM_LIMITS.min_tm,
  max_tm: DESIGN_PARAM_LIMITS.max_tm,
  opt_gc: DESIGN_PARAM_LIMITS.opt_gc,
  min_gc: DESIGN_PARAM_LIMITS.min_gc,
  max_gc: DESIGN_PARAM_LIMITS.max_gc,
  max_tm_diff: DESIGN_PARAM_LIMITS.max_tm_diff,
  max_poly_x: DESIGN_PARAM_LIMITS.max_poly_x,
  gc_clamp: DESIGN_PARAM_LIMITS.gc_clamp,
  max_end_stability: DESIGN_PARAM_LIMITS.max_end_stability,
  salt_monovalent: DESIGN_PARAM_LIMITS.salt_monovalent,
  salt_divalent: DESIGN_PARAM_LIMITS.salt_divalent,
  dntp_conc: DESIGN_PARAM_LIMITS.dntp_conc,
  dna_conc: DESIGN_PARAM_LIMITS.dna_conc,
});

export const GENOTYPING_NUMERIC_PARAM_KEYS = Object.freeze(
  Object.keys(GENOTYPING_PARAM_LIMITS) as Array<Exclude<GenotypingParamKey, 'product_size_ranges'>>,
);

/**
 * The shortest product the design can make: both allele-specific primers meet at
 * the variant, so a product spans at most `max_size` on each side of it.
 */
export function effectiveMinProductSize(maxSize: number | null | undefined): number | null {
  return isFiniteNumber(maxSize) ? 2 * Math.round(maxSize) + 1 : null;
}

/** Mirrors the genotyping endpoint's param validation; pass the effective params. */
export function validateGenotypingParams(params: Partial<GenotypingParams> | null | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!params) return issues;
  const p = params as Record<string, unknown>;

  for (const key of GENOTYPING_NUMERIC_PARAM_KEYS) {
    const v = p[key];
    if (v === undefined || v === null) continue;
    const lim = GENOTYPING_PARAM_LIMITS[key];
    if (!isFiniteNumber(v)) {
      issues.push({ field: key, code: 'NOT_A_NUMBER', message: `${key} must be a number` });
      continue;
    }
    if (lim.integer && !Number.isInteger(v)) issues.push({ field: key, code: 'NOT_AN_INTEGER', message: `${key} must be a whole number` });
    if (v < lim.min || v > lim.max) issues.push({ field: key, code: 'OUT_OF_RANGE', message: `${key} must be between ${lim.min} and ${lim.max}` });
  }

  for (const [label, lo, opt, hi] of [
    ['size', 'min_size', 'opt_size', 'max_size'],
    ['Tm', 'min_tm', 'opt_tm', 'max_tm'],
    ['GC', 'min_gc', 'opt_gc', 'max_gc'],
  ] as const) {
    const a = p[lo];
    const o = p[opt];
    const b = p[hi];
    if (isFiniteNumber(a) && isFiniteNumber(b) && a > b) {
      issues.push({ field: lo, code: 'MIN_GT_MAX', message: `Minimum ${label} must not exceed maximum ${label}` });
    }
    if (isFiniteNumber(o) && isFiniteNumber(a) && o < a) issues.push({ field: opt, code: 'OPT_LT_MIN', message: `Optimal ${label} must be at least the minimum` });
    if (isFiniteNumber(o) && isFiniteNumber(b) && o > b) issues.push({ field: opt, code: 'OPT_GT_MAX', message: `Optimal ${label} must not exceed the maximum` });
  }

  const ranges = p.product_size_ranges;
  if (ranges !== undefined) {
    if (!Array.isArray(ranges) || ranges.length < 1) {
      issues.push({ field: 'product_size_ranges', code: 'REQUIRED', message: 'At least one product size range is required' });
    } else {
      if (ranges.length > GENOTYPING_LIMITS.maxProductRanges) {
        issues.push({ field: 'product_size_ranges', code: 'TOO_MANY', message: `At most ${GENOTYPING_LIMITS.maxProductRanges} product size ranges` });
      }
      const floor = effectiveMinProductSize(isFiniteNumber(p.max_size) ? p.max_size : null);
      ranges.forEach((r, i) => {
        const field = `product_size_ranges[${i}]`;
        if (!Array.isArray(r) || r.length !== 2 || !r.every((x) => isFiniteNumber(x) && Number.isInteger(x))) {
          issues.push({ field, code: 'INVALID_RANGE', message: 'Product size range must be two whole numbers' });
          return;
        }
        const [a, b] = r as [number, number];
        if (a < GENOTYPING_LIMITS.minProductSize || b > GENOTYPING_LIMITS.maxProductSize) {
          issues.push({ field, code: 'OUT_OF_RANGE', message: `Product sizes must be between ${GENOTYPING_LIMITS.minProductSize} and ${GENOTYPING_LIMITS.maxProductSize}` });
        }
        if (!(a < b)) issues.push({ field, code: 'MIN_GE_MAX', message: 'Range start must be smaller than its end' });
        if (floor !== null && b < floor) {
          issues.push({
            field,
            code: 'BELOW_EFFECTIVE_MINIMUM',
            message: `Both primers meet at the variant, so no product is shorter than 2 × max_size + 1 = ${floor} bp`,
          });
        }
      });
    }
  }
  return issues;
}

export interface VariantInputById {
  id?: string;
  alt?: string;
}

export interface VariantInputManual {
  region?: string;
  position?: number | string;
  ref?: string;
  alt?: string;
}

export type VariantInput = VariantInputById & VariantInputManual;

/**
 * Mirrors the endpoint's variant rules: either an Ensembl id or a manual
 * region/position/REF/ALT (never both, `400 INVALID_VARIANT {reason:
 * id_or_manual}`); alleles are A/C/G/T or `-` and must differ; `-` on both sides
 * is not a variant.
 */
export function validateVariantInput(input: VariantInput | null | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const id = typeof input?.id === 'string' ? input.id.trim() : '';
  const region = typeof input?.region === 'string' ? input.region.trim() : '';
  const hasPosition = input?.position !== undefined && input?.position !== null && String(input.position).trim() !== '';
  const ref = typeof input?.ref === 'string' ? input.ref.trim() : '';
  const manualFields = [region, hasPosition ? 'p' : '', ref].filter(Boolean).length;
  const alt = typeof input?.alt === 'string' ? input.alt.trim() : '';

  if (!id && manualFields === 0) {
    issues.push({ field: 'variant', code: 'REQUIRED', message: 'Choose a variant, or enter its region, position, REF and ALT' });
    return issues;
  }
  if (id && manualFields > 0) {
    issues.push({ field: 'variant', code: 'ID_OR_MANUAL', message: 'Give either a variant id or region, position, REF and ALT — not both' });
    return issues;
  }

  if (id) {
    if (id.length > DESIGN_LIMITS.maxIdLength) issues.push({ field: 'id', code: 'TOO_LONG', message: `A variant id is at most ${DESIGN_LIMITS.maxIdLength} characters` });
    // `alt` is optional here; it picks one allele of a multi-allelic site.
    if (alt && !VARIANT_ALLELE_PATTERN.test(alt)) {
      issues.push({ field: 'alt', code: 'INVALID_ALLELE', message: 'ALT must be 1–50 bases of A, C, G or T, or `-`' });
    }
    return issues;
  }

  if (!region) issues.push({ field: 'region', code: 'REQUIRED', message: 'Enter the sequence region' });
  const position = Number(String(input?.position ?? '').trim());
  if (!hasPosition || !Number.isInteger(position) || position < 1) {
    issues.push({ field: 'position', code: 'INVALID_POSITION', message: 'Position must be a whole number of at least 1' });
  }
  for (const [field, value] of [
    ['ref', ref],
    ['alt', alt],
  ] as const) {
    if (!value) issues.push({ field, code: 'REQUIRED', message: `Enter ${field.toUpperCase()}` });
    else if (!VARIANT_ALLELE_PATTERN.test(value)) {
      issues.push({ field, code: 'INVALID_ALLELE', message: `${field.toUpperCase()} must be 1–50 bases of A, C, G or T, or \`-\`` });
    }
  }
  if (ref && alt) {
    if (ref.toUpperCase() === alt.toUpperCase()) issues.push({ field: 'alt', code: 'REF_EQUALS_ALT', message: 'REF and ALT must differ' });
    if (ref === '-' && alt === '-') issues.push({ field: 'ref', code: 'INVALID_ALLELE', message: 'REF and ALT cannot both be `-`' });
  }
  return issues;
}

/**
 * Mirrors the server's sequence-mode cleaning (spec §A.4.6, template.js
 * cleanSequence): drop header lines (optional spaces, then `>`), remove
 * whitespace and digits; the rest must be IUPAC nucleotides and 20–50,000 long.
 */
export function cleanSequenceInput(text: string): CleanedSequence {
  let records = 0;
  let recordHasSequence = false;
  const body = String(text ?? '')
    .split(/\r\n|\r|\n/)
    .filter((line) => {
      if (/^\s*>/.test(line)) {
        recordHasSequence = false;
        return false;
      }
      if (!recordHasSequence && /[^\s\d]/.test(line)) {
        recordHasSequence = true;
        records += 1;
      }
      return true;
    })
    .join('')
    .replace(/[\s\d]+/g, '');
  const invalid = new Set<string>();
  for (const ch of body) if (!/[ACGTRYKMSWBDHVN]/i.test(ch)) invalid.add(ch);
  const length = body.length;
  const iupacConverted = /[RYKMSWBDHV]/i.test(body);
  const tooShort = length < DESIGN_LIMITS.minSequenceLength;
  const tooLong = length > DESIGN_LIMITS.maxSequenceLength;
  return {
    seq: body,
    length,
    invalidChars: [...invalid],
    iupacConverted,
    hasLowercase: /[a-z]/.test(body),
    tooShort,
    tooLong,
    records,
    ok: invalid.size === 0 && !tooShort && !tooLong,
  };
}
