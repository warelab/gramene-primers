import type {
  GenotypeAllele,
  GenotypeGenomeRow,
  GenotypePrediction,
  GenotypePredictionRow,
  GenotypePrimerStatus,
  GenotypeResults,
  GenotypeSetResults,
  GenotypeSetSummary,
  GenotypeSummary,
} from './types';

export interface GenotypeStatusMeta<T extends string> {
  status: T;
  glyph: string;
  /** Okabe-Ito colour, or null where a glyph and text carry the meaning alone. */
  color: string | null;
  label: string;
  /** Higher is worse; used for "sort by worst" and "issues only". */
  severity: number;
}

/** Allele of a genome (matrix column 1): glyph + colour + text, never colour alone. */
export const ALLELE_META: Readonly<Record<GenotypeAllele, GenotypeStatusMeta<GenotypeAllele>>> = Object.freeze({
  ref: { status: 'ref', glyph: '●', color: '#0072B2', label: 'Reference allele', severity: 0 },
  alt: { status: 'alt', glyph: '▲', color: '#E69F00', label: 'Alternative allele', severity: 0 },
  other: { status: 'other', glyph: '◆', color: '#CC79A7', label: 'A third allele', severity: 3 },
  ambiguous: { status: 'ambiguous', glyph: '?', color: '#999999', label: 'Copies disagree', severity: 4 },
  missing: { status: 'missing', glyph: '–', color: null, label: 'No comparable locus', severity: 2 },
  unavailable: { status: 'unavailable', glyph: '×', color: '#555555', label: 'Allele call failed', severity: 5 },
});

/** What a set is predicted to read in a genome (one matrix column per set). */
export const PREDICTION_META: Readonly<Record<GenotypePrediction, GenotypeStatusMeta<GenotypePrediction>>> = Object.freeze({
  ref: { status: 'ref', glyph: '●', color: '#0072B2', label: 'REF dye only', severity: 0 },
  alt: { status: 'alt', glyph: '▲', color: '#E69F00', label: 'ALT dye only', severity: 0 },
  both: { status: 'both', glyph: '◐', color: '#CC79A7', label: 'Both dyes', severity: 4 },
  none: { status: 'none', glyph: '○', color: null, label: 'No product', severity: 3 },
  no_call: { status: 'no_call', glyph: '⊘', color: '#D55E00', label: 'No call', severity: 5 },
  unknown: { status: 'unknown', glyph: '·', color: null, label: 'Cannot be predicted', severity: 2 },
});

/** How each primer of a set behaves in a genome. */
export const PRIMER_STATUS_META: Readonly<Record<string, GenotypeStatusMeta<GenotypePrimerStatus>>> = Object.freeze({
  match: { status: 'match', glyph: '=', color: '#009E73', label: 'Perfect match', severity: 0 },
  terminal_mismatch: { status: 'terminal_mismatch', glyph: '≠', color: '#56B4E9', label: '3′ terminal mismatch', severity: 1 },
  weak: { status: 'weak', glyph: '~', color: '#E69F00', label: 'Weak binding', severity: 2 },
  uncertain: { status: 'uncertain', glyph: '?', color: '#999999', label: 'Uncertain', severity: 3 },
  blocked: { status: 'blocked', glyph: '⊗', color: '#D55E00', label: 'Blocked', severity: 4 },
  no_product: { status: 'no_product', glyph: '∅', color: null, label: 'No product', severity: 3 },
  unknown: { status: 'unknown', glyph: '·', color: null, label: 'Not determined', severity: 2 },
});

export function alleleMeta(allele: GenotypeAllele | null | undefined): GenotypeStatusMeta<GenotypeAllele> {
  return ALLELE_META[allele ?? 'unavailable'] ?? ALLELE_META.unavailable;
}

export function predictionMeta(predicted: GenotypePrediction | null | undefined): GenotypeStatusMeta<GenotypePrediction> {
  return PREDICTION_META[predicted ?? 'unknown'] ?? PREDICTION_META.unknown;
}

export function primerStatusMeta(status: GenotypePrimerStatus | null | undefined): GenotypeStatusMeta<GenotypePrimerStatus> {
  return PRIMER_STATUS_META[String(status ?? 'unknown')] ?? PRIMER_STATUS_META.unknown;
}

export function emptyGenotypeSummary(): GenotypeSummary {
  return { genomes_total: 0, ref: 0, alt: 0, other: 0, ambiguous: 0, missing: 0, unavailable: 0 };
}

export function emptyGenotypeSetSummary(): GenotypeSetSummary {
  return {
    genomes_total: 0,
    predicted_ref: 0,
    predicted_alt: 0,
    both: 0,
    none: 0,
    no_call: 0,
    unknown: 0,
    weak: 0,
    agree: 0,
    disagree: 0,
    not_comparable: 0,
  };
}

/** Allele counts of the pan-genome rows; the reference is never counted. */
export function summarizeGenotypeGenomes(genomes: ReadonlyArray<Pick<GenotypeGenomeRow, 'allele' | 'is_reference'>>): GenotypeSummary {
  const s = emptyGenotypeSummary();
  for (const g of genomes) {
    if (g.is_reference) continue;
    switch (g.allele) {
      case 'ref':
      case 'alt':
      case 'other':
      case 'ambiguous':
      case 'missing':
      case 'unavailable':
        s[g.allele] += 1;
        break;
      default:
        break;
    }
    s.genomes_total += 1;
  }
  return s;
}

/** The summary invariant: the allele counts add up to `genomes_total`. */
export function isConsistentGenotypeSummary(s: GenotypeSummary): boolean {
  return s.ref + s.alt + s.other + s.ambiguous + s.missing + s.unavailable === s.genomes_total;
}

/**
 * A genome whose prediction contradicts its observed allele. `agrees: null`
 * means "not comparable" (an uncertain shift tract, a missing locus) and is
 * never a disagreement.
 */
export function isDisagreement(row: Pick<GenotypePredictionRow, 'agrees'> | null | undefined): boolean {
  return row?.agrees === false;
}

/** "Issues only": an allele or a prediction that is not a clean REF/ALT call. */
export function isIssueAllele(allele: GenotypeAllele): boolean {
  return allele !== 'ref' && allele !== 'alt';
}

export function isIssuePrediction(predicted: GenotypePrediction): boolean {
  return predicted !== 'ref' && predicted !== 'alt';
}

export interface AlleleMatrixCell {
  set: GenotypeSetResults;
  /** Null while this genome has not been called for that set yet (partial job). */
  prediction: GenotypePredictionRow | null;
}

export interface AlleleMatrixRow {
  system_name: string;
  display_name: string;
  is_reference: boolean;
  /** Null for a requested genome the job has not reached yet. */
  genome: GenotypeGenomeRow | null;
  allele: GenotypeAllele | null;
  cells: AlleleMatrixCell[];
  /** Any set disagrees with the observed allele. */
  hasDisagreement: boolean;
}

/**
 * Matrix rows: the reference first, then the genomes the job has finished, then
 * `pending` rows for requested genomes without results yet — a partial job grows
 * rather than showing an empty grid. Each set contributes one cell, taken from
 * its own `genomes[]` (the reference's cell comes from `set.reference`).
 */
export function alleleMatrixRows(
  results: Pick<GenotypeResults, 'genomes' | 'sets'> | null | undefined,
  requested?: ReadonlyArray<string | { system_name: string; display_name?: string }> | null,
): AlleleMatrixRow[] {
  const sets = results?.sets ?? [];
  const byGenome = sets.map((set) => {
    const map = new Map<string, GenotypePredictionRow>();
    for (const row of set.genomes ?? []) map.set(row.system_name, row);
    return { set, map };
  });

  const rows: AlleleMatrixRow[] = [];
  const seen = new Set<string>();
  const add = (genome: GenotypeGenomeRow | null, name: string, display: string, isReference: boolean) => {
    if (seen.has(name)) return;
    seen.add(name);
    const cells = byGenome.map(({ set, map }) => ({
      set,
      prediction: (isReference ? set.reference ?? null : map.get(name) ?? null) as GenotypePredictionRow | null,
    }));
    rows.push({
      system_name: name,
      display_name: display,
      is_reference: isReference,
      genome,
      allele: genome?.allele ?? null,
      cells,
      hasDisagreement: cells.some((c) => isDisagreement(c.prediction)),
    });
  };

  for (const g of results?.genomes ?? []) {
    if (!g.is_reference) continue;
    add(g, g.system_name, g.display_name ?? g.system_name, true);
  }
  for (const g of results?.genomes ?? []) {
    if (g.is_reference) continue;
    add(g, g.system_name, g.display_name ?? g.system_name, false);
  }
  for (const r of requested ?? []) {
    const name = typeof r === 'string' ? r : r.system_name;
    add(null, name, typeof r === 'string' ? r : r.display_name ?? name, false);
  }
  return rows;
}
