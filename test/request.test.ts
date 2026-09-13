import { describe, expect, it } from 'vitest';
import { CHECK_DEFAULTS, PRESETS } from '../src/presets';
import {
  availableGenomeNames,
  CHECK_PARAM_LIMITS,
  effectiveMaxAmplifyingMismatches,
  validateCheckParams,
  buildCheckRequest,
  buildDesignRequest,
  canAddPairToCheck,
  changedCheckParams,
  changedDesignParams,
  checkMaxProductSize,
  CheckRequestError,
  checkSelectionSummary,
  defaultPangenomeGenomes,
  isCheckablePair,
  isCheckablePrimer,
  pairCheckability,
  uniquePrimers,
} from '../src/request';
import { initialDesignerState } from '../src/state';
import type { PrimerDesignerState, PrimerPair } from '../src/types';
import { gene200, genePairs, genomesResponse, qpcrCheckPair, SEQS, sequencePair, transcriptPair0 } from './fixtures/samples';

const state = (over: Partial<PrimerDesignerState>): PrimerDesignerState => ({ ...initialDesignerState({ gene: gene200 }), ...over });

function err(fn: () => unknown): CheckRequestError {
  try {
    fn();
  } catch (e) {
    return e as CheckRequestError;
  }
  throw new Error('expected CheckRequestError');
}

describe('buildDesignRequest', () => {
  it('gene mode sends gene id, the gene genome, flanks, and no params when the preset is unchanged', () => {
    const req = buildDesignRequest(state({ mode: 'gene', flankUp: 200, flankDown: 100 }), { gene: gene200 });
    expect(req).toEqual({ mode: 'gene', gene_id: 'SORBI_3001G000200', system_name: 'sorghum_bicolor', flank_up: 200, flank_down: 100 });
  });

  it('gene mode sends only changed params (spec example)', () => {
    const req = buildDesignRequest(state({ mode: 'gene', flankUp: 200, flankDown: 100, params: { product_size_ranges: [[300, 800]], opt_size: 20 } }), { gene: gene200 });
    expect(req.params).toEqual({ product_size_ranges: [[300, 800]] });
  });

  it('gene mode with a transcript overlay, intervals and repeat options', () => {
    const req = buildDesignRequest(
      state({ mode: 'gene', transcriptId: 'SORBI_3001G000200.1', target: [499, 50], included: [100, 3000], excluded: [[1000, 40], [1200, 10]], avoidRepeats: true, repeatMaskMode: 'three_prime' }),
      { geneId: 'SORBI_3001G000200' },
    );
    expect(req).toEqual({
      mode: 'gene',
      gene_id: 'SORBI_3001G000200',
      transcript_id: 'SORBI_3001G000200.1',
      target: [499, 50],
      included: [100, 3000],
      excluded: [[1000, 40], [1200, 10]],
      avoid_repeats: true,
      repeat_mask_mode: 'three_prime',
    });
  });

  it('transcript mode sends junction_spanning and no flanks (spec example)', () => {
    const req = buildDesignRequest(state({ mode: 'transcript', preset: 'qpcr', flankUp: 500 }), { gene: gene200 });
    expect(req).toEqual({ mode: 'transcript', gene_id: 'SORBI_3001G000200', junction_spanning: true });
  });

  it('transcript mode with the PCR preset sends the values that differ from qPCR', () => {
    const req = buildDesignRequest(state({ mode: 'transcript', preset: 'pcr', junctionSpanning: false }), { gene: gene200 });
    expect(req.junction_spanning).toBe(false);
    expect(req.params).toEqual({ max_size: 25, min_tm: 57, max_tm: 63, min_gc: 30, max_gc: 70, max_tm_diff: 3, product_size_ranges: [[100, 1000]] });
  });

  it('region mode (V3 #5) with intervals and params', () => {
    const req = buildDesignRequest(
      state({
        mode: 'region',
        systemName: 'sorghum_bicolor',
        region: { region: '1', start: 11080, end: 15099, strand: -1 },
        target: [499, 50],
        included: [100, 3000],
        excluded: [[1000, 40]],
        params: { min_size: 19, max_size: 22, min_tm: 58, max_tm: 61, min_gc: 40, max_gc: 60, max_tm_diff: 2, product_size_ranges: [[200, 300]] },
      }),
      {},
    );
    expect(req).toEqual({
      mode: 'region',
      system_name: 'sorghum_bicolor',
      region: { region: '1', start: 11080, end: 15099, strand: -1 },
      target: [499, 50],
      included: [100, 3000],
      excluded: [[1000, 40]],
      params: { min_size: 19, max_size: 22, min_tm: 58, max_tm: 61, min_gc: 40, max_gc: 60, max_tm_diff: 2, product_size_ranges: [[200, 300]] },
    });
  });

  it('region mode falls back to props region, then the gene location', () => {
    const base: PrimerDesignerState = { v: 1, mode: 'region' };
    expect(buildDesignRequest(base, { systemName: 'sorghum_rio', region: { region: '2', start: 5, end: 500 } })).toEqual({
      mode: 'region',
      system_name: 'sorghum_rio',
      region: { region: '2', start: 5, end: 500, strand: 1 },
    });
    expect(buildDesignRequest(base, { gene: gene200 })).toEqual({
      mode: 'region',
      system_name: 'sorghum_bicolor',
      region: { region: '1', start: 11180, end: 14899, strand: -1 },
    });
  });

  it('sequence mode sends the raw sequence, optional genome and template_only', () => {
    const seq = '>amp\nATGGCCRYTACGTACGTACGTACGTAAAA';
    const req = buildDesignRequest({ v: 1, mode: 'sequence', sequence: seq, systemName: 'sorghum_bicolor', avoidRepeats: true }, { templateOnly: true });
    expect(req).toEqual({ mode: 'sequence', sequence: seq, system_name: 'sorghum_bicolor', avoid_repeats: true, template_only: true });
  });

  it('drops invalid params and intervals, and repeat mode without avoid_repeats', () => {
    const req = buildDesignRequest(
      {
        v: 1,
        mode: 'sequence',
        sequence: 'ACGT',
        repeatMaskMode: 'three_prime',
        target: [1.5, 3] as unknown as [number, number],
        params: { min_size: 19.5, max_tm: Number.NaN, num_return: 7, product_size_ranges: [[1, 2, 3]] as unknown as [number, number][] },
      },
      {},
    );
    expect(req).toEqual({ mode: 'sequence', sequence: 'ACGT', params: { num_return: 7 } });
  });

  it('changedDesignParams compares against the mode default preset', () => {
    expect(changedDesignParams('gene', 'pcr', { ...PRESETS.pcr.params })).toEqual({});
    expect(changedDesignParams('transcript', 'qpcr', { min_5_prime_overlap_of_junction: 7, min_3_prime_overlap_of_junction: 5 })).toEqual({ min_3_prime_overlap_of_junction: 5 });
    expect(changedDesignParams('gene', null, { salt_divalent: 2.5 })).toEqual({ salt_divalent: 2.5 });
  });
});

describe('checkability', () => {
  it('isCheckablePrimer enforces ^[ACGTacgt]{15,36}$', () => {
    expect(isCheckablePrimer('ACGTACGTACGTACG')).toBe(true);
    expect(isCheckablePrimer('acgtacgtacgtacgt')).toBe(true);
    expect(isCheckablePrimer('A'.repeat(36))).toBe(true);
    expect(isCheckablePrimer('A'.repeat(14))).toBe(false);
    expect(isCheckablePrimer('A'.repeat(37))).toBe(false);
    expect(isCheckablePrimer('ACGTACGTACGTACGN')).toBe(false);
    expect(isCheckablePrimer('ACGTACGTACGTACGR')).toBe(false);
    expect(isCheckablePrimer(undefined)).toBe(false);
  });

  it('products over 10 kb are not checkable', () => {
    expect(isCheckablePair(sequencePair(0, 10000))).toBe(true);
    expect(pairCheckability(sequencePair(0, 10001))).toMatchObject({ ok: false, reason: 'PRODUCT_TOO_LONG_TO_CHECK' });
    const nPair: PrimerPair = { ...transcriptPair0, left: { ...transcriptPair0.left, seq: 'ATTACATCAANTAGGCCTTG' } };
    expect(pairCheckability(nPair)).toMatchObject({ ok: false, reason: 'PRIMER_NOT_CHECKABLE' });
  });

  it('counts unique primers case-insensitively and limits selections to 10 pairs / 20 primers', () => {
    expect(uniquePrimers([{ left: 'acgt', right: 'ACGT' }, { left: { seq: 'TTTT' }, right: 'acgt' }])).toEqual(['ACGT', 'TTTT']);
    const ten = Array.from({ length: 10 }, (_, i) => ({ ...sequencePair(i, 200), left: { ...sequencePair(i, 200).left, seq: `${'A'.repeat(15)}${'C'.repeat(i + 1)}` } }));
    expect(checkSelectionSummary(ten)).toEqual({ pairs: 10, uniquePrimers: 11, withinLimits: true });
    expect(canAddPairToCheck(ten, sequencePair(11, 200))).toBe(false);
    expect(canAddPairToCheck(ten.slice(0, 9), sequencePair(11, 200))).toBe(true);
    expect(canAddPairToCheck([], sequencePair(0, 20000))).toBe(false);
  });
});

describe('buildCheckRequest', () => {
  it('gene mode: ids P{rank+1}, expected from product.genomic, specificity only', () => {
    const req = buildCheckRequest({ mode: 'gene', systemName: 'sorghum_bicolor', geneId: 'SORBI_3004G087700', transcriptId: 'SORBI_3004G087700.3', pairs: genePairs.slice(1) });
    expect(req).toEqual({
      system_name: 'sorghum_bicolor',
      mode: 'gene',
      gene_id: 'SORBI_3004G087700',
      checks: ['specificity'],
      pairs: [
        { id: 'P2', left: SEQS.P2_L, right: SEQS.P2_R, expected: { region: '4', start: 7423537, end: 7423746 } },
        { id: 'P3', left: SEQS.P3_L, right: SEQS.P3_R, expected: { region: '4', start: 7422482, end: 7423061 } },
      ],
    });
  });

  it('region mode keeps expected; transcript mode drops it and sends transcript_id', () => {
    const region = buildCheckRequest({ mode: 'region', systemName: 'sorghum_bicolor', pairs: [genePairs[1] as PrimerPair] });
    expect(region.pairs[0]?.expected).toEqual({ region: '4', start: 7423537, end: 7423746 });
    expect(region.gene_id).toBeUndefined();

    const tx = buildCheckRequest({ mode: 'transcript', systemName: 'sorghum_bicolor', geneId: 'SORBI_3004G087700', transcriptId: 'SORBI_3004G087700.3', pairs: [qpcrCheckPair] });
    expect(tx).toEqual({
      system_name: 'sorghum_bicolor',
      mode: 'transcript',
      gene_id: 'SORBI_3004G087700',
      transcript_id: 'SORBI_3004G087700.3',
      checks: ['specificity'],
      pairs: [{ id: 'P1', left: SEQS.J_L, right: SEQS.P1_R }],
    });
    expect('expected' in (tx.pairs[0] as object)).toBe(false);
  });

  it('pangenome genomes are omitted when all are selected, else sorted without the query', () => {
    const all = defaultPangenomeGenomes(genomesResponse(), 'gene').map((g) => g.system_name);
    expect(all).toEqual(['sorghum_353', 'sorghum_grassl', 'sorghum_leoti']);
    const base = { mode: 'gene' as const, systemName: 'sorghum_bicolor', geneId: 'G', pairs: [genePairs[1] as PrimerPair], checks: ['pangenome' as const] };
    const everything = buildCheckRequest({ ...base, genomes: [...all].reverse(), allGenomes: genomesResponse() });
    expect(everything.checks).toEqual(['specificity', 'pangenome']);
    expect(everything.genomes).toBeUndefined();
    const subset = buildCheckRequest({ ...base, genomes: ['sorghum_leoti', 'sorghum_bicolor', 'sorghum_353'], allGenomes: all });
    expect(subset.genomes).toEqual(['sorghum_353', 'sorghum_leoti']);
    const noList = buildCheckRequest({ ...base, genomes: all });
    expect(noList.genomes).toEqual(all);
    const specOnly = buildCheckRequest({ ...base, checks: ['specificity'], genomes: ['sorghum_353'] });
    expect(specOnly.genomes).toBeUndefined();
    expect(defaultPangenomeGenomes(genomesResponse(), 'transcript').map((g) => g.system_name)).toEqual(['sorghum_353', 'sorghum_leoti']);
  });

  it('sends only changed check params', () => {
    expect(changedCheckParams({ max_product_size: 4000, ignore_mismatches: 5, include_unlikely: true, three_prime_window: 5.5 })).toEqual({ ignore_mismatches: 5, include_unlikely: true });
    const req = buildCheckRequest({ mode: 'gene', systemName: 's', geneId: 'G', pairs: [genePairs[0] as PrimerPair], params: { min_3p_mismatches: 2, repeat_site_threshold: 10 } });
    expect(req.params).toEqual({ repeat_site_threshold: 10 });
  });

  it('max_amplifying_mismatches: integer 0–5, default 3, below ignore_mismatches, sent only when changed', () => {
    expect(CHECK_DEFAULTS.max_amplifying_mismatches).toBe(3);
    expect(CHECK_PARAM_LIMITS.max_amplifying_mismatches).toEqual({ min: 0, max: 5 });
    expect(validateCheckParams({ max_amplifying_mismatches: 0 })).toEqual([]);
    expect(validateCheckParams({ max_amplifying_mismatches: 6 }).map((i) => i.code)).toEqual(['OUT_OF_RANGE']);
    expect(validateCheckParams({ max_amplifying_mismatches: 2.5 }).map((i) => i.code)).toEqual(['NOT_AN_INTEGER']);
    // An omitted cap is lowered to ignore_mismatches − 1 by the server (check/normalize.js); only an explicit one can conflict.
    expect(validateCheckParams({ ignore_mismatches: 3 })).toEqual([]);
    expect(effectiveMaxAmplifyingMismatches({ ignore_mismatches: 3 })).toBe(2);
    expect(effectiveMaxAmplifyingMismatches({})).toBe(3);
    expect(effectiveMaxAmplifyingMismatches(null)).toBe(3);
    expect(effectiveMaxAmplifyingMismatches({ ignore_mismatches: 3, max_amplifying_mismatches: 1 })).toBe(1);
    expect(effectiveMaxAmplifyingMismatches({ max_amplifying_mismatches: 1.5 })).toBeNull();
    expect(validateCheckParams({ ignore_mismatches: 3, max_amplifying_mismatches: 3 })).toEqual([
      { field: 'max_amplifying_mismatches', code: 'NOT_BELOW_IGNORE_MISMATCHES', message: 'max_amplifying_mismatches (3) must be less than ignore_mismatches (3)' },
    ]);
    expect(validateCheckParams({ ignore_mismatches: 3, max_amplifying_mismatches: 2 })).toEqual([]);
    expect(validateCheckParams({ max_amplifying_mismatches: 5, ignore_mismatches: 5 }).map((i) => i.code)).toEqual(['NOT_BELOW_IGNORE_MISMATCHES']);
    expect(validateCheckParams({ max_amplifying_mismatches: 5 })).toEqual([]);
    expect(validateCheckParams({ max_amplifying_mismatches: 4, ignore_mismatches: 2.5 }).map((i) => i.code)).toEqual(['NOT_AN_INTEGER']);
    expect(changedCheckParams({ max_amplifying_mismatches: 3 })).toEqual({});
    const pair = genePairs[0] as PrimerPair;
    expect(buildCheckRequest({ mode: 'gene', systemName: 's', geneId: 'G', pairs: [pair], params: { max_amplifying_mismatches: 3 } }).params).toBeUndefined();
    expect(buildCheckRequest({ mode: 'gene', systemName: 's', geneId: 'G', pairs: [pair], params: { max_amplifying_mismatches: 2 } }).params).toEqual({ max_amplifying_mismatches: 2 });
  });

  it('a saved genome list is narrowed to the genomes the mode can search; genomes that left the catalog are dropped', () => {
    const base = { systemName: 'sorghum_bicolor', geneId: 'SORBI_3004G087700', checks: ['pangenome' as const], allGenomes: genomesResponse() };
    const tx = { ...base, mode: 'transcript' as const, transcriptId: 'SORBI_3004G087700.3', pairs: [qpcrCheckPair] };
    // Chosen in gene mode, checked in transcript mode: sorghum_grassl has no cDNA DB; sorghum_gone left the catalog.
    expect(buildCheckRequest({ ...tx, genomes: ['sorghum_353', 'sorghum_grassl', 'sorghum_gone'] }).genomes).toEqual(['sorghum_353']);
    // What remains is every searchable genome, so the list is omitted.
    expect(buildCheckRequest({ ...tx, genomes: ['sorghum_353', 'sorghum_grassl', 'sorghum_leoti'] }).genomes).toBeUndefined();
    expect(buildCheckRequest({ ...base, mode: 'gene', pairs: [genePairs[1] as PrimerPair], genomes: ['sorghum_nodb', 'sorghum_leoti'] }).genomes).toEqual(['sorghum_leoti']);
    const e = err(() => buildCheckRequest({ ...tx, genomes: ['sorghum_grassl'] }));
    expect(e.code).toBe('NO_GENOMES');
    expect(e.details).toEqual({ genomes: ['sorghum_grassl'] });
    expect(availableGenomeNames(genomesResponse(), 'transcript', 'sorghum_bicolor')).toEqual(['sorghum_353', 'sorghum_leoti']);
    expect(availableGenomeNames(genomesResponse().genomes, 'gene', 'sorghum_bicolor')).toEqual(['sorghum_353', 'sorghum_grassl', 'sorghum_leoti']);
    expect(availableGenomeNames(['b', 'a', 'a'], 'gene')).toEqual(['a', 'b']);
    expect(availableGenomeNames(null, 'gene')).toBeNull();
  });

  it('sequence mode raises max_product_size client-side for long designed products', () => {
    const short = buildCheckRequest({ mode: 'sequence', systemName: 's', pairs: [sequencePair(0, 300)] });
    expect(short.params).toBeUndefined();
    expect(short.pairs[0]?.expected).toBeUndefined();
    const long = buildCheckRequest({ mode: 'sequence', systemName: 's', pairs: [sequencePair(0, 300), sequencePair(1, 5000)] });
    expect(long.params).toEqual({ max_product_size: 6000 });
    const nearCap = buildCheckRequest({ mode: 'sequence', systemName: 's', pairs: [sequencePair(0, 9500)] });
    expect(nearCap.params).toEqual({ max_product_size: 10000 });
  });

  it('throws CheckRequestError for unusable selections', () => {
    const pair = genePairs[0] as PrimerPair;
    expect(err(() => buildCheckRequest({ mode: 'gene', systemName: '', geneId: 'G', pairs: [pair] })).code).toBe('NO_SYSTEM_NAME');
    expect(err(() => buildCheckRequest({ mode: 'transcript', systemName: 's', pairs: [pair] })).code).toBe('GENE_ID_REQUIRED');
    expect(err(() => buildCheckRequest({ mode: 'region', systemName: 's', pairs: [] })).code).toBe('NO_PAIRS');
    const eleven = Array.from({ length: 11 }, (_, i) => sequencePair(i, 200));
    expect(err(() => buildCheckRequest({ mode: 'sequence', systemName: 's', pairs: eleven })).code).toBe('TOO_MANY_PAIRS');
    const withN: PrimerPair = { ...pair, right: { ...pair.right, seq: 'GTGAACATCATGCTGCCCGANG' } };
    const e = err(() => buildCheckRequest({ mode: 'region', systemName: 's', pairs: [withN] }));
    expect(e).toBeInstanceOf(CheckRequestError);
    expect(e.code).toBe('PRIMER_NOT_CHECKABLE');
    expect(e.details).toEqual({ id: 'P1' });
    expect(err(() => buildCheckRequest({ mode: 'region', systemName: 's', pairs: [sequencePair(0, 12000)] })).code).toBe('PRODUCT_TOO_LONG_TO_CHECK');
    const manyGenomes = Array.from({ length: 151 }, (_, i) => `g${i}`);
    expect(err(() => buildCheckRequest({ mode: 'region', systemName: 's', pairs: [pair], checks: ['pangenome'], genomes: manyGenomes })).code).toBe('TOO_MANY_GENOMES');
  });
});

describe('checkMaxProductSize (mirrors the server raise rule)', () => {
  const pair = (start: number, end: number) => ({ id: 'P1', left: SEQS.P2_L, right: SEQS.P2_R, expected: { region: '4', start, end } });

  it('keeps the default when 1.2 × the largest expected size fits', () => {
    expect(checkMaxProductSize({ mode: 'gene', pairs: [pair(1, 3000)] })).toEqual({ requested: 4000, effective: 4000, raised: false, tooLong: false, largestExpected: 3000 });
  });

  it('raises to ceil(1.2 × largest), capped at 10000', () => {
    expect(checkMaxProductSize({ mode: 'region', pairs: [pair(1, 3500), pair(1, 100)] })).toMatchObject({ effective: 4200, raised: true });
    expect(checkMaxProductSize({ mode: 'gene', pairs: [pair(1, 9000)] })).toMatchObject({ effective: 10000, raised: true, tooLong: false });
    expect(checkMaxProductSize({ mode: 'gene', params: { max_product_size: 8000 }, pairs: [pair(1, 1000)] })).toMatchObject({ requested: 8000, effective: 8000, raised: false });
    expect(checkMaxProductSize({ mode: 'gene', params: { max_product_size: 200 }, pairs: [pair(1, 210)] })).toMatchObject({ effective: 252, raised: true });
  });

  it('flags expected products over 10 kb and ignores expected outside gene/region', () => {
    expect(checkMaxProductSize({ mode: 'gene', pairs: [pair(1, 10001)] })).toMatchObject({ tooLong: true, largestExpected: 10001 });
    expect(checkMaxProductSize({ mode: 'transcript', pairs: [pair(1, 9000)] })).toMatchObject({ effective: 4000, raised: false, largestExpected: null });
    expect(checkMaxProductSize({ pairs: [pair(1, 9000)] })).toMatchObject({ effective: 10000, raised: true });
  });
});
