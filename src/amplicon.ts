/**
 * Restriction analysis of a predicted PCR product.
 *
 * Two questions, both answered from `template.seq`, which every design response
 * already carries — so unlike the variant listing this needs no host callback
 * and works in every mode:
 *
 * 1. Which enzymes cut this amplicon, where, and into what fragments? That is
 *    the diagnostic digest that confirms a band is the product you meant, and
 *    the check that a cloning enzyme does not cut inside it.
 * 2. Is there a variant inside the amplicon that an enzyme can tell apart? That
 *    turns an ordinary primer pair into a CAPS genotyping assay, and here —
 *    unlike on a bare listing — the fragment sizes are real, because the
 *    amplicon is known.
 */

import { digestFragments, findSites, type CapsSite } from './caps';
import { revcomp } from './coords';
import { COMMON_ENZYMES, enzymeSpecificity, type RestrictionEnzyme } from './enzymes';
import type { PrimerTemplate } from './types';

/** A 1-based, inclusive span of template coordinates. */
export interface TemplateSpan {
  start: number;
  end: number;
}

export interface AmpliconDigest {
  enzyme: RestrictionEnzyme;
  /** Recognition sites lying wholly inside the amplicon, in template coordinates. */
  sites: CapsSite[];
  /** Top-strand cut points, in template coordinates: the base after each is severed. */
  cuts: number[];
  /** Fragment sizes, largest first. */
  fragments: number[];
  specificity: number;
}

export interface DigestOptions {
  enzymes?: ReadonlyArray<RestrictionEnzyme>;
  /** Bands below this run off the end of a standard gel. Default 50. */
  minFragment?: number;
  /** Bands closer together than this co-migrate. Default 40. */
  minDifference?: number;
  /** Beyond this many cuts the ladder is unreadable. Default 4. */
  maxCuts?: number;
}

/** The amplicon's bases, or null when the span does not lie in the template. */
export function ampliconSeq(seq: string | null | undefined, span: TemplateSpan): string | null {
  if (!seq || span.start < 1 || span.end > seq.length || span.end < span.start) return null;
  return seq.slice(span.start - 1, span.end).toUpperCase();
}

/**
 * Every enzyme that cuts the amplicon, fewest cuts first.
 *
 * A single cutter is the useful case — it splits the product into two bands
 * whose sizes identify it — so the ordering puts those first rather than
 * ranking by specificity as the variant annotation does.
 */
export function digestAmplicon(
  seq: string | null | undefined,
  span: TemplateSpan,
  options: DigestOptions = {},
): AmpliconDigest[] {
  const amplicon = ampliconSeq(seq, span);
  if (!amplicon) return [];
  const enzymes = options.enzymes ?? COMMON_ENZYMES;
  const out: AmpliconDigest[] = [];
  for (const enzyme of enzymes) {
    if (enzyme.cut === null) continue;
    // Only a site lying wholly inside the product is cut; one straddling an end
    // is not there to cut, because the product stops at the primer.
    const sites = findSites(amplicon, enzyme);
    if (!sites.length) continue;
    const fragments = digestFragments(amplicon, enzyme);
    if (fragments.length < 2) continue;
    out.push({
      enzyme,
      sites: sites.map((s) => ({ ...s, start: s.start + span.start - 1, end: s.end + span.start - 1 })),
      cuts: cutPoints(amplicon, enzyme).map((c) => c + span.start - 1),
      fragments,
      specificity: enzymeSpecificity(enzyme.site),
    });
  }
  return out.sort(
    (a, b) => a.cuts.length - b.cuts.length || b.specificity - a.specificity || a.enzyme.name.localeCompare(b.enzyme.name),
  );
}

/** Top-strand cut points within a sequence, 1-based: the base at each is the first of the next fragment. */
function cutPoints(seq: string, enzyme: RestrictionEnzyme): number[] {
  if (enzyme.cut === null) return [];
  const cut = enzyme.cut;
  const at = findSites(seq, enzyme).map((site) => (site.strand === 1 ? site.start - 1 + cut : site.end - cut));
  return [...new Set(at)].filter((x) => x > 0 && x < seq.length).sort((a, b) => a - b).map((x) => x + 1);
}

/** Enzymes that cut the amplicon exactly once — the readable diagnostic digests. */
export function singleCutters(digests: ReadonlyArray<AmpliconDigest>): AmpliconDigest[] {
  return digests.filter((d) => d.cuts.length === 1);
}

/** Enzymes with no site at all: safe to use for cloning into this product's ends. */
export function nonCutters(
  seq: string | null | undefined,
  span: TemplateSpan,
  enzymes: ReadonlyArray<RestrictionEnzyme> = COMMON_ENZYMES,
): RestrictionEnzyme[] {
  const amplicon = ampliconSeq(seq, span);
  if (!amplicon) return [];
  return enzymes.filter((e) => findSites(amplicon, e).length === 0);
}

/**
 * Whether two digests can be told apart on a gel: some band in one must have no
 * counterpart of a similar size in the other, and be big enough to run.
 */
export function digestsDistinguishable(
  ref: ReadonlyArray<number>,
  alt: ReadonlyArray<number>,
  options: DigestOptions = {},
): boolean {
  const minFragment = options.minFragment ?? 50;
  const minDifference = options.minDifference ?? 40;
  const orphan = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) =>
    a.some((x) => x >= minFragment && !b.some((y) => Math.abs(x - y) < minDifference));
  return orphan(ref, alt) || orphan(alt, ref);
}

/** A variant, in the template's own coordinates and orientation. */
export interface TemplateVariant {
  /** 1-based template position of the variant's first base. */
  position: number;
  ref: string;
  alt: string;
}

/**
 * Places a genomic variant on the template.
 *
 * Two traps live here. A minus-strand template holds the reverse complement of
 * the genomic plus strand, so the alleles must be complemented and the variant's
 * first template base is the mapped position of its *last* genomic base. And a
 * spliced template omits introns, so a variant straddling a junction has no
 * contiguous image and is rejected rather than spliced into nonsense.
 */
export function variantOnTemplate(
  template: Pick<PrimerTemplate, 'mode' | 'region' | 'start' | 'end' | 'strand' | 'length' | 'features'>,
  vcf: { position: number; ref: string; alt: string },
): TemplateVariant | null {
  const ref = vcf.ref.toUpperCase();
  const alt = vcf.alt.toUpperCase();
  if (!ref || !alt) return null;
  const first = genomicToTemplatePosition(template, vcf.position);
  const last = genomicToTemplatePosition(template, vcf.position + ref.length - 1);
  if (first === null || last === null) return null;
  // Contiguous in the template, or it spans a junction and cannot be spliced.
  if (Math.abs(last - first) !== ref.length - 1) return null;
  const minus = template.strand === -1;
  return {
    position: Math.min(first, last),
    ref: minus ? revcomp(ref) : ref,
    alt: minus ? revcomp(alt) : alt,
  };
}

/** Template coordinate for a genomic position, or null when it is not in the template. */
export function genomicToTemplatePosition(
  template: Pick<PrimerTemplate, 'mode' | 'region' | 'start' | 'end' | 'strand' | 'features'>,
  pos: number,
): number | null {
  if (!template.region || template.mode === 'sequence') return null;
  const strand = template.strand === -1 ? -1 : 1;
  if (template.mode === 'transcript') {
    for (const e of template.features?.exons ?? []) {
      const g = e.genomic;
      if (!g || pos < g.start || pos > g.end) continue;
      return strand === 1 ? e.start + (pos - g.start) : e.start + (g.end - pos);
    }
    return null;
  }
  const { start, end } = template;
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  if (pos < start || pos > end) return null;
  return strand === 1 ? pos - start + 1 : end - pos + 1;
}

export interface ProductCaps {
  /** Identity of the variant this came from, for keying back to the listing. */
  key: string;
  label: string;
  variant: TemplateVariant;
  enzyme: RestrictionEnzyme;
  /** The allele the enzyme cuts more often. */
  cuts: 'ref' | 'alt';
  refFragments: number[];
  altFragments: number[];
  /** Cuts the enzyme makes in both alleles alike; they shrink the bands. */
  sharedCuts: number;
  /** How far apart the undigested products already are; an indel needs no enzyme at all. */
  baselineDifference: number;
  resolvable: boolean;
  /** Why not, when `resolvable` is false. */
  reason: string | null;
  specificity: number;
}

/**
 * CAPS assays available from one predicted product.
 *
 * The test is whether the two digests differ, not whether a site is present in
 * one allele only. That is what a gel actually reads, and it gets the awkward
 * cases right for free: an enzyme with a constitutive site across the variant
 * can still gain or lose a second one, and a site that merely moves changes the
 * fragment sizes without changing the site count.
 */
export function capsForAmplicon(
  seq: string | null | undefined,
  span: TemplateSpan,
  variants: ReadonlyArray<{ key: string; label: string; variant: TemplateVariant }>,
  options: DigestOptions = {},
): ProductCaps[] {
  const refAmplicon = ampliconSeq(seq, span);
  if (!refAmplicon) return [];
  const enzymes = options.enzymes ?? COMMON_ENZYMES;
  const minFragment = options.minFragment ?? 50;
  const maxCuts = options.maxCuts ?? 4;
  const out: ProductCaps[] = [];
  // The reference digest depends only on the enzyme, so it is computed once
  // rather than once per variant in the product.
  const refDigests = new Map<string, number[]>();
  for (const enzyme of enzymes) {
    if (enzyme.cut !== null) refDigests.set(enzyme.name, digestFragments(refAmplicon, enzyme));
  }

  for (const entry of variants) {
    const { variant } = entry;
    const offset = variant.position - span.start;
    if (offset < 0 || offset + variant.ref.length > refAmplicon.length) continue;
    // A variant the template disagrees with means the wrong assembly or a bad
    // coordinate, and every call made from it would be wrong.
    if (refAmplicon.slice(offset, offset + variant.ref.length) !== variant.ref) continue;
    const altAmplicon =
      refAmplicon.slice(0, offset) + variant.alt + refAmplicon.slice(offset + variant.ref.length);
    const baselineDifference = Math.abs(altAmplicon.length - refAmplicon.length);

    for (const enzyme of enzymes) {
      if (enzyme.cut === null) continue;
      const refFragments = refDigests.get(enzyme.name) as number[];
      const altFragments = digestFragments(altAmplicon, enzyme);
      if (refFragments.length === 1 && altFragments.length === 1) continue;
      if (same(refFragments, altFragments)) continue;

      const shared = Math.min(refFragments.length, altFragments.length) - 1;
      let reason: string | null = null;
      if (Math.max(refFragments.length, altFragments.length) - 1 > maxCuts) {
        reason = `cuts the product ${Math.max(refFragments.length, altFragments.length) - 1} times`;
      } else if (baselineDifference >= (options.minDifference ?? 40)) {
        reason = 'the undigested products already differ in size; no enzyme is needed';
      } else if (!digestsDistinguishable(refFragments, altFragments, options)) {
        reason = `the bands differ by less than a gel resolves, or fall below ${minFragment} bp`;
      }
      out.push({
        key: entry.key,
        label: entry.label,
        variant,
        enzyme,
        cuts: refFragments.length >= altFragments.length ? 'ref' : 'alt',
        refFragments,
        altFragments,
        sharedCuts: Math.max(0, shared),
        baselineDifference,
        resolvable: reason === null,
        reason,
        specificity: enzymeSpecificity(enzyme.site),
      });
    }
  }
  // Assays that actually read come first, then the most specific enzyme.
  return out.sort(
    (a, b) =>
      Number(b.resolvable) - Number(a.resolvable) ||
      b.specificity - a.specificity ||
      a.variant.position - b.variant.position ||
      a.enzyme.name.localeCompare(b.enzyme.name),
  );
}

function same(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
