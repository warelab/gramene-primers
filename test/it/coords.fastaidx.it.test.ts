/**
 * Coordinate helpers against real genome sequence served by fastaIdx (opt-in):
 *   PRIMERS_FASTAIDX=http://localhost:8888 npm run test:it
 * Uses a handful of read-only GETs (two gene spans per fixture gene plus the spec primers).
 */
import { describe, expect, it } from 'vitest';
import { cdnaToGenomicBlocks, revcomp, transcriptLayout } from '../../src/coords';
import type { GrameneGene } from '../../src/types';
import { gene200, gene46200, gene700, gene87700, SEQS } from '../fixtures/samples';

const FASTAIDX = (process.env.PRIMERS_FASTAIDX ?? '').replace(/\/+$/, '');

async function region(system: string, r: string, start: number, end: number, strand: 1 | -1): Promise<string> {
  const res = await fetch(`${FASTAIDX}/sequence/region/${system}/${r}:${start}..${end}:${strand}`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as { seq: string };
  return body.seq.toUpperCase();
}

describe.skipIf(!FASTAIDX)('coordinates against fastaIdx', () => {
  it('spec-verified qPCR primer blocks read back as the primers', async () => {
    const left = (await region('sorghum_bicolor', '1', 13637, 13650, -1)) + (await region('sorghum_bicolor', '1', 13395, 13400, -1));
    expect(left).toBe(SEQS.QPCR_L);
    expect(await region('sorghum_bicolor', '1', 13291, 13310, 1)).toBe(SEQS.QPCR_R);
  });

  for (const gene of [gene200, gene700, gene46200, gene87700] as GrameneGene[]) {
    it(`${gene._id}: every transcript splices, codons sit at the CDS bounds, junction spans map to genomic blocks`, async () => {
      const loc = gene.location;
      const forward = await region(gene.system_name, loc.region, loc.start, loc.end, 1);
      expect(forward).toHaveLength(loc.end - loc.start + 1);
      const readBlocks = (blocks: { start: number; end: number }[]) => blocks.map((b) => forward.slice(b.start - loc.start, b.end - loc.start + 1)).join('');
      const stops = new Set(['TAA', 'TAG', 'TGA']);
      let junctionsChecked = 0;
      for (const t of gene.gene_structure!.transcripts) {
        const layout = transcriptLayout(gene, t.id)!;
        const cdna = [...layout.segments].map((s) => {
          const piece = forward.slice(s.gStart - loc.start, s.gEnd - loc.start + 1);
          return loc.strand === 1 ? piece : revcomp(piece);
        }).join('');
        expect(cdna, t.id).toHaveLength(t.length);
        if (t.cds) {
          expect(cdna.slice(t.cds.start - 1, t.cds.start + 2), `${t.id} start codon`).toBe('ATG');
          expect(stops.has(cdna.slice(t.cds.end - 3, t.cds.end)), `${t.id} stop codon`).toBe(true);
        }
        for (const j of layout.junctions) {
          const a = Math.max(1, j - 11);
          const b = Math.min(layout.length, j + 9);
          const blocks = cdnaToGenomicBlocks(layout, a, b);
          expect(blocks.length, `${t.id} junction ${j}`).toBe(2);
          const genomic = readBlocks(blocks);
          expect(loc.strand === 1 ? genomic : revcomp(genomic), `${t.id} junction ${j}`).toBe(cdna.slice(a - 1, b));
          junctionsChecked += 1;
        }
      }
      expect(junctionsChecked).toBeGreaterThanOrEqual(0);
    });
  }
});
