import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { PrimerDesigner } from '../../src/components/PrimerDesigner';
import type { GenotypingDesignResponse } from '../../src/types';
import { pkgPath } from '../paths';
import { doneCheckJob, gene200, gene46200, gene87700, geneDesign, genomesResponse, transcriptCheckJob } from '../fixtures/samples';
import { expectNoAxeViolations } from './axe';
import { apiError, FakePrimersClient } from './fakeClient';
import { API, designFixture, submitAnswer, transcript87700Design } from './fixtures';

const designButton = () => screen.getByRole('button', { name: 'Design primers' });

describe('axe-core on the main states', () => {
  it('gene mode: initial form, designed results with details and the check panel', async () => {
    const fake = new FakePrimersClient();
    fake.genomes = genomesResponse();
    fake.onDesign = () => designFixture('gene-SORBI_3001G000200-flanks').response;
    const user = userEvent.setup();
    const { container } = render(<PrimerDesigner apiBase={API} client={fake} gene={gene200} />);
    await expectNoAxeViolations(container, 'initial');
    await user.click(designButton());
    const table = await screen.findByRole('table', { name: /^5 primer pairs/ });
    await user.click(within(table).getAllByRole('button', { name: /^Details/ })[0]!);
    await user.click(within(table).getByRole('checkbox', { name: 'Check pair 1' }));
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await expectNoAxeViolations(container, 'designed');
  });

  it('transcript, region and sequence inputs', async () => {
    const fake = new FakePrimersClient();
    fake.genomes = genomesResponse();
    const user = userEvent.setup();
    const { container } = render(<PrimerDesigner apiBase={API} client={fake} gene={gene46200} systemName="sorghum_bicolor" defaultMode="transcript" />);
    await expectNoAxeViolations(container, 'transcript');
    await user.click(screen.getByRole('tab', { name: 'Region' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'End' }), { target: { value: '1' } });
    await expectNoAxeViolations(container, 'region with errors');
    await user.click(screen.getByRole('tab', { name: 'Sequence' }));
    fireEvent.change(screen.getByRole('textbox', { name: /^Sequence \(FASTA/ }), { target: { value: 'ACGT!!' } });
    await user.click(screen.getByRole('button', { name: 'Add excluded interval' }));
    await expectNoAxeViolations(container, 'sequence with errors');
  });

  it('no pairs with the explain panel, and a validation error banner', async () => {
    const fake = new FakePrimersClient();
    fake.onDesign = (_req, i) =>
      i === 0 ? designFixture('no-pairs-SORBI_3001G000200').response : apiError({ status: 400, code: 'VALIDATION', message: 'Validation errors', errors: [{ code: 'PATTERN', message: 'Bad system_name', path: ['system_name'] }] });
    const user = userEvent.setup();
    const { container } = render(<PrimerDesigner apiBase={API} client={fake} gene={gene200} defaultMode="transcript" />);
    await user.click(designButton());
    await screen.findByRole('button', { name: 'Why no primer pairs?' });
    await expectNoAxeViolations(container, 'no pairs');
    await user.click(designButton());
    await screen.findByRole('alert');
    await expectNoAxeViolations(container, 'validation');
  });

  it('check results: running progress, specificity, pan-genome grid with cell detail, expired job', async () => {
    const fake = new FakePrimersClient();
    fake.genomes = genomesResponse();
    fake.onDesign = () => geneDesign();
    const user = userEvent.setup();
    const { container, unmount } = render(<PrimerDesigner apiBase={API} client={fake} gene={gene87700} />);
    await user.click(designButton());
    const table = await screen.findByRole('table', { name: /^3 primer pairs/ });
    await user.click(within(table).getByRole('checkbox', { name: 'Check pair 2' }));
    await user.click(within(table).getByRole('checkbox', { name: 'Check pair 3' }));
    await user.click(screen.getByRole('checkbox', { name: 'Pan-genome coverage' }));
    await user.click(screen.getByRole('button', { name: 'Run checks' }));
    await act(async () => fake.submitCalls[0]!.resolve({ ...doneCheckJob(), status: 'running', partial: true, progress: { done: 1, total: 5, stage: 'reference', running: [] }, created: true }));
    await screen.findByRole('progressbar');
    await expectNoAxeViolations(container, 'running');
    await act(async () => fake.pollCalls[0]!.push(doneCheckJob()));
    await user.click(screen.getByRole('tab', { name: 'Specificity' }));
    await expectNoAxeViolations(container, 'specificity');
    await user.click(screen.getByRole('tab', { name: 'Pan-genome' }));
    await user.click(within(screen.getByRole('grid')).getAllByRole('gridcell')[1]!);
    await expectNoAxeViolations(container, 'pan-genome');
    unmount();

    const expired = new FakePrimersClient();
    expired.onDesign = () => geneDesign();
    expired.onGetCheck = () => apiError({ status: 404, code: 'UNKNOWN_JOB', message: 'expired' });
    const second = render(
      <PrimerDesigner apiBase={API} client={expired} gene={gene87700} state={{ v: 1, mode: 'gene', designed: true, checkedRanks: [1], check: { checks: ['specificity'], jobId: doneCheckJob().job_id } }} />,
    );
    await screen.findByText('Results expired — Re-run check');
    await expectNoAxeViolations(second.container, 'expired');
  });

  it('genotyping mode: the variant picker, assay options and the designed sets', async () => {
    const kasp = (JSON.parse(readFileSync(pkgPath('test', 'fixtures', 'genotyping', 'capture-genotyping-design-rs871475760-kasp.json'), 'utf8')) as {
      response: GenotypingDesignResponse;
    }).response;
    const fake = new FakePrimersClient();
    fake.genomes = genomesResponse();
    fake.onDesignGenotyping = () => kasp;
    const user = userEvent.setup();
    const { container } = render(
      <PrimerDesigner
        apiBase={API}
        client={fake}
        gene={gene200}
        modes={['gene', 'genotyping']}
        defaultMode="genotyping"
        state={{ v: 1, mode: 'genotyping', systemName: 'sorghum_bicolor', genotyping: { variantKey: '1:11109:C:A' } }}
        // Exercises the CAPS column and its chips, which must read by glyph and
        // text rather than by colour alone.
        sequenceForRegion={async (q) => kasp.template.seq.slice(q.start - kasp.template.start, q.end - kasp.template.start + 1)}
      />,
    );
    await expectNoAxeViolations(container, 'genotyping inputs');
    await user.click(screen.getByRole('button', { name: 'Design assay' }));
    await screen.findByRole('table', { name: /primer set/ });
    await expectNoAxeViolations(container, 'genotyping designed');
    await user.click(within(screen.getByRole('table', { name: /primer set/ })).getAllByRole('button', { name: /^Details/ })[0]!);
    await expectNoAxeViolations(container, 'genotyping set detail');
    await user.click(screen.getByRole('tab', { name: 'Order sheet' }));
    await expectNoAxeViolations(container, 'genotyping order sheet');
  });

  it('transcript-mode check with transcriptome results', async () => {
    const fake = new FakePrimersClient();
    fake.genomes = genomesResponse();
    fake.onDesign = () => transcript87700Design();
    const user = userEvent.setup();
    const { container } = render(<PrimerDesigner apiBase={API} client={fake} gene={gene87700} defaultMode="transcript" />);
    await user.click(designButton());
    const table = await screen.findByRole('table', { name: /^1 primer pair/ });
    await user.click(within(table).getByRole('checkbox', { name: 'Check pair 1' }));
    await user.click(screen.getByRole('button', { name: 'Check specificity' }));
    fake.onGetCheck = () => transcriptCheckJob();
    await act(async () => fake.submitCalls[0]!.resolve(submitAnswer(transcriptCheckJob())));
    await user.click(await screen.findByRole('tab', { name: 'Transcriptome' }));
    await expectNoAxeViolations(container, 'transcriptome');
  });
});
