import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PrimerDesigner } from '../../src/components/PrimerDesigner';
import type { DesignResponse, PrimerDesignerState } from '../../src/types';
import { gene200, gene46200, gene87700, geneDesign } from '../fixtures/samples';
import { apiError, FakePrimersClient } from './fakeClient';
import { API, deepFreeze, designFixture } from './fixtures';

const designButton = () => screen.getByRole('button', { name: 'Design primers' });

describe('PrimerDesigner: gene mode', () => {
  it('designs SORBI_3001G000200 with flanks, keeps map and table in sync, and never mutates the gene doc', async () => {
    const gene = deepFreeze(JSON.parse(JSON.stringify(gene200)) as typeof gene200);
    const before = JSON.stringify(gene);
    const fake = new FakePrimersClient();
    const fixture = designFixture('gene-SORBI_3001G000200-flanks');
    const states: PrimerDesignerState[] = [];
    const onDesign = vi.fn();
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={fake} gene={gene} onStateChange={(s) => states.push(s)} onDesign={onDesign} />);

    expect(screen.getByRole('tab', { name: 'Gene' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: 'Transcript features shown' })).toHaveValue('SORBI_3001G000200.1');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Upstream flank (bp)' }), { target: { value: '200' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Downstream flank (bp)' }), { target: { value: '100' } });
    expect(screen.getByTestId('gpr-template-size')).toHaveTextContent('Template: 4,020 bp (1:11080-15099(-))');

    await user.click(designButton());
    expect(fake.designCalls).toHaveLength(1);
    expect(fake.designCalls[0]!.req).toEqual(fixture.request);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    await act(async () => fake.designCalls[0]!.resolve(fixture.response));
    const table = await screen.findByRole('table', { name: /^5 primer pairs/ });
    expect(within(table).getAllByRole('button', { name: /^Select pair \d$/ })).toHaveLength(5);
    const lanes = screen.getAllByRole('button', { name: /^Pair \d: / });
    expect(lanes).toHaveLength(5);
    const p0 = fixture.response.pairs[0]!;
    expect(lanes[0]).toHaveAccessibleName(`Pair 1: ${p0.product_size} bp product, left primer ${p0.left.start}–${p0.left.end}, right primer ${p0.right.start}–${p0.right.end}`);
    expect(onDesign).toHaveBeenCalledWith(fixture.response, fixture.request);
    expect(states[states.length - 1]).toMatchObject({ v: 1, mode: 'gene', designed: true, flankUp: 200, flankDown: 100 });

    await user.click(lanes[1]!);
    expect(within(table).getByRole('button', { name: 'Select pair 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(states[states.length - 1]!.selectedRank).toBe(1);
    await user.click(within(table).getByRole('button', { name: 'Select pair 4' }));
    expect(screen.getByRole('button', { name: /^Pair 4: / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Pair 2: / })).toHaveAttribute('aria-pressed', 'false');

    await user.click(within(table).getAllByRole('button', { name: /^Details/ })[0]!);
    const amplicon = screen.getByRole('group', { name: 'Amplicon sequence of pair 1' });
    expect(amplicon).toHaveTextContent(fixture.response.pairs[0]!.left.seq);
    expect(screen.getByRole('table', { name: 'Primer statistics, pair 1' })).toHaveTextContent('1:14777-14796(-)');
    expect(JSON.stringify(gene)).toBe(before);
  });

  it('Cancel aborts the running request and keeps the form usable', async () => {
    const fake = new FakePrimersClient();
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={fake} gene={gene200} />);
    await user.click(designButton());
    const signal = fake.designCalls[0]!.signal!;
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(signal.aborted).toBe(true);
    expect(designButton()).toBeEnabled();
  });

  it('sends edited intervals and params, and blocks invalid params inline', async () => {
    const fake = new FakePrimersClient();
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={fake} gene={gene200} systemName="sorghum_bicolor" defaultMode="region" />);
    expect(screen.getByRole('textbox', { name: 'Start' })).toHaveValue('11180');
    fireEvent.change(screen.getByRole('textbox', { name: 'Start' }), { target: { value: '11080' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'End' }), { target: { value: '15099' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Target start' }), { target: { value: '499' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Target length' }), { target: { value: '50' } });
    await user.click(screen.getByRole('button', { name: 'Add excluded interval' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Excluded 1 start' }), { target: { value: '1000' } });
    // Shown next to the row and in the list under the Design button.
    expect(screen.getAllByText('Excluded 1: enter a whole-number start and length.')).toHaveLength(2);
    expect(designButton()).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Excluded 1 length' }), { target: { value: '40' } });

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Primer size min' }), { target: { value: '30' } });
    expect(screen.getAllByText('Minimum size must not exceed maximum size').length).toBeGreaterThan(0);
    expect(designButton()).toBeDisabled();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Primer size min' }), { target: { value: '19' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Primer size max' }), { target: { value: '22' } });
    expect(designButton()).toBeEnabled();

    await user.click(designButton());
    expect(fake.designCalls[0]!.req).toEqual({
      mode: 'region',
      system_name: 'sorghum_bicolor',
      region: { region: '1', start: 11080, end: 15099, strand: -1 },
      target: [499, 50],
      excluded: [[1000, 40]],
      params: { min_size: 19, max_size: 22 },
    });
  });

  it('previews a pasted sequence with template_only, even one shorter than every product size range', async () => {
    const fake = new FakePrimersClient();
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={fake} modes={['sequence']} />);
    const box = screen.getByRole('textbox', { name: /^Sequence \(FASTA/ });
    const short = '>x\nACGTACGTAC GTACGTRYAC\n12 GTACGTACGT';
    fireEvent.change(box, { target: { value: short } });
    expect(screen.getByText('30 nt · IUPAC codes will be converted to N')).toBeInTheDocument();
    // Too short for the default 100–1000 bp products: Design is blocked like the server's INVALID_PARAMS,
    // but the server skips that check for template_only, so Preview template stays available.
    expect(designButton()).toBeDisabled();
    expect(screen.getAllByText('No product size range starts at or below the template length (30)').length).toBeGreaterThan(0);
    const preview = screen.getByRole('button', { name: 'Preview template' });
    expect(preview).toBeEnabled();
    await user.click(preview);
    expect(fake.designCalls[0]!.req).toEqual({ mode: 'sequence', sequence: short, template_only: true });
    const templateOnly: DesignResponse = { template: { mode: 'sequence', length: 30, seq: 'ACGTACGTACGTACGTNNACGTACGTACGT' }, pairs: [], warnings: [] };
    await act(async () => fake.designCalls[0]!.resolve(templateOnly));
    expect(await screen.findByText(/^Template preview: 30 bp/)).toBeInTheDocument();

    const pasted = `>x\n${'ACGTTGCA'.repeat(9)}\n12 ${'ACGTTGCA'.repeat(9)}RY`;
    fireEvent.change(box, { target: { value: pasted } });
    expect(screen.getByText('146 nt · IUPAC codes will be converted to N')).toBeInTheDocument();
    expect(designButton()).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Preview template' }));
    expect(fake.designCalls[1]!.req).toEqual({ mode: 'sequence', sequence: pasted, template_only: true });
  });

  it('keeps checked and selected pairs when designing again after a template preview', async () => {
    const fake = new FakePrimersClient();
    fake.onDesign = (req) => (req.template_only ? { ...geneDesign(), pairs: [] } : geneDesign());
    const states: PrimerDesignerState[] = [];
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={fake} gene={gene87700} onStateChange={(s) => states.push(s)} />);
    await user.click(designButton());
    let table = await screen.findByRole('table', { name: /^3 primer pairs/ });
    await user.click(within(table).getByRole('checkbox', { name: 'Check pair 2' }));
    await user.click(within(table).getByRole('checkbox', { name: 'Check pair 3' }));
    await user.click(within(table).getByRole('button', { name: 'Select pair 2' }));

    await user.click(screen.getByRole('button', { name: 'Preview template' }));
    await screen.findByText(/^Template preview:/);
    expect(states[states.length - 1]).toMatchObject({ checkedRanks: [1, 2], selectedRank: 1 });

    await user.click(designButton());
    table = await screen.findByRole('table', { name: /^3 primer pairs/ });
    expect(fake.designCalls.map((c) => !!c.req.template_only)).toEqual([false, true, false]);
    expect(states[states.length - 1]).toMatchObject({ designed: true, checkedRanks: [1, 2], selectedRank: 1 });
    expect(within(table).getByRole('checkbox', { name: 'Check pair 2' })).toBeChecked();
    expect(within(table).getByRole('checkbox', { name: 'Check pair 3' })).toBeChecked();
    expect(within(table).getByRole('button', { name: 'Select pair 2' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('blocks Design when a product size range starts below the maximum primer size (server INVALID_PARAMS)', async () => {
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={new FakePrimersClient()} gene={gene200} />);
    expect(designButton()).toBeEnabled();
    await user.type(screen.getByRole('textbox', { name: 'New range from (bp)' }), '20');
    await user.type(screen.getByRole('textbox', { name: 'New range to (bp)' }), '100');
    await user.click(screen.getByRole('button', { name: 'Add range' }));
    expect(designButton()).toBeDisabled();
    expect(screen.getAllByText('Maximum primer size (25) must not exceed the smallest product size (20)').length).toBeGreaterThan(0);
  });
});

describe('PrimerDesigner: region and sequence inputs', () => {
  it('blocks Region mode when the free-text genome name (genome list unavailable) is not a system name', async () => {
    const fake = new FakePrimersClient();
    fake.genomes = apiError({ status: 503, code: 'MONGO_UNAVAILABLE', message: 'genome catalog unavailable' });
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={fake} gene={gene200} defaultMode="region" />);
    const genome = await screen.findByRole('textbox', { name: 'Genome' });
    fireEvent.change(genome, { target: { value: 'Sorghum_bicolor' } });
    expect(designButton()).toBeDisabled();
    expect(screen.getAllByText('The genome name is not valid.').length).toBeGreaterThan(0);
    fireEvent.change(genome, { target: { value: 'sorghum-bicolor' } });
    expect(designButton()).toBeDisabled();
    fireEvent.change(genome, { target: { value: 'sorghum_bicolor' } });
    expect(designButton()).toBeEnabled();
    expect(screen.queryByText('The genome name is not valid.')).not.toBeInTheDocument();
    await user.click(designButton());
    expect(fake.designCalls[0]!.req).toMatchObject({ mode: 'region', system_name: 'sorghum_bicolor' });
  });

  it('notes that several pasted FASTA records will be joined into one template (MULTIPLE_RECORDS)', () => {
    render(<PrimerDesigner apiBase={API} client={new FakePrimersClient()} modes={['sequence']} />);
    const box = screen.getByRole('textbox', { name: /^Sequence \(FASTA/ });
    fireEvent.change(box, { target: { value: `>recA\n${'ACGTTGCA'.repeat(25)}\n>recB\n${'TTGCAACG'.repeat(25)}\n` } });
    expect(screen.getByText(/^2 FASTA records will be joined into one template, so a primer pair may span a join/)).toHaveAttribute('data-code', 'MULTIPLE_RECORDS');
    expect(designButton()).toBeEnabled();
    fireEvent.change(box, { target: { value: `>recA\n${'ACGTTGCA'.repeat(25)}\n` } });
    expect(screen.queryByText(/FASTA records will be joined/)).not.toBeInTheDocument();
  });
});

describe('PrimerDesigner: transcript mode', () => {
  it('disables the junction toggle for the single-exon canonical .2 and enables it for .1', async () => {
    const fake = new FakePrimersClient();
    fake.onDesign = (req) => designFixture(req.transcript_id === 'SORBI_3001G046200.1' ? 'transcript-SORBI_3001G046200.1' : 'transcript-SORBI_3001G046200.2').response;
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={fake} gene={gene46200} defaultMode="transcript" />);

    const select = screen.getByRole('combobox', { name: 'Transcript' });
    expect(select).toHaveValue('SORBI_3001G046200.2');
    let toggle = screen.getByRole('checkbox', { name: 'One primer must span an exon–exon junction' });
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription('Single-exon transcript: there is no junction to span.');

    await user.click(designButton());
    expect(fake.designCalls[0]!.req).toEqual(designFixture('transcript-SORBI_3001G046200.2').request);
    await screen.findByRole('table', { name: /^5 primer pairs/ });

    await user.selectOptions(select, 'SORBI_3001G046200.1');
    toggle = screen.getByRole('checkbox', { name: 'One primer must span an exon–exon junction' });
    expect(toggle).toBeEnabled();
    expect(toggle).toBeChecked();
    expect(screen.getByText('The inputs have changed since these results were designed.')).toBeInTheDocument();

    await user.click(designButton());
    expect(fake.designCalls[1]!.req).toEqual(designFixture('transcript-SORBI_3001G046200.1').request);
    expect((await screen.findAllByText(/primer spans the junction at 532/)).length).toBeGreaterThan(0);
    expect(screen.queryByText('The inputs have changed since these results were designed.')).not.toBeInTheDocument();
  });

  it('opens the ExplainPanel when the design returns NO_PAIRS', async () => {
    const fake = new FakePrimersClient();
    const fixture = designFixture('no-pairs-SORBI_3001G000200');
    fake.onDesign = () => fixture.response;
    const states: PrimerDesignerState[] = [];
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={fake} gene={gene200} defaultMode="transcript" onStateChange={(s) => states.push(s)} />);
    await user.click(designButton());

    const toggle = await screen.findByRole('button', { name: 'Why no primer pairs?' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('no overlap of required point')).toBeInTheDocument();
    expect(screen.getByText(/Lower the junction overlaps/)).toBeInTheDocument();
    expect(screen.getByText('Primer3 found no acceptable primer pairs')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /primer pair/ })).not.toBeInTheDocument();
    expect(states[states.length - 1]!.view).toEqual({ resultsTab: 'pairs', explainOpen: true });

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(states[states.length - 1]!.view?.explainOpen).toBe(false);
  });
});

describe('PrimerDesigner: errors', () => {
  it('VALIDATION lists the validator errors and reports onError', async () => {
    const fake = new FakePrimersClient();
    fake.onDesign = () =>
      apiError({ status: 400, code: 'VALIDATION', message: 'Validation errors', errors: [{ code: 'OBJECT_ADDITIONAL_PROPERTIES', message: 'Additional properties not allowed: foo', path: ['foo'] }] });
    const onError = vi.fn();
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={fake} gene={gene200} onError={onError} />);
    await user.click(designButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The server rejected the request.');
    expect(within(alert).getByRole('listitem')).toHaveTextContent('Additional properties not allowed: foo (foo) OBJECT_ADDITIONAL_PROPERTIES');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION', status: 400 }));
    expect(designButton()).toBeEnabled();
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('BUSY retries automatically with a countdown', async () => {
    vi.useFakeTimers();
    try {
      const fixture = designFixture('gene-SORBI_3001G000200-flanks');
      const fake = new FakePrimersClient();
      fake.onDesign = (_req, i) => (i === 0 ? apiError({ status: 503, code: 'BUSY', message: 'busy', retryAfterMs: 3000, details: { retry_after_s: 3 } }) : fixture.response);
      render(<PrimerDesigner apiBase={API} client={fake} gene={gene200} />);
      fireEvent.click(designButton());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText('The server is busy. Retrying in 3 s (attempt 1 of 3)…')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByText('The server is busy. Retrying in 2 s (attempt 1 of 3)…')).toBeInTheDocument();
      expect(fake.designCalls).toHaveLength(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(fake.designCalls).toHaveLength(2);
      expect(screen.queryByText(/Retrying in/)).not.toBeInTheDocument();
      expect(screen.getByRole('table', { name: /^5 primer pairs/ })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('BUSY gives up after 3 retries and offers Retry', async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakePrimersClient();
      fake.onDesign = () => apiError({ status: 503, code: 'BUSY', message: 'busy', retryAfterMs: 1000 });
      render(<PrimerDesigner apiBase={API} client={fake} gene={gene200} />);
      fireEvent.click(designButton());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500);
      });
      expect(fake.designCalls).toHaveLength(4);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('The server is still busy.');
      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fake.designCalls).toHaveLength(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('FEATURE_DISABLED disables the form', async () => {
    const fake = new FakePrimersClient();
    fake.onDesign = () => apiError({ status: 503, code: 'FEATURE_DISABLED', message: 'Primer design is disabled' });
    const user = userEvent.setup();
    render(<PrimerDesigner apiBase={API} client={fake} gene={gene200} />);
    await user.click(designButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Primer design is disabled on this server.');
    expect(within(alert).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(designButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview template' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Upstream flank (bp)' })).toBeDisabled();
  });
});
