import type {
  CheckJob,
  CheckResults,
  PangenomeCellStatus,
  PangenomeGenomeResult,
  PangenomePairResult,
  PangenomeStatus,
  PangenomeSummary,
} from './types';

export interface PangenomeStatusMeta {
  status: PangenomeCellStatus;
  glyph: string;
  /** Okabe-Ito colour, or null for hatch/dotted styles. */
  color: string | null;
  label: string;
  /** Higher is worse; used for "sort by worst status". */
  severity: number;
  /** Counted in `amplifies`. */
  amplifies: boolean;
}

/** Matrix legend (spec §C.3): glyph + colour + text, never colour alone. */
export const PANGENOME_STATUS_META: Readonly<Record<PangenomeCellStatus, PangenomeStatusMeta>> = Object.freeze({
  single_perfect: { status: 'single_perfect', glyph: '✓', color: '#009E73', label: 'One amplicon, no mismatches', severity: 0, amplifies: true },
  single_mismatch: { status: 'single_mismatch', glyph: '≈', color: '#56B4E9', label: 'One amplicon with mismatches', severity: 3, amplifies: true },
  multiple: { status: 'multiple', glyph: '×', color: '#E69F00', label: 'Two or more amplicons', severity: 4, amplifies: true },
  no_amplicon: { status: 'no_amplicon', glyph: '∅', color: '#D55E00', label: 'No amplicon', severity: 5, amplifies: false },
  db_unavailable: { status: 'db_unavailable', glyph: '?', color: null, label: 'No usable database', severity: 1, amplifies: false },
  error: { status: 'error', glyph: '!', color: '#555555', label: 'Check failed', severity: 2, amplifies: false },
  pending: { status: 'pending', glyph: '…', color: null, label: 'Pending', severity: -1, amplifies: false },
});

export const PANGENOME_STATUSES: readonly PangenomeStatus[] = Object.freeze([
  'single_perfect',
  'single_mismatch',
  'multiple',
  'no_amplicon',
  'db_unavailable',
  'error',
]);

/** Warning code for transcript-mode pan-genome checks (annotated transcript models only). */
export const PANGENOME_TRANSCRIPT_MODELS_ONLY = 'PANGENOME_TRANSCRIPT_MODELS_ONLY';

export function emptyPangenomeSummary(): PangenomeSummary {
  return { genomes_total: 0, single_perfect: 0, single_mismatch: 0, multiple: 0, no_amplicon: 0, db_unavailable: 0, error: 0, amplifies: 0, truncated: 0 };
}

/**
 * Counts per status; `amplifies = single_perfect + single_mismatch + multiple`;
 * `truncated` counts genomes whose search hit a result cap (a flag, not a status).
 */
export function summarizePangenome(genomes: ReadonlyArray<Pick<PangenomeGenomeResult, 'status' | 'truncated'>>): PangenomeSummary {
  const s = emptyPangenomeSummary();
  for (const g of genomes) {
    if ((PANGENOME_STATUSES as readonly string[]).includes(g.status)) s[g.status] += 1;
    s.genomes_total += 1;
    if (g.truncated) s.truncated = (s.truncated ?? 0) + 1;
  }
  s.amplifies = s.single_perfect + s.single_mismatch + s.multiple;
  return s;
}

/** Genomes of a pair whose result is incomplete: `summary.truncated`, else counted from `genomes[].truncated`. */
export function truncatedGenomeCount(pair: Pick<PangenomePairResult, 'summary' | 'genomes'> | null | undefined): number {
  if (!pair) return 0;
  if (typeof pair.summary?.truncated === 'number') return pair.summary.truncated;
  return (pair.genomes ?? []).filter((g) => g.truncated).length;
}

/** The summary invariant: status counts sum to `genomes_total` and `amplifies` is their amplifying subset. */
export function isConsistentSummary(s: PangenomeSummary): boolean {
  const sum = PANGENOME_STATUSES.reduce((acc, k) => acc + (s[k] ?? 0), 0);
  return sum === s.genomes_total && s.amplifies === s.single_perfect + s.single_mismatch + s.multiple;
}

export function amplifiesFraction(s: PangenomeSummary | null | undefined): { amplifies: number; total: number } {
  if (!s) return { amplifies: 0, total: 0 };
  return { amplifies: s.single_perfect + s.single_mismatch + s.multiple, total: s.genomes_total };
}

/** "Issues only" filter: anything that is not a single perfect amplicon. */
export function isIssueStatus(status: PangenomeCellStatus): boolean {
  return status !== 'single_perfect' && status !== 'pending';
}

/** Short text for a matrix cell (spec §C.3). */
export function pangenomeCellText(g: PangenomeGenomeResult): string {
  switch (g.status) {
    case 'single_perfect': {
      const d = g.primary?.size_delta;
      return typeof d === 'number' ? (d > 0 ? `+${d}` : String(d)) : '';
    }
    case 'single_mismatch':
      return g.primary?.mismatch_in_3p_window || g.primary?.terminal_mismatch ? '3′' : '';
    case 'multiple':
      return `×${1 + (g.other_amplicons ?? g.others?.length ?? 1)}`;
    case 'no_amplicon':
      return g.ortholog_annotated === false ? 'no ortholog annotated' : '';
    default:
      return '';
  }
}

export interface PangenomeRow {
  system_name: string;
  display_name: string;
  status: PangenomeCellStatus;
  result: PangenomeGenomeResult | null;
}

/**
 * Rows for one pair, including `pending` rows for requested genomes that have
 * no result yet (partial jobs).
 */
export function pangenomeRows(
  pair: PangenomePairResult | null | undefined,
  requested?: ReadonlyArray<string | { system_name: string; display_name?: string }> | null,
): PangenomeRow[] {
  const rows: PangenomeRow[] = [];
  const seen = new Set<string>();
  for (const g of pair?.genomes ?? []) {
    seen.add(g.system_name);
    rows.push({ system_name: g.system_name, display_name: g.display_name ?? g.system_name, status: g.status, result: g });
  }
  for (const r of requested ?? []) {
    const name = typeof r === 'string' ? r : r.system_name;
    if (seen.has(name)) continue;
    seen.add(name);
    rows.push({ system_name: name, display_name: typeof r === 'string' ? r : r.display_name ?? name, status: 'pending', result: null });
  }
  return rows;
}

export function sortPangenomeRows(rows: ReadonlyArray<PangenomeRow>, by: 'name' | 'worst'): PangenomeRow[] {
  const byName = (a: PangenomeRow, b: PangenomeRow) => a.display_name.localeCompare(b.display_name) || a.system_name.localeCompare(b.system_name);
  const copy = [...rows];
  if (by === 'name') return copy.sort(byName);
  return copy.sort((a, b) => PANGENOME_STATUS_META[b.status].severity - PANGENOME_STATUS_META[a.status].severity || byName(a, b));
}

/** True when the pan-genome searched annotated transcript models only (transcript mode). */
export function isTranscriptModelsOnly(source: CheckJob | CheckResults | null | undefined): boolean {
  if (!source) return false;
  const results: CheckResults | null | undefined = 'job_id' in source ? (source as CheckJob).results : (source as CheckResults);
  const warnings = [...((source as CheckJob).warnings ?? []), ...(results?.warnings ?? [])];
  if (warnings.some((w) => (typeof w === 'string' ? w : w?.code) === PANGENOME_TRANSCRIPT_MODELS_ONLY)) return true;
  return results?.pangenome?.target === 'cdna';
}
