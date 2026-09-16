import type { DesignerMode, PrimerDesignerState, RegionSpec } from 'gramene-primers';
import sequenceFixture from '../../test/components/fixtures/designs/sequence-iupac.json';

export type MockVariant =
  | 'default'
  | 'verified-gene-pairs'
  | 'verified-qpcr-pair'
  | 'repetitive-p5l'
  | 'genotyping-kasp'
  | 'genotyping-insertion'
  | 'genotyping-deletion'
  | 'genotyping-no-variation';

export interface PlaygroundPage {
  id: string;
  group: 'Gene' | 'Transcript' | 'Region' | 'Sequence' | 'Check' | 'Genotyping';
  label: string;
  geneId?: string;
  systemName?: string;
  region?: RegionSpec;
  sequence?: string;
  modes?: DesignerMode[];
  defaultMode: DesignerMode;
  /** Saved state the page starts from (controlled restore). */
  initialState?: PrimerDesignerState;
  mockVariant?: MockVariant;
  note: string;
}

export const PAGES: readonly PlaygroundPage[] = [
  {
    id: 'gene-000200',
    group: 'Gene',
    label: 'SORBI_3001G000200 (−)',
    geneId: 'SORBI_3001G000200',
    systemName: 'sorghum_bicolor',
    defaultMode: 'gene',
    initialState: { v: 1, mode: 'gene', preset: 'pcr', flankUp: 200, flankDown: 100 },
    note: 'Minus-strand gene with 200/100 bp flanks: template 1:11080-15099(−), 4,020 bp, exon 1 at 201–597, CDS from 499.',
  },
  {
    id: 'gene-000700',
    group: 'Gene',
    label: 'SORBI_3001G000700 (+)',
    geneId: 'SORBI_3001G000700',
    systemName: 'sorghum_bicolor',
    defaultMode: 'gene',
    note: 'Plus-strand gene, 9,525 bp, five transcript models.',
  },
  {
    id: 'transcript-87700',
    group: 'Transcript',
    label: 'SORBI_3004G087700.3',
    geneId: 'SORBI_3004G087700',
    systemName: 'sorghum_bicolor',
    defaultMode: 'transcript',
    initialState: { v: 1, mode: 'transcript', preset: 'qpcr', transcriptId: 'SORBI_3004G087700.3', junctionSpanning: true },
    note: 'Junction-spanning qPCR on the 22-exon canonical transcript.',
  },
  {
    id: 'transcript-46200',
    group: 'Transcript',
    label: 'SORBI_3001G046200 (.2 single exon, .1)',
    geneId: 'SORBI_3001G046200',
    systemName: 'sorghum_bicolor',
    defaultMode: 'transcript',
    note: 'The canonical .2 has one exon, so the junction toggle is disabled; pick .1 to enable it.',
  },
  {
    id: 'region',
    group: 'Region',
    label: 'Region 1:11,080–15,099 (−)',
    systemName: 'sorghum_bicolor',
    region: { region: '1', start: 11080, end: 15099, strand: -1 },
    modes: ['region', 'sequence'],
    defaultMode: 'region',
    initialState: {
      v: 1,
      mode: 'region',
      preset: 'pcr',
      systemName: 'sorghum_bicolor',
      region: { region: '1', start: 11080, end: 15099, strand: -1 },
      target: [499, 50],
      included: [100, 3000],
      excluded: [[1000, 40]],
      params: { min_size: 19, max_size: 22, min_tm: 58, max_tm: 61, min_gc: 40, max_gc: 60, max_tm_diff: 2, product_size_ranges: [[200, 300]] },
    },
    note: 'Target, included and excluded intervals with tightened Primer3 parameters (spec §10.3 case 5).',
  },
  {
    id: 'sequence',
    group: 'Sequence',
    label: 'Pasted sequence with IUPAC codes',
    systemName: 'sorghum_bicolor',
    sequence: sequenceFixture.request.sequence,
    modes: ['sequence'],
    defaultMode: 'sequence',
    note: '1,200 nt of SORBI_3004G087700 with R, Y and W codes (converted to N by the server).',
  },
  {
    id: 'check-p1-p3',
    group: 'Check',
    label: 'P1/P2/P3 on SORBI_3004G087700',
    geneId: 'SORBI_3004G087700',
    systemName: 'sorghum_bicolor',
    defaultMode: 'gene',
    mockVariant: 'verified-gene-pairs',
    initialState: { v: 1, mode: 'gene', preset: 'pcr', designed: true, checkedRanks: [0, 1, 2], check: { checks: ['specificity', 'pangenome'] } },
    note: 'The spec §10.4 specificity pairs (mock: design replays them; check results are synthetic apart from the P2/P3 off-targets).',
  },
  {
    id: 'check-p5l',
    group: 'Check',
    label: 'P5_L (repetitive primer)',
    systemName: 'sorghum_bicolor',
    sequence: 'mock',
    modes: ['sequence'],
    defaultMode: 'sequence',
    mockVariant: 'repetitive-p5l',
    initialState: { v: 1, mode: 'sequence', preset: 'pcr', systemName: 'sorghum_bicolor', designed: true, checkedRanks: [0] },
    note: 'P5_L flagged repetitive (mock).',
  },
  {
    id: 'check-qpcr',
    group: 'Check',
    label: 'J_L + P1_R (qPCR, .3)',
    geneId: 'SORBI_3004G087700',
    systemName: 'sorghum_bicolor',
    defaultMode: 'transcript',
    mockVariant: 'verified-qpcr-pair',
    initialState: {
      v: 1,
      mode: 'transcript',
      preset: 'qpcr',
      transcriptId: 'SORBI_3004G087700.3',
      designed: true,
      checkedRanks: [0],
      check: { checks: ['specificity', 'pangenome'] },
    },
    note: '278 bp on isoforms .1/.2/.3; transcriptome off-targets; transcript-mode pan-genome searches annotated transcripts only.',
  },
  {
    id: 'genotyping-rs871475760',
    group: 'Genotyping',
    label: 'KASP on rs871475760 (SNV)',
    geneId: 'SORBI_3001G000200',
    systemName: 'sorghum_bicolor',
    modes: ['gene', 'genotyping'],
    defaultMode: 'genotyping',
    mockVariant: 'genotyping-kasp',
    initialState: {
      v: 1,
      mode: 'genotyping',
      systemName: 'sorghum_bicolor',
      genotyping: {
        variantId: 'rs871475760',
        variantKey: '1:11109:C:A',
        window: { region: '1', start: 11180, end: 11290 },
        assay: { type: 'kasp', num_sets: 2 },
      },
    },
    note: 'Two KASP sets: S1 reverse 65 bp (usable), S2 forward 92 bp (poor, tailed-structure issue). Check them to see the allele matrix.',
  },
  {
    id: 'genotyping-insertion-blocked',
    group: 'Genotyping',
    label: 'Insertion with a blocked orientation',
    geneId: 'SORBI_3001G000200',
    systemName: 'sorghum_bicolor',
    modes: ['gene', 'genotyping'],
    defaultMode: 'genotyping',
    mockVariant: 'genotyping-insertion',
    initialState: {
      v: 1,
      mode: 'genotyping',
      systemName: 'sorghum_bicolor',
      genotyping: { variantId: 'tmp_1_11502_C_CGT', variantKey: '1:11502:C:CGT' },
    },
    note: 'Forward is blocked by a known variant 4 nt from the 3′ end; only the reverse orientation yields a set, whose ALT primer ends on an inserted base.',
  },
  {
    id: 'genotyping-manual-deletion',
    group: 'Genotyping',
    label: 'Deletion entered by hand',
    geneId: 'SORBI_3001G000200',
    systemName: 'sorghum_bicolor',
    modes: ['gene', 'genotyping'],
    defaultMode: 'genotyping',
    mockVariant: 'genotyping-deletion',
    initialState: {
      v: 1,
      mode: 'genotyping',
      systemName: 'sorghum_bicolor',
      genotyping: { manual: { region: '1', position: 11282, ref: 'CA', alt: 'C' } },
    },
    note: 'A shiftable deletion with no requested id: both orientations need relaxation level 1, and the ALT primer spans the deletion in two genomic blocks.',
  },
  {
    id: 'genotyping-no-variation',
    group: 'Genotyping',
    label: 'Genome without variant data',
    geneId: 'SORBI_3001G000200',
    systemName: 'sorghum_bicolor',
    modes: ['gene', 'genotyping'],
    defaultMode: 'genotyping',
    mockVariant: 'genotyping-no-variation',
    initialState: { v: 1, mode: 'genotyping', systemName: 'sorghum_bicolor' },
    note: 'No known variants here: the picker degrades to manual entry and says so, rather than failing.',
  },
  {
    id: 'genotyping-ensembl-down',
    group: 'Genotyping',
    label: 'Variant lookups unavailable',
    geneId: 'SORBI_3001G000200',
    systemName: 'sorghum_bicolor',
    modes: ['gene', 'genotyping'],
    defaultMode: 'genotyping',
    mockVariant: 'genotyping-kasp',
    initialState: { v: 1, mode: 'genotyping', systemName: 'sorghum_bicolor' },
    note: 'Add ?mockError=VARIATION_SOURCE_UNAVAILABLE to see the 503 path: a countdown, and manual entry still offered.',
  },
];

export function findPage(id: string | null | undefined): PlaygroundPage {
  return PAGES.find((p) => p.id === id) ?? PAGES[0]!;
}
