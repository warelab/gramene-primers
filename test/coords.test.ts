import { describe, expect, it } from 'vitest';
import {
  canonicalTranscriptId,
  cdnaToGenomicBlocks,
  formatGenomic,
  formatRegion,
  geneLength,
  geneRelativeToGenomic,
  geneTemplateExtent,
  leftFootprint,
  mismatchGlyphIndex,
  mismatchIndexes,
  productSize,
  revcomp,
  rightFootprint,
  spansJunction,
  templateToGenomic,
  transcriptLayout,
} from '../src/coords';
import { gene200, gene46200, gene700, gene87700, qpcrCheckPair, readSequenceFixture, SEQS, transcriptPair0 } from './fixtures/samples';

describe('revcomp', () => {
  it('is IUPAC-aware and case-preserving', () => {
    expect(revcomp('ACGTRYKMSWBDHVN')).toBe('NBDHVWSKMRYACGT');
    expect(revcomp('AcGt')).toBe('aCgT');
    expect(revcomp('acgtrykmswbdhvn')).toBe('nbdhvwskmryacgt');
    expect(revcomp('ACGU')).toBe('ACGT');
    expect(revcomp('A-C.')).toBe('.G-T');
    expect(revcomp('')).toBe('');
    const s = 'GATCRYKMSWBDHVNgatcrykmswbdhvn';
    expect(revcomp(revcomp(s))).toBe(s);
    expect(revcomp(SEQS.QPCR_R)).toBe('CATGGATCGACAAAGAAGTT');
  });
});

describe('mismatch glyph index = len − pos', () => {
  it('maps 3′ distances to 5′-based indexes', () => {
    expect(mismatchGlyphIndex(22, 10)).toBe(12);
    expect(mismatchGlyphIndex(22, 7)).toBe(15);
    expect(mismatchGlyphIndex(22, 1)).toBe(21);
    expect(mismatchGlyphIndex(22, 22)).toBe(0);
    expect(mismatchGlyphIndex(22, 0)).toBeNull();
    expect(mismatchGlyphIndex(22, 23)).toBeNull();
    expect(mismatchGlyphIndex(22, 1.5)).toBeNull();
    expect(mismatchIndexes(22, [7, 10, 10, 40])).toEqual([12, 15]);
    expect(mismatchIndexes(22, null)).toEqual([]);
  });

  it('matches the verified P2_L chr5 off-target site (mm pos [10, 7])', () => {
    const site = 'GGACAGCTCCACGACCTATCAG';
    const diffs = [...SEQS.P2_L].map((c, i) => (c === site[i] ? -1 : i)).filter((i) => i >= 0);
    expect(diffs).toEqual(mismatchIndexes(SEQS.P2_L.length, [10, 7]));
  });
});

describe('footprints and junctions (spec §A.3)', () => {
  it('Primer3 PRIMER_LEFT/RIGHT positions', () => {
    expect(leftFootprint(39528, 20)).toEqual({ start: 39528, end: 39547 });
    expect(rightFootprint(40043, 20)).toEqual({ start: 40024, end: 40043 });
    expect(productSize(39528, 40043)).toBe(516);
    expect(productSize(transcriptPair0.left.start, transcriptPair0.right.end)).toBe(transcriptPair0.product_size);
  });

  it('left and right junction-spanning rules', () => {
    const left = { start: 856, end: 875 };
    expect(spansJunction('left', left, 869, 7, 4)).toBe(true);
    expect(spansJunction('left', left, 869, 7, 7)).toBe(false);
    const fp = { start: 864, end: 883 };
    expect(spansJunction('right', fp, 869, 7, 4)).toBe(true);
    expect(spansJunction('left', fp, 869, 7, 4)).toBe(false);
    expect(spansJunction('left', left, 900, 7, 4)).toBe(false);
  });

  it('gene/region template mapping (V3 #2: 1:11080-15099(-), t=499 → 14601)', () => {
    expect(geneTemplateExtent(gene200, 200, 100)).toEqual({ start: 11080, end: 15099, length: 4020, effUp: 200 });
    expect(templateToGenomic(499, { start: 11080, end: 15099, strand: -1 })).toBe(14601);
    expect(templateToGenomic(201, { start: 11080, end: 15099, strand: -1 })).toBe(14899);
    expect(geneTemplateExtent(gene700, 200, 100)).toEqual({ start: 53581, end: 63405, length: 9825, effUp: 200 });
    expect(templateToGenomic(201, { start: 53581, end: 63405, strand: 1 })).toBe(53781);
    expect(geneTemplateExtent({ ...gene700, location: { ...gene700.location, start: 50 } }, 200, 0)).toMatchObject({ start: 1, effUp: 49 });
    expect(geneRelativeToGenomic(1, gene200.location)).toBe(14899);
    expect(geneRelativeToGenomic(1, gene700.location)).toBe(53781);
    expect(geneLength(gene200)).toBe(3720);
  });
});

describe('transcript layout against real gene docs and sequence', () => {
  it('SORBI_3001G000200.1 (−): splice, junctions and the verified primer blocks', () => {
    const layout = transcriptLayout(gene200)!;
    expect(canonicalTranscriptId(gene200)).toBe('SORBI_3001G000200.1');
    expect(layout.transcriptId).toBe('SORBI_3001G000200.1');
    expect(layout.length).toBe(1982);
    expect(layout.strand).toBe(-1);
    expect(layout.junctions).toEqual([397, 493, 597, 869, 992, 1081, 1187, 1285, 1546, 1630]);
    expect(layout.segments[0]).toEqual({ exonId: 'EER93047-1', tStart: 1, tEnd: 397, gStart: 14503, gEnd: 14899 });
    expect(layout.cds).toEqual({ start: 299, end: 1651 });
    expect(cdnaToGenomicBlocks(layout, 856, 875)).toEqual([{ start: 13395, end: 13400 }, { start: 13637, end: 13650 }]);
    expect(cdnaToGenomicBlocks(layout, 960, 979)).toEqual([{ start: 13291, end: 13310 }]);
    expect(transcriptPair0.left.genomic?.blocks).toEqual(cdnaToGenomicBlocks(layout, 856, 875));

    const cdna = readSequenceFixture('SORBI_3001G000200.1.cdna.txt');
    expect(cdna).toHaveLength(1982);
    expect(cdna.slice(855, 875)).toBe(SEQS.QPCR_L);
    expect(revcomp(cdna.slice(959, 979))).toBe(SEQS.QPCR_R);
    expect(cdna.slice(298, 301)).toBe('ATG');
  });

  it('every transcript of the fixture genes splices to its annotated length and junctions', () => {
    for (const gene of [gene200, gene700, gene46200, gene87700]) {
      for (const t of gene.gene_structure!.transcripts) {
        const layout = transcriptLayout(gene, t.id)!;
        expect(layout.length, t.id).toBe(t.length);
        if (t.exon_junctions) expect(layout.junctions, t.id).toEqual(t.exon_junctions);
        expect(layout.junctions, t.id).toHaveLength(t.exons.length - 1);
      }
    }
    expect(canonicalTranscriptId(gene46200)).toBe('SORBI_3001G046200.2');
    expect(transcriptLayout(gene46200)!.junctions).toEqual([]);
    expect(transcriptLayout(gene46200, 'SORBI_3001G046200.1')!.junctions).toEqual([532]);
    expect(transcriptLayout(gene46200, 'nope')).toBeNull();
  });

  it('SORBI_3004G087700.3 (+): junction-spanning J_L and P1_R blocks read back from the gene sequence', () => {
    const gene = readSequenceFixture('SORBI_3004G087700.gene.txt');
    const g0 = gene87700.location.start;
    const read = (blocks: { start: number; end: number }[]) => blocks.map((b) => gene.slice(b.start - g0, b.end - g0 + 1)).join('');
    const layout = transcriptLayout(gene87700, 'SORBI_3004G087700.3')!;
    const lb = cdnaToGenomicBlocks(layout, 730, 751);
    expect(lb).toHaveLength(2);
    expect(read(lb)).toBe(SEQS.J_L);
    expect(spansJunction('left', { start: 730, end: 751 }, 743, 7, 4)).toBe(true);
    expect(revcomp(read(cdnaToGenomicBlocks(layout, 986, 1007)))).toBe(SEQS.P1_R);
    expect(read(qpcrCheckPair.left.genomic!.blocks)).toBe(SEQS.J_L);
  });
});

describe('formatting', () => {
  it('formats genomic footprints and regions', () => {
    expect(formatGenomic(transcriptPair0.left.genomic)).toBe('1:13395-13400,13637-13650(-)');
    expect(formatGenomic(transcriptPair0.right.genomic)).toBe('1:13291-13310(+)');
    expect(formatGenomic(transcriptPair0.product.genomic)).toBe('1:13291-13650(-)');
    expect(formatGenomic(null)).toBe('');
    expect(formatRegion('4', 7423537, 7423746)).toBe('4:7423537-7423746');
    expect(formatRegion('4', 7423537, 7423746, 1)).toBe('4:7423537-7423746(+)');
  });
});
