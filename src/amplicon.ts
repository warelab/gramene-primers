/**
 * Restriction analysis of a predicted PCR product: which enzymes recognise a
 * site inside it, where those sites are, and what fragments a digest gives.
 *
 * It answers the two everyday questions about an amplicon — which enzyme
 * confirms a band is the product you meant, and which enzymes leave it alone so
 * a site can be added to a primer end. All of it comes from `template.seq`,
 * which every design response already carries, so there is no host callback and
 * it works in every mode including a pasted sequence.
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
