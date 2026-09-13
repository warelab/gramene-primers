import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { GenomePicker } from '../../src/components/GenomePicker';
import { PangenomeMatrix } from '../../src/components/PangenomeMatrix';
import { designerReducer } from '../../src/components/reducer';
import { expectedMaskSource, RepeatOptions } from '../../src/components/RepeatOptions';
import { GprRoot } from '../../src/components/Root';
import { SpecificityResults } from '../../src/components/SpecificityResults';
import { niceTicks, packPairLanes, TemplateMap } from '../../src/components/TemplateMap';
import { toApiError } from '../../src/client';
import { flattenValidationErrors } from '../../src/errors';
import * as api from '../../src/index';
import { summarizePangenome } from '../../src/pangenome';
import { unlikelyReason, unlikelyText } from '../../src/results';
import { initialDesignerState } from '../../src/state';
import type { CheckResults, GenomeAmplicon, PangenomeGenomeResult, PangenomeResults, PrimerDesignerState, PrimerTemplate } from '../../src/types';
import { doneCheckJob, gene200, genomeEntry, genomesResponse, transcriptCheckJob } from '../fixtures/samples';
import { pkgPath } from '../paths';
import { apiError } from './fakeClient';
import { designFixture } from './fixtures';

describe('RepeatOptions', () => {
  const base = { idPrefix: 't', mode: 'gene' as const, avoidRepeats: true, repeatMaskMode: 'n_mask' as const, template: null, hasLowercase: false };

  it('names the real soft-mask for soft-masked genomes', () => {
    render(
      <GprRoot>
        <RepeatOptions {...base} onChange={vi.fn()} genome={genomeEntry('sorghum_rio', { repeat_masking: 'soft_masked' })} />
      </GprRoot>,
    );
    expect(screen.getByText('RepeatMasker soft-mask')).toBeInTheDocument();
    expect(screen.queryByText(/gene families/)).not.toBeInTheDocument();
  });

  it('names the BLAST copy-number heuristic otherwise, with the gene-family caveat', () => {
    render(
      <GprRoot>
        <RepeatOptions {...base} onChange={vi.fn()} genome={genomeEntry('sorghum_bicolor')} />
      </GprRoot>,
    );
    expect(screen.getByText('BLAST copy-number heuristic')).toBeInTheDocument();
    expect(screen.getByText(/also masks multi-copy gene families/)).toBeInTheDocument();
  });

  it("prefers the last template's mask source and reports the masked fraction", () => {
    const tpl: PrimerTemplate = { ...designFixture('gene-SORBI_3001G000200-flanks').response.template, masked: true, mask_source: 'blast_depth', mask: [[100, 402]], masked_fraction: 0.1 };
    render(
      <GprRoot>
        <RepeatOptions {...base} onChange={vi.fn()} genome={genomeEntry('sorghum_rio', { repeat_masking: 'soft_masked' })} template={tpl} />
      </GprRoot>,
    );
    expect(screen.getByText('Last template: 10.0% masked (BLAST copy-number heuristic).')).toBeInTheDocument();
  });

  it('uses lowercase letters in sequence mode and reports changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <GprRoot>
        <RepeatOptions {...base} mode="sequence" genome={null} hasLowercase onChange={onChange} />
      </GprRoot>,
    );
    expect(screen.getByText('lowercase letters in the pasted sequence')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Keep, but no primer 3′ end in a repeat' }));
    expect(onChange).toHaveBeenLastCalledWith({ repeatMaskMode: 'three_prime' });
    await user.click(screen.getByRole('checkbox', { name: 'Avoid repeats' }));
    expect(onChange).toHaveBeenLastCalledWith({ avoidRepeats: false });
    expect(expectedMaskSource('sequence', null, false)).toBeNull();
    expect(expectedMaskSource('region', null, false)).toBeNull();
    expect(expectedMaskSource('transcript', genomeEntry('x', { repeat_masking: 'absent' }), false)).toBe('blast_depth');
  });
});

describe('TemplateMap', () => {
  it('packs overlapping pairs into separate lanes and picks round ticks', () => {
    const { pairs } = designFixture('gene-SORBI_3001G000200-flanks').response;
    const lanes = packPairLanes(pairs, 30);
    for (const a of pairs) {
      for (const b of pairs) {
        if (a.rank === b.rank || lanes.get(a.rank) !== lanes.get(b.rank)) continue;
        expect(a.right.end + 30 < b.left.start || b.right.end + 30 < a.left.start).toBe(true);
      }
    }
    expect(new Set(lanes.values()).size).toBe(5);
    expect(niceTicks(1, 4020, 10)).toEqual([500, 1000, 1500, 2000, 2500, 3000, 3500, 4000]);
    expect(niceTicks(1, 4020, 8)).toEqual([1000, 2000, 3000, 4000]);
    expect(niceTicks(1, 3, 8)).toEqual([1, 2, 3]);
  });

  it('draws gene features, intervals and masks; Zoom to pair, Fit and keyboard selection work', async () => {
    const f = designFixture('gene-SORBI_3001G000200-flanks').response;
    const template: PrimerTemplate = { ...f.template, mask: [[1000, 50]] };
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<TemplateMap template={template} pairs={f.pairs} selectedRank={0} onSelect={onSelect} target={[499, 50]} included={[100, 3000]} excluded={[[1000, 40]]} />);
    const svg = container.querySelector('svg.gpr-map-svg')!;
    expect(svg.querySelectorAll('rect.gpr-map-cds').length).toBeGreaterThan(5);
    expect(svg.querySelector('rect.gpr-map-utr5')).not.toBeNull();
    expect(svg.querySelector('rect.gpr-map-utr3')).not.toBeNull();
    expect(svg.querySelector('line.gpr-map-intron')).not.toBeNull();
    expect(svg.querySelector('rect.gpr-map-target')).not.toBeNull();
    expect(svg.querySelector('rect.gpr-map-included')).not.toBeNull();
    expect(svg.querySelector('rect.gpr-map-excluded')).not.toBeNull();
    expect(svg.querySelector('rect.gpr-map-mask')).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Template map' })).toHaveAccessibleDescription('4,020 bp gene template at 1:11,080–15,099 (−), 11 exons, 1 masked run, 5 primer pairs');
    expect(screen.getByText('1–4,020 of 4,020 bp')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Zoom to pair' }));
    const p = f.pairs[0]!;
    const pad = Math.max(10, Math.round((p.right.end - p.left.start + 1) * 0.15));
    expect(screen.getByText(`${(p.left.start - pad).toLocaleString('en-US')}–${(p.right.end + pad).toLocaleString('en-US')} of 4,020 bp`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fit' }));
    expect(screen.getByText('1–4,020 of 4,020 bp')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText(/^1,006–3,015 of 4,020 bp$/)).toBeInTheDocument();

    const lane = screen.getByRole('button', { name: /^Pair 3: / });
    lane.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('draws transcript exons with junction ticks, a CDS band and junction notches', () => {
    const f = designFixture('transcript-SORBI_3001G000200').response;
    const { container } = render(<TemplateMap template={f.template} pairs={f.pairs} />);
    const svg = container.querySelector('svg.gpr-map-svg')!;
    expect(svg.querySelectorAll('line.gpr-map-junction')).toHaveLength(10);
    expect(svg.querySelectorAll('rect.gpr-map-exon')).toHaveLength(11);
    expect(svg.querySelector('rect.gpr-map-cds-band')).not.toBeNull();
    expect(svg.querySelectorAll('line.gpr-map-notch').length).toBe(f.pairs.filter((p) => p.left.junction).length + f.pairs.filter((p) => p.right.junction).length);
    expect(screen.queryAllByRole('button', { name: /^Pair/ })).toHaveLength(0);
  });
});

describe('GenomePicker', () => {
  it('omits the list when everything is selected, filters, and disables genomes without a database', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<GenomePicker genomes={genomesResponse()} mode="gene" onChange={onChange} />);
    expect(screen.queryByRole('checkbox', { name: 'Sb bicolor' })).not.toBeInTheDocument();
    const nodb = screen.getByRole('checkbox', { name: 'Sb nodb' });
    expect(nodb).toBeDisabled();
    expect(nodb).toHaveAccessibleDescription('(no BLAST database)');
    expect(screen.getByText('3 of 3 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Sb grassl' }));
    expect(onChange).toHaveBeenLastCalledWith(['sorghum_353', 'sorghum_leoti']);

    rerender(<GenomePicker genomes={genomesResponse()} mode="gene" selected={['sorghum_353', 'sorghum_leoti']} onChange={onChange} />);
    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Sb grassl' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    await user.type(screen.getByRole('searchbox', { name: 'Filter genomes' }), 'leo');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Deselect all shown genomes' }));
    expect(onChange).toHaveBeenLastCalledWith(['sorghum_353']);
  });

  it('requires cDNA databases in transcript mode', () => {
    render(<GenomePicker genomes={genomesResponse()} mode="transcript" onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Sb grassl' })).toBeDisabled();
    expect(screen.getByText('2 of 2 selected')).toBeInTheDocument();
  });
});

describe('SpecificityResults', () => {
  it('shows the on-target line, sortable off-targets capped at maxRows, and gene links', async () => {
    const job = doneCheckJob();
    const onGeneClick = vi.fn();
    const user = userEvent.setup();
    render(<SpecificityResults results={job.results} job={job} systemName="sorghum_bicolor" maxRows={1} geneHref={(id) => `?idList=${id}`} onGeneClick={onGeneClick} />);
    const p2 = screen.getByRole('region', { name: /^P2/ });
    expect(within(p2).getByText(/^On target:/)).toHaveTextContent('On target: 4:7423537-7423746, 210 bp, LR in SORBI_3004G087700');
    const table = within(p2).getByRole('table', { name: /^Off-target products of P2/ });
    expect(within(p2).getByText('Showing 1 of 2; export the off-target TSV for the full list.')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('4:7437317-7437526');
    await user.click(within(table).getByRole('button', { name: 'Location' }));
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('5:66890615-66890824');
    expect(within(table).getByRole('columnheader', { name: 'Location' })).toHaveAttribute('aria-sort', 'descending');
    const link = within(p2).getByRole('link', { name: 'SORBI_3004G087700' });
    expect(link).toHaveAttribute('href', '?idList=SORBI_3004G087700');
    await user.click(link);
    expect(onGeneClick).toHaveBeenCalledWith('SORBI_3004G087700', 'sorghum_bicolor');
  });

  it('a transcript check with genome off-targets and a gDNA product never says "No off-target products"', () => {
    const job = transcriptCheckJob();
    const base = job.results!.specificity!.pairs[0]!;
    const offTargets = doneCheckJob().results!.specificity!.pairs[0]!.off_targets;
    const results: CheckResults = { ...job.results!, specificity: { target: 'genome', pairs: [{ ...base, verdict: 'off_targets', off_target_count: 2, off_targets: offTargets }] } };
    const view = render(<SpecificityResults results={results} block="genome" job={job} systemName="sorghum_bicolor" />);
    const p1 = screen.getByRole('region', { name: /^P1/ });
    expect(p1).not.toHaveTextContent('No off-target products');
    expect(
      within(p1).getByText('Transcript check: the genome has no expected product, so products outside the gene are listed as off-targets and products inside it as genomic DNA products.'),
    ).toBeInTheDocument();
    expect(within(p1).getByText('Off-targets (2)')).toBeInTheDocument();
    expect(within(p1).getByRole('table', { name: /^Off-target products of P1/ })).toBeInTheDocument();
    expect(within(p1).getByText(/DNase-treat RNA/)).toBeInTheDocument();
    view.unmount();

    // Same pair with a clean genome: the claim is limited to the genome outside the gene.
    render(<SpecificityResults results={job.results} block="genome" job={job} systemName="sorghum_bicolor" />);
    expect(screen.getByText('No off-target products in the genome outside the gene.')).toBeInTheDocument();
  });

  it('explains unlikely products (mismatch cap versus the 3′ rule) and flags approximate mismatch counts', () => {
    const job = doneCheckJob();
    const p2 = job.results!.specificity!.pairs[0]!;
    const base = p2.off_targets[0]!;
    const unlikely: GenomeAmplicon[] = [
      { ...base, region: '1', start: 100, end: 309, likelihood: 'unlikely', left_mm: 4, left_3p_mm: 0, left_mm_pos: [8, 11, 14, 17] },
      { ...base, region: '2', start: 100, end: 309, likelihood: 'unlikely', left_mm: 2, left_3p_mm: 2, left_mm_pos: [1, 3], approx: true },
    ];
    const results: CheckResults = { ...job.results!, specificity: { target: 'genome', pairs: [{ ...p2, unlikely, unlikely_count: 2 }] } };
    render(<SpecificityResults results={results} job={job} systemName="sorghum_bicolor" />);
    const rows = within(screen.getByRole('table', { name: /^Unlikely products of P2/ })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('unlikely: a primer has more than 3 mismatches');
    expect(rows[1]).not.toHaveTextContent('(approx.)');
    expect(rows[2]).toHaveTextContent('unlikely: mismatches near the 3′ end');
    expect(rows[2]).toHaveTextContent('2 total, 2 in 3′ window (approx.)');

    expect(unlikelyReason({ likelihood: 'unlikely', left_mm: 5, right_mm: 0 }, { max_amplifying_mismatches: 5 })).toBeNull();
    expect(unlikelyText(unlikelyReason({ likelihood: 'unlikely', left_mm: 2, right_mm: 0 }, { max_amplifying_mismatches: 1 }), { max_amplifying_mismatches: 1 })).toBe('unlikely: a primer has more than 1 mismatch');
    expect(unlikelyReason({ likelihood: 'likely', left_mm: 5, right_mm: 0 })).toBeNull();
  });
});

describe('PangenomeMatrix', () => {
  it('renders the legend, pending rows, cell texts and CellDetail', async () => {
    const pan = doneCheckJob().results!.pangenome!;
    const user = userEvent.setup();
    render(<PangenomeMatrix results={pan} requestedGenomes={['sorghum_353', 'sorghum_grassl', 'sorghum_leoti', 'sorghum_rio']} pairLabels={{ P2: 'P2 · pair 2' }} />);
    const legend = screen.getByRole('list', { name: 'Pan-genome status legend' });
    expect(within(legend).getAllByRole('listitem')).toHaveLength(8);
    expect(legend).toHaveTextContent('Search incomplete (a result cap was hit)');
    expect(screen.queryByText(/where the search hit a result cap/)).not.toBeInTheDocument();
    const grid = screen.getByRole('grid');
    expect(within(grid).getByRole('columnheader', { name: /^P2 · pair 2/ })).toHaveTextContent('amplifies 2/3');
    expect(within(grid).getAllByRole('gridcell', { name: /^sorghum_rio, .*Pending$/ })).toHaveLength(2);
    expect(within(grid).getByRole('gridcell', { name: 'Sb leoti, P2 · pair 2, No amplicon, no ortholog annotated' })).toHaveTextContent('∅no ortholog annotated');
    // The last display_name seen for a genome wins (P3 lists sorghum_grassl as "Sb grassl").
    expect(within(grid).getByRole('gridcell', { name: 'Sb grassl, P2 · pair 2, Two or more amplicons, 2 amplicons' })).toHaveTextContent('×2');
    expect(within(grid).getByRole('gridcell', { name: 'Sb verticilliflorum 353, P3, One amplicon with mismatches, mismatch at the 3′ end' })).toHaveTextContent('≈3′');
    await user.click(within(grid).getByRole('gridcell', { name: /^Sb leoti, P2/ }));
    expect(screen.getByRole('region', { name: 'Sb leoti · P2 · pair 2' })).toHaveTextContent('No ortholog of the query gene is annotated in this genome');
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('region', { name: 'Sb leoti · P2 · pair 2' })).not.toBeInTheDocument();
  });

  it('marks results whose search hit a cap (cell, column summary, note, CellDetail) and explains the closest unlikely product', async () => {
    const p2 = doneCheckJob().results!.pangenome!.pairs[0]!;
    const leoti: PangenomeGenomeResult = {
      ...p2.genomes[2]!,
      ortholog_annotated: null,
      truncated: true,
      nearest: { region: '4', start: 7500000, end: 7500209, strand: 1, size: 210, size_delta: 0, orientation: 'LR', likelihood: 'unlikely', left_mm: 4, right_mm: 0, left_3p_mm: 1, right_3p_mm: 0 },
    };
    const genomes = [p2.genomes[0]!, p2.genomes[1]!, leoti];
    const results: PangenomeResults = { target: 'genome', pairs: [{ ...p2, genomes, summary: summarizePangenome(genomes) }] };
    expect(results.pairs[0]!.summary).toMatchObject({ no_amplicon: 1, amplifies: 2, truncated: 1 });
    const user = userEvent.setup();
    render(<PangenomeMatrix results={results} params={{ max_amplifying_mismatches: 3 }} />);
    expect(screen.getByText(/^⋯ marks 1 of 3 results where the search hit a result cap: products may have been missed/)).toBeInTheDocument();
    const grid = screen.getByRole('grid');
    expect(within(grid).getByRole('columnheader', { name: /^P2/ })).toHaveTextContent('1 incomplete');
    const cell = within(grid).getByRole('gridcell', { name: 'Sb leoti, P2, No amplicon, closest product not expected to amplify, search incomplete' });
    expect(cell).toHaveAttribute('data-truncated', 'true');
    expect(cell).toHaveTextContent('∅⋯');
    expect(within(grid).getAllByRole('gridcell').filter((c) => c.getAttribute('data-truncated') === 'true')).toHaveLength(1);
    await user.click(cell);
    const detail = screen.getByRole('region', { name: 'Sb leoti · P2' });
    expect(detail).toHaveTextContent('No product is expected to amplify.');
    expect(detail).toHaveTextContent(/Closest product \(unlikely: a primer has more than 3 mismatches\): 4:7500000-7500209.*210 bp; mismatches left 4, right 0\./);
    expect(detail).toHaveTextContent('The search in this genome hit a result cap, so this result may be incomplete: products may have been missed.');
  });
});

describe('ErrorBanner', () => {
  it('VALIDATION lists the nested validator reasons, not the generic INVALID_REQUEST_PARAMETER wrapper', () => {
    // Shape of the real capture test/fixtures/api/error-validation-additional-property.json, plus a PATTERN failure.
    const body = {
      message: 'Validation errors',
      errors: [
        {
          code: 'INVALID_REQUEST_PARAMETER',
          errors: [
            { code: 'OBJECT_ADDITIONAL_PROPERTIES', params: ['bogus'], message: 'Additional properties not allowed: bogus', path: [] },
            { code: 'PATTERN', message: 'String does not match pattern ^[a-z0-9_]+$: Sorghum_bicolor', path: ['system_name'] },
          ],
          in: 'body',
          message: 'Invalid parameter (body): Value failed JSON Schema validation',
          name: 'body',
          path: ['paths', '/primers/design', 'post', 'parameters', '0'],
        },
      ],
    };
    render(
      <GprRoot>
        <ErrorBanner context="design" error={toApiError(400, JSON.stringify(body))} />
      </GprRoot>,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Additional properties not allowed: bogus OBJECT_ADDITIONAL_PROPERTIES',
      'String does not match pattern ^[a-z0-9_]+$: Sorghum_bicolor (system_name) PATTERN',
    ]);
    expect(alert).not.toHaveTextContent('INVALID_REQUEST_PARAMETER');
    expect(alert).not.toHaveTextContent('Value failed JSON Schema validation');
    expect(flattenValidationErrors([{ code: 'A', errors: [{ code: 'B', errors: [{ code: 'C' }] }] }, { code: 'D', errors: [] }]).map((e) => e.code)).toEqual(['C', 'D']);
  });

  it('JOB_TOO_LARGE shows the estimate and the limit', () => {
    render(
      <GprRoot>
        <ErrorBanner context="check" error={apiError({ status: 422, code: 'JOB_TOO_LARGE', message: 'Job too large', details: { estimate_cpu_s: 7250, limit: 6000 } })} />
      </GprRoot>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Estimated 7,250 CPU-s; the limit is 6,000 CPU-s.');
  });

  it('QUEUE_FULL enables Retry after the delay', async () => {
    vi.useFakeTimers();
    try {
      const onRetry = vi.fn();
      render(
        <GprRoot>
          <ErrorBanner context="check" error={apiError({ status: 503, code: 'QUEUE_FULL', message: 'Queue full', retryAfterMs: 2000 })} onRetry={onRetry} />
        </GprRoot>,
      );
      expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
      expect(screen.getByText('You can retry in 2 s.')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('NETWORK and 5xx errors offer Retry', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <GprRoot>
        <ErrorBanner context="design" error={apiError({ status: 0, code: 'NETWORK', message: 'Failed to fetch' })} onRetry={onRetry} />
      </GprRoot>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The design request could not reach the server.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    rerender(
      <GprRoot>
        <ErrorBanner context="check" error={apiError({ status: 502, code: 'HTTP_502', message: 'HTTP 502 Bad Gateway' })} onRetry={onRetry} />
      </GprRoot>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The server could not complete the check.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});

describe('designerReducer', () => {
  it('switching mode clears template intervals and follows the default preset unless one was picked', () => {
    const s: PrimerDesignerState = { ...initialDesignerState({ gene: gene200 }), target: [10, 5], excluded: [[1, 2]], params: { opt_tm: 61 } };
    const t = designerReducer(s, { type: 'setMode', mode: 'transcript' });
    expect(t).toMatchObject({ mode: 'transcript', preset: 'qpcr', params: { opt_tm: 61 } });
    expect(t).not.toHaveProperty('target');
    expect(t).not.toHaveProperty('excluded');
    expect(designerReducer({ ...t, preset: 'pcr' }, { type: 'setMode', mode: 'gene' }).preset).toBe('pcr');
    expect(designerReducer(t, { type: 'setMode', mode: 'region' }).preset).toBe('pcr');
  });

  it('keeps the state compact and JSON-serializable', () => {
    let s = initialDesignerState({ gene: gene200 });
    s = designerReducer(s, { type: 'setParam', key: 'opt_tm', value: 61 });
    expect(s.params).toEqual({ opt_tm: 61 });
    s = designerReducer(s, { type: 'setParam', key: 'opt_tm', value: undefined });
    expect(s).not.toHaveProperty('params');
    s = designerReducer(s, { type: 'designDone', templateOnly: false, noPairs: true, checkedRanks: [2, 0], selectedRank: undefined });
    expect(s).toMatchObject({ designed: true, checkedRanks: [0, 2], view: { resultsTab: 'pairs', explainOpen: true } });
    expect(s).not.toHaveProperty('selectedRank');
    s = designerReducer(s, { type: 'setPangenome', enabled: true });
    s = designerReducer(s, { type: 'checkJob', jobId: 'abc', submitted: [{ id: 'P1', left: 'ACGT', right: 'TTGG' }] });
    expect(s.check).toEqual({ checks: ['specificity', 'pangenome'], jobId: 'abc', submitted: [{ id: 'P1', left: 'ACGT', right: 'TTGG' }] });
    expect(designerReducer(s, { type: 'setTab', tab: 'pairs' })).toBe(s);
    expect(designerReducer(s, { type: 'designDone', templateOnly: true, noPairs: false })).toBe(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('styling contract (spec §C.5)', () => {
  const css = readFileSync(pkgPath('src/styles/primers.css'), 'utf8');
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');

  function selectors(): string[] {
    const stack: string[] = [];
    const out: string[] = [];
    let prelude = '';
    for (const ch of text) {
      if (ch === '{') {
        const p = prelude.trim();
        prelude = '';
        if (p.startsWith('@')) {
          stack.push(p.startsWith('@keyframes') ? 'keyframes' : 'at');
        } else {
          if (!stack.includes('keyframes')) out.push(p);
          stack.push('rule');
        }
      } else if (ch === '}') {
        stack.pop();
        prelude = '';
      } else if (ch === ';') {
        prelude = '';
      } else {
        prelude += ch;
      }
    }
    return out;
  }

  it('scopes every rule under .gpr-root with gpr- classes and --gpr- variables, without !important', () => {
    expect(text).not.toMatch(/!important/);
    const list = selectors();
    expect(list.length).toBeGreaterThan(150);
    for (const sel of list) {
      for (const part of sel.split(',')) {
        expect(part.trim(), sel).toMatch(/^\.gpr-root(?=[\s.:[>]|$)/);
        for (const cls of part.match(/\.[A-Za-z_][\w-]*/g) ?? []) expect(cls, part).toMatch(/^\.gpr-/);
      }
    }
    for (const v of css.match(/--[A-Za-z][\w-]*/g) ?? []) expect(v).toMatch(/^--gpr-/);
    for (const k of css.match(/@keyframes\s+[\w-]+/g) ?? []) expect(k).toMatch(/@keyframes gpr-/);
  });

  it('has the Bootstrap-proof reset, themes, container queries and reduced motion', () => {
    const list = selectors().flatMap((s) => s.split(',').map((p) => p.trim()));
    for (const el of ['button', 'input', 'select', 'textarea', 'table', 'label', 'code', 'pre', 'h3', 'h4']) {
      expect(list, el).toContain(`.gpr-root ${el}`);
    }
    expect(list).toContain('.gpr-root.gpr-theme-dark');
    expect(list).toContain('.gpr-root.gpr-theme-light');
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*{\s*\.gpr-root\.gpr-theme-auto/);
    expect(css).toMatch(/container-type: inline-size/);
    expect(css).toMatch(/@container gpr \(min-width: 960px\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    for (const colour of ['#aaccaf', '#a7b4d3', '#c5a3bf', '#aaaaaa', '#009E73', '#56B4E9', '#E69F00', '#D55E00']) expect(css.toLowerCase()).toContain(colour.toLowerCase());
  });

  it('uses only gpr- class names in the components', () => {
    const tokens = new Set<string>();
    for (const file of walk(pkgPath('src/components')).filter((f) => /\.tsx?$/.test(f))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
        for (const t of (m[1] ?? m[2] ?? m[3] ?? '').split(/\s+/)) if (t) tokens.add(t);
      }
      for (const m of src.matchAll(/\bcx\(([^)]*)\)/g)) {
        for (const s of m[1]!.matchAll(/'([^']*)'/g)) for (const t of s[1]!.split(/\s+/)) if (t) tokens.add(t);
      }
    }
    expect(tokens.size).toBeGreaterThan(150);
    expect([...tokens].filter((t) => !t.startsWith('gpr-'))).toEqual([]);
  });

  it('exports the components, mount and ensureStylesInjected from the package entry', () => {
    for (const name of ['PrimerDesigner', 'PairsTable', 'TemplateMap', 'SpecificityResults', 'PangenomeMatrix', 'GenomePicker', 'mount', 'ensureStylesInjected']) {
      expect(typeof (api as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});
