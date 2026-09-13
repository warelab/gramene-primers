import { describe, expect, it } from 'vitest';
import {
  amplifiesFraction,
  isConsistentSummary,
  isIssueStatus,
  isTranscriptModelsOnly,
  PANGENOME_STATUS_META,
  pangenomeCellText,
  pangenomeRows,
  sortPangenomeRows,
  summarizePangenome,
  truncatedGenomeCount,
} from '../src/pangenome';
import type { PangenomeGenomeResult, PangenomeStatus } from '../src/types';
import { doneCheckJob, transcriptCheckJob } from './fixtures/samples';

const g = (system_name: string, status: PangenomeStatus, extra: Partial<PangenomeGenomeResult> = {}): PangenomeGenomeResult => ({ system_name, status, ...extra });

describe('pan-genome summary', () => {
  it('amplifies = single_perfect + single_mismatch + multiple and counts sum to genomes_total', () => {
    const s = summarizePangenome([
      g('a', 'single_perfect'),
      g('b', 'single_mismatch'),
      g('c', 'multiple'),
      g('d', 'no_amplicon'),
      g('e', 'db_unavailable'),
      g('f', 'error'),
      g('h', 'single_perfect'),
    ]);
    expect(s).toEqual({ genomes_total: 7, single_perfect: 2, single_mismatch: 1, multiple: 1, no_amplicon: 1, db_unavailable: 1, error: 1, amplifies: 4, truncated: 0 });
    expect(isConsistentSummary(s)).toBe(true);
    expect(isConsistentSummary({ ...s, amplifies: 2 })).toBe(false);
    expect(isConsistentSummary({ ...s, genomes_total: 8 })).toBe(false);
    expect(amplifiesFraction(s)).toEqual({ amplifies: 4, total: 7 });
    expect(amplifiesFraction(null)).toEqual({ amplifies: 0, total: 0 });
  });

  it('counts truncated genomes (summary.truncated) without changing the status counts', () => {
    const genomes = [g('a', 'no_amplicon', { truncated: true }), g('b', 'single_perfect', { truncated: true }), g('c', 'single_perfect', { truncated: false })];
    const s = summarizePangenome(genomes);
    expect(s).toEqual({ genomes_total: 3, single_perfect: 2, single_mismatch: 0, multiple: 0, no_amplicon: 1, db_unavailable: 0, error: 0, amplifies: 2, truncated: 2 });
    expect(isConsistentSummary(s)).toBe(true);
    expect(truncatedGenomeCount({ summary: s, genomes })).toBe(2);
    // Results from algorithm version 1 have no summary.truncated: count the flags instead.
    const { truncated: _ignored, ...v1 } = s;
    expect(truncatedGenomeCount({ summary: v1, genomes: [g('a', 'no_amplicon', { truncated: true })] })).toBe(1);
    expect(truncatedGenomeCount(null)).toBe(0);
  });

  it('sample results satisfy the invariant and match recomputed summaries', () => {
    for (const p of doneCheckJob().results!.pangenome!.pairs) {
      expect(isConsistentSummary(p.summary)).toBe(true);
      expect(summarizePangenome(p.genomes)).toEqual(p.summary);
    }
  });
});

describe('matrix helpers', () => {
  it('status meta follows the spec legend (glyph, Okabe-Ito colour, text)', () => {
    expect(PANGENOME_STATUS_META.single_perfect).toMatchObject({ glyph: '✓', color: '#009E73' });
    expect(PANGENOME_STATUS_META.single_mismatch).toMatchObject({ glyph: '≈', color: '#56B4E9' });
    expect(PANGENOME_STATUS_META.multiple).toMatchObject({ glyph: '×', color: '#E69F00' });
    expect(PANGENOME_STATUS_META.no_amplicon).toMatchObject({ glyph: '∅', color: '#D55E00' });
    expect(PANGENOME_STATUS_META.db_unavailable).toMatchObject({ glyph: '?', color: null });
    expect(PANGENOME_STATUS_META.error).toMatchObject({ glyph: '!', color: '#555555' });
    expect(PANGENOME_STATUS_META.pending).toMatchObject({ glyph: '…' });
    for (const meta of Object.values(PANGENOME_STATUS_META)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.amplifies).toBe(['single_perfect', 'single_mismatch', 'multiple'].includes(meta.status));
    }
  });

  it('cell text: size delta, 3′ flag, ×N, no ortholog annotated', () => {
    expect(pangenomeCellText(g('a', 'single_perfect', { primary: { size: 210, size_delta: 0 } }))).toBe('0');
    expect(pangenomeCellText(g('a', 'single_perfect', { primary: { size: 232, size_delta: 22 } }))).toBe('+22');
    expect(pangenomeCellText(g('a', 'single_perfect', { primary: { size: 2187, size_delta: -177 } }))).toBe('-177');
    expect(pangenomeCellText(g('a', 'single_mismatch', { primary: { size: 580, terminal_mismatch: true } }))).toBe('3′');
    expect(pangenomeCellText(g('a', 'single_mismatch', { primary: { size: 581, mismatch_in_3p_window: false, terminal_mismatch: false } }))).toBe('');
    expect(pangenomeCellText(g('a', 'multiple', { other_amplicons: 3 }))).toBe('×4');
    expect(pangenomeCellText(g('a', 'no_amplicon', { ortholog_annotated: false }))).toBe('no ortholog annotated');
    expect(pangenomeCellText(g('a', 'no_amplicon', { ortholog_annotated: true }))).toBe('');
    expect(pangenomeCellText(g('a', 'error'))).toBe('');
  });

  it('rows add pending genomes for partial results and sort by name or worst status', () => {
    const pair = doneCheckJob().results!.pangenome!.pairs[0]!;
    const rows = pangenomeRows(pair, ['sorghum_353', { system_name: 'sorghum_rio', display_name: 'Sb Rio' }, 'sorghum_leoti']);
    expect(rows.map((r) => [r.system_name, r.status])).toEqual([
      ['sorghum_353', 'single_perfect'],
      ['sorghum_grassl', 'multiple'],
      ['sorghum_leoti', 'no_amplicon'],
      ['sorghum_rio', 'pending'],
    ]);
    expect(sortPangenomeRows(rows, 'worst').map((r) => r.status)).toEqual(['no_amplicon', 'multiple', 'single_perfect', 'pending']);
    expect(sortPangenomeRows(rows, 'name').map((r) => r.display_name)).toEqual(['=HYPERLINK("http://x")', 'Sb leoti', 'Sb Rio', 'Sb verticilliflorum 353']);
    expect(pangenomeRows(null, ['a']).map((r) => r.status)).toEqual(['pending']);
  });

  it('issues-only filter keeps everything but single_perfect and pending', () => {
    expect(isIssueStatus('single_perfect')).toBe(false);
    expect(isIssueStatus('pending')).toBe(false);
    for (const s of ['single_mismatch', 'multiple', 'no_amplicon', 'db_unavailable', 'error'] as const) expect(isIssueStatus(s)).toBe(true);
  });

  it('detects transcript-model-only pan-genome checks', () => {
    expect(isTranscriptModelsOnly(transcriptCheckJob())).toBe(true);
    const results = transcriptCheckJob().results!;
    expect(isTranscriptModelsOnly({ ...results, warnings: [] })).toBe(true);
    expect(isTranscriptModelsOnly({ pangenome: { target: 'genome', pairs: [] }, warnings: [{ code: 'PANGENOME_TRANSCRIPT_MODELS_ONLY' }] })).toBe(true);
    expect(isTranscriptModelsOnly(doneCheckJob())).toBe(false);
    expect(isTranscriptModelsOnly(null)).toBe(false);
  });
});
