/**
 * Types for the gramene-swagger `/primers` API (spec §A.2, §B.12) and the
 * headless client. Readers are tolerant: unknown fields are ignored and
 * optional fields must be guarded by consumers.
 */

import type { RestrictionEnzyme } from './enzymes';

export type { RestrictionEnzyme };
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
  /** Known-variant data exists for this genome (only the reference, in practice). */
  has_variation?: boolean;
  repeat_masking: RepeatMasking;
  total_bases: number | null;
  warnings?: Array<PrimerWarning | string>;
}

export interface GenomesResponse {
  system_name: string;
  species: { taxon_id: number; name: string };
  /** Whether variant lookups work at all on this server, and from which source. */
  variation?: { available: boolean; source?: string | null; release?: string | null };
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
  /**
   * Allele calls for KASP / AS-PCR sets (gene and region modes only). A request
   * carrying it hashes with algorithm `2+g1`, so genotyping jobs never collide
   * with ordinary ones.
   */
  genotyping?: CheckGenotypingBlock;
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
  /**
   * Allele calls, present only for jobs whose request carried `genotyping` —
   * the key is absent (not null) on every ordinary job.
   */
  genotyping?: GenotypeResults;
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
  /**
   * Genotyping (optional, so existing hosts and test doubles still satisfy the
   * interface): the designer hides the Genotyping mode without `designGenotyping`.
   */
  listVariants?(query: VariantListQuery, o?: RequestOptions): Promise<VariantListResponse>;
  getVariant?(variantId: string, query: { system_name: string }, o?: RequestOptions): Promise<VariantLookupResponse>;
  designGenotyping?(req: GenotypingDesignRequest, o?: RequestOptions): Promise<GenotypingDesignResponse>;
}

// ---------------------------------------------------------------------------
// Genotyping: known variants, KASP / AS-PCR design, allele calls
// (GET /primers/variants[/{id}], POST /primers/genotyping/design, the check's
// `genotyping` block). Shapes follow the recorded captures in
// test/fixtures/genotyping, which win over the design spec.
// ---------------------------------------------------------------------------

export type VariantKind = 'snv' | 'mnv' | 'insertion' | 'deletion' | 'complex';

/** `{code, message, details}`, e.g. `REPEAT_TOO_LONG` on a non-designable variant. */
export interface VariantIssue {
  code: string;
  message?: string;
  details?: Record<string, unknown>;
}

export interface VariantVcf {
  position: number;
  ref: string;
  alt: string;
}

/** Left-aligned minimal representation; `-` alleles are written as an empty string. */
export interface VariantMinimal {
  start: number;
  end: number;
  ref: string;
  alt: string;
}

export interface VariantRecord {
  id: string;
  source: string;
  ems: boolean;
}

export interface VariantDiscriminatingBase {
  position: number;
  ref_base: string;
  alt_base: string;
  /** Null when the ALT base is inserted, so it has no reference coordinate. */
  alt_maps_to: number | null;
}

/** A known variant near a primer; `alleles` is a display string such as `G/A`. */
export interface VariantNeighbour {
  key: string;
  ids: string[];
  label: string;
  start: number;
  end: number;
  alleles: string;
  ems: boolean;
  /** Bases from the primer's 3′ end; 1 is the 3′ base itself. */
  distance_from_3p: number;
}

export interface VariantEntry {
  /** `region:position:REF:ALT` — the identity; ids are for lookup and display only. */
  key: string;
  ids: string[];
  synonyms: string[];
  label: string;
  kind: VariantKind;
  region: string;
  vcf: VariantVcf;
  minimal: VariantMinimal;
  alleles: string[];
  multiallelic: { alleles: string[]; other_alts: string[] } | null;
  /** How far an indel can slide; null when it slid past the read window. */
  shift: number | null;
  zone: { start: number; end: number } | null;
  discriminating: { forward: VariantDiscriminatingBase; reverse: VariantDiscriminatingBase } | null;
  records: VariantRecord[];
  /** True when every record is an EMS mutation. */
  ems: boolean;
  consequence: string | null;
  ref_verified: boolean;
  designable: boolean;
  issues: VariantIssue[];
  /** Design responses only: the id the caller asked for, null for a manual variant. */
  requested_id?: string | null;
  /** Design responses only: 50 bp each side of `[REF/ALT]`. */
  submission_sequence?: string;
}

export interface VariantSource {
  name: string;
  release?: string | null;
}

export interface VariantListQuery {
  system_name: string;
  region: string;
  start: number;
  end: number;
  types?: VariantKind[];
  /** Only `false` is sent; it drops entries whose records are all EMS. */
  include_ems?: boolean;
  limit?: number;
}

export interface VariantListResponse {
  system_name: string;
  region: string;
  start: number;
  end: number;
  source: VariantSource;
  total: number;
  returned: number;
  truncated: boolean;
  variants: VariantEntry[];
  warnings: PrimerWarning[];
}

export interface VariantLookupResponse {
  requested_id: string;
  system_name: string;
  source: VariantSource;
  /** One entry per alternative allele, including non-designable ones. */
  variants: VariantEntry[];
  warnings: PrimerWarning[];
}

export type GenotypingAssayType = 'kasp' | 'as_pcr';
export type GenotypingOrientation = 'forward' | 'reverse';
export type GenotypingOrientationChoice = GenotypingOrientation | 'both';
export type GenotypingTails = 'none' | 'ref_fam_alt_hex' | 'ref_hex_alt_fam';
export type GenotypingMismatchMode = 'none' | 'auto';
export type GenotypingNeighbourPolicy = 'avoid_3p' | 'ignore';

export interface GenotypingAssay {
  type: GenotypingAssayType;
  orientation: GenotypingOrientationChoice;
  tails: GenotypingTails;
  deliberate_mismatch: GenotypingMismatchMode;
  mismatch_position: number;
  num_sets: number;
  max_relaxation: number;
  neighbour_policy: GenotypingNeighbourPolicy;
}

/** Design params the genotyping endpoint accepts (no `num_return`, `max_ns` or junction params). */
export type GenotypingParamKey =
  | 'opt_size'
  | 'min_size'
  | 'max_size'
  | 'opt_tm'
  | 'min_tm'
  | 'max_tm'
  | 'opt_gc'
  | 'min_gc'
  | 'max_gc'
  | 'max_tm_diff'
  | 'max_poly_x'
  | 'gc_clamp'
  | 'max_end_stability'
  | 'salt_monovalent'
  | 'salt_divalent'
  | 'dntp_conc'
  | 'dna_conc'
  | 'product_size_ranges';

export type GenotypingParams = Pick<DesignParams, GenotypingParamKey>;

/** By Ensembl id (`alt` picks one allele of a multi-allelic site). */
export interface GenotypingVariantById {
  id: string;
  alt?: string;
}

/** VCF style (neither allele `-`) or Ensembl style (exactly one `-`). */
export interface GenotypingVariantManual {
  region: string;
  position: number;
  ref: string;
  alt: string;
}

export type GenotypingVariantInput = GenotypingVariantById | GenotypingVariantManual;

export interface GenotypingDesignRequest {
  system_name: string;
  variant: GenotypingVariantInput;
  assay?: Partial<GenotypingAssay>;
  params?: Partial<GenotypingParams>;
  avoid_repeats?: boolean;
  repeat_mask_mode?: RepeatMaskMode;
  /** Verifies REF and returns variant, template, assay and neighbours without designing. */
  template_only?: boolean;
  label?: string;
}

export interface KaspMix {
  stock_uM: number;
  as_ref_uL: number;
  as_alt_uL: number;
  common_uL: number;
  water_uL: number;
  total_uL: number;
  source: string;
}

export interface GenotypingAssaySettings extends GenotypingAssay {
  /** Every record of the target is an EMS mutation: neighbours warn instead of blocking. */
  ems_target: boolean;
  /** Null for `as_pcr`. */
  kasp_mix: KaspMix | null;
}

export interface GenotypingTemplateFeatures {
  variant: { start: number; end: number };
  zone: { start: number; end: number };
  /** Template positions of the discriminating base in each orientation. */
  discriminating: { forward: number; reverse: number };
  /** ALT length minus REF length: `+2` insertion, `−1` deletion, `0` SNV. */
  alt_offset: number;
  /** `[start, length]` runs the repeat mask must leave alone. */
  exempt: Interval[];
}

export interface GenotypingTemplate {
  system_name: string;
  region: string;
  start: number;
  end: number;
  strand: Strand;
  length: number;
  alt_length: number;
  seq: string;
  alt_seq: string;
  masked: boolean;
  mask_source: MaskSource;
  mask: Interval[];
  masked_fraction: number;
  features: GenotypingTemplateFeatures;
}

/** Whether neighbours could be screened at all. */
export interface GenotypingNeighbourhood {
  data: 'ensembl' | 'none' | 'unavailable' | (string & {});
  window: { start: number; end: number };
  variants: number;
  non_ems: number;
  ems: number;
  dense_non_ems: number;
}

export type GenotypingOrientationStatus = 'ok' | 'blocked' | 'skipped' | 'no_sets' | (string & {});

export interface GenotypingAttempt {
  level: number;
  changes: Partial<GenotypingParams>;
  explain: DesignExplain | null;
  /** Always `rejected` totals + `not_scored` + `sets`. */
  pairs_returned: number;
  rejected: Record<string, number>;
  not_scored: number;
  sets: number;
}

export interface GenotypingOrientationReport {
  status: GenotypingOrientationStatus;
  /** Null when `status` is `ok`. */
  reason: string | null;
  discriminating_position: number;
  /** Null when blocked or skipped. */
  relaxation_level: number | null;
  sets_found: number;
  blockers: VariantNeighbour[];
  attempts: GenotypingAttempt[];
}

export type GenotypingRole = 'as_ref' | 'as_alt' | 'common';

export interface GenotypingGenomicSpan {
  region: string;
  start: number;
  end: number;
  strand: Strand;
  /** Two blocks when a primer spans a deletion. */
  blocks: Array<{ start: number; end: number }>;
}

export interface GenotypingTemplateSpan {
  start: number;
  end: number;
  sequence: 'ref' | 'alt';
}

export interface GenotypingDiscrimination {
  own_allele: { mm_pos: number[]; likelihood: string };
  other_allele: { mm_pos: number[]; likelihood: string };
  /** Little (1995) terminal-mismatch class, e.g. `max` or `weak`. */
  terminal_mismatch_class: string;
  /** The 3′ base lies inside an indel's shift tract, so discrimination is uncertain. */
  in_shift_tract: boolean;
}

export interface GenotypingDeliberateMismatch {
  position: number;
  from?: string;
  to?: string;
  [key: string]: unknown;
}

export interface GenotypingOligo {
  role: GenotypingRole;
  /** The allele this primer reads; null on the common primer. */
  allele: string | null;
  three_prime_base: string;
  haplotype: 'ref' | 'alt' | 'both';
  /** What anneals — the only sequence a check ever receives. */
  target_seq: string;
  matched_seq: string;
  /** Null on the common primer and with `tails: none`. */
  dye: string | null;
  tail_seq: string | null;
  /** `tail_seq + target_seq` — what the vendor synthesizes. Never send it to a check. */
  order_seq: string;
  len: number;
  order_len: number;
  tm: number;
  tm_method: 'primer3' | 'ntthal_duplex' | (string & {});
  /** Perfect-match Tm when a deliberate mismatch was applied. */
  matched_tm: number | null;
  gc: number;
  hairpin_th: number;
  self_any_th: number;
  self_end_th: number;
  end_stability: number;
  primer3_problems: string | null;
  template: GenotypingTemplateSpan;
  genomic: GenotypingGenomicSpan | null;
  /** Bases with no reference coordinate (insertion ALT primers). */
  inserted_bases: number;
  deliberate_mismatch: GenotypingDeliberateMismatch | null;
  discrimination: GenotypingDiscrimination | null;
  /** Structures of the tailed oligo; null when untailed. */
  tailed: { hairpin_th: number; self_any_th: number; self_end_th: number } | null;
  neighbours: VariantNeighbour[];
}

export interface GenotypingProduct {
  size: number;
  template: GenotypingTemplateSpan;
  genomic: GenotypingGenomicSpan | null;
  inserted_bases: number;
}

export type GenotypingQuality = 'good' | 'usable' | 'poor';
export type GenotypingSeverity = 'info' | 'warn' | 'high';

export interface GenotypingIssue {
  code: string;
  severity: GenotypingSeverity;
  message: string;
  details?: Record<string, unknown>;
}

export interface GenotypingThermo {
  ref_common: { compl_any_th: number; compl_end_th: number };
  alt_common: { compl_any_th: number; compl_end_th: number };
  /** Present only for tailed (KASP) sets. */
  tailed?: {
    ref_alt_any_th: number;
    ref_alt_end_th: number;
    ref_common_any_th: number;
    ref_common_end_th: number;
    alt_common_any_th: number;
    alt_common_end_th: number;
  } | null;
}

/** The set as a check would receive it: two pairs sharing the common primer. */
export interface GenotypingSetCheck {
  set: { id: string; ref_pair: string; alt_pair: string };
  pairs: CheckPairInput[];
}

export interface GenotypingOrderRow {
  /** `{label}_{set id}_{REF|ALT|COM}`, plus `_FAM`/`_HEX` for a tailed AS primer. */
  name: string;
  set_id: string;
  set_key: string;
  role: GenotypingRole;
  allele: string | null;
  dye: string | null;
  order_seq: string;
  target_seq: string;
  tail_seq: string | null;
  length: number;
  tm: number;
  gc: number;
  orientation: GenotypingOrientation;
  product_size_ref: number;
  product_size_alt: number;
  variant_key: string;
  notes: string;
}

export interface GenotypingSet {
  /** Positional (`S1`, `S2`); identify a set by `key`. */
  id: string;
  /** 12 hex of orientation + the three target sequences; stable across re-designs. */
  key: string;
  rank: number;
  orientation: GenotypingOrientation;
  relaxation_level: number;
  quality: GenotypingQuality;
  score: number;
  primers: { as_ref: GenotypingOligo; as_alt: GenotypingOligo; common: GenotypingOligo };
  products: { ref: GenotypingProduct; alt: GenotypingProduct };
  thermo: GenotypingThermo;
  tm_balance: { as_tm_diff: number; common_minus_as: number };
  neighbour_sites: number;
  primer3_penalty: number;
  warnings: PrimerWarning[];
  issues: GenotypingIssue[];
  check: GenotypingSetCheck;
  order: GenotypingOrderRow[];
}

export interface GenotypingSettings {
  preset: GenotypingAssayType;
  params: Partial<GenotypingParams>;
  /** Params the client sent; these are never relaxed. */
  pinned: string[];
  ladder: Array<{ level: number; changes: Partial<GenotypingParams> }>;
  floors: { as_min_tm: number; as_min_gc: number };
}

/** The ready-made `POST /primers/check` body the design hands back. */
export interface GenotypingCheckPlan {
  request: CheckRequest;
  set_ids: string[];
  unique_primers: number;
  /** Sets left out of the request because of the server's packing caps. */
  omitted_set_ids: string[];
}

export interface GenotypingDesignResponse {
  variant: VariantEntry;
  template: GenotypingTemplate;
  assay: GenotypingAssaySettings;
  neighbours: GenotypingNeighbourhood;
  /** Null with `template_only`. */
  orientations: { forward: GenotypingOrientationReport; reverse: GenotypingOrientationReport } | null;
  sets: GenotypingSet[];
  /** Null with `template_only` or when no set was found. */
  check: GenotypingCheckPlan | null;
  settings: GenotypingSettings;
  engine?: { primer3?: string | null; thermo?: string | null; genotyping_design?: string; variation_source?: string | null; [key: string]: unknown };
  warnings: PrimerWarning[];
}

// ---- the check's genotyping block and its results ---------------------------

export interface CheckGenotypingSet {
  id: string;
  ref_pair: string;
  alt_pair: string;
}

export interface CheckGenotypingBlock {
  /** VCF style, no `-`. */
  variant: { region: string } & VariantVcf;
  sets: CheckGenotypingSet[];
}

export type GenotypeAllele = 'ref' | 'alt' | 'other' | 'ambiguous' | 'missing' | 'unavailable';
export type GenotypePrediction = 'ref' | 'alt' | 'both' | 'none' | 'no_call' | 'unknown';
export type GenotypePrimerStatus = 'match' | 'terminal_mismatch' | 'weak' | 'uncertain' | 'blocked' | 'no_product' | 'unknown' | (string & {});

export interface GenotypeCopy {
  region: string;
  start: number;
  end: number;
  strand: Strand;
  variant_position: number;
  identity: number;
  /** The ortholog test uses this one (≥ 95 %). */
  gap_compressed_identity: number;
  aligned_length: number;
  observed: string | null;
  flank_edits: number;
  call: string | null;
  anchors: number;
  /** Null in region mode; only gene mode annotates orthologs. */
  ortholog: boolean | null;
  source: 'amplicon' | 'megablast' | (string & {});
}

export interface GenotypeGenomeRow {
  system_name: string;
  display_name: string;
  is_reference: boolean;
  allele: GenotypeAllele;
  /** Null for `missing`, `unavailable` and `ambiguous`. */
  observed: string | null;
  source: 'amplicon' | 'megablast' | null;
  copies: GenotypeCopy[];
  orthologous_copies: number;
  paralog_copies: number;
  /** `no_orthologous_copy`, `variant_not_covered`, `fallback_failed`, `fallback_budget`; null when the call succeeded. */
  reason: string | null;
}

export interface GenotypePrimerCall {
  status: GenotypePrimerStatus;
  likelihood: string | null;
  mm_pos: number[] | null;
  residual_mm_pos: number[] | null;
}

export interface GenotypePredictionRow {
  system_name: string;
  ref_primer: GenotypePrimerCall;
  alt_primer: GenotypePrimerCall;
  common_primer: GenotypePrimerCall;
  predicted: GenotypePrediction;
  /** Null whenever there is no on-locus signal to grade. */
  strength: 'normal' | 'weak' | null;
  /** Null when the genome cannot be compared (e.g. an uncertain shift tract). */
  agrees: boolean | null;
  reasons: string[];
  off_locus_products: number;
}

export interface GenotypeSummary {
  genomes_total: number;
  ref: number;
  alt: number;
  other: number;
  ambiguous: number;
  missing: number;
  unavailable: number;
}

export interface GenotypeSetSummary {
  genomes_total: number;
  predicted_ref: number;
  predicted_alt: number;
  both: number;
  none: number;
  no_call: number;
  unknown: number;
  weak: number;
  agree: number;
  disagree: number;
  not_comparable: number;
}

export interface GenotypeSetResults {
  id: string;
  ref_pair: string;
  alt_pair: string;
  orientation: GenotypingOrientation;
  deliberate_mismatch_positions: number[];
  specificity: {
    ref_pair: { verdict: SpecificityVerdict; consistent_with_allele: boolean };
    alt_pair: { verdict: SpecificityVerdict; consistent_with_allele: boolean };
    off_target_count: number;
  };
  /** The reference genome must read its own allele; `fail` makes the set unreliable. */
  control: { status: 'pass' | 'warn' | 'fail'; allele: GenotypeAllele | null; reasons: string[] };
  reference: GenotypePredictionRow;
  summary: GenotypeSetSummary;
  /** The reference is never included here. */
  genomes: GenotypePredictionRow[];
}

export interface GenotypeResults {
  algorithm_version: string;
  variant: { key: string; region: string; position: number; ref: string; alt: string; shift?: number | null; core?: { ref: string; alt: string }; [key: string]: unknown };
  summary: GenotypeSummary;
  genomes: GenotypeGenomeRow[];
  sets: GenotypeSetResults[];
}

// ---------------------------------------------------------------------------
// Component state and props (§C.2)
// ---------------------------------------------------------------------------

export type ResultsTab = 'pairs' | 'specificity' | 'transcriptome' | 'pangenome';

/**
 * The designer's modes. `DesignMode` deliberately stays as it is: `genotyping`
 * must never reach `POST /primers/check` (swagger rejects it) or a template.
 */
export type DesignerMode = DesignMode | 'genotyping';

/** Results tabs in genotyping mode, kept apart from `ResultsTab` so old builds keep validating. */
export type GenotypingTab = 'sets' | 'alleles' | 'specificity' | 'pangenome' | 'order';

export interface SubmittedPair {
  id: string;
  left: string;
  right: string;
}

/**
 * A submitted set, by UPPERCASE target sequence: results are matched on the
 * triple (REF pair, ALT pair), never on `id` or rank, so a re-design that
 * renumbers sets still finds its results.
 */
export interface SubmittedGenotypingSet {
  id: string;
  /** `sets[].key` when it was known at submit time. */
  key?: string;
  ref: SubmittedPair;
  alt: SubmittedPair;
}

export interface PrimerDesignerCheckState {
  checks: CheckName[];
  genomes?: string[];
  params?: Partial<CheckParams>;
  jobId?: string;
  submitted?: SubmittedPair[];
}

/**
 * The genotyping slice of the designer state. Additive and `v: 1`: it holds
 * inputs and selections only — never response data — so an older build simply
 * ignores it.
 */
export interface GenotypingState {
  /** The Ensembl id the user picked, for display and re-lookup. */
  variantId?: string;
  /** The chosen allele of a multi-allelic site. */
  alt?: string;
  /** `region:position:REF:ALT` — the identity a design is built from. */
  variantKey?: string;
  manual?: { region: string; position: number; ref: string; alt: string };
  /** The listing window; at most 50,000 bp. */
  window?: { region: string; start: number; end: number };
  filters?: { types?: VariantKind[]; includeEms?: boolean; query?: string };
  assay?: Partial<GenotypingAssay>;
  params?: Partial<GenotypingParams>;
  label?: string;
  avoidRepeats?: boolean;
  repeatMaskMode?: RepeatMaskMode;
  designed?: boolean;
  /** `sets[].key`, which survives a re-design; never `sets[].id`. */
  selectedSetKey?: string;
  /** At most 5 set keys. */
  checkedSetKeys?: string[];
  check?: {
    checks: CheckName[];
    genomes?: string[];
    params?: Partial<CheckParams>;
    jobId?: string;
    submitted?: SubmittedGenotypingSet[];
  };
  view?: { tab: GenotypingTab };
}

/** Serializable designer state (`v: 1`); responses and results are never stored. */
export interface PrimerDesignerState {
  v: 1;
  mode: DesignerMode;
  genotyping?: GenotypingState;
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
  /** Offered only when the client can design genotyping assays. */
  genotyping?: boolean;
}

/**
 * A gene as the region browser draws it. Everything is in genomic coordinates,
 * because that is what a region view needs and what gene sources (Ensembl REST
 * among them) already return — asking a host to convert to gene-relative or
 * cDNA coordinates would be work with no purpose here.
 */
export interface RegionGene {
  id: string;
  /** Shown on the model; the id when there is no name. */
  label?: string | null;
  start: number;
  end: number;
  strand: Strand;
  /** Genomic exon blocks. Without them the gene draws as a single block. */
  exons?: Array<{ start: number; end: number }>;
  /** Genomic coding extent, so coding exons can be told from UTR. */
  cds?: { start: number; end: number } | null;
  biotype?: string | null;
}

/**
 * Genes overlapping a browsed region. `/primers` has no such endpoint — it can
 * only fetch a gene by id — so the host supplies this when it has a gene source
 * of its own. Without it the variant browser simply draws no gene track.
 */
export type GenesInRegion = (
  query: { system_name: string; region: string; start: number; end: number },
  options?: RequestOptions,
) => Promise<RegionGene[]>;

/**
 * Reference sequence for a window, plus strand, as plain bases. `/primers`
 * returns no sequence with a variant listing, so the host supplies this when it
 * has a sequence source of its own. Without it the CAPS column reads
 * "unknown" — never "no", which would be a claim the client cannot make.
 *
 * It must be the same assembly *and the same release* the primers API reads
 * variants from. A mismatched gene track is visibly wrong; mismatched sequence
 * produces a confident, wrong enzyme call, which is why every window is checked
 * against the reference alleles before it is used.
 */
export type SequenceForRegion = (
  query: { system_name: string; region: string; start: number; end: number },
  options?: RequestOptions,
) => Promise<string | null>;

/** One population's frequency for one allele of a variant. */
export interface PopulationFrequency {
  population: string;
  allele: string;
  frequency: number;
  /** Chromosomes counted, where the source reports it. */
  count: number | null;
}

/**
 * Allele frequencies for variants, by id. `/primers` reports which alleles
 * exist but not how common they are, so the host supplies this when it has a
 * frequency source of its own; without it the picker shows no frequency column.
 *
 * Called with at most a few hundred ids at a time — the library decides how
 * many and how often, the host only makes the request. Ids absent from the
 * answer are taken to have no frequency reported, which is ordinary: about one
 * variant in ten has none. Alleles must be written as the listing's `minimal`
 * block writes them, so a deletion is `-`.
 *
 * It must read the same assembly and release the primers API reads variants
 * from, for the same reason the sequence source must.
 */
export type AlleleFrequencies = (
  query: { system_name: string; ids: string[] },
  options?: RequestOptions,
) => Promise<Record<string, PopulationFrequency[]>>;

export interface PrimerDesignerProps {
  apiBase: string;
  client?: PrimersClient;
  gene?: GrameneGene;
  geneId?: string;
  systemName?: string;
  region?: RegionSpec;
  sequence?: string;
  modes?: DesignerMode[];
  /** Supplies gene models for the genotyping variant browser; omitted, the gene track is hidden. */
  genesInRegion?: GenesInRegion;
  /** Supplies reference sequence for the CAPS annotation; omitted, the CAPS column reads "unknown". */
  sequenceForRegion?: SequenceForRegion;
  /** Supplies allele frequencies for listed variants; omitted, there is no frequency column. */
  alleleFrequencies?: AlleleFrequencies;
  /** Restriction enzymes to consider for CAPS. Defaults to the bundled panel. */
  enzymes?: ReadonlyArray<RestrictionEnzyme>;
  defaultMode?: DesignerMode;
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
