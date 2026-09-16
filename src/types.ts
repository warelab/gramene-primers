/**
 * Types for the gramene-swagger `/primers` API (spec §A.2, §B.12) and the
 * headless client. Readers are tolerant: unknown fields are ignored and
 * optional fields must be guarded by consumers.
 */
import type { CSSProperties } from 'react';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export type DesignMode = 'gene' | 'transcript' | 'region' | 'sequence';
export type Strand = 1 | -1;
/** 1-based `[start, length]` in template coordinates. */
export type Interval = [number, number];
/** Inclusive product size range `[min, max]`. */
export type ProductSizeRange = [number, number];
export type RepeatMaskMode = 'n_mask' | 'three_prime';
export type PresetName = 'pcr' | 'qpcr';

export interface PrimerWarning {
  code: string;
  message?: string;
  details?: Record<string, unknown>;
}

/** One entry of the swagger validator's `errors[]` (400 `Validation errors`). */
export interface ValidationErrorItem {
  code: string;
  message?: string;
  path?: Array<string | number>;
  [key: string]: unknown;
}

/** Handler error body `{message, code, details}` or validator body `{message, errors}`. */
export interface ApiErrorBody {
  message?: string;
  code?: string;
  details?: Record<string, unknown> | null;
  errors?: ValidationErrorItem[];
}

// ---------------------------------------------------------------------------
// POST /primers/design (§A.2.1)
// ---------------------------------------------------------------------------

export interface DesignParams {
  opt_size: number;
  min_size: number;
  max_size: number;
  opt_tm: number;
  min_tm: number;
  max_tm: number;
  opt_gc: number;
  min_gc: number;
  max_gc: number;
  max_tm_diff: number;
  max_poly_x: number;
  gc_clamp: number;
  max_end_stability: number;
  max_ns: number;
  salt_monovalent: number;
  salt_divalent: number;
  dntp_conc: number;
  dna_conc: number;
  num_return: number;
  min_3_prime_overlap_of_junction: number;
  min_5_prime_overlap_of_junction: number;
  product_size_ranges: ProductSizeRange[];
}

export type DesignParamKey = keyof DesignParams;
export type NumericDesignParamKey = Exclude<DesignParamKey, 'product_size_ranges'>;

export interface RegionSpec {
  region: string;
  start: number;
  end: number;
  strand?: Strand;
}

export interface DesignRequest {
  mode: DesignMode;
  gene_id?: string;
  transcript_id?: string;
  system_name?: string;
  region?: RegionSpec;
  sequence?: string;
  flank_up?: number;
  flank_down?: number;
  target?: Interval;
  included?: Interval;
  excluded?: Interval[];
  avoid_repeats?: boolean;
  repeat_mask_mode?: RepeatMaskMode;
  junction_spanning?: boolean;
  template_only?: boolean;
  params?: Partial<DesignParams>;
}

export interface GenomicBlock {
  start: number;
  end: number;
}

/** Genomic footprint of one primer; `blocks` has > 1 entry when a cDNA primer spans a junction. */
export interface PrimerGenomic {
  region: string;
  start: number;
  end: number;
  strand: Strand;
  blocks: GenomicBlock[];
}

export interface ProductGenomic {
  region: string;
  start: number;
  end: number;
  strand: Strand;
}

export interface PrimerJunction {
  position: number;
  overlap_5p: number;
  overlap_3p: number;
}

export interface PrimerOligo {
  /** 5'->3', UPPERCASE. */
  seq: string;
  /** Template footprint, 1-based inclusive. */
  start: number;
  end: number;
  len: number;
  tm: number;
  gc: number;
  self_any_th?: number;
  self_end_th?: number;
  hairpin_th?: number;
  end_stability?: number;
  penalty?: number;
  junction?: PrimerJunction | null;
  /** null in sequence mode. */
  genomic?: PrimerGenomic | null;
}

export interface PrimerProduct {
  start: number;
  end: number;
  genomic?: ProductGenomic | null;
  /** Present only for transcript templates. */
  genomic_size?: number | null;
}

export interface PrimerPair {
  /** 0-based Primer3 rank. */
  rank: number;
  penalty: number;
  product_size: number;
  product_tm: number | null;
  compl_any_th?: number;
  compl_end_th?: number;
  left: PrimerOligo;
  right: PrimerOligo;
  product: PrimerProduct;
}

export type MaskSource = 'softmask' | 'blast_depth' | 'user_lowercase' | null;

export interface TemplateExon {
  id: string;
  start: number;
  end: number;
  genomic?: GenomicBlock | null;
}

export interface TemplateFeatures {
  gene?: GenomicBlock | null;
  exons?: TemplateExon[];
  cds?: GenomicBlock | null;
  junctions?: number[];
}

export interface PrimerTemplate {
  mode: DesignMode;
  system_name?: string | null;
  gene_id?: string | null;
  transcript_id?: string | null;
  region?: string | null;
  start?: number | null;
  end?: number | null;
  strand?: Strand | null;
  length: number;
  /** Always UPPERCASE. */
  seq: string;
  masked?: boolean;
  mask_source?: MaskSource;
  /** Merged masked runs as `[start, length]`. */
  mask?: Interval[];
  masked_fraction?: number;
  features?: TemplateFeatures;
}

/** Parsed Primer3 explain string, e.g. `{raw:'considered 9120, low tm 3280, ok 1022', considered: 9120, 'low tm': 3280, ok: 1022}`. */
export interface ExplainCounts {
  raw: string;
  [label: string]: number | string;
}

export interface DesignExplain {
  left?: ExplainCounts | null;
  right?: ExplainCounts | null;
  pair?: ExplainCounts | null;
  internal?: ExplainCounts | null;
}

export interface DesignSettings {
  preset?: PresetName | string | null;
  junction_spanning?: boolean | null;
  avoid_repeats?: boolean | null;
  repeat_mask_mode?: RepeatMaskMode | null;
  params?: Partial<DesignParams>;
  [key: string]: unknown;
}

export interface DesignResponse {
  template: PrimerTemplate;
  pairs: PrimerPair[];
  explain?: DesignExplain | null;
  settings?: DesignSettings;
  engine?: { primer3?: string; [key: string]: unknown };
  warnings: PrimerWarning[];
}

// ---------------------------------------------------------------------------
// GET /primers/genomes (§A.2.2)
// ---------------------------------------------------------------------------

export type RepeatMasking = 'soft_masked' | 'unmasked_copy' | 'absent';

export interface GenomeEntry {
  system_name: string;
  display_name: string;
  taxon_id: number;
  map_id: string | null;
  is_query: boolean;
  has_sequence: boolean;
  has_blastdb: boolean;
  has_cdna_blastdb: boolean;
  repeat_masking: RepeatMasking;
  total_bases: number | null;
  warnings?: Array<PrimerWarning | string>;
}

export interface GenomesResponse {
  system_name: string;
  species: { taxon_id: number; name: string };
  counts: { total: number; with_blastdb: number; with_cdna_blastdb: number };
  genomes: GenomeEntry[];
}

// ---------------------------------------------------------------------------
// POST /primers/check, GET /primers/check/{job_id} (§A.2.3, §A.2.4)
// ---------------------------------------------------------------------------

export type CheckName = 'specificity' | 'pangenome';
export type CheckKind = 'specificity' | 'pangenome';

export interface CheckParams {
  max_product_size: number;
  ignore_mismatches: number;
  /**
   * A product amplifies only when each primer has at most this many mismatches
   * (0–5, default 3, below `ignore_mismatches`); products with more are `unlikely`.
   */
  max_amplifying_mismatches: number;
  min_total_mismatches: number;
  min_3p_mismatches: number;
  three_prime_window: number;
  include_unlikely: boolean;
  repeat_site_threshold: number;
}

export interface CheckExpected {
  region: string;
  start: number;
  end: number;
}

export interface CheckPairInput {
  id: string;
  left: string;
  right: string;
  expected?: CheckExpected;
}

export interface CheckRequest {
  system_name: string;
  mode?: DesignMode;
  gene_id?: string;
  transcript_id?: string;
  checks?: CheckName[];
  genomes?: string[];
  params?: Partial<CheckParams>;
  pairs: CheckPairInput[];
}

export type CheckStatus = 'queued' | 'running' | 'done' | 'error';
export type CheckStage = 'queued' | 'reference' | 'transcriptome' | 'pangenome' | 'annotate' | 'done' | (string & {});

export interface CheckProgress {
  done: number;
  total: number;
  stage: CheckStage;
  running?: string[];
}

export interface CheckJobError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface CheckJob {
  job_id: string;
  status: CheckStatus;
  kind?: CheckKind;
  partial?: boolean;
  queue_position?: number | null;
  progress?: CheckProgress;
  estimate?: { cpu_s: number; [key: string]: unknown };
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
  attempts?: number;
  /** Normalized request echo (uppercase primers, defaults filled). */
  request?: CheckRequest;
  warnings?: PrimerWarning[];
  results?: CheckResults | null;
  error?: CheckJobError | null;
}

// ---------------------------------------------------------------------------
// PrimerCheckResults (§B.12)
// ---------------------------------------------------------------------------

export type Likelihood = 'likely' | 'likely_weak' | 'unlikely';
export type Orientation = 'LR' | 'RL' | 'LL' | 'RR';

export interface AmpliconGene {
  id: string;
  name?: string;
  biotype?: string;
  strand?: Strand;
}

export interface AmpliconMismatches {
  left_mm: number;
  right_mm: number;
  left_3p_mm: number;
  right_3p_mm: number;
  /** Mismatch positions counted from the primer 3' end (1 = terminal base). */
  left_mm_pos: number[];
  right_mm_pos: number[];
}

export interface GenomeAmplicon extends AmpliconMismatches {
  region: string;
  start: number;
  end: number;
  size: number;
  orientation: Orientation;
  likelihood: Likelihood;
  strand?: Strand;
  /** A mismatch at the 3′-terminal base of either primer. */
  terminal_mismatch?: boolean;
  approx?: boolean;
  genes?: AmpliconGene[] | null;
}

export type OffTarget = GenomeAmplicon;

export type SpecificityVerdict =
  | 'specific'
  | 'off_targets'
  | 'on_target_missing'
  | 'unverified_target'
  | 'truncated'
  | 'error';

export interface SpecificityPairResult {
  id: string;
  verdict: SpecificityVerdict;
  on_target_inferred?: boolean;
  truncated?: boolean;
  on_target: GenomeAmplicon | null;
  off_target_count: number;
  unlikely_count?: number;
  off_targets: OffTarget[];
  unlikely?: OffTarget[];
  /** Transcript mode, genome target: likely amplicons inside the gene span. */
  gdna_products?: GenomeAmplicon[];
  error?: CheckJobError | null;
}

export interface SpecificityResults {
  target: 'genome';
  pairs: SpecificityPairResult[];
}

export interface TranscriptIsoform {
  transcript_id: string;
  start: number;
  end: number;
  size: number;
  likelihood?: Likelihood;
  left_mm?: number;
  right_mm?: number;
}

export interface TranscriptAmpliconGroup extends Partial<AmpliconMismatches> {
  gene_id: string;
  isoforms: TranscriptIsoform[];
  size_min: number;
  size_max: number;
  likelihood: Likelihood;
  orientation?: Orientation;
  terminal_mismatch?: boolean;
  approx?: boolean;
}

export interface TranscriptomePairResult {
  id: string;
  verdict: SpecificityVerdict;
  truncated?: boolean;
  on_target: TranscriptAmpliconGroup | null;
  /** Other product groups of the design gene; not counted as off-targets. */
  other_on_target_groups?: number;
  off_target_count: number;
  unlikely_count?: number;
  off_targets: TranscriptAmpliconGroup[];
  unlikely?: TranscriptAmpliconGroup[];
  error?: CheckJobError | null;
}

export interface TranscriptomeResults {
  target: 'cdna';
  gene_id?: string;
  transcript_id?: string;
  pairs: TranscriptomePairResult[];
}

export type PangenomeStatus =
  | 'single_perfect'
  | 'single_mismatch'
  | 'multiple'
  | 'no_amplicon'
  | 'db_unavailable'
  | 'error';

/** A matrix cell that has no result yet (partial job). Client-side only. */
export type PangenomeCellStatus = PangenomeStatus | 'pending';

export interface PangenomeAmplicon extends Partial<AmpliconMismatches> {
  region?: string;
  start?: number;
  end?: number;
  strand?: Strand;
  size: number;
  size_delta?: number | null;
  orientation?: Orientation;
  likelihood?: Likelihood;
  mismatch_in_3p_window?: boolean;
  terminal_mismatch?: boolean;
  genes?: AmpliconGene[] | null;
  ortholog?: boolean | null;
  approx?: boolean;
  /** cDNA target (transcript-mode pan-genome). */
  gene_id?: string;
  isoforms?: TranscriptIsoform[];
  size_min?: number;
  size_max?: number;
}

export interface PangenomeGenomeResult {
  system_name: string;
  display_name?: string;
  status: PangenomeStatus;
  ortholog_annotated?: boolean | null;
  truncated?: boolean;
  /** Why the genome has no usable database (`db_unavailable`). */
  reason?: string;
  primary?: PangenomeAmplicon | null;
  other_amplicons?: number;
  others?: PangenomeAmplicon[];
  nearest?: PangenomeAmplicon | null;
  error?: CheckJobError | string | null;
}

export interface PangenomeSummary {
  genomes_total: number;
  single_perfect: number;
  single_mismatch: number;
  multiple: number;
  no_amplicon: number;
  db_unavailable: number;
  error: number;
  /** single_perfect + single_mismatch + multiple */
  amplifies: number;
  /**
   * Genomes whose search hit a result cap (`genomes[].truncated`); their status is
   * a lower bound. Not a status, so not part of `genomes_total`. Absent in results
   * from algorithm version 1.
   */
  truncated?: number;
}

export interface PangenomePairResult {
  id: string;
  reference_size: number | null;
  /** Largest product searched for in the pan-genome genomes. */
  max_size?: number;
  summary: PangenomeSummary;
  genomes: PangenomeGenomeResult[];
}

export interface PangenomeResults {
  /** `cdna` in transcript mode: annotated transcript models only (PANGENOME_TRANSCRIPT_MODELS_ONLY). */
  target: 'genome' | 'cdna';
  pairs: PangenomePairResult[];
}

export interface PrimerSensitivity {
  word_size: number;
  guaranteed_max_mismatches: number;
}

export interface CheckPrimerInfo {
  len: number;
  near_perfect_sites: number;
  repetitive: boolean;
  truncated: boolean;
  sensitivity?: { reference?: PrimerSensitivity; pangenome?: PrimerSensitivity };
}

export interface CheckResults {
  engine?: { algorithm_version?: string; blast?: string | null; reference?: string; pangenome?: string | null; [key: string]: unknown };
  params?: CheckParams;
  reference?: { system_name: string; map_id?: string | null; total_bases?: number | null };
  sensitivity_note?: string;
  /** Keyed by UPPERCASE primer sequence. */
  primers?: Record<string, CheckPrimerInfo>;
  specificity?: SpecificityResults | null;
  transcriptome?: TranscriptomeResults | null;
  pangenome?: PangenomeResults | null;
  warnings?: PrimerWarning[];
  timings_ms?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Gramene gene document (GET /genes?idList=), only the fields used here
// ---------------------------------------------------------------------------

export interface GrameneExon {
  id: string;
  /** Gene-relative, 1-based. */
  start: number;
  end: number;
}

export interface GrameneTranscript {
  id: string;
  name?: string;
  length: number;
  /** Exon ids in transcription order. */
  exons: string[];
  /** Absent for non-coding transcripts. */
  exon_junctions?: number[];
  cds?: { start: number; end: number };
  translation?: { id: string; length: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface GrameneGene {
  _id: string;
  name?: string;
  description?: string;
  biotype?: string;
  taxon_id?: number;
  system_name: string;
  location: { region: string; start: number; end: number; strand: Strand; map?: string };
  gene_structure?: {
    exons: GrameneExon[];
    transcripts: GrameneTranscript[];
    canonical_transcript?: string;
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface PrimersClientOptions {
  /** e.g. `https://data.sorghumbase.org/sorghum_v11` (trailing slashes are removed). */
  apiBase: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  /** Milliseconds; defaults `{design: 60000, other: 15000}`. */
  timeouts?: { design?: number; other?: number };
}

export interface PollOptions {
  signal?: AbortSignal;
  onUpdate?(job: CheckJob): void;
  /** Default 1000. */
  initialDelayMs?: number;
  /** Default 10000. */
  maxDelayMs?: number;
  /** Default 1.5. */
  factor?: number;
  /** Minimum delay while the job is queued; default 2000. */
  queuedMinDelayMs?: number;
  /** Default 5. */
  maxConsecutiveErrors?: number;
  /** Resubmit once on 404 — only for jobs started in the current mount. */
  resubmit?: CheckRequest;
  /** Default true. */
  pauseWhenHidden?: boolean;
  /** A job the caller already has (from submit or getCheck); polling then starts with a sleep instead of a GET. */
  initialJob?: CheckJob;
}

export interface PrimersClient {
  readonly apiBase: string;
  design(req: DesignRequest, o?: RequestOptions): Promise<DesignResponse>;
  /** `created` is true for 202 (newly queued), false for 200 (existing job). */
  submitCheck(req: CheckRequest, o?: RequestOptions): Promise<CheckJob & { created: boolean }>;
  getCheck(jobId: string, o?: RequestOptions): Promise<CheckJob>;
  /** Resolves when the job is `done` or `error`. */
  pollCheck(jobId: string, o?: PollOptions): Promise<CheckJob>;
  runCheck(req: CheckRequest, o?: Omit<PollOptions, 'resubmit' | 'initialJob'>): Promise<CheckJob>;
  /** Memoized per system_name; evicted on error. */
  listGenomes(systemName: string, o?: RequestOptions): Promise<GenomesResponse>;
  getGene(geneId: string, o?: RequestOptions): Promise<GrameneGene | null>;
}

// ---------------------------------------------------------------------------
// Component state and props (§C.2)
// ---------------------------------------------------------------------------

export type ResultsTab = 'pairs' | 'specificity' | 'transcriptome' | 'pangenome';

export interface SubmittedPair {
  id: string;
  left: string;
  right: string;
}

export interface PrimerDesignerCheckState {
  checks: CheckName[];
  genomes?: string[];
  params?: Partial<CheckParams>;
  jobId?: string;
  submitted?: SubmittedPair[];
}

/** Serializable designer state (`v: 1`); responses and results are never stored. */
export interface PrimerDesignerState {
  v: 1;
  mode: DesignMode;
  transcriptId?: string;
  flankUp?: number;
  flankDown?: number;
  region?: { region: string; start: number; end: number; strand: Strand };
  sequence?: string;
  systemName?: string;
  target?: Interval;
  included?: Interval;
  excluded?: Interval[];
  junctionSpanning?: boolean;
  avoidRepeats?: boolean;
  repeatMaskMode?: RepeatMaskMode;
  preset?: PresetName;
  params?: Partial<DesignParams>;
  designed?: boolean;
  selectedRank?: number;
  checkedRanks?: number[];
  check?: PrimerDesignerCheckState;
  /** Results tab, explain panel, and the form-column width set with the splitter (px; absent means the default layout). */
  view?: { resultsTab: ResultsTab; explainOpen?: boolean; formWidth?: number };
}

export interface PrimerDesignerFeatures {
  check?: boolean;
  pangenome?: boolean;
  export?: boolean;
  map?: boolean;
}

export interface PrimerDesignerProps {
  apiBase: string;
  client?: PrimersClient;
  gene?: GrameneGene;
  geneId?: string;
  systemName?: string;
  region?: RegionSpec;
  sequence?: string;
  modes?: DesignMode[];
  defaultMode?: DesignMode;
  defaultParams?: Partial<DesignParams>;
  state?: PrimerDesignerState;
  onStateChange?: (s: PrimerDesignerState) => void;
  /** Default true. */
  persistSequence?: boolean;
  onDesign?: (res: DesignResponse, req: DesignRequest) => void;
  onCheckUpdate?: (job: CheckJob) => void;
  onError?: (e: import('./errors').PrimersApiError) => void;
  /** Each defaults to true. */
  features?: PrimerDesignerFeatures;
  geneHref?: (geneId: string, systemName?: string) => string;
  onGeneClick?: (geneId: string, systemName?: string) => void;
  geneLabel?: string;
  theme?: 'light' | 'dark' | 'auto';
  className?: string;
  style?: CSSProperties;
  /** Default true. */
  injectStyles?: boolean;
  poll?: Partial<Pick<PollOptions, 'initialDelayMs' | 'maxDelayMs' | 'factor'>>;
}
