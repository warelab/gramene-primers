import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PairsTable } from '../../src/components/PairsTable';
import { PrimerDesigner } from '../../src/components/PrimerDesigner';
import { mount, type MountHandle } from '../../src/mount';
import { STYLE_ELEMENT_ID } from '../../src/styles/inject';
import type { PrimerDesignerProps, PrimerDesignerState } from '../../src/types';
import { doneCheckJob, gene200, gene700, gene87700, geneDesign, genomesResponse, SEQS } from '../fixtures/samples';
import { apiError, FakePrimersClient } from './fakeClient';
import { API, designFixture, JOB_ID, queuedJob, runningPartialJob } from './fixtures';

const designButton = () => screen.getByRole('button', { name: 'Design primers' });

const SAVED: PrimerDesignerState = {
  v: 1,
  mode: 'gene',
  preset: 'pcr',
  designed: true,
  checkedRanks: [1],
  check: { checks: ['specificity'], jobId: JOB_ID, submitted: [{ id: 'P2', left: SEQS.P2_L, right: SEQS.P2_R }] },
  view: { resultsTab: 'pairs' },
};

function ControlledHost(props: Omit<PrimerDesignerProps, 'state' | 'onStateChange' | 'apiBase'> & { initial: PrimerDesignerState; log?: PrimerDesignerState[] }) {
  const { initial, log, ...rest } = props;
  const [state, setState] = useState<PrimerDesignerState>(initial);
  return (
    <PrimerDesigner
      apiBase={API}
      {...rest}
      state={state}
      onStateChange={(s) => {
        log?.push(s);
        setState(s);
      }}
    />
  );
}

describe('identity changes', () => {
  it('a gene change aborts the design and polling requests and resets the state', async () => {
    const fake = new FakePrimersClient();
    fake.genomes = genomesResponse();
    const states: PrimerDesignerState[] = [];
    const user = userEvent.setup();
    const { rerender } = render(<PrimerDesigner apiBase={API} client={fake} gene={gene87700} onStateChange={(s) => states.push(s)} />);
    await user.click(designButton());
    await act(async () => fake.designCalls[0]!.resolve(geneDesign()));
    const table = await screen.findByRole('table', { name: /^3 primer pairs/ });
    await user.click(within(table).getByRole('checkbox', { name: 'Check pair 2' }));
    await user.click(screen.getByRole('button', { name: 'Check specificity' }));
    await act(async () => fake.submitCalls[0]!.resolve(queuedJob()));
    const pollSignal = fake.pollCalls[0]!.signal!;
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Upstream flank (bp)' }), { target: { value: '500' } });
    await user.click(designButton());
    const designSignal = fake.designCalls[1]!.signal!;
    expect(pollSignal.aborted).toBe(false);
    expect(designSignal.aborted).toBe(false);

    rerender(<PrimerDesigner apiBase={API} client={fake} gene={gene700} onStateChange={(s) => states.push(s)} />);
    expect(designSignal.aborted).toBe(true);
    expect(pollSignal.aborted).toBe(true);
    await act(async () => fake.designCalls[1]!.resolve(geneDesign()));
    expect(screen.queryByRole('table', { name: /primer pairs/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(states[states.length - 1]).toMatchObject({ v: 1, mode: 'gene', designed: false, flankUp: 0, checkedRanks: [], check: { checks: ['specificity'] } });
    expect(states[states.length - 1]!.check?.jobId).toBeUndefined();
    expect(screen.getByRole('spinbutton', { name: 'Upstream flank (bp)' })).toHaveValue(0);
    expect(screen.getByText('SORBI_3001G000700')).toBeInTheDocument();
  });
});

describe('controlled restore', () => {
  it('re-runs the design, finds an expired job and offers "Re-run check" without resubmitting', async () => {
    const fake = new FakePrimersClient();
    fake.onDesign = () => geneDesign();
    fake.onGetCheck = () => apiError({ status: 404, code: 'UNKNOWN_JOB', message: 'Unknown or expired job' });
    const user = userEvent.setup();
    render(<ControlledHost client={fake} gene={gene87700} initial={SAVED} />);

    expect(await screen.findByText('Results expired — Re-run check')).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: /^3 primer pairs/ });
    expect(fake.designCalls.map((c) => c.req)).toEqual([{ mode: 'gene', gene_id: 'SORBI_3004G087700', system_name: 'sorghum_bicolor' }]);
    expect(fake.getCheckCalls.map((c) => c.req)).toEqual([JOB_ID]);
    expect(fake.submitCalls).toHaveLength(0);
    expect(within(table).getByRole('checkbox', { name: 'Check pair 2' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Re-run check' }));
    expect(fake.submitCalls).toHaveLength(1);
    expect(fake.submitCalls[0]!.req).toEqual({
      system_name: 'sorghum_bicolor',
      mode: 'gene',
      gene_id: 'SORBI_3004G087700',
      checks: ['specificity'],
      pairs: [{ id: 'P2', left: SEQS.P2_L, right: SEQS.P2_R, expected: { region: '4', start: 7423537, end: 7423746 } }],
    });
  });

  it('polls a restored running job without resubmit, and Stop watching only detaches', async () => {
    const fake = new FakePrimersClient();
    fake.onDesign = () => geneDesign();
    fake.onGetCheck = () => runningPartialJob();
    const log: PrimerDesignerState[] = [];
    const user = userEvent.setup();
    render(<ControlledHost client={fake} gene={gene87700} initial={SAVED} log={log} />);

    await screen.findByRole('progressbar', { name: 'Check progress' });
    expect(fake.pollCalls).toHaveLength(1);
    expect(fake.pollCalls[0]!.options.resubmit).toBeUndefined();
    expect(fake.pollCalls[0]!.options.initialJob?.status).toBe('running');
    const table = await screen.findByRole('table', { name: /^3 primer pairs/ });
    expect(within(table).getAllByRole('row')[2]).toHaveTextContent('Off-targets (2)');

    await user.click(screen.getByRole('button', { name: 'Stop watching' }));
    expect(fake.pollCalls[0]!.signal!.aborted).toBe(true);
    expect(screen.getByText('Stopped watching. The check keeps running on the server.')).toBeInTheDocument();
    expect(fake.submitCalls).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Resume watching' }));
    expect(fake.getCheckCalls).toHaveLength(2);
    await screen.findByRole('progressbar');
    await act(async () => fake.pollCalls[1]!.push(doneCheckJob()));
    expect(within(screen.getByRole('region', { name: 'Check primers' })).getByText('Check finished.')).toBeInTheDocument();
    expect(log.every((s) => s.check?.jobId === JOB_ID)).toBe(true);
  });

  it('persistSequence={false} never emits the sequence but keeps what the user typed', async () => {
    const fake = new FakePrimersClient();
    const log: PrimerDesignerState[] = [];
    const user = userEvent.setup();
    function Host() {
      const [state, setState] = useState<PrimerDesignerState | undefined>(undefined);
      return (
        <PrimerDesigner
          apiBase={API}
          client={fake}
          systemName="sorghum_bicolor"
          modes={['sequence']}
          state={state}
          persistSequence={false}
          onStateChange={(s) => {
            log.push(s);
            setState(s);
          }}
        />
      );
    }
    render(<Host />);
    const box = screen.getByRole('textbox', { name: /^Sequence \(FASTA/ });
    const typed = 'ACGTTGCA'.repeat(15);
    fireEvent.change(box, { target: { value: typed } });
    fireEvent.change(box, { target: { value: `${typed}AA` } });
    expect(box).toHaveValue(`${typed}AA`);
    expect(log.length).toBe(2);
    expect(log.every((s) => !('sequence' in s))).toBe(true);
    await user.click(designButton());
    expect(fake.designCalls[0]!.req).toEqual({ mode: 'sequence', sequence: `${typed}AA`, system_name: 'sorghum_bicolor' });
  });
});

describe('restore re-runs only designs the Design button would allow', () => {
  it('a sequence-mode design saved without its sequence (persistSequence={false}) is not re-run after a remount', async () => {
    const fake = new FakePrimersClient();
    const fixture = designFixture('sequence-iupac');
    fake.onDesign = () => fixture.response;
    const onError = vi.fn();
    const log: PrimerDesignerState[] = [];
    const user = userEvent.setup();
    const first = render(<ControlledHost client={fake} gene={gene200} initial={{ v: 1, mode: 'sequence' }} persistSequence={false} onError={onError} log={log} />);
    fireEvent.change(screen.getByRole('textbox', { name: /^Sequence \(FASTA/ }), { target: { value: fixture.request.sequence } });
    await user.click(designButton());
    await screen.findByRole('table', { name: /primer pairs/ });
    const saved = log[log.length - 1]!;
    expect(saved).toMatchObject({ mode: 'sequence', designed: true });
    expect(saved).not.toHaveProperty('sequence');
    first.unmount();

    // As in gramene-search: another detail tab was opened, and Primers renders again from the stored state.
    render(<ControlledHost client={fake} gene={gene200} initial={saved} persistSequence={false} onError={onError} />);
    await act(async () => {});
    expect(screen.getByRole('tab', { name: 'Sequence' })).toHaveAttribute('aria-selected', 'true');
    expect(fake.designCalls).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
    expect(screen.getByText(/Choose the inputs and press/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: /^Sequence \(FASTA/ }), { target: { value: fixture.request.sequence } });
    await user.click(designButton());
    expect(fake.designCalls).toHaveLength(2);
  });

  it('a saved design with params the Design button would block is not sent', async () => {
    const fake = new FakePrimersClient();
    fake.onDesign = () => geneDesign();
    render(<ControlledHost client={fake} gene={gene87700} initial={{ ...SAVED, check: { checks: ['specificity'] }, params: { min_size: 30, max_size: 22 } }} />);
    await act(async () => {});
    expect(fake.designCalls).toHaveLength(0);
    expect(designButton()).toBeDisabled();
    expect(screen.getAllByText('Minimum size must not exceed maximum size').length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a saved design with an excluded interval past the template is not sent', async () => {
    const fake = new FakePrimersClient();
    fake.onDesign = () => geneDesign();
    render(<ControlledHost client={fake} gene={gene87700} initial={{ ...SAVED, check: { checks: ['specificity'] }, excluded: [[7000, 50]] }} />);
    await act(async () => {});
    expect(fake.designCalls).toHaveLength(0);
    expect(designButton()).toBeDisabled();
  });
});

describe('mount and styles', () => {
  it('mount renders, update merges props, unmount aborts requests and empties the element', () => {
    const el = document.createElement('div');
    el.id = 'gpr-host';
    document.body.appendChild(el);
    const fake = new FakePrimersClient();
    let handle!: MountHandle;
    act(() => {
      handle = mount('#gpr-host', { apiBase: API, client: fake, gene: gene200 });
    });
    expect(el.querySelector('.gpr-root')).toHaveClass('gpr-theme-auto');
    expect(document.getElementById(STYLE_ELEMENT_ID)).not.toBeNull();

    act(() => handle.update({ theme: 'dark', geneLabel: 'RabGAP (SORBI_3001G000200)' }));
    expect(el.querySelector('.gpr-root')).toHaveClass('gpr-theme-dark');
    expect(el).toHaveTextContent('RabGAP (SORBI_3001G000200)');

    act(() => {
      fireEvent.click(within(el).getByRole('button', { name: 'Design primers' }));
    });
    const signal = fake.designCalls[0]!.signal!;
    act(() => handle.unmount());
    expect(signal.aborted).toBe(true);
    expect(el.innerHTML).toBe('');
    act(() => handle.update({ theme: 'light' }));
    expect(el.innerHTML).toBe('');
    el.remove();
    expect(() => mount('#gpr-missing', { apiBase: API })).toThrow(/no element matches #gpr-missing/);
  });

  it('injects the stylesheet once at the start of <head>, and not with injectStyles={false}', () => {
    document.getElementById(STYLE_ELEMENT_ID)?.remove();
    const fake = new FakePrimersClient();
    const first = render(<PrimerDesigner apiBase={API} client={fake} gene={gene200} injectStyles={false} />);
    expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
    first.unmount();
    const { container } = render(
      <>
        <PrimerDesigner apiBase={API} client={fake} gene={gene200} theme="light" className="host-class" />
        <PairsTable pairs={[]} theme="dark" />
      </>,
    );
    expect(document.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
    expect(document.head.firstElementChild?.id).toBe(STYLE_ELEMENT_ID);
    const roots = container.querySelectorAll('.gpr-root');
    expect(roots).toHaveLength(2);
    expect(roots[0]).toHaveClass('gpr-theme-light', 'host-class');
    expect(roots[1]).toHaveClass('gpr-theme-dark');
  });

  it('injectStyles={false} also covers the result components mounted after a design and a check', async () => {
    document.getElementById(STYLE_ELEMENT_ID)?.remove();
    const fake = new FakePrimersClient();
    fake.genomes = genomesResponse();
    fake.onDesign = () => geneDesign();
    const user = userEvent.setup();
    const { container, unmount } = render(<PrimerDesigner apiBase={API} client={fake} gene={gene87700} injectStyles={false} />);
    await user.click(designButton());
    const table = await screen.findByRole('table', { name: /^3 primer pairs/ });
    expect(container.querySelector('svg.gpr-map-svg')).not.toBeNull();
    await user.click(within(table).getByRole('checkbox', { name: 'Check pair 2' }));
    await user.click(screen.getByRole('checkbox', { name: 'Pan-genome coverage' }));
    expect(screen.getByRole('group', { name: 'Genomes to search' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run checks' }));
    await act(async () => fake.submitCalls[0]!.resolve(queuedJob()));
    await act(async () => fake.pollCalls[0]!.push(doneCheckJob()));
    await user.click(screen.getByRole('tab', { name: 'Specificity' }));
    expect(screen.getByRole('region', { name: /^P2/ })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Pan-genome' }));
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
    unmount();

    // A standalone component still injects unless told not to.
    render(<PairsTable pairs={[]} />);
    expect(document.getElementById(STYLE_ELEMENT_ID)).not.toBeNull();
  });
});
