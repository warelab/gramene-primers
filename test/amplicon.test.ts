import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ampliconSeq,
  capsForAmplicon,
  digestAmplicon,
  digestsDistinguishable,
  genomicToTemplatePosition,
  nonCutters,
  singleCutters,
  variantOnTemplate,
  type TemplateVariant,
} from '../src/amplicon';
import { findEnzyme } from '../src/enzymes';
import type { DesignResponse, PrimerTemplate } from '../src/types';
import { fixturePath } from './paths';

function design(name: string): DesignResponse {
  return (JSON.parse(readFileSync(fixturePath('api', `${name}.json`), 'utf8')) as { body: DesignResponse }).body;
}

const geneMinus = design('design-gene-SORBI_3001G000200-flanks');
const transcriptMinus = design('design-transcript-SORBI_3001G000200');
const regionMinus = design('design-region-target-included-excluded');
const plainSequence = design('design-sequence-iupac');
const transcriptPlus = design('design-transcript-SORBI_3004G087700.3');

/** The four variants the primers API reports for 1:11180–11290, on the plus strand. */
const VARIANTS = [
  { key: '1:11182:A:G', label: '1:11182 A/G', vcf: { position: 11182, ref: 'A', alt: 'G' } },
  { key: '1:11193:C:T', label: '1:11193 C/T', vcf: { position: 11193, ref: 'C', alt: 'T' } },
  { key: '1:11203:C:T', label: '1:11203 C/T', vcf: { position: 11203, ref: 'C', alt: 'T' } },
  { key: '1:11282:CA:C', label: '1:11282 CA/C', vcf: { position: 11282, ref: 'CA', alt: 'C' } },
];

const enzyme = (name: string) => {
  const found = findEnzyme(name);
  if (!found) throw new Error(`no ${name} in the panel`);
  return found;
};

const onTemplate = (template: PrimerTemplate) =>
  VARIANTS.map((v) => {
    const variant = variantOnTemplate(template, v.vcf);
    return variant ? { key: v.key, label: v.label, variant } : null;
  }).filter((x): x is { key: string; label: string; variant: TemplateVariant } => x !== null);

describe('genomicToTemplatePosition', () => {
  it('counts forward from the start on a plus-strand span', () => {
    const t = { mode: 'region', region: '4', start: 7547610, end: 7564601, strand: 1 } as PrimerTemplate;
    expect(genomicToTemplatePosition(t, 7547610)).toBe(1);
    expect(genomicToTemplatePosition(t, 7547710)).toBe(101);
  });

  it('counts back from the end on a minus-strand span', () => {
    const t = { mode: 'region', region: '1', start: 11080, end: 15099, strand: -1 } as PrimerTemplate;
    expect(genomicToTemplatePosition(t, 15099)).toBe(1);
    expect(genomicToTemplatePosition(t, 11080)).toBe(4020);
  });

  it('returns null outside the span, and for a pasted sequence with no coordinates', () => {
    const t = { mode: 'region', region: '1', start: 11080, end: 15099, strand: 1 } as PrimerTemplate;
    expect(genomicToTemplatePosition(t, 11079)).toBeNull();
    expect(genomicToTemplatePosition(t, 15100)).toBeNull();
    expect(genomicToTemplatePosition(plainSequence.template, 11193)).toBeNull();
  });

  it('skips introns on a spliced template', () => {
    const exons = transcriptMinus.template.features?.exons ?? [];
    expect(exons.length).toBeGreaterThan(1);
    // A position between two exons is in an intron and has no template image.
    const [first, second] = [...exons].sort((a, b) => a.start - b.start);
    const gapStart = Math.max(first!.genomic!.end, second!.genomic!.end) + 1;
    const inExon = genomicToTemplatePosition(transcriptMinus.template, first!.genomic!.start);
    expect(inExon).not.toBeNull();
    expect(genomicToTemplatePosition(transcriptMinus.template, gapStart - 0)).not.toBe(inExon);
  });
});

describe('variantOnTemplate', () => {
  /**
   * The load-bearing property: whatever coordinate system a template uses, the
   * allele placed on it must be the bases the template actually holds. A
   * minus-strand template holds the reverse complement, so a silent failure
   * here would produce confident, wrong enzyme calls.
   */
  it.each([
    ['gene, minus strand', geneMinus.template],
    ['transcript, minus strand and spliced', transcriptMinus.template],
    ['region, minus strand', regionMinus.template],
  ])('places every real variant on the %s template exactly', (_label, template) => {
    const placed = onTemplate(template);
    expect(placed).toHaveLength(VARIANTS.length);
    for (const { label, variant } of placed) {
      const actual = template.seq.slice(variant.position - 1, variant.position - 1 + variant.ref.length);
      expect(actual, label).toBe(variant.ref);
    }
  });

  it('complements the alleles on a minus-strand template', () => {
    const placed = variantOnTemplate(geneMinus.template, { position: 11193, ref: 'C', alt: 'T' });
    expect(placed).toMatchObject({ ref: 'G', alt: 'A' });
  });

  it('anchors a deletion at the mapped last base when the strand flips', () => {
    // CA>C on the plus strand reads TG>G on the minus strand, and its first
    // template base is the image of the variant's *last* genomic base.
    const placed = variantOnTemplate(geneMinus.template, { position: 11282, ref: 'CA', alt: 'C' });
    expect(placed).toMatchObject({ ref: 'TG', alt: 'G' });
    expect(geneMinus.template.seq.slice(placed!.position - 1, placed!.position + 1)).toBe('TG');
  });

  it('refuses a variant that straddles a splice junction', () => {
    const exons = [...(transcriptMinus.template.features?.exons ?? [])].sort((a, b) => a.start - b.start);
    const boundary = exons[0]!.genomic!;
    // A deletion running off the end of an exon has no contiguous template image.
    const spanning = variantOnTemplate(transcriptMinus.template, {
      position: boundary.start - 1,
      ref: 'A'.repeat(4),
      alt: 'A',
    });
    expect(spanning).toBeNull();
  });

  it('places nothing on a pasted sequence', () => {
    expect(variantOnTemplate(plainSequence.template, { position: 11193, ref: 'C', alt: 'T' })).toBeNull();
  });

  it('agrees with the plus-strand template it is given', () => {
    const t = transcriptPlus.template;
    const exon = (t.features?.exons ?? [])[0];
    expect(exon?.genomic).toBeTruthy();
    const pos = exon!.genomic!.start + 5;
    const at = genomicToTemplatePosition(t, pos)!;
    const base = t.seq[at - 1]!;
    expect(variantOnTemplate(t, { position: pos, ref: base, alt: base === 'A' ? 'C' : 'A' })).toMatchObject({
      position: at,
      ref: base,
    });
  });
});

describe('digestAmplicon', () => {
  const pair = geneMinus.pairs[0]!;
  const span = { start: pair.left.start, end: pair.right.end };
  const digests = digestAmplicon(geneMinus.template.seq, span);

  it('returns fragments that account for the whole product', () => {
    expect(digests.length).toBeGreaterThan(0);
    for (const d of digests) {
      const total = d.fragments.reduce((a, b) => a + b, 0);
      expect(total, d.enzyme.name).toBe(pair.product_size);
      expect(d.fragments.length, d.enzyme.name).toBe(d.cuts.length + 1);
    }
  });

  it('reports sites in template coordinates, inside the amplicon', () => {
    for (const d of digests) {
      for (const site of d.sites) {
        expect(site.start).toBeGreaterThanOrEqual(span.start);
        expect(site.end).toBeLessThanOrEqual(span.end);
        expect(geneMinus.template.seq.slice(site.start - 1, site.end).length).toBe(site.end - site.start + 1);
      }
    }
  });

  it('puts the fewest cuts first, because a single cutter is the readable one', () => {
    const counts = digests.map((d) => d.cuts.length);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
    expect(singleCutters(digests).every((d) => d.cuts.length === 1)).toBe(true);
  });

  it('lists enzymes with no site as safe for cloning', () => {
    const safe = nonCutters(geneMinus.template.seq, span);
    expect(safe.length).toBeGreaterThan(0);
    const cutting = new Set(digests.map((d) => d.enzyme.name));
    expect(safe.some((e) => cutting.has(e.name))).toBe(false);
  });

  it('works on a pasted sequence, which has no coordinates at all', () => {
    const p = plainSequence.pairs[0]!;
    const d = digestAmplicon(plainSequence.template.seq, { start: p.left.start, end: p.right.end });
    expect(d.length).toBeGreaterThan(0);
    expect(d[0]!.fragments.reduce((a, b) => a + b, 0)).toBe(p.product_size);
  });

  it('returns nothing for a span that runs past the template', () => {
    expect(digestAmplicon(geneMinus.template.seq, { start: 1, end: 99_999 })).toEqual([]);
    expect(ampliconSeq(geneMinus.template.seq, { start: 1, end: 99_999 })).toBeNull();
  });
});

describe('digestsDistinguishable', () => {
  it('accepts a band with no counterpart of a similar size', () => {
    expect(digestsDistinguishable([300, 200], [500])).toBe(true);
  });

  it('rejects bands that co-migrate', () => {
    expect(digestsDistinguishable([300, 200], [305, 198])).toBe(false);
  });

  it('ignores a difference that is only in fragments too small to run', () => {
    expect(digestsDistinguishable([480, 20], [490, 10])).toBe(false);
  });
});

describe('capsForAmplicon', () => {
  // A 100 bp window of the minus-strand gene template spanning the variants.
  const span = { start: 3860, end: 3959 };
  const caps = capsForAmplicon(geneMinus.template.seq, span, onTemplate(geneMinus.template));

  it('finds the XbaI assay that 1:11193 C>T gives, with real fragment sizes', () => {
    const xba = caps.find((c) => c.enzyme.name === 'XbaI');
    expect(xba).toBeTruthy();
    expect(xba!.key).toBe('1:11193:C:T');
    expect(xba!.cuts).toBe('ref');
    expect(xba!.refFragments).toEqual([56, 44]);
    expect(xba!.altFragments).toEqual([100]);
    expect(xba!.resolvable).toBe(true);
  });

  it('counts a constitutive cut and still rejects bands that co-migrate', () => {
    // AccI cuts both alleles once regardless, and the extra cut splits 75 into
    // 39 and 36 — a real difference, but not one a gel shows.
    const acc = caps.find((c) => c.enzyme.name === 'AccI');
    expect(acc).toBeTruthy();
    expect(acc!.sharedCuts).toBe(1);
    expect(acc!.refFragments).toEqual([39, 36, 25]);
    expect(acc!.altFragments).toEqual([75, 25]);
    expect(acc!.resolvable).toBe(false);
    expect(acc!.reason).toMatch(/gel resolves|below/);
  });

  it('keeps every digest accounting for its own product', () => {
    for (const c of caps) {
      const refLen = span.end - span.start + 1;
      expect(c.refFragments.reduce((a, b) => a + b, 0)).toBe(refLen);
      expect(c.altFragments.reduce((a, b) => a + b, 0)).toBe(refLen - c.variant.ref.length + c.variant.alt.length);
    }
  });

  it('puts assays that actually read first', () => {
    const flags = caps.map((c) => Number(c.resolvable));
    expect([...flags].sort((a, b) => b - a)).toEqual(flags);
  });

  it('says an indel needs no enzyme when the products already differ enough', () => {
    // One DraI site, and a 60 bp insertion elsewhere: the undigested products
    // are already a length polymorphism, so the enzyme adds nothing.
    const seq = `${'A'.repeat(80)}TTTAAA${'A'.repeat(80)}`;
    const variant: TemplateVariant = { position: 10, ref: 'A', alt: `A${'A'.repeat(60)}` };
    const found = capsForAmplicon(seq, { start: 1, end: seq.length }, [{ key: 'k', label: 'l', variant }], {
      enzymes: [enzyme('DraI')],
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.baselineDifference).toBe(60);
    expect(found[0]!.resolvable).toBe(false);
    expect(found[0]!.reason).toContain('no enzyme is needed');
  });

  it('rejects a ladder too busy to read before anything else', () => {
    // Ten cuts is not a digest anyone can score, whatever else is true of it.
    const seq = `${'A'.repeat(49)}A${'GTTTAAACGG'.repeat(10)}`;
    const variant: TemplateVariant = { position: 50, ref: 'A', alt: `A${'C'.repeat(60)}` };
    const found = capsForAmplicon(seq, { start: 1, end: seq.length }, [{ key: 'k', label: 'l', variant }]);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((c) => !c.resolvable && /cuts the product \d+ times/.test(c.reason ?? ''))).toBe(true);
  });

  it('ignores a variant whose reference allele disagrees with the template', () => {
    const wrong = [{ key: 'x', label: 'x', variant: { position: 3900, ref: 'TTTT', alt: 'A' } as TemplateVariant }];
    expect(capsForAmplicon(geneMinus.template.seq, span, wrong)).toEqual([]);
  });

  it('honours a restricted enzyme panel', () => {
    const only = capsForAmplicon(geneMinus.template.seq, span, onTemplate(geneMinus.template), {
      enzymes: [enzyme('XbaI')],
    });
    expect(only.map((c) => c.enzyme.name)).toEqual(['XbaI']);
  });
});
