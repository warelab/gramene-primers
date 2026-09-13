/**
 * Components and helpers against real /primers responses captured from the dev API with
 * `PRIMERS_IT_BASE=... node scripts/capture-fixtures.mjs --checks` (test/fixtures/api/). Unlike
 * samples.ts nothing here is illustrative: the jobs are the server's own queued / running / done
 * documents. Expectations are derived from the captures where a re-capture could legitimately change
 * a number (e.g. off-target counts). Skipped when the captures are absent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PangenomeMatrix } from '../../src/components/PangenomeMatrix';
import { PrimerDesigner } from '../../src/components/PrimerDesigner';
import { SpecificityResults } from '../../src/components/SpecificityResults';
import { VERDICT_META } from '../../src/components/VerdictChip';
import { offTargetsToTSV, pairsToTSV, pangenomeToTSV } from '../../src/exporters';
import { isConsistentSummary, summarizePangenome } from '../../src/pangenome';
import { matchCheckResults } from '../../src/results';
import type { CheckJob, GenomesResponse, PrimerDesignerProps, PrimerDesignerState } from '../../src/types';
import { gene87700, geneDesign, genePairs, qpcrCheckPair, SEQS } from '../fixtures/samples';
import { fixturePath } from '../paths';
import { FakePrimersClient } from './fakeClient';
import { API } from './fixtures';

const CAPTURES = [
  'check-gene-P2-submit',
  'check-gene-P2-final',
  'check-transcript-qpcr-submit',
  'check-transcript-qpcr-final',
  'check-pangenome-P3-submit',
  'check-pangenome-P3-running',
  'check-pangenome-P3-final',
  'genomes-sorghum_bicolor',
];
const HAVE_CAPTURES = CAPTURES.every((n) => existsSync(fixturePath('api', `${n}.json`)));

interface Captured<T> {
  status: number;
  headers: Record<string, string | null>;
  body: T;
}

function captured<T>(name: string): Captured<T> {
  return JSON.parse(readFileSync(fixturePath('api', `${name}.json`), 'utf8')) as Captured<T>;
}

const job = (name: string): CheckJob => captured<CheckJob>(name).body;

/** VerdictChip text for a captured specificity result (the verdict itself can change with the algorithm version). */
function chipText(r: { verdict: string; off_target_count?: number | null; on_target_inferred?: boolean }): string {
  const label = VERDICT_META[r.verdict as keyof typeof VERDICT_META]?.label ?? r.verdict;
  const count = r.verdict === 'off_targets' && typeof r.off_target_count === 'number' ? ` (${r.off_target_count})` : '';
  return `${label}${count}${r.on_target_inferred ? ' · inferred' : ''}`;
}

function Host(props: Omit<PrimerDesignerProps, 'state' | 'onStateChange' | 'apiBase'> & { initial: PrimerDesignerState }) {
  const { initial, ...rest } = props;
  const [state, setState] = useState<PrimerDesignerState>(initial);
  return <PrimerDesigner apiBase={API} {...rest} state={state} onStateChange={setState} />;
}

describe.skipIf(!HAVE_CAPTURES)('real dev-API check responses', () => {
  it('submit answers are 202 queued jobs; finished jobs echo the normalized request and carry every §B.12 block', () => {
    for (const name of ['check-gene-P2', 'check-transcript-qpcr', 'check-pangenome-P3']) {
      const submit = captured<CheckJob>(`${name}-submit`);
      expect(submit.status, name).toBe(202);
      expect(submit.headers['cache-control']).toBe('no-store');
      expect(submit.body).toMatchObject({ status: 'queued', queue_position: expect.any(Number), progress: { done: 0, stage: 'queued' } });
      expect(submit.body.estimate?.cpu_s).toBeGreaterThan(0);
      const final = job(`${name}-final`);
      expect(final.job_id).toBe(submit.body.job_id);
      expect(final).toMatchObject({ status: 'done', partial: false, progress: { stage: 'done' }, error: null });
      expect(Object.keys(final.results ?? {}).sort()).toEqual(
        ['engine', 'params', 'reference', 'sensitivity_note', 'primers', 'specificity', 'transcriptome', 'pangenome', 'warnings', 'timings_ms'].sort(),
      );
      for (const p of final.request?.pairs ?? []) {
        expect(p.left).toBe(p.left.toUpperCase());
        expect(final.results?.primers?.[p.left], `${name} ${p.left}`).toBeDefined();
        expect(final.results?.primers?.[p.right], `${name} ${p.right}`).toBeDefined();
      }
    }
  });

  it('SpecificityResults renders the real P2 genome block, including the chr5 RL off-target mismatch glyphs', () => {
    const p2 = job('check-gene-P2-final');
    const pair = p2.results!.specificity!.pairs.find((p) => p.id === 'P2')!;
    expect(pair.verdict).toBe('off_targets');
    expect(pair.off_targets.map((o) => `${o.region}:${o.start}-${o.end}`)).toEqual(expect.arrayContaining(['4:7437317-7437526', '5:66890615-66890824']));
    render(<SpecificityResults results={p2.results ?? null} block="genome" pairs={genePairs} job={p2} systemName="sorghum_bicolor" />);
    const region = screen.getByRole('region', { name: /^P2/ });
    expect(within(region).getByText(`Off-targets (${pair.off_target_count})`)).toBeInTheDocument();
    expect(within(region).getByRole('table', { name: /^Off-target products of P2/ })).toBeInTheDocument();
    expect(within(region).getAllByRole('img', { name: 'Left primer: 2 mismatches at 7, 10 nt from the 3′ end' }).length).toBeGreaterThanOrEqual(1);
    expect(within(region).getAllByRole('img', { name: /^Right primer: 2 mismatches at 10, 15 nt from the 3′ end/ }).length).toBeGreaterThanOrEqual(1);
  });

  it('SpecificityResults renders the real qPCR transcriptome block (.1/.2/.3 on target, two off-target genes) and the gDNA note', () => {
    const q = job('check-transcript-qpcr-final');
    const tp = q.results!.transcriptome!.pairs[0]!;
    expect(tp.on_target?.isoforms.map((i) => i.transcript_id)).toEqual(['SORBI_3004G087700.1', 'SORBI_3004G087700.2', 'SORBI_3004G087700.3']);
    expect(tp.off_targets.map((g) => g.gene_id)).toEqual(['SORBI_3005G183900', 'SORBI_3004G087800']);
    const view = render(<SpecificityResults results={q.results ?? null} block="transcriptome" pairs={[qpcrCheckPair]} job={q} systemName="sorghum_bicolor" />);
    const tx = screen.getByRole('table', { name: 'Transcript products of P1, one row per gene' });
    const rows = within(tx).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('SORBI_3004G087700on targetSORBI_3004G087700.1');
    expect(tx).toHaveTextContent('SORBI_3005G183900');
    expect(tx).toHaveTextContent('SORBI_3004G087800');
    view.unmount();
    render(<SpecificityResults results={q.results ?? null} block="genome" pairs={[qpcrCheckPair]} job={q} systemName="sorghum_bicolor" />);
    const genomeP1 = q.results!.specificity!.pairs[0]!;
    expect(genomeP1.verdict).not.toBe('on_target_missing');
    expect(screen.getByText(/genomic DNA product inside the gene \(\d[\d,]* bp\): DNase-treat RNA/)).toBeInTheDocument();
    if (genomeP1.off_target_count > 0) {
      // The capture has genome off-targets next to the gDNA product: the pair must not read as clean in the genome.
      expect(screen.queryByText(/No off-target products/)).not.toBeInTheDocument();
      expect(screen.getByText(/^Transcript check: the genome has no expected product/)).toBeInTheDocument();
    }
  });

  it('PangenomeMatrix renders the real P3 matrix (580/580/581 bp primaries) and pending cells for the real partial job', async () => {
    const p3 = job('check-pangenome-P3-final');
    const genomes = captured<GenomesResponse>('genomes-sorghum_bicolor').body;
    const pan = p3.results!.pangenome!;
    const pair = pan.pairs[0]!;
    expect(isConsistentSummary(pair.summary)).toBe(true);
    // The client-side summary must agree with the server's (algorithm version 2 captures include summary.truncated).
    expect(summarizePangenome(pair.genomes)).toMatchObject(pair.summary);
    expect(Object.fromEntries(pair.genomes.map((g) => [g.system_name, g.primary?.size]))).toEqual({ sorghum_353: 580, sorghum_grassl: 580, sorghum_leoti: 581 });
    // Algorithm version 2 stringency: a product amplifies only with ≤ 3 mismatches per primer (4–5 are 'unlikely'),
    // so P3 has no genome off-targets and amplifies exactly once, with mismatches, in each of the three genomes.
    expect(p3.results!.engine?.algorithm_version).toBe('2');
    expect(p3.results!.params).toMatchObject({ max_amplifying_mismatches: 3 });
    expect(p3.results!.specificity!.pairs[0]).toMatchObject({ id: 'P3', verdict: 'specific', off_target_count: 0 });
    expect(pair.summary).toMatchObject({ genomes_total: 3, single_mismatch: 3, multiple: 0, amplifies: 3, truncated: 0 });

    const user = userEvent.setup();
    const view = render(<PangenomeMatrix results={pan} requestedGenomes={p3.request!.genomes} genomes={genomes.genomes} />);
    const grid = screen.getByRole('grid');
    const cells = within(grid).getAllByRole('gridcell');
    expect(cells).toHaveLength(3);
    const leoti = pair.genomes.find((g) => g.system_name === 'sorghum_leoti')!;
    const leotiName = genomes.genomes.find((g) => g.system_name === 'sorghum_leoti')!.display_name;
    const byName = within(grid).getByRole('gridcell', { name: new RegExp(`^${leotiName}, P3, `) });
    const index = cells.indexOf(byName);
    expect(index).toBeGreaterThanOrEqual(0);
    cells[0]!.focus();
    for (let i = 0; i < index; i++) await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(byName);
    await user.keyboard('{Enter}');
    const detail = screen.getByRole('region', { name: `${leotiName} · P3` });
    expect(detail).toHaveTextContent(`581 bp (+${leoti.primary!.size_delta} bp vs the reference)`);
    if ((leoti.other_amplicons ?? 0) > 0) expect(detail).toHaveTextContent(`${leoti.other_amplicons} other amplicon`);
    view.unmount();

    const running = job('check-pangenome-P3-running');
    expect(running).toMatchObject({ status: 'running', partial: true });
    const partialPan = running.results?.pangenome ?? null;
    render(<PangenomeMatrix results={partialPan} requestedGenomes={running.request!.genomes} genomes={genomes.genomes} />);
    if (!partialPan) {
      // The server sends pangenome: null until the first genome finishes (only finished genomes are listed), so the
      // rows are known from the request but there are no pair columns yet.
      expect(screen.getByText('No pan-genome results yet.')).toBeInTheDocument();
      expect(screen.getByText('3 of 3 genomes')).toBeInTheDocument();
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    } else {
      const done = partialPan.pairs[0]?.genomes.length ?? 0;
      expect(within(screen.getByRole('grid')).queryAllByRole('gridcell', { name: /Pending/ })).toHaveLength(3 - done);
    }
  });

  it('PrimerDesigner restores the saved P3 check from the real running job, polls without resubmitting, and shows the real final results', async () => {
    const running = job('check-pangenome-P3-running');
    const final = job('check-pangenome-P3-final');
    const fake = new FakePrimersClient();
    fake.genomes = captured<GenomesResponse>('genomes-sorghum_bicolor').body;
    fake.onDesign = () => geneDesign();
    fake.onGetCheck = () => running;
    const saved: PrimerDesignerState = {
      v: 1,
      mode: 'gene',
      preset: 'pcr',
      designed: true,
      checkedRanks: [2],
      check: { checks: ['specificity', 'pangenome'], jobId: running.job_id, submitted: [{ id: 'P3', left: SEQS.P3_L, right: SEQS.P3_R }] },
      view: { resultsTab: 'pairs' },
    };
    const user = userEvent.setup();
    render(<Host client={fake} gene={gene87700} initial={saved} />);

    const bar = await screen.findByRole('progressbar', { name: 'Check progress' });
    const pr = running.progress!;
    expect(bar).toHaveAttribute('aria-valuetext', `${pr.done} of ${pr.total} · ${pr.stage}${pr.running?.length ? ` · running: ${pr.running.join(', ')}` : ''}`);
    expect(fake.getCheckCalls.map((c) => c.req)).toEqual([running.job_id]);
    expect(fake.pollCalls).toHaveLength(1);
    expect(fake.pollCalls[0]!.options.resubmit).toBeUndefined();
    const table = await screen.findByRole('table', { name: /^3 primer pairs/ });
    const specRunning = running.results?.specificity?.pairs.find((p) => p.id === 'P3');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Not checked');
    expect(within(table).getAllByRole('row')[3]).toHaveTextContent(specRunning ? `Genome: ${chipText(specRunning)}` : 'Checking');

    await act(async () => fake.pollCalls[0]!.push(final));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Check primers' })).getByText('Check finished.')).toBeInTheDocument();
    const summary = final.results!.pangenome!.pairs[0]!.summary;
    expect(within(table).getAllByRole('row')[3]).toHaveTextContent(`amplifies ${summary.amplifies}/${summary.genomes_total}`);

    await user.click(screen.getByRole('tab', { name: 'Pan-genome' }));
    expect(within(screen.getByRole('grid')).getAllByRole('gridcell')).toHaveLength(3);
    expect(within(screen.getByRole('grid')).queryAllByRole('gridcell', { name: /Pending/ })).toHaveLength(0);
    await user.click(screen.getByRole('tab', { name: 'Specificity' }));
    expect(within(screen.getByRole('region', { name: /^P3/ })).getByText(chipText(final.results!.specificity!.pairs[0]!))).toBeInTheDocument();
    expect(fake.submitCalls).toHaveLength(0);
  });

  it('pair matching and the TSV exporters work on the real results', () => {
    const p3 = job('check-pangenome-P3-final');
    const spec = p3.results!.specificity!.pairs[0]!;
    const m = matchCheckResults(genePairs, p3);
    expect(m.notChecked).toEqual([0, 1]);
    expect(m.orphanIds).toEqual([]);
    expect(m.byRank.get(2)).toMatchObject({ id: 'P3', specificity: { verdict: spec.verdict, off_target_count: spec.off_target_count }, pangenome: { summary: { genomes_total: 3 } } });
    expect(m.byRank.get(2)!.leftPrimer).toMatchObject({ len: SEQS.P3_L.length });
    const amp = p3.results!.pangenome!.pairs[0]!.summary;
    const rows = pairsToTSV(genePairs, { check: p3 }).split('\n');
    expect(rows[3]).toMatch(new RegExp(`^P3\\t3\\t${SEQS.P3_L}\\t.*\\t${spec.verdict}\\t${spec.off_target_count}\\t\\t${amp.amplifies}/${amp.genomes_total}$`));
    const pan = pangenomeToTSV(p3.results).trim().split('\n');
    expect(pan.length).toBeGreaterThanOrEqual(4);
    expect(pan.some((l) => l.includes('sorghum_leoti') && l.includes('581'))).toBe(true);

    const p2 = job('check-gene-P2-final');
    const off = offTargetsToTSV(p2.results).trim().split('\n');
    expect(off.length - 1).toBeGreaterThanOrEqual(p2.results!.specificity!.pairs[0]!.off_targets.length);
    expect(off.some((l) => l.includes('66890615'))).toBe(true);
  });
});
