/**
 * Primer3 documentation for the design settings and pair statistics. Links go to the
 * Primer3 manual for release 2.6.1, the version the server runs: input tags by name,
 * output tags with 4 as the pair index, and a few section ids.
 */

export const PRIMER3_MANUAL_URL = 'https://primer3.org/manual.html';

/** The paper the Primer3 authors ask users to cite. */
export const PRIMER3_CITATION = Object.freeze({
  text: 'Untergasser A, Cutcutache I, Koressaar T, Ye J, Faircloth BC, Remm M, Rozen SG. Primer3—new capabilities and interfaces. Nucleic Acids Res. 2012;40(15):e115.',
  short: 'Untergasser et al. 2012',
  url: 'https://doi.org/10.1093/nar/gks596',
});

export interface Primer3ManualLink {
  /** A tag name or section id in the manual. */
  anchor: string;
  /** Link text for a section; tags are shown by name. */
  label?: string;
}

export interface Primer3Doc {
  text: string;
  links: ReadonlyArray<Primer3ManualLink>;
}

export type Primer3DocTopic =
  | 'size'
  | 'tm'
  | 'gc'
  | 'max_tm_diff'
  | 'num_return'
  | 'product_size_ranges'
  | 'max_poly_x'
  | 'gc_clamp'
  | 'max_end_stability'
  | 'max_ns'
  | 'salt_monovalent'
  | 'salt_divalent'
  | 'dntp_conc'
  | 'dna_conc'
  | 'min_5_prime_overlap_of_junction'
  | 'min_3_prime_overlap_of_junction'
  | 'junction'
  | 'repeat_masking'
  | 'intervals'
  | 'explain'
  | 'tm_gc'
  | 'product'
  | 'penalty'
  | 'complementarity'
  | 'hairpin'
  | 'self_complementarity'
  | 'end_stability'
  | 'product_tm';

export function primer3ManualUrl(anchor: string): string {
  return `${PRIMER3_MANUAL_URL}#${anchor}`;
}

const tags = (...anchors: string[]): Primer3ManualLink[] => anchors.map((anchor) => ({ anchor }));

const DOCS: Record<Primer3DocTopic, Primer3Doc> = {
  size: {
    text: 'Primer length. Primers shorter than min or longer than max are rejected, and Primer3 prefers lengths close to opt.',
    links: tags('PRIMER_MIN_SIZE', 'PRIMER_OPT_SIZE', 'PRIMER_MAX_SIZE'),
  },
  tm: {
    text: 'Primer melting temperature, calculated with SantaLucia (1998) nearest-neighbor parameters and the salt, dNTP and oligo concentrations under Advanced parameters. Primers outside min–max are rejected, and Primer3 prefers a Tm close to opt.',
    links: tags('PRIMER_MIN_TM', 'PRIMER_OPT_TM', 'PRIMER_MAX_TM', 'PRIMER_TM_FORMULA'),
  },
  gc: {
    text: 'Share of G and C bases. Primers outside min–max are rejected. Primer3 uses opt only when a GC penalty weight is set, which this form does not send.',
    links: tags('PRIMER_MIN_GC', 'PRIMER_OPT_GC_PERCENT', 'PRIMER_MAX_GC'),
  },
  max_tm_diff: {
    text: 'Largest allowed difference between the melting temperatures of the left and right primers.',
    links: tags('PRIMER_PAIR_MAX_DIFF_TM'),
  },
  num_return: {
    text: 'Most primer pairs to return, sorted by penalty (best first).',
    links: tags('PRIMER_NUM_RETURN'),
  },
  product_size_ranges: {
    text: 'Allowed product lengths, primers included. Primer3 returns pairs from the first range and uses a later range only when the first has too few pairs.',
    links: tags('PRIMER_PRODUCT_SIZE_RANGE'),
  },
  max_poly_x: {
    text: 'Longest allowed run of a single base: 4 accepts AAAA but rejects AAAAA.',
    links: tags('PRIMER_MAX_POLY_X'),
  },
  gc_clamp: {
    text: 'Number of consecutive G or C bases required at the 3′ end of both primers.',
    links: tags('PRIMER_GC_CLAMP'),
  },
  max_end_stability: {
    text: 'Largest allowed stability of a primer’s last five 3′ bases, as the ΔG (kcal/mol) to disrupt their duplex. Bigger values mean more stable 3′ ends.',
    links: tags('PRIMER_MAX_END_STABILITY'),
  },
  max_ns: {
    text: 'Most unknown bases (N) a primer may contain. Avoid repeats with “Replace with N” sets this to 0.',
    links: tags('PRIMER_MAX_NS_ACCEPTED'),
  },
  salt_monovalent: {
    text: 'Concentration of monovalent cations (usually KCl) in the PCR, used for melting temperatures.',
    links: tags('PRIMER_SALT_MONOVALENT'),
  },
  salt_divalent: {
    text: 'Concentration of divalent cations (usually Mg²⁺). Primer3 converts it to an equivalent monovalent concentration, allowing for the dNTPs that bind it.',
    links: tags('PRIMER_SALT_DIVALENT'),
  },
  dntp_conc: {
    text: 'Total concentration of all four dNTPs. It affects melting temperatures only when the divalent cation concentration is above 0.',
    links: tags('PRIMER_DNTP_CONC'),
  },
  dna_conc: {
    text: 'Concentration of each annealing oligo during the PCR, used for melting temperatures.',
    links: tags('PRIMER_DNA_CONC'),
  },
  min_5_prime_overlap_of_junction: {
    text: 'For a junction-spanning primer: the fewest primer bases on the 5′ side of the exon–exon junction.',
    links: tags('PRIMER_MIN_5_PRIME_OVERLAP_OF_JUNCTION', 'SEQUENCE_OVERLAP_JUNCTION_LIST'),
  },
  min_3_prime_overlap_of_junction: {
    text: 'For a junction-spanning primer: the fewest primer bases on the 3′ side of the exon–exon junction.',
    links: tags('PRIMER_MIN_3_PRIME_OVERLAP_OF_JUNCTION', 'SEQUENCE_OVERLAP_JUNCTION_LIST'),
  },
  junction: {
    text: 'The server gives Primer3 the transcript’s exon–exon junctions; the left or the right primer of every pair must then span one.',
    links: tags('SEQUENCE_OVERLAP_JUNCTION_LIST', 'PRIMER_MIN_5_PRIME_OVERLAP_OF_JUNCTION', 'PRIMER_MIN_3_PRIME_OVERLAP_OF_JUNCTION'),
  },
  repeat_masking: {
    text: 'Replace with N turns masked bases into N and allows no N in primers. Keep marks masked bases as lowercase, and Primer3 rejects only primers whose 3′-end base is masked.',
    links: tags('PRIMER_MAX_NS_ACCEPTED', 'PRIMER_LOWERCASE_MASKING'),
  },
  intervals: {
    text: 'Primer3 receives these as start,length pairs.',
    links: tags('SEQUENCE_TARGET', 'SEQUENCE_INCLUDED_REGION', 'SEQUENCE_EXCLUDED_REGION'),
  },
  explain: {
    text: 'Primer3 reports how many candidate primers and pairs it considered and why it rejected the others.',
    links: [...tags('PRIMER_LEFT_EXPLAIN', 'PRIMER_PAIR_EXPLAIN'), { anchor: 'findNoPrimers', label: 'What to do if Primer3 cannot find primers' }],
  },
  tm_gc: {
    text: 'Melting temperature and GC percentage of the left and right primer.',
    links: tags('PRIMER_LEFT_4_TM', 'PRIMER_LEFT_4_GC_PERCENT'),
  },
  product: {
    text: 'Product length in bp, from the 5′ end of the left primer to the 5′ end of the right primer.',
    links: tags('PRIMER_PAIR_4_PRODUCT_SIZE'),
  },
  penalty: {
    text: 'Primer3’s objective function for the pair; with its default weights, mostly how far each primer is from the optimal length and Tm. Lower is better, and pairs are listed best first.',
    links: [...tags('PRIMER_PAIR_4_PENALTY'), { anchor: 'calculatePenalties', label: 'How Primer3 calculates the penalty' }],
  },
  complementarity: {
    text: 'Melting temperature (°C) of the most stable duplex the two primers form with each other, anywhere and at their 3′ ends; high 3′ values risk primer-dimers. Lower is better.',
    links: tags('PRIMER_PAIR_4_COMPL_ANY_TH', 'PRIMER_PAIR_4_COMPL_END_TH'),
  },
  hairpin: {
    text: 'Melting temperature (°C) of the most stable hairpin each primer can form. Lower is better.',
    links: tags('PRIMER_LEFT_4_HAIRPIN_TH'),
  },
  self_complementarity: {
    text: 'Melting temperature (°C) of the most stable duplex a primer forms with itself, anywhere and at its 3′ end. Lower is better.',
    links: tags('PRIMER_LEFT_4_SELF_ANY_TH', 'PRIMER_LEFT_4_SELF_END_TH'),
  },
  end_stability: {
    text: 'ΔG (kcal/mol) to disrupt the duplex of a primer’s last five 3′ bases; bigger values mean a more stable 3′ end.',
    links: tags('PRIMER_LEFT_4_END_STABILITY'),
  },
  product_tm: {
    text: 'Melting temperature of the product (Rychlik et al. 1990).',
    links: tags('PRIMER_PAIR_4_PRODUCT_TM'),
  },
};

export const PRIMER3_DOCS: Readonly<Record<Primer3DocTopic, Primer3Doc>> = Object.freeze(DOCS);
