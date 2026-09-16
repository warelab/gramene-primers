import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { App } from '../../examples/playground/App';
import { createMockClient } from '../../examples/playground/mockClient';
import { PAGES } from '../../examples/playground/pages';
import { isConsistentSummary } from '../../src/pangenome';
import type { CheckRequest } from '../../src/types';

describe('playground (?api=mock)', () => {
  it('designs on every design page (all four modes) under StrictMode', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App search="?api=mock" mockDelayScale={0.01} />
      </StrictMode>,
    );
    const pageSelect = screen.getByRole('combobox', { name: 'Page' });
    // Genotyping pages have no design form: they are exercised separately below.
    const designPages = PAGES.filter((p) => p.group !== 'Check' && p.group !== 'Genotyping');
    expect(new Set(designPages.map((p) => p.defaultMode))).toEqual(new Set(['gene', 'transcript', 'region', 'sequence']));
    for (const page of designPages) {
      await user.selectOptions(pageSelect, page.id);
      await user.click(screen.getByRole('button', { name: 'Design primers' }));
      expect(await screen.findByRole('table', { name: /^5 primer pairs/ }, { timeout: 3000 }), page.id).toBeInTheDocument();
      expect(screen.getByTestId('pg-state')).toHaveTextContent('"designed": true');
    }
  });

  it('designs a genotyping assay from the mock variant capture', async () => {
    const user = userEvent.setup();
    render(<App search="?api=mock&page=genotyping-rs871475760" mockDelayScale={0.01} />);
    // The picker lists the mock window rather than falling back to manual entry.
    expect(await screen.findByRole('table', { name: /variant/ }, { timeout: 3000 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Design assay' }));
    const sets = await screen.findByRole('table', { name: /primer set/ }, { timeout: 3000 });
    expect(within(sets).getAllByRole('row').length).toBeGreaterThan(1);
    expect(screen.getByRole('tab', { name: 'Order sheet' })).toBeInTheDocument();
  });

  it('restores the P1/P2/P3 check page and runs a pan-genome check to completion', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App search="?api=mock&page=check-p1-p3" mockDelayScale={0.002} />
      </StrictMode>,
    );
    const table = await screen.findByRole('table', { name: /^3 primer pairs/ }, { timeout: 3000 });
    expect(within(table).getByRole('checkbox', { name: 'Check pair 2' })).toBeChecked();
    await user.click(await screen.findByRole('button', { name: 'Run checks' }));
    const panel = screen.getByRole('region', { name: 'Check primers' });
    expect(await within(panel).findByText('Check finished.', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')[2]).toHaveTextContent('Off-targets (2)');
    await user.click(screen.getByRole('tab', { name: 'Pan-genome' }));
    expect(within(screen.getByRole('grid')).getAllByRole('gridcell').length).toBe(3 * 8);
  });

  it('offers "Re-run check" after restoring an expired job', async () => {
    const user = userEvent.setup();
    render(<App search="?api=mock&page=gene-000700" mockDelayScale={0.01} />);
    await user.click(screen.getByRole('button', { name: 'Restore with an expired job' }));
    expect(await screen.findByText('Results expired — Re-run check', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByTestId('pg-state')).toHaveTextContent('"jobId": "00000000000000000000000000000000"');
  });

  it('mock check jobs progress from queued to done with consistent pan-genome summaries', async () => {
    const client = createMockClient({ delayScale: 0.001 });
    const req: CheckRequest = {
      system_name: 'sorghum_bicolor',
      mode: 'gene',
      gene_id: 'SORBI_3004G087700',
      checks: ['specificity', 'pangenome'],
      pairs: [{ id: 'P2', left: 'GGACAGCTCCACAACATATCAG', right: 'GGACATTTGAAGCCCATGGCC', expected: { region: '4', start: 7423537, end: 7423746 } }],
    };
    const first = await client.submitCheck(req);
    expect(first).toMatchObject({ status: 'queued', created: true });
    expect((await client.submitCheck(req)).created).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    const done = await client.getCheck(first.job_id);
    expect(done.status).toBe('done');
    const pan = done.results!.pangenome!.pairs[0]!;
    expect(pan.genomes).toHaveLength(8);
    expect(isConsistentSummary(pan.summary)).toBe(true);
    expect(done.results!.specificity!.pairs[0]!.off_target_count).toBe(2);
    await expect(client.getCheck('f'.repeat(32))).rejects.toMatchObject({ status: 404, code: 'UNKNOWN_JOB' });
  });
});
