import { describe, expect, it } from 'vitest';
import {
  CDNA_GB_ESTIMATE,
  CPU_S_PER_PRIMER_GB,
  estimateCheckCpu,
  FALLBACK_GENOME_GB,
  MAX_JOB_CPU_S,
  PANGENOME_CPU_FACTOR,
  REALIGN_CPU_S_PER_PRIMER_TASK,
} from '../src/cost';
import { genePairs } from './fixtures/samples';

const BICOLOR = 708_735_318;
const R = REALIGN_CPU_S_PER_PRIMER_TASK;
const F = PANGENOME_CPU_FACTOR;

describe('estimateCheckCpu (mirrors check/cost.js, spec §B.13)', () => {
  it('uses the server coefficients and limits', () => {
    expect(CPU_S_PER_PRIMER_GB).toEqual({ 5: 5.2, 6: 2.2, 7: 1.2 });
    expect(CDNA_GB_ESTIMATE).toBe(0.15);
    expect(MAX_JOB_CPU_S).toBe(6000);
    // Must equal DEFAULT_REALIGN_CPU_S_PER_PRIMER_TASK, DEFAULT_PANGENOME_CPU_FACTOR and FALLBACK_GENOME_GB
    // in gramene-swagger api/helpers/primers/check/cost.js.
    expect(REALIGN_CPU_S_PER_PRIMER_TASK).toBe(0.6);
    expect(PANGENOME_CPU_FACTOR).toBe(2);
    expect(FALLBACK_GENOME_GB).toBe(1);
  });

  it('specificity only, 10 primers on sorghum_bicolor: ≈ 37 CPU-s of BLAST plus re-alignment of one genome task', () => {
    const e = estimateCheckCpu({ primers: 10, mode: 'gene', referenceTotalBases: BICOLOR });
    expect(e.reference_cpu_s).toBeCloseTo(10 * 0.708735318 * 5.2, 6);
    expect(e.realign_cpu_s).toBeCloseTo(10 * 1 * R, 9);
    expect(e.cpu_s).toBe(Math.ceil(10 * 0.708735318 * 5.2 + 10 * R));
    expect(e.cpu_s).toBe(43);
    expect(e).toMatchObject({ transcriptome_cpu_s: 0, pangenome_cpu_s: 0, genome_tasks: 1, unique_primers: 10, genomes: 0, over_limit: false, limit: 6000 });
  });

  it('transcript mode adds the reference cDNA at word size 5; cDNA searches are not charged for re-alignment', () => {
    const e = estimateCheckCpu({ primers: 10, mode: 'transcript', referenceTotalBases: BICOLOR });
    expect(e.transcriptome_cpu_s).toBeCloseTo(10 * 0.15 * 5.2, 6);
    expect(e.genome_tasks).toBe(1);
    expect(e.cpu_s).toBe(Math.ceil(10 * 0.708735318 * 5.2 + 10 * 0.15 * 5.2 + 10 * 1 * R));
  });

  it('pan-genome over 119 sorghum-sized genomes at ws6 with the factor: 10 primers stay under the cap, 20 primers exceed it', () => {
    const pan = Array.from({ length: 119 }, () => ({ total_bases: 700_000_000 }));
    const e10 = estimateCheckCpu({ primers: 10, mode: 'gene', referenceTotalBases: BICOLOR, pangenome: pan });
    expect(e10.pangenome_cpu_s).toBeCloseTo(10 * 119 * 0.7 * 2.2 * F, 6);
    expect(e10.genome_tasks).toBe(120);
    expect(e10.realign_cpu_s).toBeCloseTo(10 * 120 * R, 6);
    expect(e10.cpu_s).toBe(Math.ceil(10 * 0.708735318 * 5.2 + 10 * 119 * 0.7 * 2.2 * F + 10 * 120 * R));
    expect(e10.over_limit).toBe(false);
    const e20 = estimateCheckCpu({ primers: 20, mode: 'gene', referenceTotalBases: BICOLOR, pangenome: pan });
    expect(e20.over_limit).toBe(true);
    expect(e20.cpu_s).toBeGreaterThan(6000);
  });

  it('transcript-mode pan-genome uses the cDNA estimate per genome and adds no re-alignment per genome', () => {
    const pan = Array.from({ length: 119 }, () => 700_000_000);
    const e = estimateCheckCpu({ primers: 10, mode: 'transcript', referenceTotalBases: BICOLOR, pangenome: pan });
    expect(e.pangenome_cpu_s).toBeCloseTo(10 * 119 * 0.15 * 2.2 * F, 6);
    expect(e.genome_tasks).toBe(1);
    expect(e.realign_cpu_s).toBeCloseTo(10 * R, 9);
  });

  it('flags jobs over 6000 CPU-s', () => {
    const pan = Array.from({ length: 150 }, () => 2_000_000_000);
    const e = estimateCheckCpu({ primers: 20, mode: 'gene', referenceTotalBases: BICOLOR, pangenome: pan });
    expect(e.over_limit).toBe(true);
    expect(e.cpu_s).toBeGreaterThan(6000);
  });

  it('deduplicates primers case-insensitively from pairs or strings', () => {
    const fromPairs = estimateCheckCpu({ primers: [...genePairs, genePairs[0]!], referenceTotalBases: 1e9 });
    expect(fromPairs.unique_primers).toBe(6);
    const fromStrings = estimateCheckCpu({ primers: ['acgt', 'ACGT', 'TTTT'], referenceTotalBases: 1e9 });
    expect(fromStrings.unique_primers).toBe(2);
    expect(fromStrings.cpu_s).toBe(Math.ceil(2 * 5.2 + 2 * R));
  });

  it('charges unknown genome sizes as 1 Gb like the server and supports other word sizes', () => {
    const e = estimateCheckCpu({ primers: 1, referenceTotalBases: 2e9, pangenome: [null, { total_bases: null }, 5e8], wordSizePangenome: 7 });
    expect(e.pangenome_cpu_s).toBeCloseTo((1 + 1 + 0.5) * 1.2 * F, 6);
    // Unknown reference size: server check/cost.js charges 1 Gb, i.e. ceil(2 × 1 × 5.2 + 2 × 0.6) = 12.
    expect(estimateCheckCpu({ primers: 2, referenceTotalBases: null }).cpu_s).toBe(12);
    expect(estimateCheckCpu({ primers: 0, referenceTotalBases: 1e9 }).cpu_s).toBe(0);
  });

  it('rounds up like the server: float noise below 1e-6 does not add a CPU-second', () => {
    // 1 primer at ws7 (1.2 CPU-s per Gb): reference bases chosen so the total is 2 + 1e-7 (→ 2) or 2 + 2e-6 (→ 3).
    const bases = (excess: number) => Math.round(((2 - R + excess) / 1.2) * 1e9);
    expect(estimateCheckCpu({ primers: 1, referenceTotalBases: bases(1e-7), wordSizeReference: 7 }).cpu_s).toBe(2);
    expect(estimateCheckCpu({ primers: 1, referenceTotalBases: bases(2e-6), wordSizeReference: 7 }).cpu_s).toBe(3);
  });
});
