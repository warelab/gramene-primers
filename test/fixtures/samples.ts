/**
 * Sample API payloads for unit tests. Coordinates and sequences of the
 * sorghum_bicolor pairs were verified against the genome (fastaIdx);
 * Tm/GC/penalty and check statuses marked "illustrative" are not.
 */
import { readFileSync } from 'node:fs';
import { cdnaToGenomicBlocks, transcriptLayout } from '../../src/coords';
import { fixturePath } from '../paths';
import type {
  CheckJob,
  CheckRequest,
  DesignResponse,
  GenomeEntry,
  GenomesResponse,
  GrameneGene,
  PrimerOligo,
  PrimerPair,
  Strand,
} from '../../src/types';
import gene200Json from './genes/SORBI_3001G000200.json';
import gene700Json from './genes/SORBI_3001G000700.json';
import gene46200Json from './genes/SORBI_3001G046200.json';
import gene87700Json from './genes/SORBI_3004G087700.json';

export const gene200 = gene200Json as unknown as GrameneGene;
export const gene700 = gene700Json as unknown as GrameneGene;
export const gene46200 = gene46200Json as unknown as GrameneGene;
export const gene87700 = gene87700Json as unknown as GrameneGene;

export function readSequenceFixture(name: string): string {
  return readFileSync(fixturePath('sequences', name), 'utf8').trim();
}

// Primer sequences (spec §10.4)
export const SEQS = {
  P1_L: 'GATCGACAATCCGACGATAGAAG',
  P1_R: 'GTGAACATCATGCTGCCCGATG',
  P2_L: 'GGACAGCTCCACAACATATCAG',
  P2_R: 'GGACATTTGAAGCCCATGGCC',
  P3_L: 'GATATCAGTGGAATCATAAGACCG',
  P3_R: 'CATCGATATCAGGATCTGGCTT',
  P5_L: 'CGACGAGGAGGCGCTGCGATG',
  J_L: 'CCAACAAAGTCATGGATGCACT',
  QPCR_L: 'ATTACATCAAATAGGCCTTG',
  QPCR_R: 'AACTTCTTTGTCGATCCATG',
} as const;

function oligo(seq: string, start: number, end: number, extra: Partial<PrimerOligo> = {}): PrimerOligo {
  return {
    seq,
    start,
    end,
    len: seq.length,
    tm: 60,
    gc: 50,
    self_any_th: 0,
    self_end_th: 0,
    hairpin_th: 0,
    end_stability: 3,
    penalty: 0.1,
    junction: null,
    genomic: null,
    ...extra,
  };
}

/** Gene-mode pair on SORBI_3004G087700 (+1, 4:7421357-7428285, flanks 0) from genomic expected coordinates. */
export function genePair(rank: number, left: string, right: string, gStart: number, gEnd: number): PrimerPair {
  const g0 = 7421357;
  const ls = gStart - g0 + 1;
  const re = gEnd - g0 + 1;
  const rs = re - right.length + 1;
  const strand: Strand = 1;
  return {
    rank,
    penalty: 0.2 + rank / 10,
    product_size: re - ls + 1,
    product_tm: 82.5,
    compl_any_th: 0,
    compl_end_th: 0,
    left: oligo(left, ls, ls + left.length - 1, {
      tm: 60.14,
      gc: 50,
      genomic: { region: '4', start: gStart, end: gStart + left.length - 1, strand, blocks: [{ start: gStart, end: gStart + left.length - 1 }] },
    }),
    right: oligo(right, rs, re, {
      tm: 61.02,
      gc: 57.14,
      genomic: { region: '4', start: gEnd - right.length + 1, end: gEnd, strand: -1, blocks: [{ start: gEnd - right.length + 1, end: gEnd }] },
    }),
    product: { start: ls, end: re, genomic: { region: '4', start: gStart, end: gEnd, strand } },
  };
}

export const genePairs: PrimerPair[] = [
  genePair(0, SEQS.P1_L, SEQS.P1_R, 7422190, 7422843),
  genePair(1, SEQS.P2_L, SEQS.P2_R, 7423537, 7423746),
  genePair(2, SEQS.P3_L, SEQS.P3_R, 7422482, 7423061),
];

export function geneDesign(): DesignResponse {
  const seq = readSequenceFixture('SORBI_3004G087700.gene.txt');
  return {
    template: {
      mode: 'gene',
      system_name: 'sorghum_bicolor',
      gene_id: 'SORBI_3004G087700',
      transcript_id: 'SORBI_3004G087700.3',
      region: '4',
      start: 7421357,
      end: 7428285,
      strand: 1,
      length: seq.length,
      seq,
      masked: false,
      mask_source: null,
      mask: [],
      masked_fraction: 0,
      features: { gene: { start: 1, end: seq.length }, exons: [], cds: null, junctions: [] },
    },
    pairs: genePairs,
    explain: { left: { raw: 'considered 100, ok 10', considered: 100, ok: 10 }, right: { raw: 'considered 100, ok 12', considered: 100, ok: 12 }, pair: { raw: 'considered 40, ok 3', considered: 40, ok: 3 } },
    settings: { preset: 'pcr', junction_spanning: false, avoid_repeats: false, repeat_mask_mode: null, params: { opt_size: 20 } },
    engine: { primer3: '2.6.1' },
    warnings: [],
  };
}

/** Verified qPCR pair on SORBI_3001G000200.1 (spec §A.2.1 example). */
export const transcriptPair0: PrimerPair = {
  rank: 0,
  penalty: 0.41,
  product_size: 124,
  product_tm: 81.2,
  compl_any_th: 0,
  compl_end_th: 0,
  left: oligo(SEQS.QPCR_L, 856, 875, {
    tm: 59.1,
    gc: 35,
    junction: { position: 869, overlap_5p: 14, overlap_3p: 6 },
    genomic: { region: '1', start: 13395, end: 13650, strand: -1, blocks: [{ start: 13395, end: 13400 }, { start: 13637, end: 13650 }] },
  }),
  right: oligo(SEQS.QPCR_R, 960, 979, {
    tm: 59.8,
    gc: 40,
    genomic: { region: '1', start: 13291, end: 13310, strand: 1, blocks: [{ start: 13291, end: 13310 }] },
  }),
  product: { start: 856, end: 979, genomic: { region: '1', start: 13291, end: 13650, strand: -1 }, genomic_size: 360 },
};

export function transcriptDesign(): DesignResponse {
  const seq = readSequenceFixture('SORBI_3001G000200.1.cdna.txt');
  return {
    template: {
      mode: 'transcript',
      system_name: 'sorghum_bicolor',
      gene_id: 'SORBI_3001G000200',
      transcript_id: 'SORBI_3001G000200.1',
      region: '1',
      start: 11180,
      end: 14899,
      strand: -1,
      length: 1982,
      seq,
      masked: false,
      mask_source: null,
      mask: [],
      masked_fraction: 0,
      features: {
        gene: null,
        exons: [{ id: 'EER93047-1', start: 1, end: 397, genomic: { start: 14503, end: 14899 } }],
        cds: { start: 299, end: 1651 },
        junctions: [397, 493, 597, 869, 992, 1081, 1187, 1285, 1546, 1630],
      },
    },
    pairs: [transcriptPair0],
    explain: null,
    settings: { preset: 'qpcr', junction_spanning: true, avoid_repeats: false, repeat_mask_mode: null, params: {} },
    engine: { primer3: '2.6.1' },
    warnings: [],
  };
}

/**
 * qPCR J_L + P1_R on SORBI_3004G087700.3: J_L at cDNA 730–751 (spans junction 743),
 * P1_R footprint 986–1007, product 278 bp (positions verified against the genome).
 */
export function qpcrPairOn87700(): PrimerPair {
  const layout = transcriptLayout(gene87700, 'SORBI_3004G087700.3')!;
  const lb = cdnaToGenomicBlocks(layout, 730, 751);
  const rb = cdnaToGenomicBlocks(layout, 986, 1007);
  const env = (b: { start: number; end: number }[]) => ({ start: b[0]!.start, end: b[b.length - 1]!.end });
  const product = env([...lb, ...rb].sort((a, b) => a.start - b.start));
  return {
    rank: 0,
    penalty: 0.5,
    product_size: 278,
    product_tm: 83,
    left: oligo(SEQS.J_L, 730, 751, { junction: { position: 743, overlap_5p: 14, overlap_3p: 8 }, genomic: { region: '4', ...env(lb), strand: 1, blocks: lb } }),
    right: oligo(SEQS.P1_R, 986, 1007, { genomic: { region: '4', ...env(rb), strand: -1, blocks: rb } }),
    product: { start: 730, end: 1007, genomic: { region: '4', ...product, strand: 1 }, genomic_size: product.end - product.start + 1 },
  };
}

export const qpcrCheckPair: PrimerPair = qpcrPairOn87700();

export function sequencePair(rank: number, productSize: number): PrimerPair {
  const left = oligo('ACGTACGTACGTACGTACGT', 10, 29);
  const right = oligo('TTGCATGCATGCATGCATGC', 10 + productSize - 20, 9 + productSize);
  return { rank, penalty: 1, product_size: productSize, product_tm: null, left, right, product: { start: 10, end: 9 + productSize, genomic: null } };
}

export const P2_REQUEST: CheckRequest = {
  system_name: 'sorghum_bicolor',
  mode: 'gene',
  gene_id: 'SORBI_3004G087700',
  checks: ['pangenome', 'specificity'],
  genomes: ['sorghum_353', 'sorghum_grassl', 'sorghum_leoti'],
  params: { max_product_size: 4000, ignore_mismatches: 6, max_amplifying_mismatches: 3, min_total_mismatches: 2, min_3p_mismatches: 2, three_prime_window: 5, include_unlikely: false, repeat_site_threshold: 5 },
  pairs: [
    { id: 'P2', left: SEQS.P2_L, right: SEQS.P2_R, expected: { region: '4', start: 7423537, end: 7423746 } },
    { id: 'P3', left: SEQS.P3_L, right: SEQS.P3_R, expected: { region: '4', start: 7422482, end: 7423061 } },
  ],
};

/** Finished check for P2 and P3 (P2 specificity from spec §B.12; pan-genome statuses partly illustrative). */
export function doneCheckJob(): CheckJob {
  return {
    job_id: '9f2c0a4be1d34c7a8e5f00112233aabb',
    status: 'done',
    kind: 'pangenome',
    partial: false,
    progress: { done: 5, total: 5, stage: 'done', running: [] },
    created_at: '2026-09-12T20:01:02.000Z',
    finished_at: '2026-09-12T20:05:02.000Z',
    request: P2_REQUEST,
    warnings: [],
    results: {
      engine: { algorithm_version: '1', blast: '2.13.0', reference: 'blastn-short r1 p-1 ws5 ungapped e30000 searchsp1.5e10', pangenome: 'blastn-short r1 p-1 ws6 ungapped e30000 searchsp1.5e10' },
      params: { max_product_size: 4000, ignore_mismatches: 6, max_amplifying_mismatches: 3, min_total_mismatches: 2, min_3p_mismatches: 2, three_prime_window: 5, include_unlikely: false, repeat_site_threshold: 5 },
      reference: { system_name: 'sorghum_bicolor', map_id: 'GCA_000003195.3', total_bases: 708735318 },
      sensitivity_note: 'Sites are detected only if they contain an exact match of at least the word size…',
      primers: {
        [SEQS.P2_L]: { len: 22, near_perfect_sites: 2, repetitive: false, truncated: false, sensitivity: { reference: { word_size: 5, guaranteed_max_mismatches: 3 }, pangenome: { word_size: 6, guaranteed_max_mismatches: 2 } } },
        [SEQS.P2_R]: { len: 21, near_perfect_sites: 2, repetitive: false, truncated: false },
        [SEQS.P3_L]: { len: 24, near_perfect_sites: 2, repetitive: false, truncated: false },
        [SEQS.P3_R]: { len: 22, near_perfect_sites: 9, repetitive: true, truncated: false },
      },
      specificity: {
        target: 'genome',
        pairs: [
          {
            id: 'P2',
            verdict: 'off_targets',
            on_target_inferred: false,
            truncated: false,
            on_target: { region: '4', start: 7423537, end: 7423746, size: 210, orientation: 'LR', likelihood: 'likely', left_mm: 0, right_mm: 0, left_3p_mm: 0, right_3p_mm: 0, left_mm_pos: [], right_mm_pos: [], genes: [{ id: 'SORBI_3004G087700', strand: 1 }] },
            off_target_count: 2,
            unlikely_count: 0,
            off_targets: [
              { region: '4', start: 7437317, end: 7437526, size: 210, orientation: 'LR', likelihood: 'likely', left_mm: 0, right_mm: 0, left_3p_mm: 0, right_3p_mm: 0, left_mm_pos: [], right_mm_pos: [], approx: false, genes: [{ id: 'SORBI_3004G087800', strand: 1 }] },
              { region: '5', start: 66890615, end: 66890824, size: 210, orientation: 'RL', likelihood: 'likely', left_mm: 2, right_mm: 2, left_3p_mm: 0, right_3p_mm: 0, left_mm_pos: [10, 7], right_mm_pos: [15, 10], approx: false, genes: [{ id: 'SORBI_3005G183900', strand: -1 }] },
            ],
            gdna_products: [],
          },
          {
            id: 'P3',
            verdict: 'off_targets',
            on_target_inferred: false,
            truncated: false,
            on_target: { region: '4', start: 7422482, end: 7423061, size: 580, orientation: 'LR', likelihood: 'likely', left_mm: 0, right_mm: 0, left_3p_mm: 0, right_3p_mm: 0, left_mm_pos: [], right_mm_pos: [], genes: [{ id: 'SORBI_3004G087700', strand: 1 }] },
            off_target_count: 1,
            unlikely_count: 0,
            off_targets: [
              { region: '4', start: 7436221, end: 7436845, size: 625, orientation: 'LR', likelihood: 'likely_weak', left_mm: 1, right_mm: 0, left_3p_mm: 1, right_3p_mm: 0, left_mm_pos: [1], right_mm_pos: [], approx: false, genes: [{ id: 'SORBI_3004G087800', strand: 1 }] },
            ],
            gdna_products: [],
          },
        ],
      },
      transcriptome: null,
      pangenome: {
        target: 'genome',
        pairs: [
          {
            id: 'P2',
            reference_size: 210,
            summary: { genomes_total: 3, single_perfect: 1, single_mismatch: 0, multiple: 1, no_amplicon: 1, db_unavailable: 0, error: 0, amplifies: 2, truncated: 0 },
            genomes: [
              { system_name: 'sorghum_353', display_name: 'Sb verticilliflorum 353', status: 'single_perfect', ortholog_annotated: true, primary: { region: '4', start: 7500000, end: 7500209, strand: 1, size: 210, size_delta: 0, orientation: 'LR', likelihood: 'likely', left_mm: 0, right_mm: 0, left_3p_mm: 0, right_3p_mm: 0, left_mm_pos: [], right_mm_pos: [], mismatch_in_3p_window: false, terminal_mismatch: false, genes: [{ id: '353.004G093400' }], ortholog: true }, other_amplicons: 0, others: [], nearest: null },
              { system_name: 'sorghum_grassl', display_name: '=HYPERLINK("http://x")', status: 'multiple', ortholog_annotated: true, primary: { region: '4', start: 7400000, end: 7400209, strand: 1, size: 210, size_delta: 0, orientation: 'LR', likelihood: 'likely', left_mm: 0, right_mm: 0, left_3p_mm: 0, right_3p_mm: 0, left_mm_pos: [], right_mm_pos: [], mismatch_in_3p_window: false, terminal_mismatch: false, genes: [], ortholog: true }, other_amplicons: 1, others: [], nearest: null },
              { system_name: 'sorghum_leoti', display_name: 'Sb leoti', status: 'no_amplicon', ortholog_annotated: false, primary: null, other_amplicons: 0, others: [], nearest: null },
            ],
          },
          {
            id: 'P3',
            reference_size: 580,
            summary: { genomes_total: 3, single_perfect: 0, single_mismatch: 3, multiple: 0, no_amplicon: 0, db_unavailable: 0, error: 0, amplifies: 3, truncated: 0 },
            genomes: [
              { system_name: 'sorghum_353', display_name: 'Sb verticilliflorum 353', status: 'single_mismatch', ortholog_annotated: true, primary: { region: '4', start: 7499931, end: 7500510, strand: 1, size: 580, size_delta: 0, orientation: 'LR', likelihood: 'likely_weak', left_mm: 1, right_mm: 0, left_3p_mm: 1, right_3p_mm: 0, left_mm_pos: [1], right_mm_pos: [], mismatch_in_3p_window: true, terminal_mismatch: true, genes: [{ id: '353.004G093500' }], ortholog: true }, other_amplicons: 0, others: [], nearest: null },
              { system_name: 'sorghum_grassl', display_name: 'Sb grassl', status: 'single_mismatch', ortholog_annotated: true, primary: { size: 580, size_delta: 0, likelihood: 'likely_weak', left_mm: 1, right_mm: 0, left_3p_mm: 1, right_3p_mm: 0, left_mm_pos: [1], right_mm_pos: [], mismatch_in_3p_window: true, terminal_mismatch: true, ortholog: true }, other_amplicons: 0, others: [], nearest: null },
              { system_name: 'sorghum_leoti', display_name: 'Sb leoti', status: 'single_mismatch', ortholog_annotated: true, primary: { size: 581, size_delta: 1, likelihood: 'likely', left_mm: 0, right_mm: 1, left_3p_mm: 0, right_3p_mm: 0, left_mm_pos: [], right_mm_pos: [12], mismatch_in_3p_window: false, terminal_mismatch: false, ortholog: true }, other_amplicons: 0, others: [], nearest: null },
            ],
          },
        ],
      },
      warnings: [],
      timings_ms: { reference: 11000, sorghum_353: 1500 },
    },
  };
}

/** Transcript-mode check results for J_L + P1_R (spec §10.4 qPCR case; mismatch details illustrative). */
export function transcriptCheckJob(): CheckJob {
  return {
    job_id: '0123456789abcdef0123456789abcdef',
    status: 'done',
    kind: 'pangenome',
    partial: false,
    progress: { done: 3, total: 3, stage: 'done', running: [] },
    request: { system_name: 'sorghum_bicolor', mode: 'transcript', gene_id: 'SORBI_3004G087700', transcript_id: 'SORBI_3004G087700.3', checks: ['pangenome', 'specificity'], genomes: ['sorghum_353'], pairs: [{ id: 'P1', left: SEQS.J_L, right: SEQS.P1_R }] },
    warnings: [{ code: 'PANGENOME_TRANSCRIPT_MODELS_ONLY', message: 'Transcript-mode pan-genome searches annotated transcripts only' }],
    results: {
      specificity: { target: 'genome', pairs: [{ id: 'P1', verdict: 'specific', on_target: null, off_target_count: 0, off_targets: [], gdna_products: [{ region: '4', start: 7422822, end: 7423300, size: 479, orientation: 'LR', likelihood: 'likely', left_mm: 0, right_mm: 0, left_3p_mm: 0, right_3p_mm: 0, left_mm_pos: [], right_mm_pos: [] }] }] },
      transcriptome: {
        target: 'cdna',
        pairs: [
          {
            id: 'P1',
            verdict: 'off_targets',
            on_target: { gene_id: 'SORBI_3004G087700', isoforms: [{ transcript_id: 'SORBI_3004G087700.1', start: 641, end: 918, size: 278 }, { transcript_id: 'SORBI_3004G087700.2', start: 443, end: 720, size: 278 }, { transcript_id: 'SORBI_3004G087700.3', start: 730, end: 1007, size: 278 }], size_min: 278, size_max: 278, likelihood: 'likely', orientation: 'LR', left_mm: 0, right_mm: 0, left_3p_mm: 0, right_3p_mm: 0, left_mm_pos: [], right_mm_pos: [], approx: false },
            off_target_count: 2,
            off_targets: [
              { gene_id: 'SORBI_3005G183900', isoforms: [{ transcript_id: 'SORBI_3005G183900.1', start: 100, end: 390, size: 291 }, { transcript_id: 'SORBI_3005G183900.2', start: 120, end: 410, size: 291 }], size_min: 291, size_max: 291, likelihood: 'likely', orientation: 'LR', left_mm: 2, right_mm: 2, left_3p_mm: 0, right_3p_mm: 0, left_mm_pos: [10, 7], right_mm_pos: [15, 10], approx: false },
              { gene_id: 'SORBI_3004G087800', isoforms: [{ transcript_id: 'SORBI_3004G087800.1', start: 50, end: 330, size: 281 }], size_min: 281, size_max: 281, likelihood: 'likely_weak', orientation: 'LR', left_mm: 1, right_mm: 0, left_3p_mm: 1, right_3p_mm: 0, left_mm_pos: [1], right_mm_pos: [], approx: true },
            ],
          },
        ],
      },
      pangenome: {
        target: 'cdna',
        pairs: [{ id: 'P1', reference_size: 278, summary: { genomes_total: 1, single_perfect: 1, single_mismatch: 0, multiple: 0, no_amplicon: 0, db_unavailable: 0, error: 0, amplifies: 1, truncated: 0 }, genomes: [{ system_name: 'sorghum_353', status: 'single_perfect', primary: { size: 278, size_delta: 0, gene_id: '353.004G093400', isoforms: [{ transcript_id: '353.004G093400.1', start: 1, end: 278, size: 278 }] } }] }],
      },
      warnings: [{ code: 'PANGENOME_TRANSCRIPT_MODELS_ONLY', message: 'annotated transcript models only' }],
    },
  };
}

export function genomeEntry(system_name: string, extra: Partial<GenomeEntry> = {}): GenomeEntry {
  return {
    system_name,
    display_name: system_name.replace(/^sorghum_/, 'Sb '),
    taxon_id: 4558001,
    map_id: `GCA_${system_name}`,
    is_query: false,
    has_sequence: true,
    has_blastdb: true,
    has_cdna_blastdb: true,
    repeat_masking: 'unmasked_copy',
    total_bases: 700_000_000,
    warnings: [],
    ...extra,
  };
}

export function genomesResponse(): GenomesResponse {
  return {
    system_name: 'sorghum_bicolor',
    species: { taxon_id: 4558, name: 'Sorghum bicolor' },
    counts: { total: 5, with_blastdb: 4, with_cdna_blastdb: 3 },
    genomes: [
      genomeEntry('sorghum_bicolor', { is_query: true, total_bases: 708735318, map_id: 'GCA_000003195.3' }),
      genomeEntry('sorghum_353'),
      genomeEntry('sorghum_grassl', { has_cdna_blastdb: false }),
      genomeEntry('sorghum_leoti'),
      genomeEntry('sorghum_nodb', { has_blastdb: false, has_cdna_blastdb: false, total_bases: null }),
    ],
  };
}
