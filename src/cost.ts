import type { DesignMode, GenomeEntry } from './types';

/** Single-thread CPU-seconds per primer·Gb by BLAST word size (measured on sorghum, spec §B.3). */
export const CPU_S_PER_PRIMER_GB: Readonly<Record<5 | 6 | 7, number>> = Object.freeze({ 5: 5.2, 6: 2.2, 7: 1.2 });
/** cDNA DB size assumed by the API-side estimate. */
export const CDNA_GB_ESTIMATE = 0.15;
export const MAX_JOB_CPU_S = 6000;
export const REFERENCE_WORD_SIZE = 5;
export const PANGENOME_WORD_SIZE = 6;
/**
 * Re-alignment (FASTA DP of candidate sites) CPU-seconds per unique primer per
 * genome task: the reference genome and, outside transcript mode, each pan-genome
 * genome. cDNA searches re-align from the BLAST alignment and are not charged.
 * Mirrors `DEFAULT_REALIGN_CPU_S_PER_PRIMER_TASK` in the server's `check/cost.js`.
 */
export const REALIGN_CPU_S_PER_PRIMER_TASK = 0.6;
/**
 * Multiplier on the pan-genome BLAST term. Pan-genome genomes run as up to 8 concurrent
 * single-thread blastn processes, which used about twice the single-thread CPU per primer·Gb
 * on the full sorghum panel (4.33 vs 2.2 at word size 6).
 * Mirrors `DEFAULT_PANGENOME_CPU_FACTOR` in the server's `check/cost.js`.
 */
export const PANGENOME_CPU_FACTOR = 2.0;
/** Size charged for a genome whose `total_bases` is unknown. Mirrors `FALLBACK_GENOME_GB` in `check/cost.js`. */
export const FALLBACK_GENOME_GB = 1.0;

export type WordSize = 5 | 6 | 7;

type GenomeSize = number | null | undefined | Pick<GenomeEntry, 'total_bases'>;

export interface CheckCpuInput {
  /** Unique primer count, or the primers / pairs themselves (uppercase-deduplicated). */
  primers: number | ReadonlyArray<string> | ReadonlyArray<{ left: string | { seq: string }; right: string | { seq: string } }>;
  mode?: DesignMode;
  /** Reference genome size in bases (`GenomeEntry.total_bases`); an unknown size is charged as 1 Gb, like the server. */
  referenceTotalBases: number | null | undefined;
  /** Pan-genome genomes (sizes or entries); omit for specificity only. */
  pangenome?: ReadonlyArray<GenomeSize> | null;
  wordSizeReference?: WordSize;
  wordSizePangenome?: WordSize;
  cdnaGb?: number;
  limit?: number;
}

export interface CheckCpuEstimate {
  /** Rounded up to whole CPU-seconds. */
  cpu_s: number;
  reference_cpu_s: number;
  transcriptome_cpu_s: number;
  /** Includes `PANGENOME_CPU_FACTOR`. */
  pangenome_cpu_s: number;
  /** `unique_primers × genome_tasks × REALIGN_CPU_S_PER_PRIMER_TASK`. */
  realign_cpu_s: number;
  /** Re-aligned genome tasks: 1 reference genome, plus each pan-genome genome outside transcript mode. */
  genome_tasks: number;
  unique_primers: number;
  genomes: number;
  limit: number;
  /** The server rejects jobs over the limit with 422 `JOB_TOO_LARGE`. */
  over_limit: boolean;
}

function countUnique(primers: CheckCpuInput['primers']): number {
  if (typeof primers === 'number') return Math.max(0, Math.floor(primers));
  const set = new Set<string>();
  for (const p of primers) {
    if (typeof p === 'string') set.add(p.toUpperCase());
    else {
      set.add((typeof p.left === 'string' ? p.left : p.left.seq).toUpperCase());
      set.add((typeof p.right === 'string' ? p.right : p.right.seq).toUpperCase());
    }
  }
  return set.size;
}

function sizeOf(g: GenomeSize): number | null {
  if (typeof g === 'number') return Number.isFinite(g) ? g : null;
  if (g && typeof g === 'object') return typeof g.total_bases === 'number' ? g.total_bases : null;
  return null;
}

/** Gb for a size in bases; a missing, non-finite or non-positive size uses FALLBACK_GENOME_GB (server `genomeGb`). */
function gbOf(bases: number | null): number {
  return bases !== null && Number.isFinite(bases) && bases > 0 ? bases / 1e9 : FALLBACK_GENOME_GB;
}

/**
 * Mirrors the server estimate (`check/cost.js`, spec §B.13 plus the re-alignment term and the pan-genome factor):
 * `uniq × [ref_Gb·c(ws_ref) + (transcript ? cdna_Gb·c(ws_ref) : 0) + PANGENOME_CPU_FACTOR·Σ_pan (genome_Gb | cdna_Gb)·c(ws_pan)
 *  + genome_tasks·REALIGN_CPU_S_PER_PRIMER_TASK]`,
 * with `genome_tasks = 1 + (transcript ? 0 : pan genomes)`, unknown genome sizes charged as 1 Gb,
 * rounded up ignoring float noise below 1e-6.
 * The server is authoritative; this is for display and for disabling Submit.
 */
export function estimateCheckCpu(input: CheckCpuInput): CheckCpuEstimate {
  const uniq = countUnique(input.primers);
  const wsRef = input.wordSizeReference ?? REFERENCE_WORD_SIZE;
  const wsPan = input.wordSizePangenome ?? PANGENOME_WORD_SIZE;
  const cRef = CPU_S_PER_PRIMER_GB[wsRef];
  const cPan = CPU_S_PER_PRIMER_GB[wsPan];
  const cdnaGb = input.cdnaGb ?? CDNA_GB_ESTIMATE;
  const limit = input.limit ?? MAX_JOB_CPU_S;
  const transcript = input.mode === 'transcript';
  const refGb = gbOf(typeof input.referenceTotalBases === 'number' ? input.referenceTotalBases : null);

  const reference = uniq * refGb * cRef;
  const transcriptome = transcript ? uniq * cdnaGb * cRef : 0;
  let panGb = 0;
  const pan = input.pangenome ?? [];
  for (const g of pan) {
    if (transcript) panGb += cdnaGb;
    else panGb += gbOf(sizeOf(g));
  }
  const pangenome = uniq * panGb * cPan * PANGENOME_CPU_FACTOR;
  const genomeTasks = 1 + (transcript ? 0 : pan.length);
  const realign = uniq * genomeTasks * REALIGN_CPU_S_PER_PRIMER_TASK;
  const total = reference + transcriptome + pangenome + realign;
  return {
    // Server ceilCpu: Math.ceil(Math.round(x × 1e6) / 1e6).
    cpu_s: Math.max(0, Math.ceil(Math.round(total * 1e6) / 1e6)),
    reference_cpu_s: reference,
    transcriptome_cpu_s: transcriptome,
    pangenome_cpu_s: pangenome,
    realign_cpu_s: realign,
    genome_tasks: genomeTasks,
    unique_primers: uniq,
    genomes: pan.length,
    limit,
    over_limit: total > limit,
  };
}
