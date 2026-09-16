import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { estimateCheckCpu, GENOTYPE_CPU_S_PER_GENOME } from '../src/cost';
import { alleleMatrixRows, isDisagreement, summarizeGenotypeGenomes } from '../src/genotyping';
import { changedGenotypingAssay, changedGenotypingParams, effectiveGenotypingAssay, GENOTYPING_FLOORS, GENOTYPING_LEVEL0_PARAMS } from '../src/presets';
import { buildGenotypingCheckRequest, buildGenotypingRequest, CheckRequestError, GENOTYPING_CHECK_LIMITS } from '../src/request';
import { designSetTriple, matchGenotypingResults, submittedGenotypingSets } from '../src/results';
import { genotypeCallsToTSV, orderRowsToFasta, orderSheetToTSV } from '../src/exporters';
import { normalizeDesignerState } from '../src/state';
import type { CheckJob, GenomesResponse, GenotypeResults, GenotypingDesignResponse, GenotypingSet, PrimerDesignerState, VariantListResponse } from '../src/types';
import { validateGenotypingParams, validateVariantInput } from '../src/validate';
import { pkgPath } from './paths';

/** A recorded response from the API session (`{source, request, status, response}`). */
function capture<T>(name: string): T {
  const raw = JSON.parse(readFileSync(pkgPath('test', 'fixtures', 'genotyping', `${name}.json`), 'utf8')) as { response: T };
  return raw.response;
}

const kasp = capture<GenotypingDesignResponse>('capture-genotyping-design-rs871475760-kasp');
const insertion = capture<GenotypingDesignResponse>('capture-genotyping-design-tmp_1_11502_C_CGT');
const variantList = capture<VariantListResponse>('capture-variants-list-1_11180-11290');
const checkJob = capture<CheckJob>('capture-check-genotyping-result');

const genomesFixture = capture<GenomesResponse>('capture-genomes-sorghum_bicolor');
const REFERENCE = 'sorghum_bicolor';
/** The real panel, so the mirrored estimate is compared against the server's own sizes. */
const panel = () => genomesFixture.genomes.filter((g) => g.system_name !== REFERENCE && g.has_blastdb);
const REFERENCE_BASES = genomesFixture.genomes.find((g) => g.system_name === REFERENCE)?.total_bases ?? null;

/**
 * `count` sets sharing `distinctCommons` common primers, cloned from the KASP
 * capture so the check block keeps its real shape. Unique primers come to
 * `2 × count + distinctCommons`, which is how a selection reaches 13 or 14.
 */
function clonedSets(count: number, distinctCommons: number): GenotypingSet[] {
  const template = kasp.sets[0]!;
  const commonSeq = template.primers.common.target_seq;
  const refSeq = template.primers.as_ref.target_seq;
  const refPairId = template.check!.set.ref_pair;
  const commons = Array.from({ length: distinctCommons }, (_, i) => `${commonSeq.slice(0, -2)}${'ACGT'[i % 4]}${i}`);
  return Array.from({ length: count }, (_, i) => {
    const s = JSON.parse(JSON.stringify(template)) as GenotypingSet;
    s.key = String(i).repeat(12).slice(0, 12);
    const common = commons[i % distinctCommons]!;
    const plan = s.check!;
    plan.set.id = `S${i + 1}`;
    for (const p of plan.pairs) {
      const isRef = p.id === refPairId;
      p.id = `${isRef ? 'R' : 'A'}${i}`;
      const as = `${refSeq.slice(0, -2)}${isRef ? 'C' : 'G'}${i}`;
      if (p.left === commonSeq) {
        p.left = common;
        p.right = as;
      } else {
        p.left = as;
        p.right = common;
      }
    }
    plan.set.ref_pair = `R${i}`;
    plan.set.alt_pair = `A${i}`;
    return s;
  });
}

describe('genotyping request builders', () => {
  const baseState = (genotyping: PrimerDesignerState['genotyping']): PrimerDesignerState => ({
    v: 1,
    mode: 'genotyping',
    systemName: 'sorghum_bicolor',
    genotyping,
  });

  it('designs from the VCF key, not the id, and sends only changed assay fields', () => {
    const req = buildGenotypingRequest(baseState({ variantId: 'rs871475760', variantKey: '1:11109:C:A', assay: { type: 'kasp', num_sets: 2 } }));
    expect(req).toEqual({
      system_name: 'sorghum_bicolor',
      variant: { region: '1', position: 11109, ref: 'C', alt: 'A' },
      assay: { num_sets: 2 },
    });
  });

  it('falls back to an id (with the chosen allele), and to a manual variant', () => {
    expect(buildGenotypingRequest(baseState({ variantId: 'rs871475760', alt: 'A' }))?.variant).toEqual({ id: 'rs871475760', alt: 'A' });
    expect(buildGenotypingRequest(baseState({ manual: { region: '1', position: 11283, ref: 'A', alt: '-' } }))?.variant).toEqual({
      region: '1',
      position: 11283,
      ref: 'A',
      alt: '-',
    });
    expect(buildGenotypingRequest(baseState({}))).toBeNull();
  });

  it('sends every param the user edits, because the server pins them', () => {
    const req = buildGenotypingRequest(baseState({ variantKey: '1:11109:C:A', params: { max_size: 30, opt_tm: 60 } }));
    // 30 and 60 equal the level-0 preset, and are still sent: a pinned param is never relaxed.
    expect(req?.params).toEqual({ max_size: 30, opt_tm: 60 });
    expect(GENOTYPING_LEVEL0_PARAMS.max_size).toBe(30);
  });

  it('builds the check body from the sets, with target sequences and the genotyping block', () => {
    const req = buildGenotypingCheckRequest({
      sets: kasp.sets,
      variant: kasp.variant,
      systemName: 'sorghum_bicolor',
      mode: 'region',
      checks: ['specificity', 'pangenome'],
    });
    expect(req).toEqual(kasp.check?.request);
    expect(req.pairs).toHaveLength(4);
    expect(req.genotyping?.sets.map((s) => s.id)).toEqual(['S1', 'S2']);
    // A tail is never checked. The common primer is untailed, so its order_seq
    // and target_seq are the same string — only a genuine tail disqualifies.
    const tailed = new Set((kasp.sets ?? []).flatMap((s) => (s.order ?? []).filter((o) => o.order_seq !== o.target_seq).map((o) => o.order_seq)));
    const targets = new Set((kasp.sets ?? []).flatMap((s) => (s.order ?? []).map((o) => o.target_seq)));
    expect(tailed.size).toBe(4); // both allele-specific primers of both sets
    for (const p of req.pairs) {
      for (const seq of [p.left, p.right]) {
        expect(tailed.has(seq)).toBe(false);
        expect(targets.has(seq)).toBe(true);
      }
    }
    // Each set's two pairs share the common primer and differ in the allele-specific one.
    const byId = new Map(req.pairs.map((p) => [p.id, p]));
    for (const s of req.genotyping?.sets ?? []) {
      const ref = byId.get(s.ref_pair);
      const alt = byId.get(s.alt_pair);
      expect([ref, alt].every(Boolean)).toBe(true);
      const shared = [ref!.left, ref!.right].filter((x) => x === alt!.left || x === alt!.right);
      expect(shared).toHaveLength(1);
    }
  });

  it('refuses more than five sets', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...kasp.sets[0]!, id: `S${i + 1}`, key: `${i}`.repeat(12) }));
    expect(() => buildGenotypingCheckRequest({ sets: many, variant: kasp.variant, systemName: 'sorghum_bicolor' })).toThrow(CheckRequestError);
    expect(GENOTYPING_CHECK_LIMITS).toEqual({ maxSets: 5, maxPairs: 10, maxUniquePrimers: 20 });
  });
});

describe('genotyping cost mirror', () => {
  it('charges 0.2 CPU-s per genome task on top of the ordinary terms', () => {
    const input = { primers: 6, mode: 'region' as const, referenceTotalBases: REFERENCE_BASES, pangenome: panel() };
    const without = estimateCheckCpu(input);
    const with_ = estimateCheckCpu({ ...input, genotyping: true });
    expect(with_.genotyping_cpu_s).toBeCloseTo(120 * GENOTYPE_CPU_S_PER_GENOME, 6);
    expect(with_.cpu_s - without.cpu_s).toBe(24);
    expect(without.cpu_s).toBe(2666);
    expect(with_.cpu_s).toBe(2690);
  });

  it('matches the documented figures, and 14 distinct primers exceed the limit', () => {
    const panelInput = (primers: number) => ({ primers, mode: 'region' as const, referenceTotalBases: REFERENCE_BASES, pangenome: panel(), genotyping: true });
    expect(estimateCheckCpu(panelInput(3)).cpu_s).toBe(1357);
    expect(estimateCheckCpu(panelInput(12)).cpu_s).toBe(5356);
    const thirteen = estimateCheckCpu(panelInput(13));
    const fourteen = estimateCheckCpu(panelInput(14));
    expect(thirteen.cpu_s).toBe(5800);
    expect(thirteen.over_limit).toBe(false);
    expect(fourteen.cpu_s).toBe(6245);
    expect(fourteen.over_limit).toBe(true);
  });

  it('a three-genome check stays far under the limit', () => {
    const three = estimateCheckCpu({ primers: 6, mode: 'region', referenceTotalBases: REFERENCE_BASES, pangenome: [1e9, 1e9, 1e9], genotyping: true });
    expect(three.over_limit).toBe(false);
  });
});

describe('the cost guard', () => {
  const build = (sets: GenotypingSet[], over: Partial<Parameters<typeof buildGenotypingCheckRequest>[0]> = {}) =>
    buildGenotypingCheckRequest({
      sets,
      variant: kasp.variant,
      systemName: REFERENCE,
      mode: 'region',
      checks: ['specificity', 'pangenome'],
      allGenomes: genomesFixture,
      ...over,
    });

  it('allows 13 distinct primers over the full panel and refuses 14', () => {
    expect(clonedSets(5, 3)).toHaveLength(5);
    expect(() => build(clonedSets(5, 3))).not.toThrow(); // 5,800 CPU-s
    let err: unknown;
    try {
      build(clonedSets(5, 4));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CheckRequestError);
    expect((err as CheckRequestError).code).toBe('OVER_CPU_LIMIT');
    expect((err as CheckRequestError).details).toMatchObject({ estimate_cpu_s: 6245, limit: 6000 });
  });

  it('blocks on the cost, not the primer count: the same 14 primers pass on three genomes', () => {
    const subset = panel().slice(0, 3).map((g) => g.system_name);
    expect(() => build(clonedSets(5, 4), { genomes: subset })).not.toThrow();
  });

  it('cannot price a job when the host passed only genome names, so it does not block one', () => {
    expect(() => build(clonedSets(5, 4), { allGenomes: genomesFixture.genomes.map((g) => g.system_name) })).not.toThrow();
  });

  it('cannot reach the 20-primer cap: a set is three primers, so five sets is fifteen', () => {
    // The server makes a set's two pairs share exactly one primer, so the primer
    // cap is structurally unreachable here however the sets are chosen.
    const req = build(clonedSets(5, 5), { genomes: panel().slice(0, 3).map((g) => g.system_name) });
    const distinct = new Set(req.pairs.flatMap((p) => [p.left.toUpperCase(), p.right.toUpperCase()]));
    expect(req.pairs).toHaveLength(GENOTYPING_CHECK_LIMITS.maxPairs);
    expect(distinct.size).toBe(15);
    expect(distinct.size).toBeLessThan(GENOTYPING_CHECK_LIMITS.maxUniquePrimers);
  });

  it('still reports a count cap when that is what binds', () => {
    let err: unknown;
    try {
      build(clonedSets(6, 4));
    } catch (e) {
      err = e;
    }
    expect((err as CheckRequestError).code).toBe('TOO_MANY_SETS');
  });
});

describe('matching results to sets', () => {
  it('matches by target-sequence triple, so a re-design that renumbers sets still lines up', () => {
    const results = (checkJob.results?.genotyping ?? null) as GenotypeResults | null;
    expect(results).not.toBeNull();
    // The design's S1/S2 renamed and reordered: only the sequences identify them.
    const renumbered = [
      { ...kasp.sets[1]!, id: 'S9', key: 'aaaaaaaaaaaa' },
      { ...kasp.sets[0]!, id: 'S7', key: 'bbbbbbbbbbbb' },
    ];
    const matched = matchGenotypingResults(renumbered, checkJob);
    expect(matched.bySetKey.get('bbbbbbbbbbbb')?.id).toBe('S1');
    expect(matched.bySetKey.get('aaaaaaaaaaaa')?.id).toBe('S2');
    expect(matched.bySetKey.get('bbbbbbbbbbbb')?.results?.summary.agree).toBe(11);
    expect(matched.notChecked).toEqual([]);
    expect(matched.orphanIds).toEqual([]);
  });

  it('reports designed sets that were never checked, and submitted sets that are gone', () => {
    const stranger = { ...insertion.sets[0]!, key: 'cccccccccccc' };
    const matched = matchGenotypingResults([stranger], checkJob);
    expect(matched.notChecked).toEqual(['cccccccccccc']);
    expect(matched.orphanIds.sort()).toEqual(['S1', 'S2']);
  });

  it('keeps submitted sets by uppercase target sequence', () => {
    const submitted = submittedGenotypingSets(kasp.check!.request);
    expect(submitted).toHaveLength(2);
    expect(submitted[0]?.ref.left).toBe(kasp.sets[0]?.primers.common.target_seq.toUpperCase());
    expect(designSetTriple(kasp.sets[0]!)).toContain(kasp.sets[0]!.primers.as_ref.target_seq.toUpperCase());
  });
});

describe('allele matrix and summaries', () => {
  const results = checkJob.results!.genotyping as GenotypeResults;

  it('puts the reference first, keeps it out of the summary, and grows with a partial job', () => {
    const rows = alleleMatrixRows(results, ['sorghum_not_yet_searched']);
    expect(rows[0]?.is_reference).toBe(true);
    expect(rows[rows.length - 1]).toMatchObject({ system_name: 'sorghum_not_yet_searched', genome: null, allele: null });
    const summary = summarizeGenotypeGenomes(results.genomes);
    expect(summary).toMatchObject({ genomes_total: 11, ref: 6, alt: 5 });
    expect(results.summary.genomes_total).toBe(11);
  });

  it('never counts a null `agrees` as a disagreement', () => {
    expect(isDisagreement({ agrees: false })).toBe(true);
    expect(isDisagreement({ agrees: null })).toBe(false);
    expect(isDisagreement({ agrees: true })).toBe(false);
  });
});

describe('genotyping exports', () => {
  it('writes the order sheet with both sequences, the mix and the submission string', () => {
    const tsv = orderSheetToTSV(kasp.sets, { kaspMix: kasp.assay.kasp_mix, submissionSequence: kasp.variant.submission_sequence });
    const lines = tsv.trim().split('\n');
    expect(lines[0]).toMatch(/^# KASP mix: 12 µL REF \+ 12 µL ALT \+ 30 µL common at 100 µM/);
    expect(lines[1]).toMatch(/^# Submission sequence: /);
    expect(lines[2]?.split('\t')).toContain('order_seq');
    // Three rows per set, REF, ALT then common.
    expect(lines).toHaveLength(3 + kasp.sets.length * 3);
    const first = lines[3]!.split('\t');
    expect(first[0]).toBe('rs871475760_S1_REF_FAM');
    expect(first[6]).toBe(kasp.sets[0]?.order[0]?.order_seq);
    expect(first[7]).toBe(kasp.sets[0]?.order[0]?.target_seq);
  });

  it('names FASTA records from the unique order names', () => {
    const fasta = orderRowsToFasta(kasp.sets);
    const names = fasta.split('\n').filter((l) => l.startsWith('>')).map((l) => l.slice(1).split(' ')[0]);
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
  });

  it('writes one genotype-call row per genome and set, leaving null strength empty', () => {
    const tsv = genotypeCallsToTSV(checkJob.results!.genotyping);
    const lines = tsv.trim().split('\n');
    expect(lines).toHaveLength(1 + 12 * 2);
    const header = lines[0]!.split('\t');
    expect(header).toEqual(expect.arrayContaining(['allele', 'predicted', 'strength', 'agrees', 'off_locus_products']));
    const reference = lines[1]!.split('\t');
    expect(reference[0]).toBe('sorghum_bicolor');
    expect(reference[2]).toBe('true');
  });
});

describe('genotyping validation and state', () => {
  it('requires either an id or a manual variant, with distinct valid alleles', () => {
    expect(validateVariantInput({ id: 'rs871475760' })).toEqual([]);
    expect(validateVariantInput({ region: '1', position: 11109, ref: 'C', alt: 'A' })).toEqual([]);
    expect(validateVariantInput({ id: 'rs1', region: '1', position: 1, ref: 'C', alt: 'A' })[0]?.code).toBe('ID_OR_MANUAL');
    expect(validateVariantInput({})[0]?.code).toBe('REQUIRED');
    expect(validateVariantInput({ region: '1', position: 11109, ref: 'C', alt: 'C' }).some((i) => i.code === 'REF_EQUALS_ALT')).toBe(true);
    expect(validateVariantInput({ region: '1', position: 11109, ref: 'X', alt: 'A' }).some((i) => i.code === 'INVALID_ALLELE')).toBe(true);
    expect(validateVariantInput({ region: '1', position: 0, ref: 'C', alt: 'A' }).some((i) => i.code === 'INVALID_POSITION')).toBe(true);
  });

  it('explains that no product is shorter than 2 × max_size + 1', () => {
    const issues = validateGenotypingParams({ max_size: 30, product_size_ranges: [[40, 50]] });
    expect(issues.some((i) => i.code === 'BELOW_EFFECTIVE_MINIMUM' && i.message.includes('61'))).toBe(true);
    expect(validateGenotypingParams({ max_size: 30, product_size_ranges: [[61, 120]] })).toEqual([]);
  });

  it('keeps assay defaults per type and reports only real changes', () => {
    expect(effectiveGenotypingAssay({ type: 'as_pcr' })).toMatchObject({ tails: 'none', deliberate_mismatch: 'auto' });
    expect(effectiveGenotypingAssay(null)).toMatchObject({ type: 'kasp', tails: 'ref_fam_alt_hex', num_sets: 6 });
    expect(changedGenotypingAssay({ type: 'kasp', num_sets: 6 })).toEqual({});
    expect(changedGenotypingAssay({ type: 'as_pcr', orientation: 'reverse' })).toEqual({ type: 'as_pcr', orientation: 'reverse' });
    expect(changedGenotypingParams({ max_size: 999 })).toEqual({});
    expect(GENOTYPING_FLOORS).toEqual({ as_min_tm: 52, as_min_gc: 15 });
  });

  it('restores a genotyping slice and drops what it does not recognise', () => {
    const saved = {
      v: 1,
      mode: 'genotyping',
      systemName: 'sorghum_bicolor',
      genotyping: {
        variantKey: '1:11109:C:A',
        variantId: 'rs871475760',
        assay: { type: 'kasp', num_sets: 2, orientation: 'sideways' },
        params: { max_size: 30, bogus: 5 },
        checkedSetKeys: ['f9df650ad116', 'nope', '1accc54c262d'],
        selectedSetKey: 'f9df650ad116',
        designed: true,
        view: { tab: 'alleles' },
        check: { checks: ['specificity', 'pangenome'], jobId: '8e9160d598f602137d94efa9fc409264' },
      },
    };
    const state = normalizeDesignerState(saved, { systemName: 'sorghum_bicolor', modes: ['genotyping'] });
    expect(state.mode).toBe('genotyping');
    expect(state.genotyping).toEqual({
      variantKey: '1:11109:C:A',
      variantId: 'rs871475760',
      assay: { type: 'kasp', num_sets: 2 },
      params: { max_size: 30 },
      checkedSetKeys: ['f9df650ad116', '1accc54c262d'],
      selectedSetKey: 'f9df650ad116',
      designed: true,
      view: { tab: 'alleles' },
      check: { checks: ['specificity', 'pangenome'], jobId: '8e9160d598f602137d94efa9fc409264' },
    });
    expect(state.v).toBe(1);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('an older build ignores a genotyping state it cannot show', () => {
    const state = normalizeDesignerState({ v: 1, mode: 'genotyping', genotyping: { variantKey: '1:11109:C:A' } }, { gene: undefined, systemName: 'sorghum_bicolor' });
    // `modes` not offering genotyping: the mode falls back, and the slice is kept but unused.
    expect(state.mode).not.toBe('genotyping');
  });

  it('lists variants with their designability and issues', () => {
    expect(variantList.variants).toHaveLength(4);
    expect(variantList.variants.filter((v) => v.ems)).toHaveLength(2);
    expect(variantList.variants.find((v) => v.kind === 'deletion')?.shift).toBe(2);
  });
});
