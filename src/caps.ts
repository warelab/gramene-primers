/**
 * CAPS and dCAPS annotation: can a variant be typed by digesting a PCR product?
 *
 * CAPS works when a variant creates or destroys a restriction site, so one
 * allele is cut and the other is not and the two are told apart by fragment
 * sizes on a gel. dCAPS covers the far more common case where no such site
 * exists naturally but one can be manufactured by carrying a deliberate
 * mismatch in the primer.
 *
 * This is an annotation — a property of the sequence — not an assay design. It
 * reports that an opportunity exists and where the mismatch would go; designing
 * the primer around it is a separate problem.
 *
 * Digests are reported as sequence alone. Methylation is not modelled, and a
 * Dam- or Dcm-sensitive enzyme may fail on plant genomic DNA that this
 * annotation says is cuttable.
 */

import { revcomp } from './coords';
import { COMMON_ENZYMES, enzymeSpecificity, type RestrictionEnzyme } from './enzymes';
import type { Strand } from './types';

export type CapsVerdict = 'caps' | 'dcaps' | 'none';

export interface CapsSite {
  /** 1-based position of the recognition sequence's first base. */
  start: number;
  end: number;
  /** The strand the recognition sequence reads on. */
  strand: Strand;
}

export interface CapsEnzymeHit {
  enzyme: RestrictionEnzyme;
  /** The allele that carries the site; the other one is not cut. */
  cuts: 'ref' | 'alt';
  site: CapsSite;
  /** Informative bases as a 1-in-N frequency; six-cutters are 4096 or better. */
  specificity: number;
}

/** Which side of the variant a deliberate mismatch sits on. */
export type DcapsSide = 'upstream' | 'downstream';

export interface DcapsOpportunity {
  enzyme: RestrictionEnzyme;
  /** Which allele would be cut once the mismatch is carried in. */
  cuts: 'ref' | 'alt';
  /**
   * Which primer carries the mismatch: `upstream` is the forward primer,
   * `downstream` the reverse one.
   */
  side: DcapsSide;
  /** Bases between the mismatch and the variant; 1 is immediately adjacent. */
  offset: number;
  /** The base the template has there. */
  from: string;
  /** The base the primer must carry instead. */
  to: string;
  specificity: number;
}

export interface CapsCall {
  verdict: CapsVerdict;
  /** Natural differential sites, most specific first. */
  sites: CapsEnzymeHit[];
  /** Only populated when no natural site exists. */
  dcaps: DcapsOpportunity[];
}

const IUPAC: Readonly<Record<string, string>> = Object.freeze({
  A: 'A', C: 'C', G: 'G', T: 'T', U: 'T',
  R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
});

/**
 * A recognition sequence as a regular expression. Degenerate codes become
 * character classes, so an interrupted site like `GAANNNNTTC` matches its
 * spacer as four free bases rather than four literal Ns.
 */
export function iupacMatcher(site: string): RegExp {
  const source = [...site.toUpperCase()]
    .map((base) => {
      const bases = IUPAC[base];
      if (!bases) throw new Error(`Not an IUPAC base: ${base}`);
      return bases.length === 1 ? bases : `[${bases}]`;
    })
    .join('');
  return new RegExp(source, 'g');
}

/**
 * Every occurrence of an enzyme's site, on both strands. Overlapping matches
 * count: advancing by one base rather than by the whole match finds a site that
 * begins inside the previous one. A palindromic site reads the same on the
 * reverse strand, so it is scanned once rather than reporting every hit twice.
 */
export function findSites(seq: string, enzyme: RestrictionEnzyme): CapsSite[] {
  const upper = seq.toUpperCase();
  const site = enzyme.site.toUpperCase();
  const reverse = revcomp(site).toUpperCase();
  const patterns: Array<[string, Strand]> = site === reverse ? [[site, 1]] : [[site, 1], [reverse, -1]];
  const out: CapsSite[] = [];
  for (const [pattern, strand] of patterns) {
    const re = iupacMatcher(pattern);
    let match: RegExpExecArray | null;
    while ((match = re.exec(upper)) !== null) {
      out.push({ start: match.index + 1, end: match.index + pattern.length, strand });
      re.lastIndex = match.index + 1;
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Every site covering any part of `[from, to]`. */
function sitesOverSpan(seq: string, enzyme: RestrictionEnzyme, from: number, to: number): CapsSite[] {
  return findSites(seq, enzyme).filter((site) => site.start <= to && site.end >= from);
}

export interface VariantContext {
  /** REF haplotype with flanking sequence. */
  ref: string;
  /** ALT haplotype over the same flanks. */
  alt: string;
  /** 1-based position of the variant's first base, the same in both strings. */
  at: number;
  refLength: number;
  altLength: number;
}

/**
 * Cuts the REF and ALT haplotypes out of a window of reference sequence.
 *
 * Returns null when the variant falls outside the window, or when the reference
 * allele disagrees with the sequence — a coordinate or release mismatch, and the
 * one case where carrying on regardless would produce confidently wrong answers.
 */
export function variantContext(
  windowSeq: string,
  windowStart: number,
  vcf: { position: number; ref: string; alt: string },
  flank = 20,
): VariantContext | null {
  const seq = windowSeq.toUpperCase();
  const ref = vcf.ref.toUpperCase();
  const alt = vcf.alt.toUpperCase();
  if (!ref || !alt) return null;
  const index = vcf.position - windowStart;
  if (index < 0 || index + ref.length > seq.length) return null;
  if (seq.slice(index, index + ref.length) !== ref) return null;

  const from = Math.max(0, index - flank);
  const upstream = seq.slice(from, index);
  const downstream = seq.slice(index + ref.length, index + ref.length + flank);
  return {
    ref: upstream + ref + downstream,
    alt: upstream + alt + downstream,
    at: index - from + 1,
    refLength: ref.length,
    altLength: alt.length,
  };
}

/**
 * Enzymes that cut across the variant a different number of times in the two
 * alleles. An indel spans different lengths in the two haplotypes, so each is
 * compared over its own span.
 *
 * Counting rather than testing presence matters when an enzyme already has a
 * constitutive site across the variant: the variant can destroy a second one
 * and still leave a site in both alleles, which a presence test would call
 * undifferentiated. Equal counts at different offsets are *not* reported —
 * both alleles are cut, and only fragment sizes can say whether the assay
 * reads, which needs an amplicon this function does not have.
 */
export function differentialSites(
  context: VariantContext,
  enzymes: ReadonlyArray<RestrictionEnzyme> = COMMON_ENZYMES,
): CapsEnzymeHit[] {
  const out: CapsEnzymeHit[] = [];
  for (const enzyme of enzymes) {
    const inRef = sitesOverSpan(context.ref, enzyme, context.at, context.at + context.refLength - 1);
    const inAlt = sitesOverSpan(context.alt, enzyme, context.at, context.at + context.altLength - 1);
    if (inRef.length === inAlt.length) continue;
    const more = inRef.length > inAlt.length ? inRef : inAlt;
    const fewer = inRef.length > inAlt.length ? inAlt : inRef;
    const site = more.find((s) => !fewer.some((o) => o.start === s.start && o.strand === s.strand)) ?? more[0];
    out.push({
      enzyme,
      cuts: inRef.length > inAlt.length ? 'ref' : 'alt',
      site: site as CapsSite,
      specificity: enzymeSpecificity(enzyme.site),
    });
  }
  // Most specific first: a six-cutter gives a readable digest, a four-cutter rarely does.
  return out.sort((a, b) => b.specificity - a.specificity || a.enzyme.name.localeCompare(b.enzyme.name));
}

/** Whether an IUPAC code stands for a given base. */
function codeMatches(code: string, base: string): boolean {
  return (IUPAC[code] ?? '').includes(base);
}

interface NearMiss {
  side: DcapsSide;
  offset: number;
  from: string;
  to: string;
}

/**
 * Positions where a recognition sequence is one base away from matching, across
 * the variant.
 *
 * Going straight for the near-miss is what makes this affordable. Substituting
 * every base at every offset and rescanning costs a full pass of the panel per
 * candidate; sliding the site across the variant and counting mismatches finds
 * the same answers in one pass, and only the survivors are worth verifying.
 */
function nearMisses(
  seq: string,
  pattern: string,
  spanStart: number,
  spanEnd: number,
  reach: number,
): NearMiss[] {
  const out: NearMiss[] = [];
  const length = pattern.length;
  const first = Math.max(0, spanStart - length);
  const last = Math.min(seq.length - length, spanEnd - 1);
  for (let p = first; p <= last; p++) {
    let missIndex = -1;
    let misses = 0;
    for (let i = 0; i < length && misses < 2; i++) {
      if (!codeMatches(pattern[i] as string, seq[p + i] as string)) {
        misses++;
        missIndex = p + i;
      }
    }
    if (misses !== 1) continue;
    // The variant's own bases are not a mismatch a primer can carry.
    if (missIndex >= spanStart - 1 && missIndex <= spanEnd - 1) continue;
    const side: DcapsSide = missIndex < spanStart - 1 ? 'upstream' : 'downstream';
    const offset = side === 'upstream' ? spanStart - 1 - missIndex : missIndex - (spanEnd - 1);
    if (offset > reach) continue;
    const from = seq[missIndex] as string;
    const code = pattern[missIndex - p] as string;
    for (const to of IUPAC[code] as string) {
      if (to !== from) {
        out.push({ side, offset, from, to });
        break;
      }
    }
  }
  return out.sort((a, b) => a.offset - b.offset);
}

/**
 * Sites that a single deliberate mismatch could create, when none exists
 * naturally. The mismatch must sit within `reach` bases of the variant, close
 * enough for a primer whose 3' end lands beside it to carry the change.
 *
 * Only the nearest opportunity per enzyme is reported: a mismatch close to the
 * 3' end is the one most likely to still prime.
 */
export function dcapsOpportunities(
  context: VariantContext,
  enzymes: ReadonlyArray<RestrictionEnzyme> = COMMON_ENZYMES,
  reach = 12,
): DcapsOpportunity[] {
  const out: DcapsOpportunity[] = [];
  const variantStart = context.at;
  for (const enzyme of enzymes) {
    const site = enzyme.site.toUpperCase();
    const reverse = revcomp(site).toUpperCase();
    const patterns = site === reverse ? [site] : [site, reverse];
    const candidates: NearMiss[] = [];
    for (const pattern of patterns) {
      candidates.push(
        ...nearMisses(context.ref, pattern, variantStart, variantStart + context.refLength - 1, reach),
        ...nearMisses(context.alt, pattern, variantStart, variantStart + context.altLength - 1, reach),
      );
    }
    candidates.sort((a, b) => a.offset - b.offset);

    let found: DcapsOpportunity | null = null;
    for (const near of candidates) {
      // The near-miss says a site would form; only a differential scan says it
      // would form in one allele and not the other.
      const refIndex =
        near.side === 'upstream'
          ? variantStart - 1 - near.offset
          : variantStart - 1 + context.refLength - 1 + near.offset;
      const altIndex =
        near.side === 'upstream'
          ? variantStart - 1 - near.offset
          : variantStart - 1 + context.altLength - 1 + near.offset;
      if (refIndex < 0 || altIndex < 0 || refIndex >= context.ref.length || altIndex >= context.alt.length) continue;
      if (context.ref[refIndex] !== near.from || context.alt[altIndex] !== near.from) continue;
      const probe: VariantContext = {
        ...context,
        ref: context.ref.slice(0, refIndex) + near.to + context.ref.slice(refIndex + 1),
        alt: context.alt.slice(0, altIndex) + near.to + context.alt.slice(altIndex + 1),
      };
      const [hit] = differentialSites(probe, [enzyme]);
      if (hit) {
        found = {
          enzyme,
          cuts: hit.cuts,
          side: near.side,
          offset: near.offset,
          from: near.from,
          to: near.to,
          specificity: hit.specificity,
        };
        break;
      }
    }
    if (found) out.push(found);
  }
  return out.sort(
    (a, b) => b.specificity - a.specificity || a.offset - b.offset || a.enzyme.name.localeCompare(b.enzyme.name),
  );
}

export interface CapsCallOptions {
  enzymes?: ReadonlyArray<RestrictionEnzyme>;
  /** Look for a dCAPS opportunity when no natural site exists. Default true. */
  dcaps?: boolean;
  /** How far from the variant a deliberate mismatch may sit. Default 12. */
  reach?: number;
}

/** The annotation for one variant. */
export function capsCall(context: VariantContext, options: CapsCallOptions = {}): CapsCall {
  const enzymes = options.enzymes ?? COMMON_ENZYMES;
  const sites = differentialSites(context, enzymes);
  if (sites.length) return { verdict: 'caps', sites, dcaps: [] };
  if (options.dcaps === false) return { verdict: 'none', sites: [], dcaps: [] };
  const dcaps = dcapsOpportunities(context, enzymes, options.reach ?? 12);
  return { verdict: dcaps.length ? 'dcaps' : 'none', sites: [], dcaps };
}

/**
 * Where an enzyme severs the top strand, as 0-based boundaries.
 *
 * `cut` is measured from the 5' end of the recognition sequence as written, so
 * a site found on the reverse strand is counted from its other end: the
 * complementary offset `length − cut`. For the palindromic enzymes in the
 * bundled panel the two agree, which is why only a custom panel exercises this.
 */
function cutPositions(seq: string, enzyme: RestrictionEnzyme): number[] {
  if (enzyme.cut === null) return [];
  const cut = enzyme.cut;
  const at = findSites(seq, enzyme).map((site) =>
    site.strand === 1 ? site.start - 1 + cut : site.end - cut,
  );
  return [...new Set(at)].filter((x) => x > 0 && x < seq.length).sort((a, b) => a - b);
}

/**
 * Fragment sizes from digesting a sequence, largest first. An enzyme that cuts
 * outside its recognition sequence has no derivable boundary and yields the
 * undigested length.
 */
export function digestFragments(seq: string, enzyme: RestrictionEnzyme): number[] {
  if (enzyme.cut === null) return [seq.length];
  const bounds = [0, ...cutPositions(seq, enzyme), seq.length];
  const sizes: number[] = [];
  for (let i = 1; i < bounds.length; i++) sizes.push((bounds[i] as number) - (bounds[i - 1] as number));
  return sizes.sort((a, b) => b - a);
}

/**
 * Whether a digest can actually be read on a gel: the cut allele must separate
 * from the uncut product and its own fragments must separate from each other.
 * Bands closer together than `resolution` run as one.
 */
export function isResolvable(fragments: ReadonlyArray<number>, uncut: number, resolution = 25): boolean {
  if (fragments.length < 2) return false;
  const sorted = [...fragments].sort((a, b) => b - a);
  if (uncut - (sorted[0] as number) < resolution) return false;
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i - 1] as number) - (sorted[i] as number) < resolution) return false;
  }
  return true;
}

/**
 * Checks fetched sequence against the reference alleles the primers API
 * reports, before any of it is believed.
 *
 * The verdict is for the whole window, not per variant: the API has already
 * verified these alleles against the assembly, so a single disagreement means
 * the sequence is the wrong assembly, the wrong release, or off by one — and in
 * every one of those cases the other variants' annotations are wrong too, they
 * just happen to be wrong silently.
 */
export interface WindowCheck {
  ok: boolean;
  checked: number;
  /** The first disagreement, for a message the user can act on. */
  mismatch: { position: number; expected: string; found: string } | null;
}

export function verifyWindow(
  windowSeq: string,
  windowStart: number,
  variants: ReadonlyArray<{ vcf?: { position: number; ref: string } | null }>,
): WindowCheck {
  const seq = windowSeq.toUpperCase();
  let checked = 0;
  for (const variant of variants) {
    const vcf = variant.vcf;
    if (!vcf || !vcf.ref) continue;
    const index = vcf.position - windowStart;
    if (index < 0 || index + vcf.ref.length > seq.length) continue;
    checked++;
    const found = seq.slice(index, index + vcf.ref.length);
    const expected = vcf.ref.toUpperCase();
    if (found !== expected) return { ok: false, checked, mismatch: { position: vcf.position, expected, found } };
  }
  return { ok: checked > 0, checked, mismatch: null };
}

/** Why a variant has no CAPS verdict. */
export type CapsUnknownReason = 'no-sequence' | 'window-mismatch' | 'out-of-window' | 'ref-mismatch';

export interface CapsAnnotation extends CapsCall {
  /** Null once a verdict was reached; set when the verdict is `none` for want of data. */
  unknown: CapsUnknownReason | null;
}

const UNKNOWN = (reason: CapsUnknownReason): CapsAnnotation => ({
  verdict: 'none',
  sites: [],
  dcaps: [],
  unknown: reason,
});

export interface AnnotateOptions extends CapsCallOptions {
  /** Bases of context either side of the variant. Default 20. */
  flank?: number;
}

/**
 * CAPS annotations for a listing, keyed by `VariantEntry.key`.
 *
 * "Unknown" and "no" are kept apart throughout. Without sequence the client
 * cannot say a variant has no site — only that it cannot tell — and a column
 * that renders those the same way invites a user to abandon a perfectly good
 * marker.
 */
export function annotateVariants(
  variants: ReadonlyArray<{ key: string; vcf?: { position: number; ref: string; alt: string } | null }>,
  windowSeq: string | null,
  windowStart: number,
  options: AnnotateOptions = {},
): Map<string, CapsAnnotation> {
  const out = new Map<string, CapsAnnotation>();
  if (!windowSeq) {
    for (const v of variants) out.set(v.key, UNKNOWN('no-sequence'));
    return out;
  }
  // One bad window means every annotation in it is wrong, not just one.
  if (!verifyWindow(windowSeq, windowStart, variants).ok) {
    for (const v of variants) out.set(v.key, UNKNOWN('window-mismatch'));
    return out;
  }
  for (const v of variants) {
    if (!v.vcf) {
      out.set(v.key, UNKNOWN('out-of-window'));
      continue;
    }
    const context = variantContext(windowSeq, windowStart, v.vcf, options.flank ?? 20);
    if (!context) {
      const index = v.vcf.position - windowStart;
      const inside = index >= 0 && index + v.vcf.ref.length <= windowSeq.length;
      out.set(v.key, UNKNOWN(inside ? 'ref-mismatch' : 'out-of-window'));
      continue;
    }
    out.set(v.key, { ...capsCall(context, options), unknown: null });
  }
  return out;
}

/** The enzymes a listing's annotations actually discriminate, with counts. */
export function enzymeCounts(annotations: Iterable<CapsAnnotation>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of annotations) {
    const names = new Set([...a.sites.map((s) => s.enzyme.name), ...a.dcaps.map((d) => d.enzyme.name)]);
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}
