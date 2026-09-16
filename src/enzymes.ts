/**
 * Restriction enzymes for the CAPS annotation.
 *
 * A small panel of widely stocked enzymes, enough to answer "could this variant
 * be typed on a gel?" without shipping a database. Recognition sequences and cut
 * positions follow REBASE (Roberts et al., *Nucleic Acids Res* 43:D298, 2015,
 * rebase.neb.com), the reference catalogue for restriction enzymes.
 *
 * The panel is a default, not a fixed list: what matters is which enzymes a
 * given lab actually stocks, so every entry point here takes an optional panel.
 */

export interface RestrictionEnzyme {
  name: string;
  /** Recognition sequence 5'→3', IUPAC. */
  site: string;
  /**
   * Cut offset on the top strand, counted from the start of the recognition
   * sequence: `G^AATTC` is 1, `GAT^ATC` is 3. Null when the enzyme cuts outside
   * its recognition sequence, where a fragment boundary cannot be derived.
   */
  cut: number | null;
}

/**
 * Widely available enzymes, six-cutters first. Four-cutters are included because
 * they discriminate far more variants, but they cut an amplicon so often that a
 * digest is usually unreadable — `enzymeSpecificity` is what tells them apart.
 */
export const COMMON_ENZYMES: ReadonlyArray<RestrictionEnzyme> = Object.freeze([
  // ---- six and eight base cutters ----
  { name: 'AatII', site: 'GACGTC', cut: 5 },
  { name: 'AccI', site: 'GTMKAC', cut: 2 },
  { name: 'AflII', site: 'CTTAAG', cut: 1 },
  { name: 'ApaI', site: 'GGGCCC', cut: 5 },
  { name: 'AvrII', site: 'CCTAGG', cut: 1 },
  { name: 'BamHI', site: 'GGATCC', cut: 1 },
  { name: 'BglII', site: 'AGATCT', cut: 1 },
  { name: 'BstYI', site: 'RGATCY', cut: 1 },
  { name: 'ClaI', site: 'ATCGAT', cut: 2 },
  { name: 'DraI', site: 'TTTAAA', cut: 3 },
  { name: 'EagI', site: 'CGGCCG', cut: 1 },
  { name: 'EcoRI', site: 'GAATTC', cut: 1 },
  { name: 'EcoRV', site: 'GATATC', cut: 3 },
  { name: 'HindIII', site: 'AAGCTT', cut: 1 },
  { name: 'HpaI', site: 'GTTAAC', cut: 3 },
  { name: 'KpnI', site: 'GGTACC', cut: 5 },
  { name: 'MfeI', site: 'CAATTG', cut: 1 },
  { name: 'NcoI', site: 'CCATGG', cut: 1 },
  { name: 'NdeI', site: 'CATATG', cut: 2 },
  { name: 'NheI', site: 'GCTAGC', cut: 1 },
  { name: 'NotI', site: 'GCGGCCGC', cut: 2 },
  { name: 'NsiI', site: 'ATGCAT', cut: 5 },
  { name: 'PstI', site: 'CTGCAG', cut: 5 },
  { name: 'PvuII', site: 'CAGCTG', cut: 3 },
  { name: 'SacI', site: 'GAGCTC', cut: 5 },
  { name: 'SalI', site: 'GTCGAC', cut: 1 },
  { name: 'ScaI', site: 'AGTACT', cut: 3 },
  { name: 'SmaI', site: 'CCCGGG', cut: 3 },
  { name: 'SpeI', site: 'ACTAGT', cut: 1 },
  { name: 'SphI', site: 'GCATGC', cut: 5 },
  { name: 'SspI', site: 'AATATT', cut: 3 },
  { name: 'StuI', site: 'AGGCCT', cut: 3 },
  { name: 'XbaI', site: 'TCTAGA', cut: 1 },
  { name: 'XhoI', site: 'CTCGAG', cut: 1 },
  // Interrupted sites: the Ns are spacers, not informative bases.
  { name: 'XmnI', site: 'GAANNNNTTC', cut: 5 },
  { name: 'BsaJI', site: 'CCNNGG', cut: 1 },
  // ---- four and five base cutters ----
  { name: 'AluI', site: 'AGCT', cut: 2 },
  { name: 'DdeI', site: 'CTNAG', cut: 1 },
  { name: 'HaeIII', site: 'GGCC', cut: 2 },
  { name: 'HhaI', site: 'GCGC', cut: 3 },
  { name: 'HinfI', site: 'GANTC', cut: 1 },
  { name: 'MseI', site: 'TTAA', cut: 1 },
  { name: 'MspI', site: 'CCGG', cut: 1 },
  { name: 'NlaIII', site: 'CATG', cut: 4 },
  { name: 'RsaI', site: 'GTAC', cut: 2 },
  { name: 'Sau3AI', site: 'GATC', cut: 0 },
  { name: 'TaqI', site: 'TCGA', cut: 1 },
  { name: 'Tsp509I', site: 'AATT', cut: 0 },
]);

/** How many bases each IUPAC code stands for. */
const AMBIGUITY: Readonly<Record<string, number>> = Object.freeze({
  A: 1, C: 1, G: 1, T: 1, U: 1,
  R: 2, Y: 2, S: 2, W: 2, K: 2, M: 2,
  B: 3, D: 3, H: 3, V: 3,
  N: 4,
});

/**
 * How rarely a site occurs by chance: `4^(informative bases)`, where a degenerate
 * code counts for less than a whole base and `N` for nothing. `GAATTC` gives
 * 4096, `GTMKAC` 1024, `GGCC` 256.
 *
 * This, not the length of the string, is what separates an enzyme that cuts an
 * amplicon once from one that shreds it: `XmnI` (`GAANNNNTTC`) is ten characters
 * long but only a six-cutter.
 */
export function enzymeSpecificity(site: string): number {
  let out = 1;
  for (const base of site.toUpperCase()) out *= 4 / (AMBIGUITY[base] ?? 4);
  return out;
}

/** Six informative bases or better: the enzymes whose digests are readable on a gel. */
export const SIX_CUTTER_SPECIFICITY = 4096;

export function isSixCutter(enzyme: RestrictionEnzyme): boolean {
  return enzymeSpecificity(enzyme.site) >= SIX_CUTTER_SPECIFICITY;
}

/** Looks an enzyme up by name in a panel, case-insensitively. */
export function findEnzyme(name: string, panel: ReadonlyArray<RestrictionEnzyme> = COMMON_ENZYMES): RestrictionEnzyme | null {
  const wanted = name.trim().toLowerCase();
  return panel.find((e) => e.name.toLowerCase() === wanted) ?? null;
}
