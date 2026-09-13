import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CheckPanel, type CheckPanelProps } from '../../src/components/CheckPanel';
import type { CheckRunState } from '../../src/components/hooks/useCheckJob';
import { PairsTable } from '../../src/components/PairsTable';
import { PrimerDesigner } from '../../src/components/PrimerDesigner';
import type { PrimerDesignerState } from '../../src/types';
import { doneCheckJob, gene87700, geneDesign, genePairs, genomesResponse, qpcrCheckPair, SEQS, sequencePair, transcriptCheckJob } from '../fixtures/samples';
import { FakePrimersClient } from './fakeClient';
import { API, JOB_ID, queuedJob, runningPartialJob, submitAnswer, transcript87700Design } from './fixtures';

const designButton = () => screen.getByRole('button', { name: 'Design primers' });

describe('check flow', () => {
  it('queued → running (partial) → done: verdict chips, matrix keyboard navigation, CellDetail and exports', async () => {
    const fake = new FakePrimersClient();
    fake.genomes = genomesResponse();
    fake.onDesign = () => geneDesign();
    const onCheckUpdate = vi.fn();
    const states: PrimerDesignerState[] = [];
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={fake} gene={gene87700} onCheckUpdate={onCheckUpdate} onStateChange={(s) => states.push(s)} />);

    await user.click(designButton());
    const table = await screen.findByRole('table', { name: /^3 primer pairs/ });
    await user.click(within(table).getByRole('checkbox', { name: 'Check pair 2' }));
    await user.click(within(table).getByRole('checkbox', { name: 'Check pair 3' }));
    expect(screen.getByText(/^2 pairs selected · 4 distinct primers/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Genome specificity' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Pan-genome coverage' }));
    expect(screen.getByRole('checkbox', { name: 'Sb nodb' })).toBeDisabled();
    expect(screen.getByText('3 of 3 selected')).toBeInTheDocument();
    // 4 primers: reference 14.7 + 3 × 0.7 Gb at ws6 18.5 × pan-genome factor 2 = 37.0 + re-alignment 4 primers × 4 genome
    // tasks × 0.6 = 9.6 → 61.3
    expect(screen.getByText(/^Estimated cost ≈ 62 CPU-s/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Run checks' }));
    expect(fake.submitCalls).toHaveLength(1);
    expect(fake.submitCalls[0]!.req).toEqual({
      system_name: 'sorghum_bicolor',
      mode: 'gene',
      gene_id: 'SORBI_3004G087700',
      checks: ['specificity', 'pangenome'],
      pairs: [
        { id: 'P2', left: SEQS.P2_L, right: SEQS.P2_R, expected: { region: '4', start: 7423537, end: 7423746 } },
        { id: 'P3', left: SEQS.P3_L, right: SEQS.P3_R, expected: { region: '4', start: 7422482, end: 7423061 } },
      ],
    });

    await act(async () => fake.submitCalls[0]!.resolve(queuedJob()));
    const bar = await screen.findByRole('progressbar', { name: 'Check progress' });
    expect(bar).toHaveAttribute('aria-valuetext', 'Queued · 1 job ahead');
    expect(states[states.length - 1]!.check).toEqual({
      checks: ['specificity', 'pangenome'],
      jobId: JOB_ID,
      submitted: [
        { id: 'P2', left: SEQS.P2_L, right: SEQS.P2_R },
        { id: 'P3', left: SEQS.P3_L, right: SEQS.P3_R },
      ],
    });
    expect(fake.pollCalls).toHaveLength(1);
    expect(fake.pollCalls[0]!.options.resubmit).toEqual(fake.submitCalls[0]!.req);
    expect(fake.pollCalls[0]!.options.initialJob?.status).toBe('queued');

    await act(async () => fake.pollCalls[0]!.push(runningPartialJob()));
    expect(bar).toHaveAttribute('aria-valuetext', '2 of 5 · pangenome · running: sorghum_grassl');
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Not checked');
    expect(rows[2]).toHaveTextContent('Off-targets (2)');
    expect(rows[2]).toHaveTextContent('amplifies 1/1');
    expect(rows[3]).toHaveTextContent('Checking');

    await user.click(screen.getByRole('tab', { name: 'Pan-genome' }));
    const partialGrid = screen.getByRole('grid');
    expect(within(partialGrid).getAllByRole('gridcell', { name: /Pending/ })).toHaveLength(5);

    await act(async () => fake.pollCalls[0]!.push(doneCheckJob()));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Check primers' })).getByText('Check finished.')).toBeInTheDocument();
    expect(onCheckUpdate).toHaveBeenCalledTimes(3);

    const grid = screen.getByRole('grid');
    const cells = within(grid).getAllByRole('gridcell');
    expect(cells).toHaveLength(6);
    expect(cells[0]).toHaveAttribute('tabindex', '0');
    expect(cells[3]).toHaveAccessibleName('Sb leoti, P3, One amplicon with mismatches');
    cells[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(cells[1]);
    expect(cells[1]).toHaveAttribute('tabindex', '0');
    expect(cells[0]).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cells[3]);
    await user.keyboard('{Enter}');
    const detail = screen.getByRole('region', { name: 'Sb leoti · P3' });
    expect(detail).toHaveTextContent('One amplicon with mismatches');
    expect(detail).toHaveTextContent('581 bp (+1 bp vs the reference)');
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('region', { name: /· P3$/ })).toHaveTextContent('3′ window');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: /· P3$/ })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'worst');
    expect(within(screen.getByRole('grid')).getAllByRole('rowheader')[0]).toHaveTextContent('Sb leoti');
    await user.click(screen.getByRole('checkbox', { name: 'Issues only' }));
    expect(within(screen.getByRole('grid')).getAllByRole('rowheader')).toHaveLength(3);

    await user.click(screen.getByRole('tab', { name: 'Specificity' }));
    const p2 = screen.getByRole('region', { name: /^P2/ });
    expect(within(p2).getByText('Off-targets (2)')).toBeInTheDocument();
    expect(within(p2).getByRole('table', { name: /^Off-target products of P2/ })).toBeInTheDocument();
    expect(within(p2).getByRole('img', { name: 'Left primer: 2 mismatches at 7, 10 nt from the 3′ end' })).toBeInTheDocument();
    const p3 = screen.getByRole('region', { name: /^P3/ });
    expect(within(p3).getByText(/Right primer: 9 near-perfect genome sites/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('button', { name: 'Copy Primer pairs (TSV)' }));
    const tsv = await navigator.clipboard.readText();
    expect(tsv.split('\n')[1]).toMatch(/^P1\t1\tGATCGACAATCCGACGATAGAAG\t.*\tnot checked\t\t\t$/);
    expect(tsv.split('\n')[2]).toMatch(/^P2\t2\tGGACAGCTCCACAACATATCAG\t.*\toff_targets\t2\t\t2\/3$/);
    expect(screen.getByRole('button', { name: 'Copy Pan-genome coverage (TSV)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Off-target products (TSV)' })).toBeInTheDocument();
  });

  it('hides the pan-genome toggle when the species has only one genome', async () => {
    const fake = new FakePrimersClient();
    const g = genomesResponse();
    fake.genomes = { ...g, counts: { total: 1, with_blastdb: 1, with_cdna_blastdb: 1 }, genomes: [g.genomes[0]!] };
    fake.onDesign = () => geneDesign();
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={fake} gene={gene87700} />);
    await user.click(designButton());
    const table = await screen.findByRole('table', { name: /^3 primer pairs/ });
    await user.click(within(table).getByRole('checkbox', { name: 'Check pair 1' }));
    expect(screen.getByRole('checkbox', { name: 'Genome specificity' })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Pan-genome/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check specificity' })).toBeEnabled();
  });

  it('labels transcript-mode pan-genome checks as annotated transcripts', async () => {
    const fake = new FakePrimersClient();
    fake.genomes = genomesResponse();
    fake.onDesign = () => transcript87700Design();
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={fake} gene={gene87700} defaultMode="transcript" />);
    await user.click(designButton());
    const table = await screen.findByRole('table', { name: /^1 primer pair/ });
    await user.click(within(table).getByRole('checkbox', { name: 'Check pair 1' }));
    expect(screen.getByRole('checkbox', { name: 'Genome and transcriptome specificity' })).toBeDisabled();
    const pan = screen.getByRole('checkbox', { name: 'Pan-genome coverage (annotated transcripts)' });
    expect(pan).toHaveAccessibleDescription(/annotated transcript models/);
    await user.click(pan);
    expect(screen.getByRole('checkbox', { name: 'Sb grassl' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Run checks' }));
    const req = fake.submitCalls[0]!.req;
    expect(req).toMatchObject({ mode: 'transcript', gene_id: 'SORBI_3004G087700', transcript_id: 'SORBI_3004G087700.3', checks: ['specificity', 'pangenome'] });
    expect(req.pairs).toEqual([{ id: 'P1', left: SEQS.J_L, right: SEQS.P1_R }]);
    expect(req.genomes).toBeUndefined();

    // The job already finished: POST answers with its status only, and the component reads the results.
    fake.onGetCheck = () => transcriptCheckJob();
    await act(async () => fake.submitCalls[0]!.resolve(submitAnswer(transcriptCheckJob())));
    const panTab = await screen.findByRole('tab', { name: 'Pan-genome (annotated transcripts)' });
    expect(within(screen.getByRole('region', { name: 'Check primers' })).getByText('Check finished.')).toBeInTheDocument();
    expect(fake.getCheckCalls.map((c) => c.req)).toEqual([transcriptCheckJob().job_id]);
    expect(fake.pollCalls).toHaveLength(0);
    expect(within(table).getByText('Specific')).toBeInTheDocument();
    await user.click(panTab);
    expect(screen.getByText(/^Annotated transcripts only: in transcript mode/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Transcriptome' }));
    const tx = screen.getByRole('table', { name: 'Transcript products of P1, one row per gene' });
    const txRows = within(tx).getAllByRole('row');
    expect(txRows[1]).toHaveTextContent('SORBI_3004G087700on targetSORBI_3004G087700.1');
    expect(txRows).toHaveLength(4);
    await user.click(screen.getByRole('tab', { name: 'Specificity' }));
    expect(screen.getByText(/genomic DNA product inside the gene \(479 bp\): DNase-treat RNA/)).toBeInTheDocument();
    expect(screen.getByText('No off-target products in the genome outside the gene.')).toBeInTheDocument();
  });

  it('a check that already finished (shared job id): the POST answer has no results, so the job is read once and its results shown', async () => {
    const fake = new FakePrimersClient();
    fake.genomes = genomesResponse();
    fake.onDesign = () => geneDesign();
    const done = doneCheckJob();
    fake.onSubmit = () => submitAnswer(done);
    fake.onGetCheck = () => done;
    const onCheckUpdate = vi.fn();
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={fake} gene={gene87700} onCheckUpdate={onCheckUpdate} />);
    await user.click(designButton());
    const table = await screen.findByRole('table', { name: /^3 primer pairs/ });
    await user.click(within(table).getByRole('checkbox', { name: 'Check pair 2' }));
    await user.click(within(table).getByRole('checkbox', { name: 'Check pair 3' }));
    await user.click(screen.getByRole('button', { name: 'Check specificity' }));

    const panel = screen.getByRole('region', { name: 'Check primers' });
    expect(await within(panel).findByText('Check finished.')).toBeInTheDocument();
    expect(fake.submitCalls).toHaveLength(1);
    expect(fake.getCheckCalls.map((c) => c.req)).toEqual([done.job_id]);
    expect(fake.pollCalls).toHaveLength(0);
    expect(onCheckUpdate).toHaveBeenCalledTimes(1);
    expect(onCheckUpdate.mock.calls[0]![0]).toMatchObject({ status: 'done', results: { specificity: { target: 'genome' } } });
    const rows = within(table).getAllByRole('row');
    expect(rows[2]).toHaveTextContent('Off-targets (2)');
    expect(rows[3]).toHaveTextContent('Off-targets (1)');
    expect(rows[2]).not.toHaveTextContent('Not checked');
    expect(rows[3]).not.toHaveTextContent('Not checked');
    await user.click(screen.getByRole('tab', { name: 'Specificity' }));
    expect(within(screen.getByRole('region', { name: /^P2/ })).getByRole('table', { name: /^Off-target products of P2/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByRole('button', { name: 'Copy Off-target products (TSV)' })).toBeInTheDocument();
  });
});

describe('CheckPanel', () => {
  const idle: CheckRunState = { status: 'idle', job: null, request: null, error: null, startedHere: false, created: null };
  const props = (over: Partial<CheckPanelProps>): CheckPanelProps => ({
    idPrefix: 't',
    mode: 'gene',
    systemName: 'sorghum_bicolor',
    geneId: 'SORBI_3004G087700',
    transcriptId: null,
    pairs: genePairs,
    checkedRanks: [1],
    checkState: { checks: ['specificity'] },
    genomes: genomesResponse(),
    pangenomeFeature: true,
    run: idle,
    disabled: false,
    onPangenome: vi.fn(),
    onGenomes: vi.fn(),
    onParam: vi.fn(),
    onSubmit: vi.fn(),
    onDetach: vi.fn(),
    onResume: vi.fn(),
    onRerun: vi.fn(),
    ...over,
  });

  it('offers max_amplifying_mismatches (0–5, default 3), sends it only when set, and blocks an explicit value not below ignore_mismatches', async () => {
    const onSubmit = vi.fn();
    const onParam = vi.fn();
    const p = props({ onSubmit, onParam });
    const user = userEvent.setup();
    const { rerender } = render(<CheckPanel {...p} />);
    const field = () => screen.getByRole('spinbutton', { name: 'Max mismatches per primer for a product' });
    expect(field()).toHaveAttribute('placeholder', '3');
    expect(field()).toHaveAttribute('min', '0');
    expect(field()).toHaveAttribute('max', '5');
    await user.type(field(), '2');
    expect(onParam).toHaveBeenLastCalledWith('max_amplifying_mismatches', 2);

    // An omitted cap follows ignore_mismatches down (the server lowers the default to ignore_mismatches − 1).
    rerender(<CheckPanel {...p} checkState={{ checks: ['specificity'], params: { ignore_mismatches: 3 } }} />);
    expect(field()).toHaveAttribute('placeholder', '2');
    expect(screen.queryByText(/must be less than ignore_mismatches/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check specificity' })).toBeEnabled();

    rerender(<CheckPanel {...p} checkState={{ checks: ['specificity'], params: { ignore_mismatches: 3, max_amplifying_mismatches: 3 } }} />);
    expect(screen.getByText('max_amplifying_mismatches (3) must be less than ignore_mismatches (3)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check specificity' })).toBeDisabled();

    rerender(<CheckPanel {...p} checkState={{ checks: ['specificity'], params: { ignore_mismatches: 3, max_amplifying_mismatches: 2 } }} />);
    await user.click(screen.getByRole('button', { name: 'Check specificity' }));
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ params: { ignore_mismatches: 3, max_amplifying_mismatches: 2 } }));
    rerender(<CheckPanel {...p} checkState={{ checks: ['specificity'], params: { max_amplifying_mismatches: 3 } }} />);
    await user.click(screen.getByRole('button', { name: 'Check specificity' }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.lastCall![0]).not.toHaveProperty('params');
  });

  it('prices and submits only the saved genomes the mode can search (a list chosen in gene mode, checked in transcript mode)', async () => {
    const p = props({
      mode: 'transcript',
      transcriptId: 'SORBI_3004G087700.3',
      pairs: [qpcrCheckPair],
      checkedRanks: [0],
      checkState: { checks: ['specificity', 'pangenome'], genomes: ['sorghum_353', 'sorghum_grassl'] },
    });
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CheckPanel {...p} onSubmit={onSubmit} />);
    // sorghum_grassl has no cDNA DB. 2 primers: reference 7.37 + cDNA 1.56 + sorghum_353 cDNA 0.66 × pan-genome factor 2
    // + re-alignment of the reference genome 2 × 1 × 0.6 = 11.45 → 12 (with sorghum_grassl it would be 12.77 → 13).
    expect(screen.getByText(/^Estimated cost ≈ 12 CPU-s/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run checks' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ checks: ['specificity', 'pangenome'], genomes: ['sorghum_353'] }));
  });
});

describe('PairsTable', () => {
  it('does not allow checking products longer than 10 kb', () => {
    const onChecked = vi.fn();
    render(<PairsTable pairs={[sequencePair(0, 12000), sequencePair(1, 500)]} checkedRanks={[]} onCheckedChange={onChecked} />);
    const long = screen.getByRole('checkbox', { name: 'Check pair 1' });
    expect(long).toBeDisabled();
    expect(long).toHaveAccessibleDescription('Products longer than 10000 bp cannot be checked');
    expect(screen.getByText('not checkable')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Check pair 2' })).toBeEnabled();
  });

  it('limits a check to 10 pairs', async () => {
    const pairs = Array.from({ length: 11 }, (_, i) => {
      const p = sequencePair(i, 300);
      const left = `ACGTACGTACGTACGT${'ACGT'.slice(0, (i % 4) + 1)}${'T'.repeat(i)}`;
      return { ...p, left: { ...p.left, seq: left }, right: { ...p.right, seq: p.right.seq } };
    });
    const onChecked = vi.fn();
    render(<PairsTable pairs={pairs} checkedRanks={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]} onCheckedChange={onChecked} />);
    const eleventh = screen.getByRole('checkbox', { name: 'Check pair 11' });
    expect(eleventh).toBeDisabled();
    expect(eleventh).toHaveAccessibleDescription('At most 10 pairs and 20 distinct primers can be checked at once');
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Check pair 1' }));
    expect(onChecked).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
