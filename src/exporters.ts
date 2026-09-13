import { formatGenomic } from './coords';
import { matchCheckResults } from './results';
import type {
  CheckJob,
  CheckResults,
  GenomeAmplicon,
  PangenomeAmplicon,
  PrimerOligo,
  PrimerPair,
  PrimerTemplate,
  TranscriptAmpliconGroup,
} from './types';

type Cell = string | number | boolean | null | undefined;

const NUMERIC = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
// = + - @ and their full-width forms start a formula in spreadsheet apps.
const FORMULA_START = /^[=+\-@＝＋－＠]/;

/**
 * One TSV cell: tabs/newlines become spaces; non-numeric text whose first
 * non-blank character is `= + - @` is prefixed with `'` (formula injection).
 */
export function tsvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const s = String(value).replace(/[\t\r\n]+/g, ' ');
  if (NUMERIC.test(s.trim())) return s;
  if (FORMULA_START.test(s.trimStart())) return `'${s}`;
  return s;
}

export function toTSV(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<Cell>>): string {
  const lines = [header.map(tsvCell).join('\t')];
  for (const r of rows) lines.push(r.map(tsvCell).join('\t'));
  return `${lines.join('\n')}\n`;
}

function round(v: number | null | undefined, digits: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function fastaLabel(label: string | null | undefined): string {
  const cleaned = String(label ?? '').replace(/[^A-Za-z0-9_.:-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'primers';
}

function headerText(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim();
}

function wrap(seq: string, width = 60): string {
  const out: string[] = [];
  for (let i = 0; i < seq.length; i += width) out.push(seq.slice(i, i + width));
  return out.join('\n');
}

function junctionText(o: PrimerOligo): string {
  return o.junction ? `${o.junction.position} (${o.junction.overlap_5p}/${o.junction.overlap_3p})` : '';
}

export interface PairsExportOptions {
  /** Check job whose results are matched to pairs by sequence. */
  check?: Pick<CheckJob, 'request' | 'results'> | null;
}

export const PAIRS_TSV_HEADER = [
  'pair', 'rank', 'left_seq', 'left_start', 'left_len', 'left_tm', 'left_gc', 'left_junction', 'left_genomic',
  'right_seq', 'right_start', 'right_len', 'right_tm', 'right_gc', 'right_junction', 'right_genomic',
  'product_size', 'product_tm', 'product_genomic', 'genomic_size', 'penalty', 'compl_any_th', 'compl_end_th',
  'left_hairpin_th', 'right_hairpin_th', 'specificity', 'off_targets', 'transcriptome', 'pangenome_amplifies',
] as const;

export function pairsToTSV(pairs: ReadonlyArray<PrimerPair>, options: PairsExportOptions = {}): string {
  const matched = options.check ? matchCheckResults(pairs, options.check) : null;
  const rows = pairs.map((p) => {
    const m = matched?.byRank.get(p.rank);
    const pan = m?.pangenome?.summary;
    return [
      `P${p.rank + 1}`, p.rank + 1,
      p.left.seq, p.left.start, p.left.len, round(p.left.tm, 2), round(p.left.gc, 2), junctionText(p.left), formatGenomic(p.left.genomic),
      p.right.seq, p.right.start, p.right.len, round(p.right.tm, 2), round(p.right.gc, 2), junctionText(p.right), formatGenomic(p.right.genomic),
      p.product_size, round(p.product_tm, 2), formatGenomic(p.product?.genomic), p.product?.genomic_size ?? null,
      round(p.penalty, 4), round(p.compl_any_th, 2), round(p.compl_end_th, 2), round(p.left.hairpin_th, 2), round(p.right.hairpin_th, 2),
      m ? m.specificity?.verdict ?? '' : matched ? 'not checked' : '',
      m?.specificity ? m.specificity.off_target_count : null,
      m?.transcriptome?.verdict ?? '',
      pan ? `${pan.amplifies}/${pan.genomes_total}` : '',
    ];
  });
  return toTSV(PAIRS_TSV_HEADER, rows);
}

export interface FastaOptions {
  /** Prefix for record names, e.g. the gene id; sanitized to `[A-Za-z0-9_.:-]`. */
  label?: string;
}

/** `>{label}_P{n}_F tm=59.1 gc=35 {genomic}` records for every primer. */
export function primersToFasta(pairs: ReadonlyArray<PrimerPair>, options: FastaOptions = {}): string {
  const label = fastaLabel(options.label);
  const out: string[] = [];
  for (const p of pairs) {
    for (const [side, o] of [['F', p.left], ['R', p.right]] as const) {
      const parts = [`>${label}_P${p.rank + 1}_${side}`, `tm=${round(o.tm, 1) ?? ''}`, `gc=${round(o.gc, 1) ?? ''}`];
      const g = formatGenomic(o.genomic);
      if (g) parts.push(g);
      out.push(headerText(parts.join(' ')), o.seq.toUpperCase());
    }
  }
  return out.length ? `${out.join('\n')}\n` : '';
}

/** Amplicon sequences cut from the template (`left.start … right.end`), 60 nt lines. */
export function ampliconsToFasta(pairs: ReadonlyArray<PrimerPair>, template: Pick<PrimerTemplate, 'seq' | 'length'> | null | undefined, options: FastaOptions = {}): string {
  const label = fastaLabel(options.label);
  const seq = template?.seq ?? '';
  const out: string[] = [];
  for (const p of pairs) {
    const start = p.left.start;
    const end = p.right.end;
    if (!seq || start < 1 || end > seq.length || end < start) continue;
    const amp = seq.slice(start - 1, end).toUpperCase();
    const parts = [`>${label}_P${p.rank + 1}_amplicon`, `size=${amp.length}`, `template=${start}-${end}`];
    const g = formatGenomic(p.product?.genomic);
    if (g) parts.push(g);
    out.push(headerText(parts.join(' ')), wrap(amp));
  }
  return out.length ? `${out.join('\n')}\n` : '';
}

export const OFF_TARGETS_TSV_HEADER = [
  'target', 'pair', 'verdict', 'kind', 'region', 'start', 'end', 'size', 'gene_id', 'isoforms', 'orientation', 'likelihood',
  'left_mm', 'right_mm', 'left_3p_mm', 'right_3p_mm', 'left_mm_pos', 'right_mm_pos', 'approx', 'genes',
] as const;

function genomeRow(target: string, pair: string, verdict: string, kind: string, a: GenomeAmplicon): Cell[] {
  return [
    target, pair, verdict, kind, a.region, a.start, a.end, a.size, '', '', a.orientation, a.likelihood,
    a.left_mm, a.right_mm, a.left_3p_mm, a.right_3p_mm, (a.left_mm_pos ?? []).join(','), (a.right_mm_pos ?? []).join(','),
    a.approx ?? false, (a.genes ?? []).map((g) => g.id).join(','),
  ];
}

function groupRow(pair: string, verdict: string, kind: string, g: TranscriptAmpliconGroup): Cell[] {
  const size = g.size_min === g.size_max ? g.size_min : `${g.size_min}-${g.size_max}`;
  return [
    'cdna', pair, verdict, kind, '', '', '', size, g.gene_id, (g.isoforms ?? []).map((i) => i.transcript_id).join(','), g.orientation ?? '', g.likelihood,
    g.left_mm ?? null, g.right_mm ?? null, g.left_3p_mm ?? null, g.right_3p_mm ?? null, (g.left_mm_pos ?? []).join(','), (g.right_mm_pos ?? []).join(','),
    g.approx ?? false, g.gene_id,
  ];
}

/** On-target, off-target, unlikely and gDNA amplicons from the specificity and transcriptome blocks. */
export function offTargetsToTSV(results: CheckResults | null | undefined): string {
  const rows: Cell[][] = [];
  for (const p of results?.specificity?.pairs ?? []) {
    if (p.on_target) rows.push(genomeRow('genome', p.id, p.verdict, 'on_target', p.on_target));
    for (const a of p.off_targets ?? []) rows.push(genomeRow('genome', p.id, p.verdict, 'off_target', a));
    for (const a of p.unlikely ?? []) rows.push(genomeRow('genome', p.id, p.verdict, 'unlikely', a));
    for (const a of p.gdna_products ?? []) rows.push(genomeRow('genome', p.id, p.verdict, 'gdna_product', a));
  }
  for (const p of results?.transcriptome?.pairs ?? []) {
    if (p.on_target) rows.push(groupRow(p.id, p.verdict, 'on_target', p.on_target));
    for (const g of p.off_targets ?? []) rows.push(groupRow(p.id, p.verdict, 'off_target', g));
  }
  return toTSV(OFF_TARGETS_TSV_HEADER, rows);
}

export const PANGENOME_TSV_HEADER = [
  'pair', 'reference_size', 'system_name', 'display_name', 'status', 'ortholog_annotated', 'region', 'start', 'end', 'strand',
  'size', 'size_delta', 'orientation', 'likelihood', 'left_mm', 'right_mm', 'left_3p_mm', 'right_3p_mm',
  'mismatch_in_3p_window', 'terminal_mismatch', 'ortholog', 'genes', 'other_amplicons', 'nearest_size', 'truncated',
] as const;

function panSize(a: PangenomeAmplicon | null | undefined): Cell {
  if (!a) return null;
  if (typeof a.size_min === 'number' && typeof a.size_max === 'number' && a.size_min !== a.size_max) return `${a.size_min}-${a.size_max}`;
  return a.size;
}

/** One row per pair × genome; `truncated` is true when that genome's search hit a result cap. */
export function pangenomeToTSV(results: CheckResults | null | undefined): string {
  const rows: Cell[][] = [];
  for (const p of results?.pangenome?.pairs ?? []) {
    for (const g of p.genomes ?? []) {
      const a = g.primary ?? null;
      const genes = a?.genes ? a.genes.map((x) => x.id).join(',') : a?.gene_id ?? '';
      rows.push([
        p.id, p.reference_size, g.system_name, g.display_name ?? '', g.status, g.ortholog_annotated ?? null,
        a?.region ?? '', a?.start ?? null, a?.end ?? null, a?.strand ?? null,
        panSize(a), a?.size_delta ?? null, a?.orientation ?? '', a?.likelihood ?? '',
        a?.left_mm ?? null, a?.right_mm ?? null, a?.left_3p_mm ?? null, a?.right_3p_mm ?? null,
        a?.mismatch_in_3p_window ?? null, a?.terminal_mismatch ?? null, a?.ortholog ?? null, genes,
        g.other_amplicons ?? null, panSize(g.nearest), g.truncated ?? null,
      ]);
    }
  }
  return toTSV(PANGENOME_TSV_HEADER, rows);
}
