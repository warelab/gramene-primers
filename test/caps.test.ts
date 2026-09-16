import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  capsCall,
  dcapsOpportunities,
  differentialSites,
  digestFragments,
  findSites,
  isResolvable,
  iupacMatcher,
  variantContext,
  verifyWindow,
} from '../src/caps';
import { COMMON_ENZYMES, enzymeSpecificity, findEnzyme, isSixCutter } from '../src/enzymes';
import type { GenotypingDesignResponse, VariantListResponse } from '../src/types';
import { pkgPath } from './paths';

function capture<T>(name: string): T {
  const raw = JSON.parse(readFileSync(pkgPath('test', 'fixtures', 'genotyping', `${name}.json`), 'utf8')) as { response: T };
  return raw.response;
}

const kasp = capture<GenotypingDesignResponse>('capture-genotyping-design-rs871475760-kasp');
const variantList = capture<VariantListResponse>('capture-variants-list-1_11180-11290');

/**
 * The listing window, cut from the design capture's template rather than
 * pasted in, so the sequence cannot drift away from the variants it is checked
 * against. The two captures come from the same assembly and release.
 */
const WINDOW_START = 11180;
const WINDOW_END = 11290;
const windowSeq = kasp.template.seq.slice(WINDOW_START - kasp.template.start, WINDOW_END - kasp.template.start + 1);

const enzyme = (name: string) => {
  const found = findEnzyme(name);
  if (!found) throw new Error(`no ${name} in the panel`);
  return found;
};

describe('iupacMatcher', () => {
  it('expands degenerate codes to character classes', () => {
    expect(iupacMatcher('GTMKAC').source).toBe('GT[AC][GT]AC');
    expect(iupacMatcher('GANTC').source).toBe('GA[ACGT]TC');
    expect(iupacMatcher('RYSWKM').source).toBe('[AG][CT][CG][AT][GT][AC]');
  });

  it('treats U as T and rejects anything that is not a base', () => {
    expect(iupacMatcher('gaattc').source).toBe('GAATTC');
    expect(iupacMatcher('AU').source).toBe('AT');
    expect(() => iupacMatcher('GA-TC')).toThrow(/IUPAC/);
  });
});

describe('findSites', () => {
  it('reports a palindromic site once, not once per strand', () => {
    const sites = findSites('AAAAAAAAAAGAATTCTTTTTTTTTTTTTT', enzyme('EcoRI'));
    expect(sites).toEqual([{ start: 11, end: 16, strand: 1 }]);
  });

  it('finds sites that overlap each other', () => {
    // CC NN GG matches CCCCGGGG in three frames; advancing by a whole match would find one.
    expect(findSites('CCCCGGGG', enzyme('BsaJI')).map((s) => s.start)).toEqual([1, 2, 3]);
  });

  it('matches an interrupted site across its spacer', () => {
    expect(findSites('TTGAACGTATTCTT', enzyme('XmnI'))).toEqual([{ start: 3, end: 12, strand: 1 }]);
  });

  it('is case-insensitive, so soft-masked sequence does not silently read as empty', () => {
    expect(findSites('aaaaaaaaaagaattcttttt', enzyme('EcoRI'))).toHaveLength(1);
  });

  it('scans both strands for a site that is not its own reverse complement', () => {
    const custom = { name: 'TestI', site: 'GGTGA', cut: 1 };
    expect(findSites('AAGGTGAAAAAATCACCAA', custom)).toEqual([
      { start: 3, end: 7, strand: 1 },
      { start: 13, end: 17, strand: -1 },
    ]);
  });
});

describe('digestFragments', () => {
  it('cuts at the top-strand offset', () => {
    // G^AATTC starts at 1-based 11 and severs after the G, at position 11.
    expect(digestFragments('AAAAAAAAAAGAATTCTTTTTTTTTTTTTT', enzyme('EcoRI'))).toEqual([19, 11]);
  });

  it('counts a reverse-strand site from its other end', () => {
    // The recognition sequence reads 3'->5' here, so the cut is the complementary offset.
    const custom = { name: 'TestI', site: 'GGTGA', cut: 1 };
    expect(digestFragments('AAGGTGAAAAAATCACCAA', custom)).toEqual([13, 3, 3]);
  });

  it('leaves a sequence whole when the enzyme cuts outside its site', () => {
    const outside = { name: 'OutsideI', site: 'GGATG', cut: null };
    expect(digestFragments('AAGGATGAAAA', outside)).toEqual([11]);
  });
});

describe('isResolvable', () => {
  it('accepts bands that separate from each other and from the uncut product', () => {
    expect(isResolvable([200, 100], 300)).toBe(true);
  });

  it('rejects a cut that barely shortens the product', () => {
    expect(isResolvable([299, 1], 300)).toBe(false);
  });

  it('rejects a single fragment: nothing was cut', () => {
    expect(isResolvable([300], 300)).toBe(false);
  });
});

describe('variantContext', () => {
  it('splices the alternate allele over the same flanks', () => {
    const ctx = variantContext('AAAACCCCGGGGTTTT', 1, { position: 9, ref: 'G', alt: 'A' }, 4);
    expect(ctx).toEqual({ ref: 'CCCCGGGGTTTT'.slice(0, 4) + 'G' + 'GGGT', alt: 'CCCCAGGGT', at: 5, refLength: 1, altLength: 1 });
  });

  it('refuses sequence that disagrees with the reference allele', () => {
    expect(variantContext('AAAACCCCGGGGTTTT', 1, { position: 9, ref: 'T', alt: 'A' })).toBeNull();
  });

  it('refuses a variant that runs past the window', () => {
    expect(variantContext('AAAACCCC', 1, { position: 8, ref: 'CC', alt: 'C' })).toBeNull();
  });
});

describe('verifyWindow', () => {
  const variants = variantList.variants;

  it('accepts sequence that matches every reference allele the API reports', () => {
    expect(verifyWindow(windowSeq, WINDOW_START, variants)).toEqual({ ok: true, checked: 4, mismatch: null });
  });

  it('rejects the whole window on one disagreement, rather than one variant', () => {
    const i = 11193 - WINDOW_START;
    const corrupt = windowSeq.slice(0, i) + (windowSeq[i] === 'A' ? 'C' : 'A') + windowSeq.slice(i + 1);
    const check = verifyWindow(corrupt, WINDOW_START, variants);
    expect(check.ok).toBe(false);
    expect(check.mismatch?.position).toBe(11193);
  });

  it('reports not-ok rather than throwing when nothing could be checked', () => {
    expect(verifyWindow(windowSeq, 999999, variants)).toEqual({ ok: false, checked: 0, mismatch: null });
  });
});

describe('differentialSites, on the captured window', () => {
  const at = (position: number) => {
    const found = variantList.variants.find((v) => v.vcf?.position === position);
    if (!found?.vcf) throw new Error(`no variant at ${position}`);
    const ctx = variantContext(windowSeq, WINDOW_START, found.vcf);
    if (!ctx) throw new Error(`no context at ${position}`);
    return ctx;
  };

  it('finds the XbaI site that 1:11193 C>T destroys', () => {
    const hits = differentialSites(at(11193));
    expect(hits.map((h) => h.enzyme.name)).toContain('XbaI');
    expect(hits.find((h) => h.enzyme.name === 'XbaI')?.cuts).toBe('ref');
  });

  it('resolves the degenerate AccI site at 1:11203 C>T', () => {
    const hits = differentialSites(at(11203));
    const acc = hits.find((h) => h.enzyme.name === 'AccI');
    expect(acc?.enzyme.site).toBe('GTMKAC');
    expect(acc?.cuts).toBe('ref');
  });

  it('finds nothing for 1:11182 A>G', () => {
    expect(differentialSites(at(11182))).toEqual([]);
  });

  it('does not credit the HinfI site beside the 1:11282 CA>C deletion', () => {
    // GANTC sits just upstream and is carried by both alleles; only the
    // deleted base differs, and it is outside the site.
    expect(differentialSites(at(11282)).map((h) => h.enzyme.name)).not.toContain('HinfI');
  });

  it('ranks six-cutters above four-cutters', () => {
    const hits = differentialSites(at(11193));
    const specificities = hits.map((h) => h.specificity);
    expect([...specificities].sort((a, b) => b - a)).toEqual(specificities);
  });

  it('counts sites rather than testing presence, so a constitutive site cannot mask a lost one', () => {
    // Two EcoRI sites across the variant; the variant destroys the second.
    const ctx = variantContext('CCCCCCCCCCGAATTCGAATTCCCCCCCCCCC', 1, { position: 18, ref: 'A', alt: 'C' });
    expect(ctx).not.toBeNull();
    const hits = differentialSites(ctx!, [enzyme('EcoRI')]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.cuts).toBe('ref');
  });
});

describe('indels', () => {
  it('compares each haplotype over its own span', () => {
    // A two-base insertion: the ALT variant span is longer than the REF one.
    const ctx = variantContext('AAAAAAAAAAGTTTTTTTTTTT', 1, { position: 11, ref: 'G', alt: 'GAATTC' }, 10);
    expect(ctx).not.toBeNull();
    expect(ctx!.refLength).toBe(1);
    expect(ctx!.altLength).toBe(6);
    const hits = differentialSites(ctx!, [enzyme('EcoRI')]);
    expect(hits.map((h) => h.cuts)).toEqual(['alt']);
  });

  it('places a downstream mismatch at the right index in each haplotype', () => {
    // REF and ALT differ in length, so the same template base sits at
    // different offsets; both must be changed together.
    const ctx = variantContext('AAAAAAAAAACCGTTTTTTTTTT', 1, { position: 11, ref: 'CC', alt: 'C' }, 10);
    expect(ctx).not.toBeNull();
    for (const op of dcapsOpportunities(ctx!)) {
      if (op.side !== 'downstream') continue;
      const refIndex = ctx!.at - 1 + ctx!.refLength - 1 + op.offset;
      const altIndex = ctx!.at - 1 + ctx!.altLength - 1 + op.offset;
      expect(ctx!.ref[refIndex]).toBe(op.from);
      expect(ctx!.alt[altIndex]).toBe(op.from);
    }
  });
});

describe('capsCall', () => {
  const at = (position: number) => {
    const found = variantList.variants.find((v) => v.vcf?.position === position)!;
    return variantContext(windowSeq, WINDOW_START, found.vcf!)!;
  };

  it('reports a natural site and does not bother looking for a mismatch', () => {
    const call = capsCall(at(11193));
    expect(call.verdict).toBe('caps');
    expect(call.dcaps).toEqual([]);
  });

  it('falls back to a dCAPS opportunity within reach of the variant', () => {
    const call = capsCall(at(11182));
    expect(call.verdict).toBe('dcaps');
    expect(call.sites).toEqual([]);
    const best = call.dcaps[0]!;
    expect(best.offset).toBeGreaterThanOrEqual(1);
    expect(best.offset).toBeLessThanOrEqual(12);
    expect(best.from).not.toBe(best.to);
  });

  it('honours a panel of one enzyme', () => {
    expect(capsCall(at(11193), { enzymes: [enzyme('EcoRI')], dcaps: false }).verdict).toBe('none');
  });

  it('skips the dCAPS scan when asked to', () => {
    expect(capsCall(at(11182), { dcaps: false })).toEqual({ verdict: 'none', sites: [], dcaps: [] });
  });

  it('finds no opportunity at all with an empty panel', () => {
    expect(capsCall(at(11193), { enzymes: [] }).verdict).toBe('none');
  });
});

describe('dcapsOpportunities', () => {
  it('reports the mismatch a primer would have to carry', () => {
    const ctx = variantContext(windowSeq, WINDOW_START, { position: 11182, ref: 'A', alt: 'G' })!;
    for (const op of dcapsOpportunities(ctx)) {
      const index = op.side === 'upstream' ? ctx.at - 1 - op.offset : ctx.at - 1 + ctx.refLength - 1 + op.offset;
      expect(ctx.ref[index]).toBe(op.from);
      // Substituting the reported base is what creates the site.
      const probe = { ...ctx, ref: ctx.ref.slice(0, index) + op.to + ctx.ref.slice(index + 1) };
      const mutated = { ...probe, alt: ctx.alt.slice(0, index) + op.to + ctx.alt.slice(index + 1) };
      expect(differentialSites(mutated, [op.enzyme]).length).toBeGreaterThan(0);
    }
  });

  it('keeps the mismatch within reach', () => {
    const ctx = variantContext(windowSeq, WINDOW_START, { position: 11182, ref: 'A', alt: 'G' })!;
    expect(dcapsOpportunities(ctx, COMMON_ENZYMES, 4).every((o) => o.offset <= 4)).toBe(true);
  });
});

describe('the bundled panel', () => {
  it('has unique names and well-formed sites', () => {
    const names = COMMON_ENZYMES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    for (const e of COMMON_ENZYMES) {
      expect(e.site, e.name).toMatch(/^[ACGTURYSWKMBDHVN]+$/);
      expect(() => iupacMatcher(e.site), e.name).not.toThrow();
      if (e.cut !== null) expect(e.cut, e.name).toBeLessThanOrEqual(e.site.length);
    }
  });

  it('scores an interrupted site by its informative bases, not its length', () => {
    expect(enzymeSpecificity('GAANNNNTTC')).toBe(4096);
    expect(isSixCutter(enzyme('XmnI'))).toBe(true);
    expect(isSixCutter(enzyme('HaeIII'))).toBe(false);
    expect(enzymeSpecificity('GTMKAC')).toBe(1024);
  });
});
