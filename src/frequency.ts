/**
 * Allele frequency for listed variants.
 *
 * How common an allele is decides whether a variant is worth typing at all: a
 * marker near fixation in the panel you mean to screen tells you nothing,
 * however well its primers score. The frequencies come from the host, which
 * reads them from the same Ensembl release the variants came from.
 *
 * Three things about the upstream data shape this module:
 *
 *  - rows repeat, the same population and allele several times over;
 *  - `MAF` and `minor_allele` arrive null even where the population rows carry
 *    real frequencies, so a minor-allele frequency has to be worked out here;
 *  - alleles are written the way the listing's `minimal` block writes them —
 *    a deletion is `A/-`, not the VCF `CA>C` — so that is what a variant must
 *    be matched on.
 */

import type { PopulationFrequency, VariantEntry } from './types';

/** One population's figure for one allele. */
export interface AlleleShare {
  frequency: number;
  /** Chromosomes counted, where the source reports it. */
  count: number | null;
}

/** Keeps rows that are actually usable, and drops repeats of the same population and allele. */
export function dedupePopulations(rows: ReadonlyArray<PopulationFrequency> | null | undefined): PopulationFrequency[] {
  const seen = new Map<string, PopulationFrequency>();
  for (const row of rows ?? []) {
    if (!row || typeof row.population !== 'string' || typeof row.allele !== 'string') continue;
    const frequency = Number(row.frequency);
    if (!Number.isFinite(frequency)) continue;
    // Neither a population name nor an allele ever contains a pipe.
    const key = `${row.population}|${row.allele}`;
    if (seen.has(key)) continue;
    // `Number(null)` is 0, which would report a real count of nought.
    const raw = row.count;
    const count = raw === null || raw === undefined ? Number.NaN : Number(raw);
    seen.set(key, {
      population: row.population,
      allele: row.allele,
      frequency,
      count: Number.isFinite(count) ? count : null,
    });
  }
  return [...seen.values()];
}

/** Every population with a figure for this variant, in a stable order. */
export function populationsOf(rows: ReadonlyArray<PopulationFrequency> | null | undefined): string[] {
  return [...new Set(dedupePopulations(rows).map((r) => r.population))].sort((a, b) => a.localeCompare(b));
}

/**
 * The allele string a variant is known by upstream.
 *
 * `minimal` is the one to use: a deletion is `A/-` there and in Ensembl alike,
 * while `vcf` writes it `CA>C` with an anchor base that no frequency row will
 * ever match. Matching on `vcf.alt` silently misses every indel.
 */
export function variantAllele(entry: Pick<VariantEntry, 'minimal' | 'alleles'>): string | null {
  const minimal = entry.minimal?.alt;
  if (typeof minimal === 'string' && minimal) return minimal;
  const fallback = entry.alleles?.[1];
  return typeof fallback === 'string' && fallback ? fallback : null;
}

/** What one population says about one allele, or null when it says nothing. */
export function alleleShare(
  rows: ReadonlyArray<PopulationFrequency> | null | undefined,
  population: string,
  allele: string | null,
): AlleleShare | null {
  if (!allele) return null;
  const row = dedupePopulations(rows).find((r) => r.population === population && r.allele === allele);
  return row ? { frequency: row.frequency, count: row.count } : null;
}

/**
 * The second most common allele's frequency in one population — the figure
 * that says whether a variant is informative at all.
 *
 * Computed rather than read: the source reports `MAF` as null even where its
 * own population rows carry real frequencies.
 */
export function minorAlleleFrequency(
  rows: ReadonlyArray<PopulationFrequency> | null | undefined,
  population: string,
): number | null {
  const mine = dedupePopulations(rows)
    .filter((r) => r.population === population)
    .sort((a, b) => b.frequency - a.frequency);
  return mine.length >= 2 ? (mine[1] as PopulationFrequency).frequency : null;
}

/** How many annotated variants each population covers, most first. */
export function populationCounts(
  byId: ReadonlyMap<string, ReadonlyArray<PopulationFrequency>>,
): Array<readonly [string, number]> {
  const counts = new Map<string, number>();
  for (const rows of byId.values()) {
    for (const population of populationsOf(rows)) counts.set(population, (counts.get(population) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * The population to read by default: whichever covers the most variants here.
 * Panels differ wildly in what they have called, so the widest one is the least
 * likely to leave the column empty.
 */
export function bestPopulation(byId: ReadonlyMap<string, ReadonlyArray<PopulationFrequency>>): string | null {
  return populationCounts(byId)[0]?.[0] ?? null;
}
