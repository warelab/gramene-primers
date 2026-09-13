import { describe, expect, it } from 'vitest';
import { CHECK_DEFAULTS, defaultPresetFor, effectiveDesignParams, PRESETS, PRIMER3_DEFAULTS, presetParams } from '../src/presets';
import { cleanSequenceInput, DESIGN_PARAM_LIMITS, validateDesignParams, validateInterval, validateIntervals } from '../src/validate';

const codes = (issues: { code: string; field: string }[]) => issues.map((i) => `${i.field}:${i.code}`);

describe('presets (spec §A.5)', () => {
  it('pcr preset', () => {
    expect(PRESETS.pcr.modes).toEqual(['gene', 'region', 'sequence']);
    expect(PRESETS.pcr.params).toEqual({
      opt_size: 20, min_size: 18, max_size: 25, opt_tm: 60, min_tm: 57, max_tm: 63, min_gc: 30, max_gc: 70,
      max_tm_diff: 3, max_poly_x: 4, product_size_ranges: [[100, 1000]], num_return: 5,
    });
  });

  it('qpcr preset', () => {
    expect(PRESETS.qpcr.modes).toEqual(['transcript']);
    expect(PRESETS.qpcr.junction_spanning).toBe(true);
    expect(PRESETS.qpcr.params).toMatchObject({
      opt_size: 20, min_size: 18, max_size: 24, opt_tm: 60, min_tm: 58, max_tm: 62, min_gc: 35, max_gc: 65,
      max_tm_diff: 2, max_poly_x: 4, product_size_ranges: [[70, 150]], num_return: 5,
      min_3_prime_overlap_of_junction: 4, min_5_prime_overlap_of_junction: 7,
    });
  });

  it('is frozen; presetParams and effectiveDesignParams return independent copies', () => {
    expect(Object.isFrozen(PRESETS.pcr.params)).toBe(true);
    expect(Object.isFrozen(PRESETS.pcr.params.product_size_ranges)).toBe(true);
    const copy = presetParams('pcr');
    copy.product_size_ranges![0]![0] = 1;
    expect(PRESETS.pcr.params.product_size_ranges![0]![0]).toBe(100);
    const eff = effectiveDesignParams('qpcr', { max_size: 22, min_tm: undefined });
    expect(eff.max_size).toBe(22);
    expect(eff.min_tm).toBe(58);
    expect(defaultPresetFor('transcript')).toBe('qpcr');
    for (const m of ['gene', 'region', 'sequence'] as const) expect(defaultPresetFor(m)).toBe('pcr');
  });

  it('check defaults and Primer3 2.6.1 defaults', () => {
    expect(CHECK_DEFAULTS).toEqual({ max_product_size: 4000, ignore_mismatches: 6, max_amplifying_mismatches: 3, min_total_mismatches: 2, min_3p_mismatches: 2, three_prime_window: 5, include_unlikely: false, repeat_site_threshold: 5 });
    expect(PRIMER3_DEFAULTS).toMatchObject({ salt_monovalent: 50, salt_divalent: 1.5, dntp_conc: 0.6, dna_conc: 50, max_end_stability: 100, gc_clamp: 0, max_ns: 0 });
  });

  it('every preset value is within the field limits', () => {
    for (const preset of Object.values(PRESETS)) {
      expect(validateDesignParams(preset.params, { mode: preset.modes[0] })).toEqual([]);
    }
  });
});

describe('validateDesignParams (mirrors INVALID_PARAMS)', () => {
  it('checks field limits and integers', () => {
    expect(DESIGN_PARAM_LIMITS.max_size).toEqual({ min: 15, max: 36, integer: true });
    const issues = validateDesignParams({ min_size: 14, max_size: 37, opt_size: 20.5, min_tm: 29, num_return: 21, max_ns: 6, salt_monovalent: Number.NaN });
    expect(codes(issues)).toEqual(expect.arrayContaining(['min_size:OUT_OF_RANGE', 'max_size:OUT_OF_RANGE', 'opt_size:NOT_AN_INTEGER', 'min_tm:OUT_OF_RANGE', 'num_return:OUT_OF_RANGE', 'max_ns:OUT_OF_RANGE', 'salt_monovalent:NOT_A_NUMBER']));
  });

  it('min ≤ opt ≤ max for size, Tm and GC', () => {
    expect(codes(validateDesignParams({ min_size: 22, opt_size: 20, max_size: 21 }))).toEqual(['min_size:MIN_GT_MAX', 'opt_size:OPT_LT_MIN']);
    expect(codes(validateDesignParams({ min_tm: 57, opt_tm: 64, max_tm: 63 }))).toEqual(['opt_tm:OPT_GT_MAX']);
    expect(codes(validateDesignParams({ min_gc: 70, max_gc: 30 }))).toEqual(['min_gc:MIN_GT_MAX']);
    expect(validateDesignParams({ min_size: 20, opt_size: 20, max_size: 20 })).toEqual([]);
  });

  it('product size ranges: a < b, 20–50000, ≤ 10 ranges, one starting within the template', () => {
    expect(codes(validateDesignParams({ product_size_ranges: [[300, 300]] }))).toEqual(['product_size_ranges[0]:MIN_GE_MAX']);
    expect(codes(validateDesignParams({ product_size_ranges: [[10, 60000]] }))).toEqual(['product_size_ranges[0]:OUT_OF_RANGE']);
    expect(codes(validateDesignParams({ product_size_ranges: [] }))).toEqual(['product_size_ranges:REQUIRED']);
    const eleven = Array.from({ length: 11 }, (_, i) => [100 + i, 200 + i] as [number, number]);
    expect(codes(validateDesignParams({ product_size_ranges: eleven }))).toEqual(['product_size_ranges:TOO_MANY']);
    expect(codes(validateDesignParams({ product_size_ranges: [[600, 900]] }, { templateLength: 500 }))).toEqual(['product_size_ranges:LONGER_THAN_TEMPLATE']);
    expect(validateDesignParams({ product_size_ranges: [[600, 900], [100, 400]] }, { templateLength: 500 })).toEqual([]);
    expect(codes(validateDesignParams({ product_size_ranges: [[1.5, 3]] as [number, number][] }))).toEqual(['product_size_ranges[0]:INVALID_RANGE']);
  });

  it('junction overlaps must be ≤ floor(max_size/2) when a junction list is sent (V3 #10)', () => {
    const p = { max_size: 24, min_5_prime_overlap_of_junction: 13, min_3_prime_overlap_of_junction: 4 };
    expect(codes(validateDesignParams(p, { mode: 'transcript' }))).toEqual(['min_5_prime_overlap_of_junction:JUNCTION_OVERLAP_TOO_LARGE']);
    expect(validateDesignParams(p, { mode: 'transcript', junctionSpanning: false })).toEqual([]);
    expect(validateDesignParams(p, { mode: 'gene' })).toEqual([]);
    expect(validateDesignParams({ ...p, min_5_prime_overlap_of_junction: 12 }, { mode: 'transcript' })).toEqual([]);
  });

  it('max_size must not exceed the smallest product size (server checkParams INVALID_PARAMS)', () => {
    const pcr = effectiveDesignParams('pcr', { product_size_ranges: [[20, 100], [300, 600]] });
    expect(validateDesignParams(pcr)).toEqual([
      { field: 'max_size', code: 'MAX_SIZE_GT_PRODUCT', message: 'Maximum primer size (25) must not exceed the smallest product size (20)' },
    ]);
    expect(validateDesignParams(effectiveDesignParams('pcr', { product_size_ranges: [[25, 100]] }))).toEqual([]);
    expect(codes(validateDesignParams(effectiveDesignParams('qpcr', { product_size_ranges: [[23, 150]] }), { mode: 'transcript' }))).toEqual(['max_size:MAX_SIZE_GT_PRODUCT']);
    expect(validateDesignParams({ max_size: 30, product_size_ranges: [[1.5, 3]] as [number, number][] }).map((i) => i.code)).toEqual(['INVALID_RANGE', 'MAX_SIZE_GT_PRODUCT']);
  });
});

describe('intervals', () => {
  it('validates [start, length] against the template', () => {
    expect(validateInterval('target', [499, 50], 4020)).toEqual([]);
    expect(codes(validateInterval('target', [4000, 50], 4020))).toEqual(['target:INTERVAL_OUT_OF_BOUNDS']);
    expect(codes(validateInterval('target', [0, 0]))).toEqual(['target:OUT_OF_RANGE', 'target:OUT_OF_RANGE']);
    expect(codes(validateInterval('target', [1, 'x']))).toEqual(['target:INVALID_INTERVAL']);
    const many = Array.from({ length: 51 }, (_, i) => [i + 1, 1] as [number, number]);
    expect(codes(validateIntervals({ target: [1, 5], included: [1, 5000], excluded: many }, 4020))).toEqual(['included:INTERVAL_OUT_OF_BOUNDS', 'excluded:TOO_MANY']);
  });
});

describe('cleanSequenceInput (mirrors sequence mode cleaning)', () => {
  it('drops FASTA headers, whitespace and digits', () => {
    const c = cleanSequenceInput('>amp desc\n  1 ACGTACGTAC GTACGTACGT\r\n 21 acgtNNacgt\n>second\nTTTT');
    expect(c.seq).toBe('ACGTACGTACGTACGTACGTacgtNNacgtTTTT');
    expect(c).toMatchObject({ length: 34, invalidChars: [], iupacConverted: false, hasLowercase: true, tooShort: false, tooLong: false, records: 2, ok: true });
  });

  it('counts FASTA records that contain sequence, as the server does (warning MULTIPLE_RECORDS above 1)', () => {
    expect(cleanSequenceInput('>recA\nACGTACGTAC\n>recB\nGGGGCCCCAA\n').records).toBe(2);
    expect(cleanSequenceInput('>a\n>b\nACGTACGTACGTACGTACGT').records).toBe(1);
    expect(cleanSequenceInput('ACGTACGTAC\n>b\nACGTACGTAC\n\n>c\nTTTTTTTTTT').records).toBe(3);
    expect(cleanSequenceInput('ACGTACGTACGTACGTACGT').records).toBe(1);
    // Headers with no sequence after them, and blank or digit-only lines, do not count.
    expect(cleanSequenceInput('>a\n  12 \n\n>b\nACGTACGTACGTACGTACGT\n>c\n').records).toBe(1);
    expect(cleanSequenceInput('').records).toBe(0);
  });

  it('flags IUPAC codes, invalid characters and length limits', () => {
    expect(cleanSequenceInput('ACGTRYACGTACGTACGTACGTAC')).toMatchObject({ iupacConverted: true, ok: true });
    expect(cleanSequenceInput('ACGTUXACGTACGTACGTACGTAC-')).toMatchObject({ invalidChars: ['U', 'X', '-'], ok: false });
    // Header lines may start with spaces (server: /^\s*>/); a '>' inside a sequence line is invalid.
    expect(cleanSequenceInput(' >hdr\nACGTACGTACGTACGTACGTAC')).toMatchObject({ seq: 'ACGTACGTACGTACGTACGTAC', invalidChars: [], records: 1, ok: true });
    expect(cleanSequenceInput('ACGTAC>GTACGTACGTACGTAC')).toMatchObject({ invalidChars: ['>'], ok: false });
    expect(cleanSequenceInput('ACGT')).toMatchObject({ tooShort: true, ok: false });
    expect(cleanSequenceInput('A'.repeat(50001))).toMatchObject({ tooLong: true, ok: false });
    expect(cleanSequenceInput('A'.repeat(50000)).ok).toBe(true);
  });
});
