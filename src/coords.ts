import type { GenomicBlock, GrameneGene, PrimerGenomic, ProductGenomic, Strand } from './types';

const COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', U: 'A', G: 'C', C: 'G',
  R: 'Y', Y: 'R', K: 'M', M: 'K', S: 'S', W: 'W',
  B: 'V', V: 'B', D: 'H', H: 'D', N: 'N',
  a: 't', t: 'a', u: 'a', g: 'c', c: 'g',
  r: 'y', y: 'r', k: 'm', m: 'k', s: 's', w: 'w',
  b: 'v', v: 'b', d: 'h', h: 'd', n: 'n',
};

/** IUPAC-aware, case-preserving reverse complement (same rules as the server). */
export function revcomp(seq: string): string {
  let out = '';
  for (let i = seq.length - 1; i >= 0; i--) {
    const ch = seq[i] as string;
    out += COMPLEMENT[ch] ?? ch;
  }
  return out;
}

/**
 * 0-based index (from the 5' end) of a mismatch reported as a distance from
 * the 3' end (`left_mm_pos`/`right_mm_pos`, 1 = terminal base): `len − pos`.
 * Returns null when the position is outside the primer.
 */
export function mismatchGlyphIndex(len: number, pos: number): number | null {
  if (!Number.isInteger(len) || !Number.isInteger(pos) || pos < 1 || pos > len) return null;
  return len - pos;
}

/** Sorted, de-duplicated 5'-based indexes for a list of 3'-distances. */
export function mismatchIndexes(len: number, positions: readonly number[] | null | undefined): number[] {
  const set = new Set<number>();
  for (const p of positions ?? []) {
    const i = mismatchGlyphIndex(len, p);
    if (i !== null) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}

/** Left primer footprint from Primer3 `PRIMER_LEFT_i=pos,len`: `[pos, pos+len-1]`. */
export function leftFootprint(pos: number, len: number): GenomicBlock {
  return { start: pos, end: pos + len - 1 };
}

/** Right primer footprint from Primer3 `PRIMER_RIGHT_i=pos,len` (pos = rightmost base): `[pos-len+1, pos]`. */
export function rightFootprint(pos: number, len: number): GenomicBlock {
  return { start: pos - len + 1, end: pos };
}

/** `product_size = right.end − left.start + 1`. */
export function productSize(leftStart: number, rightEnd: number): number {
  return rightEnd - leftStart + 1;
}

/**
 * Junction `j` is the boundary between cDNA bases j and j+1. A left primer
 * `[a,b]` spans it when `j−a+1 ≥ min5` and `b−j ≥ min3`; a right primer when
 * `j−a+1 ≥ min3` and `b−j ≥ min5` (its 3' end is on the left).
 */
export function spansJunction(side: 'left' | 'right', fp: GenomicBlock, j: number, min5: number, min3: number): boolean {
  const upstream = j - fp.start + 1;
  const downstream = fp.end - j;
  return side === 'left' ? upstream >= min5 && downstream >= min3 : upstream >= min3 && downstream >= min5;
}

/** Template position → genomic for gene/region templates: `strand==1 ? start+t−1 : end−t+1`. */
export function templateToGenomic(t: number, span: { start: number; end: number; strand: Strand }): number {
  return span.strand === 1 ? span.start + t - 1 : span.end - t + 1;
}

/** Gene-relative position → genomic: `strand==1 ? loc.start+p−1 : loc.end−p+1`. */
export function geneRelativeToGenomic(p: number, loc: { start: number; end: number; strand: Strand }): number {
  return loc.strand === 1 ? loc.start + p - 1 : loc.end - p + 1;
}

export interface TranscriptSegment {
  exonId: string;
  /** cDNA coordinates, 1-based inclusive. */
  tStart: number;
  tEnd: number;
  /** Genomic coordinates (ascending). */
  gStart: number;
  gEnd: number;
}

export interface TranscriptLayout {
  transcriptId: string;
  length: number;
  strand: Strand;
  region: string;
  segments: TranscriptSegment[];
  /** Cumulative segment ends except the last. */
  junctions: number[];
  cds: GenomicBlock | null;
}

/** The transcript id used by default: `canonical_transcript`, else the first transcript. */
export function canonicalTranscriptId(gene: GrameneGene | null | undefined): string | null {
  const gs = gene?.gene_structure;
  if (!gs) return null;
  if (gs.canonical_transcript && gs.transcripts?.some((t) => t.id === gs.canonical_transcript)) return gs.canonical_transcript;
  return gs.transcripts?.[0]?.id ?? null;
}

/**
 * Splices a transcript from a Gramene gene doc (spec §A.4.4): exons are
 * gene-relative, 1-based, listed in `transcript.exons` (transcription) order.
 * Returns null when the structure is missing or inconsistent.
 */
export function transcriptLayout(gene: GrameneGene, transcriptId?: string | null): TranscriptLayout | null {
  const gs = gene.gene_structure;
  const loc = gene.location;
  if (!gs || !loc) return null;
  const tid = transcriptId ?? canonicalTranscriptId(gene);
  const tr = gs.transcripts?.find((t) => t.id === tid);
  if (!tr) return null;
  const byId = new Map(gs.exons.map((e) => [e.id, e]));
  const segments: TranscriptSegment[] = [];
  let cum = 0;
  for (const exonId of tr.exons) {
    const e = byId.get(exonId);
    if (!e) return null;
    const n = e.end - e.start + 1;
    const gStart = loc.strand === 1 ? loc.start + e.start - 1 : loc.end - e.end + 1;
    const gEnd = loc.strand === 1 ? loc.start + e.end - 1 : loc.end - e.start + 1;
    segments.push({ exonId, tStart: cum + 1, tEnd: cum + n, gStart, gEnd });
    cum += n;
  }
  return {
    transcriptId: tr.id,
    length: cum,
    strand: loc.strand,
    region: loc.region,
    segments,
    junctions: segments.slice(0, -1).map((s) => s.tEnd),
    cds: tr.cds ? { start: tr.cds.start, end: tr.cds.end } : null,
  };
}

/** Maps a cDNA span to ascending genomic blocks (spec §A.4.4 step 7). */
export function cdnaToGenomicBlocks(layout: TranscriptLayout, start: number, end: number): GenomicBlock[] {
  const blocks: GenomicBlock[] = [];
  for (const s of layout.segments) {
    const lo = Math.max(start, s.tStart);
    const hi = Math.min(end, s.tEnd);
    if (lo > hi) continue;
    if (layout.strand === 1) {
      blocks.push({ start: s.gStart + lo - s.tStart, end: s.gStart + hi - s.tStart });
    } else {
      blocks.push({ start: s.gEnd - (hi - s.tStart), end: s.gEnd - (lo - s.tStart) });
    }
  }
  return blocks.sort((a, b) => a.start - b.start);
}

/** Template extent of a gene-mode template (region length unknown client-side, so only `start ≥ 1` is clamped). */
export function geneTemplateExtent(gene: GrameneGene, flankUp = 0, flankDown = 0): { start: number; end: number; length: number; effUp: number } {
  const { start, end, strand } = gene.location;
  const up = Math.max(0, flankUp);
  const down = Math.max(0, flankDown);
  const gStart = strand === 1 ? Math.max(1, start - up) : Math.max(1, start - down);
  const gEnd = strand === 1 ? end + down : end + up;
  const effUp = strand === 1 ? start - gStart : gEnd - end;
  return { start: gStart, end: gEnd, length: gEnd - gStart + 1, effUp };
}

export function geneLength(gene: Pick<GrameneGene, 'location'>): number {
  return gene.location.end - gene.location.start + 1;
}

const strandSign = (s: Strand | null | undefined) => (s === -1 ? '-' : '+');

/** `1:13395-13400,13637-13650(-)`; empty string for null. */
export function formatGenomic(g: PrimerGenomic | ProductGenomic | null | undefined): string {
  if (!g) return '';
  const blocks = 'blocks' in g && Array.isArray(g.blocks) && g.blocks.length ? g.blocks : [{ start: g.start, end: g.end }];
  return `${g.region}:${blocks.map((b) => `${b.start}-${b.end}`).join(',')}(${strandSign(g.strand)})`;
}

/** `4:7423537-7423746`. */
export function formatRegion(region: string, start: number, end: number, strand?: Strand | null): string {
  return `${region}:${start}-${end}${strand ? `(${strandSign(strand)})` : ''}`;
}
