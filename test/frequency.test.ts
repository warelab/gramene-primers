import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  alleleShare,
  bestPopulation,
  dedupePopulations,
  minorAlleleFrequency,
  populationCounts,
  populationsOf,
  variantAllele,
} from '../src/frequency';
import type { PopulationFrequency, VariantEntry, VariantListResponse } from '../src/types';
import { pkgPath } from './paths';

/** A recorded `POST /variation/sorghum_bicolor?pops=1`, quirks and all. */
const capture = JSON.parse(
  readFileSync(pkgPath('test', 'fixtures', 'genotyping', 'capture-ensembl-variation-pops.json'), 'utf8'),
) as {
  response: Record<string, { MAF: number | null; mappings: Array<{ allele_string: string }>; populations: PopulationFrequency[] }>;
};

const variantList = (
  JSON.parse(readFileSync(pkgPath('test', 'fixtures', 'genotyping', 'capture-variants-list-1_11180-11290.json'), 'utf8')) as {
    response: VariantListResponse;
  }
).response;

/**
 * The mapping the host adapter performs: Ensembl spells the tally
 * `allele_count`, while the callback contract asks for `count`, so that a host
 * with some other frequency source is not made to speak Ensembl.
 */
const fromEnsembl = (rows: ReadonlyArray<Record<string, unknown>>): PopulationFrequency[] =>
  rows.map((r) => ({
    population: String(r.population),
    allele: String(r.allele),
    frequency: Number(r.frequency),
    count: r.allele_count === undefined || r.allele_count === null ? null : Number(r.allele_count),
  }));

const rowsFor = (id: string) => fromEnsembl(capture.response[id]!.populations as unknown as Array<Record<string, unknown>>);

describe('dedupePopulations', () => {
  it('collapses the repeats the source sends', () => {
    // rs871475760 arrives with SAP four times over, identically.
    const raw = rowsFor('rs871475760');
    expect(raw.length).toBe(12);
    const clean = dedupePopulations(raw);
    expect(clean.length).toBe(6);
    expect(new Set(clean.map((r) => `${r.population}/${r.allele}`)).size).toBe(clean.length);
    // The figures themselves are untouched.
    expect(clean.find((r) => r.population === 'SAP' && r.allele === 'A')).toMatchObject({ frequency: 0.35125 });
  });

  it('drops rows it cannot use rather than inventing numbers', () => {
    const rows = [
      { population: 'P', allele: 'A', frequency: 0.5, count: 10 },
      { population: 'P', allele: 'C', frequency: Number.NaN, count: 1 },
      { population: 'P', allele: 'G', frequency: 'nonsense', count: 1 },
      { allele: 'T', frequency: 0.1, count: 1 },
    ] as unknown as PopulationFrequency[];
    expect(dedupePopulations(rows)).toEqual([{ population: 'P', allele: 'A', frequency: 0.5, count: 10 }]);
  });

  it('keeps a missing count as null instead of zero', () => {
    const rows = [{ population: 'P', allele: 'A', frequency: 0.5, count: null }] as PopulationFrequency[];
    expect(dedupePopulations(rows)[0]!.count).toBeNull();
  });

  it('survives nothing at all', () => {
    expect(dedupePopulations(null)).toEqual([]);
    expect(dedupePopulations(undefined)).toEqual([]);
  });
});

describe('variantAllele', () => {
  /**
   * The load-bearing one. Ensembl writes a deletion `A/-`, as the listing's
   * `minimal` block does; its VCF form carries an anchor base (`CA>C`) that no
   * frequency row will ever match.
   */
  it('matches an indel on the minimal allele, never on the VCF one', () => {
    const deletion = variantList.variants.find((v) => v.kind === 'deletion')!;
    expect(deletion.vcf.alt).toBe('C');
    expect(variantAllele(deletion)).toBe('-');

    const rows = rowsFor('rs5413864115');
    expect(capture.response['rs5413864115']!.mappings[0]!.allele_string).toBe('A/-');
    // The minimal allele finds a figure; the VCF allele finds nothing.
    expect(alleleShare(rows, 'SAP', variantAllele(deletion))).toMatchObject({ frequency: 0.0575 });
    expect(alleleShare(rows, 'SAP', deletion.vcf.alt)).toBeNull();
  });

  it('reads a substitution straight off the minimal block', () => {
    const snv = variantList.variants.find((v) => v.vcf.position === 11182)!;
    expect(variantAllele(snv)).toBe('G');
  });

  it('falls back to the allele list, and gives up rather than guessing', () => {
    expect(variantAllele({ minimal: undefined, alleles: ['C', 'T'] } as unknown as VariantEntry)).toBe('T');
    expect(variantAllele({ minimal: undefined, alleles: [] } as unknown as VariantEntry)).toBeNull();
  });
});

describe('alleleShare', () => {
  it('reports the frequency and the count a population gives', () => {
    expect(alleleShare(rowsFor('rs871475760'), 'Lozano_study', 'A')).toEqual({ frequency: 0.26332, count: 257 });
  });

  it('is null for a population that says nothing about this variant', () => {
    expect(alleleShare(rowsFor('tmp_1_11193_C_T'), 'SAP', 'T')).toBeNull();
    expect(alleleShare(rowsFor('rs871475760'), 'Lozano_study', null)).toBeNull();
  });
});

describe('minorAlleleFrequency', () => {
  it('works it out, since the source reports MAF as null', () => {
    expect(capture.response['rs871475760']!.MAF).toBeNull();
    expect(minorAlleleFrequency(rowsFor('rs871475760'), 'SAP')).toBeCloseTo(0.35125, 5);
    expect(minorAlleleFrequency(rowsFor('rs871475760'), 'BAP')).toBeCloseTo(0.215068, 5);
  });

  it('catches the near-fixed variant that makes a poor marker', () => {
    // 1 line in 180 carries the alternate allele.
    expect(minorAlleleFrequency(rowsFor('tmp_1_11193_C_T'), 'USDA-Lubbock-EMS3')).toBeCloseTo(0.00555556, 6);
  });

  it('is null where one allele alone is reported', () => {
    const rows = [{ population: 'P', allele: 'A', frequency: 1, count: 10 }] as PopulationFrequency[];
    expect(minorAlleleFrequency(rows, 'P')).toBeNull();
    expect(minorAlleleFrequency(rowsFor('rs871475760'), 'Nowhere')).toBeNull();
  });
});

describe('populations across a listing', () => {
  const byId = new Map(Object.entries(capture.response).map(([id, v]) => [id, v.populations]));

  it('lists a variant’s populations once each', () => {
    expect(populationsOf(rowsFor('rs871475760'))).toEqual(['BAP', 'Lozano_study', 'SAP']);
  });

  it('counts how many variants each population covers, widest first', () => {
    const counts = populationCounts(byId);
    expect(counts.map(([p]) => p)).toContain('SAP');
    const values = counts.map(([, n]) => n);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
    // Every count is a real tally of the five captured variants.
    for (const [, n] of counts) expect(n).toBeGreaterThan(0);
  });

  it('defaults to the population covering the most of them', () => {
    const best = bestPopulation(byId)!;
    const counts = new Map(populationCounts(byId));
    for (const [, n] of counts) expect(counts.get(best)!).toBeGreaterThanOrEqual(n);
  });

  it('has no default when nothing is annotated', () => {
    expect(bestPopulation(new Map())).toBeNull();
  });
});
