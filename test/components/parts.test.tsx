import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { GenomePicker } from '../../src/components/GenomePicker';
import { PangenomeMatrix } from '../../src/components/PangenomeMatrix';
import { designerReducer } from '../../src/components/reducer';
import { expectedMaskSource, RepeatOptions } from '../../src/components/RepeatOptions';
import { AlleleMatrix } from '../../src/components/AlleleMatrix';
import { AssayOptions } from '../../src/components/AssayOptions';
import { ManualVariantInputs } from '../../src/components/ManualVariantInputs';
import { OrderSheet } from '../../src/components/OrderSheet';
import { OrientationExplain } from '../../src/components/OrientationExplain';
import { VariantBrowser } from '../../src/components/VariantBrowser';
import { VariantPicker } from '../../src/components/VariantPicker';
import { consequenceColor } from '../../src/variants';
import { GenotypingPanel } from '../../src/components/GenotypingPanel';
import { PrimerDesigner } from '../../src/components/PrimerDesigner';
import { GprRoot } from '../../src/components/Root';
import { SetsTable } from '../../src/components/SetsTable';
import { SpecificityResults } from '../../src/components/SpecificityResults';
import { niceTicks, packPairLanes, TemplateMap } from '../../src/components/TemplateMap';
import { DigestPanel } from '../../src/components/DigestPanel';
import { PairDetail } from '../../src/components/PairDetail';
import { toApiError } from '../../src/client';
import { flattenValidationErrors } from '../../src/errors';
import * as api from '../../src/index';
import { summarizePangenome } from '../../src/pangenome';
import { unlikelyReason, unlikelyText } from '../../src/results';
import { initialDesignerState } from '../../src/state';
import type {
  CheckJob,
  CheckResults,
  DesignerMode,
  GenomeAmplicon,
  GenotypingDesignResponse,
  GenotypingState,
  PangenomeGenomeResult,
  PangenomeResults,
  PrimerDesignerState,
  PrimerTemplate,
  VariantEntry,
  VariantListResponse,
} from '../../src/types';
import { doneCheckJob, gene200, genomeEntry, genomesResponse, transcriptCheckJob } from '../fixtures/samples';
import { pkgPath } from '../paths';
import { apiError, FakePrimersClient } from './fakeClient';
import { API, designFixture } from './fixtures';

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

describe('PrimerDesigner: genotyping mode', () => {
  const designer = (over: { modes?: DesignerMode[]; defaultMode?: DesignerMode } = {}) => {
    const fake = new FakePrimersClient();
    fake.genomes = genomesResponse();
    render(<PrimerDesigner apiBase={API} client={fake} gene={gene200} modes={over.modes} defaultMode={over.defaultMode} />);
    return fake;
  };

  it('offers genotyping only when the host asks for it', () => {
    const { unmount } = render(<PrimerDesigner apiBase={API} client={new FakePrimersClient()} gene={gene200} />);
    expect(screen.queryByRole('tab', { name: 'Genotyping (KASP)' })).toBeNull();
    unmount();
    designer({ modes: ['gene', 'genotyping'] });
    expect(screen.getByRole('tab', { name: 'Genotyping (KASP)' })).toBeTruthy();
  });

  it('swaps the design form for the genotyping panel, and back', async () => {
    const user = userEvent.setup();
    designer({ modes: ['gene', 'genotyping'], defaultMode: 'genotyping' });
    expect(screen.getByRole('button', { name: 'Design assay' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Design primers' })).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Gene' }));
    expect(screen.getByRole('button', { name: 'Design primers' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Design assay' })).toBeNull();
  });
});

describe('GenotypingPanel', () => {
  const kasp = (JSON.parse(readFileSync(pkgPath('test', 'fixtures', 'genotyping', 'capture-genotyping-design-rs871475760-kasp.json'), 'utf8')) as {
    response: GenotypingDesignResponse;
  }).response;

  const panel = (genotyping: GenotypingState, over: Partial<Record<string, unknown>> = {}) => {
    const fake = new FakePrimersClient();
    fake.onDesignGenotyping = () => kasp;
    const dispatch = vi.fn();
    const state: PrimerDesignerState = { v: 1, mode: 'genotyping', systemName: 'sorghum_bicolor', genotyping };
    render(<GenotypingPanel client={fake} state={state} dispatch={dispatch} systemName="sorghum_bicolor" genomes={genomesResponse()} {...over} />);
    return { fake, dispatch };
  };

  it('cannot design until a variant is chosen', () => {
    panel({});
    expect(screen.getByRole('button', { name: 'Design assay' })).toBeDisabled();
    expect(screen.getByText('Choose a variant to design against.')).toBeTruthy();
  });

  it('designs from the chosen variant and defaults the selection to the sets the server packed', async () => {
    const user = userEvent.setup();
    const { fake, dispatch } = panel({ variantKey: '1:11109:C:A' });
    await user.click(screen.getByRole('button', { name: 'Design assay' }));
    expect(fake.genotypingDesignCalls[0]!.req).toEqual({ system_name: 'sorghum_bicolor', variant: { region: '1', position: 11109, ref: 'C', alt: 'A' } });
    const done = dispatch.mock.calls.map(([a]) => a).find((a) => a.type === 'genotypingDesignDone');
    expect(done).toMatchObject({ noSets: false, templateOnly: false, checkedSetKeys: kasp.check!.set_ids.map((id) => kasp.sets.find((s) => s.id === id)!.key) });
  });

  it('posts exactly the check request the design handed back', async () => {
    const user = userEvent.setup();
    const keys = kasp.sets.map((s) => s.key);
    const { fake } = panel({ variantKey: '1:11109:C:A', checkedSetKeys: keys, check: { checks: ['specificity', 'pangenome'] } });
    await user.click(screen.getByRole('button', { name: 'Design assay' }));
    await user.click(await screen.findByRole('button', { name: 'Check selected sets' }));
    expect(fake.submitCalls[0]!.req).toEqual(kasp.check!.request);
  });

  it('keeps the allele tab shut until a check has produced calls', async () => {
    const user = userEvent.setup();
    panel({ variantKey: '1:11109:C:A' });
    await user.click(screen.getByRole('button', { name: 'Design assay' }));
    const alleles = await screen.findByRole('tab', { name: 'Alleles' });
    expect(alleles).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('tab', { name: 'Sets' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('OrderSheet', () => {
  const kasp = (JSON.parse(readFileSync(pkgPath('test', 'fixtures', 'genotyping', 'capture-genotyping-design-rs871475760-kasp.json'), 'utf8')) as {
    response: GenotypingDesignResponse;
  }).response;

  it('lists three oligos per set, named for ordering', () => {
    render(<OrderSheet sets={kasp.sets} />);
    const table = screen.getByRole('table', { name: /oligos/ });
    expect(within(table).getAllByRole('row')).toHaveLength(kasp.sets.length * 3 + 1);
    expect(within(table).getByText(kasp.sets[0]!.order[0]!.name)).toBeTruthy();
  });

  it('does not repeat the sequence for an untailed primer, which is ordered as it anneals', () => {
    render(<OrderSheet sets={kasp.sets} />);
    const untailed = kasp.sets.flatMap((s) => s.order).filter((r) => r.order_seq === r.target_seq);
    expect(untailed.length).toBeGreaterThan(0);
    // One "same" per untailed oligo, instead of printing the identical string twice.
    expect(screen.getAllByText('same')).toHaveLength(untailed.length);
  });

  it('shows the KASP mix and the submission sequence when the assay has them', () => {
    render(<OrderSheet sets={kasp.sets} kaspMix={kasp.assay.kasp_mix} submissionSequence={kasp.variant.submission_sequence} />);
    const mix = kasp.assay.kasp_mix!;
    // "KASP mix:" is its own <strong>, so assert against the paragraph holding the recipe.
    const note = screen.getByText(/KASP mix:/).closest('p');
    expect(note).toHaveTextContent(`${mix.as_ref_uL} µL REF + ${mix.as_alt_uL} µL ALT + ${mix.common_uL} µL common at ${mix.stock_uM} µM`);
    expect(screen.getByRole('button', { name: 'Copy the submission sequence' })).toBeTruthy();
  });

  it('offers the genotype-calls export only once there are results', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<OrderSheet sets={kasp.sets} />);
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByRole('button', { name: 'Download Order sheet (TSV)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download Primers (FASTA)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Genotype calls/ })).toBeNull();
    unmount();

    const job = (JSON.parse(readFileSync(pkgPath('test', 'fixtures', 'genotyping', 'capture-check-genotyping-result.json'), 'utf8')) as { response: CheckJob }).response;
    render(<OrderSheet sets={kasp.sets} results={job.results!.genotyping} />);
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByRole('button', { name: 'Download Genotype calls (TSV)' })).toBeTruthy();
  });
});

describe('OrientationExplain', () => {
  const design = (name: string) =>
    (JSON.parse(readFileSync(pkgPath('test', 'fixtures', 'genotyping', `${name}.json`), 'utf8')) as { response: GenotypingDesignResponse }).response;

  it('says which orientation was blocked and what blocked it', () => {
    const d = design('capture-genotyping-design-tmp_1_11502_C_CGT');
    const forward = d.orientations!.forward;
    expect(forward.status).toBe('blocked');
    const blocker = forward.blockers[0]!;
    render(<OrientationExplain orientations={d.orientations} />);
    const card = screen.getByRole('region', { name: 'Forward' });
    expect(card).toHaveTextContent('Blocked');
    expect(card).toHaveTextContent(`${blocker.distance_from_3p} nt from the 3′ end`);
    expect(card).toHaveTextContent(blocker.alleles);
  });

  it('reports the relaxation level each orientation needed', () => {
    const d = design('capture-genotyping-design-manual-deletion');
    render(<OrientationExplain orientations={d.orientations} />);
    for (const which of ['Forward', 'Reverse'] as const) {
      const report = d.orientations![which.toLowerCase() as 'forward' | 'reverse'];
      if (report.relaxation_level == null) continue;
      expect(screen.getByRole('region', { name: which })).toHaveTextContent(`relaxation level ${report.relaxation_level}`);
    }
  });

  it('renders nothing for a template-only design, which has no orientations', () => {
    const { container } = render(<OrientationExplain orientations={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('VariantBrowser', () => {
  const listing = (JSON.parse(readFileSync(pkgPath('test', 'fixtures', 'genotyping', 'capture-variants-list-1_11180-11290.json'), 'utf8')) as {
    response: VariantListResponse;
  }).response;
  const win = { start: 11180, end: 11290 };
  const base = () => ({ region: '1', window: win, systemName: 'sorghum_bicolor', variants: listing.variants, maxWindow: 50_000 });

  it('rings the variants an enzyme cuts, without recolouring them', () => {
    // Colour is the consequence scale; a second meaning on it would be unreadable.
    const [first, second] = listing.variants;
    const caps = new Map([
      [first!.key, { verdict: 'caps' as const, sites: [{ enzyme: { name: 'XbaI', site: 'TCTAGA', cut: 1 }, cuts: 'ref' as const, site: { start: 1, end: 6, strand: 1 as const }, specificity: 4096 }], dcaps: [], unknown: null }],
      [second!.key, { verdict: 'dcaps' as const, sites: [], dcaps: [], unknown: null }],
    ]);
    const { container } = render(<VariantBrowser {...base()} caps={caps} />);
    // Only the natural site is marked; a dCAPS opportunity is not an assay.
    expect(container.querySelectorAll('.gpr-browser-variant .gpr-browser-caps')).toHaveLength(1);
    expect(container.querySelector('.gpr-browser-variant title')?.textContent).toContain('XbaI cuts one allele');
    expect(screen.getByText('cut differently by an enzyme')).toBeTruthy();
  });

  it('omits the CAPS key when nothing in view is cut', () => {
    render(<VariantBrowser {...base()} />);
    expect(screen.queryByText('cut differently by an enzyme')).toBeNull();
  });

  it('draws exactly the variants it is handed, so it cannot disagree with the table', () => {
    const { container } = render(<VariantBrowser {...base()} />);
    expect(container.querySelectorAll('.gpr-browser-variant')).toHaveLength(listing.variants.length);

    // The picker passes its filtered rows, so a narrower set draws fewer markers.
    const one = render(<VariantBrowser {...base()} variants={listing.variants.slice(0, 1)} />);
    expect(one.container.querySelectorAll('.gpr-browser-variant')).toHaveLength(1);
  });

  it('gives each consequence its own colour and names it in the legend', () => {
    const variants = JSON.parse(JSON.stringify(listing.variants)) as VariantEntry[];
    variants[0]!.consequence = 'missense_variant';
    const { container } = render(<VariantBrowser {...base()} variants={variants} />);
    expect(container.querySelectorAll('.gpr-browser-key')).toHaveLength(2);
    expect(screen.getByText('missense variant')).toBeTruthy();
    // Stable and distinct, so a term keeps its colour as you pan.
    expect(consequenceColor('missense_variant')).not.toBe(consequenceColor('3_prime_UTR_variant'));
    expect(consequenceColor('missense_variant')).toBe(consequenceColor('missense_variant'));
  });

  it('asks the host for gene models over the region actually being browsed', async () => {
    // Typed so the recorded call can be inspected.
    const genesInRegion = vi.fn(async (query: { system_name: string; region: string; start: number; end: number }) => {
      void query;
      // Genomic coordinates, as Ensembl REST returns them.
      return [{ id: 'SORBI_3001G000200', label: 'SORBI_3001G000200', start: 11180, end: 14899, strand: -1 as const, exons: [{ start: 11892, end: 12152 }] }];
    });
    render(<VariantBrowser {...base()} genesInRegion={genesInRegion} />);
    await waitFor(() => expect(genesInRegion).toHaveBeenCalled());
    expect(genesInRegion.mock.calls[0]![0]).toMatchObject({ system_name: 'sorghum_bicolor', region: '1', start: win.start, end: win.end });
  });

  it('says so when the host offers no gene search, rather than looking broken', () => {
    render(<VariantBrowser {...base()} />);
    expect(screen.getByText('Gene models are not available here.')).toBeTruthy();
  });

  it('hands the browsed region back to the listing', async () => {
    const onUseRegion = vi.fn();
    const user = userEvent.setup();
    render(<VariantBrowser {...base()} onUseRegion={onUseRegion} />);
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'List this region' }));
    const call = onUseRegion.mock.calls[0]!;
    expect(call[1] - call[0] + 1).toBeGreaterThan(win.end - win.start + 1);
  });

  it('will not list a region wider than the server accepts', async () => {
    const user = userEvent.setup();
    render(<VariantBrowser {...base()} maxWindow={200} onUseRegion={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByRole('button', { name: 'List this region' })).toBeDisabled();
    expect(screen.getByText(/at most 200 bp can be listed/)).toBeTruthy();
  });

  it('does not offer a way round the table disabling a row', async () => {
    const onSelect = vi.fn();
    const variants = JSON.parse(JSON.stringify(listing.variants)) as VariantEntry[];
    variants[0]!.designable = false;
    const user = userEvent.setup();
    const { container } = render(<VariantBrowser {...base()} variants={variants} onSelect={onSelect} />);
    const markers = container.querySelectorAll('.gpr-browser-variant');
    await user.click(markers[0] as Element);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('VariantPicker', () => {
  const variantList = (JSON.parse(readFileSync(pkgPath('test', 'fixtures', 'genotyping', 'capture-variants-list-1_11180-11290.json'), 'utf8')) as { response: VariantListResponse })
    .response;
  const window = { region: '1', start: 11180, end: 11290 };
  const base = (over: Record<string, unknown> = {}) => ({
    systemName: 'sorghum_bicolor',
    variationAvailable: true,
    source: { name: 'Ensembl', release: '115' },
    state: { window } as GenotypingState,
    onWindow: vi.fn(),
    onFilters: vi.fn(),
    onSelect: vi.fn(),
    ...over,
  });

  /** Every variant in the capture is designable, so a non-designable row is synthesized. */
  const withUndesignable = (): VariantListResponse => {
    const copy = JSON.parse(JSON.stringify(variantList)) as VariantListResponse;
    copy.variants[0]!.designable = false;
    copy.variants[0]!.issues = [{ code: 'REPEAT_TOO_LONG', message: 'The variant sits in a long repeat' }];
    return copy;
  };

  it('lists the window and marks a row that cannot be designed', async () => {
    const fake = new FakePrimersClient();
    const listing = withUndesignable();
    fake.onListVariants = () => listing;
    render(<VariantPicker client={fake} {...base()} />);
    const table = await screen.findByRole('table', { name: /variants/ });
    expect(within(table).getAllByRole('row')).toHaveLength(listing.variants.length + 1);
    const blocked = listing.variants.find((v) => !v.designable)!;
    // Listed on purpose, with its reason, but not selectable.
    expect(within(table).getByRole('radio', { name: `Use ${blocked.label}` })).toBeDisabled();
    expect(within(table).getByText(/repeat too long/i)).toBeTruthy();
  });

  it('scrolls the table in place and keeps the headers sortable', async () => {
    const fake = new FakePrimersClient();
    fake.onListVariants = () => variantList;
    const user = userEvent.setup();
    render(<VariantPicker client={fake} {...base()} />);
    const table = await screen.findByRole('table', { name: /variants/ });
    // The wrapper is the scroll container, which is what makes the sticky header work.
    expect(table.closest('.gpr-variant-scroll')).toBeTruthy();

    const positions = () => within(table).getAllByRole('row').slice(1).map((r) => r.querySelector('th')?.textContent ?? '');
    expect(positions()).toEqual([...positions()].sort());

    await user.click(within(table).getByRole('button', { name: /^Kind/ }));
    expect(within(table).getByRole('columnheader', { name: /^Kind/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(positions()[0]).toBe('11,282'); // 'deletion' sorts before 'snv'

    await user.click(within(table).getByRole('button', { name: /^Kind/ }));
    expect(within(table).getByRole('columnheader', { name: /^Kind/ })).toHaveAttribute('aria-sort', 'descending');
    expect(positions()[0]).not.toBe('11,282');
  });

  it('builds the consequence filter from the listing', async () => {
    const listing = JSON.parse(JSON.stringify(variantList)) as VariantListResponse;
    listing.variants[0]!.consequence = 'missense_variant';
    const fake = new FakePrimersClient();
    fake.onListVariants = () => listing;
    const user = userEvent.setup();
    render(<VariantPicker client={fake} {...base()} />);
    await screen.findByRole('table', { name: /variants/ });

    const select = screen.getByRole('combobox', { name: 'Consequence' });
    // "Any consequence" plus one option per consequence actually present.
    expect(within(select).getAllByRole('option')).toHaveLength(3);
    await user.selectOptions(select, 'missense_variant');
    // One row left, so the caption reads "1 variant": match the stable half.
    expect(within(screen.getByRole('table', { name: /cannot be designed/ })).getAllByRole('row')).toHaveLength(2);
  });

  it('offers no choice when every row shares one consequence', async () => {
    const fake = new FakePrimersClient();
    fake.onListVariants = () => variantList;
    render(<VariantPicker client={fake} {...base()} />);
    await screen.findByRole('table', { name: /variants/ });
    expect(new Set(variantList.variants.map((v) => v.consequence)).size).toBe(1);
    expect(screen.getByRole('combobox', { name: 'Consequence' })).toBeDisabled();
  });

  it('filters by the source a variant was reported from', async () => {
    const fake = new FakePrimersClient();
    fake.onListVariants = () => variantList;
    const user = userEvent.setup();
    render(<VariantPicker client={fake} {...base()} />);
    await screen.findByRole('table', { name: /variants/ });

    const sources = [...new Set(variantList.variants.flatMap((v) => v.records.map((r) => r.source)))];
    expect(sources.length).toBeGreaterThan(1);
    const target = sources[0]!;
    const expected = variantList.variants.filter((v) => v.records.some((r) => r.source === target)).length;

    await user.selectOptions(screen.getByRole('combobox', { name: 'Source' }), target);
    expect(within(screen.getByRole('table', { name: /variants/ })).getAllByRole('row')).toHaveLength(expected + 1);
  });

  it('filters to indels that can slide', async () => {
    const fake = new FakePrimersClient();
    fake.onListVariants = () => variantList;
    const user = userEvent.setup();
    render(<VariantPicker client={fake} {...base()} />);
    await screen.findByRole('table', { name: /variants/ });
    const shiftable = variantList.variants.filter((v) => typeof v.shift === 'number' && v.shift > 0).length;
    expect(shiftable).toBeGreaterThan(0);

    await user.click(screen.getByRole('checkbox', { name: 'Can slide' }));
    expect(within(screen.getByRole('table', { name: /cannot be designed/ })).getAllByRole('row')).toHaveLength(shiftable + 1);
  });

  it('stays escapable when a filter matches nothing', async () => {
    const fake = new FakePrimersClient();
    fake.onListVariants = () => variantList;
    const user = userEvent.setup();
    render(<VariantPicker client={fake} {...base()} />);
    await screen.findByRole('table', { name: /variants/ });
    // No variant in this window is multi-allelic.
    expect(variantList.variants.every((v) => !v.multiallelic)).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: 'Multi-allelic only' }));
    expect(screen.queryByRole('table', { name: /variants/ })).toBeNull();
    expect(screen.getByText('No variants match these filters.')).toBeTruthy();

    // The way back is still on screen, rather than hidden with the table.
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(within(screen.getByRole('table', { name: /variants/ })).getAllByRole('row')).toHaveLength(variantList.variants.length + 1);
  });

  it('filters to the rows that can actually be designed, and says how many are shown', async () => {
    const fake = new FakePrimersClient();
    const listing = withUndesignable();
    fake.onListVariants = () => listing;
    const user = userEvent.setup();
    render(<VariantPicker client={fake} {...base()} />);
    await screen.findByRole('table', { name: /variants/ });
    const n = listing.variants.length;
    expect(screen.getByText(`${n} of ${n} variants`)).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: 'Designable only' }));
    expect(within(screen.getByRole('table', { name: /variants/ })).getAllByRole('row')).toHaveLength(n); // header + (n-1)
    expect(screen.getByText(`${n - 1} of ${n} variants`)).toBeTruthy();
  });

  it('selects by content key, which already names one alternative allele', async () => {
    const fake = new FakePrimersClient();
    fake.onListVariants = () => variantList;
    const p = base();
    const user = userEvent.setup();
    render(<VariantPicker client={fake} {...p} />);
    const first = variantList.variants.find((v) => v.designable)!;
    await user.click(await screen.findByRole('radio', { name: `Use ${first.label}` }));
    expect(p.onSelect).toHaveBeenCalledWith({ variantKey: first.key, variantId: first.ids[0], alt: first.vcf.alt });
  });

  it('refuses a window longer than the server will list', () => {
    const fake = new FakePrimersClient();
    fake.onListVariants = () => variantList;
    render(<VariantPicker client={fake} {...base({ state: { window: { region: '1', start: 1, end: 60_000 } } })} />);
    expect(screen.getByText(/at most 50,000 bp can be listed/)).toBeTruthy();
  });

  it('degrades to manual entry when lookups are switched off, instead of disabling the form', async () => {
    const fake = new FakePrimersClient();
    fake.onListVariants = () => apiError({ status: 503, code: 'FEATURE_DISABLED', message: 'off' });
    render(<VariantPicker client={fake} {...base()} />);
    expect(await screen.findByText(/switched off on this server/)).toBeTruthy();
    // The manual fields stay usable, and the browser is gone.
    expect(screen.getByRole('textbox', { name: 'Reference allele' })).not.toBeDisabled();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('validates manual entry only once it is touched, and commits only a complete variant', async () => {
    const fake = new FakePrimersClient();
    const p = base({ variationAvailable: false, state: {} });
    render(<VariantPicker client={fake} {...p} />);
    // Nothing typed yet: no error shown.
    expect(screen.queryByText(/Position must be a whole number/)).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Sequence' }), { target: { value: '1' } });
    expect(p.onSelect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Position' }), { target: { value: '11109' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Reference allele' }), { target: { value: 'C' } });
    expect(p.onSelect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Alternative allele' }), { target: { value: 'A' } });
    expect(p.onSelect).toHaveBeenCalledWith({ manual: { region: '1', position: 11109, ref: 'C', alt: 'A' } });
  });

  describe('CAPS annotation', () => {
    // Real bases for the window, cut from the design capture so the two
    // fixtures cannot drift apart.
    const kasp = (JSON.parse(readFileSync(pkgPath('test', 'fixtures', 'genotyping', 'capture-genotyping-design-rs871475760-kasp.json'), 'utf8')) as {
      response: { template: { start: number; seq: string } };
    }).response;
    const sequenceForRegion = async (q: { start: number; end: number }) =>
      kasp.template.seq.slice(q.start - kasp.template.start, q.end - kasp.template.start + 1);

    /** Rows are keyed by position: two variants in this window are both C>T. */
    const capsRow = (position: number) => within(screen.getByRole('row', { name: new RegExp(String(position)) }));

    it('names the enzyme that cuts one allele and not the other', async () => {
      const fake = new FakePrimersClient();
      fake.onListVariants = () => variantList;
      render(<VariantPicker client={fake} {...base({ sequenceForRegion })} />);
      await screen.findByRole('table', { name: /variants/ });
      // 1:11193 C>T destroys an XbaI site; 1:11182 A>G has no natural site.
      await waitFor(() => expect(capsRow(11193).getByText('XbaI')).toBeTruthy());
      expect(capsRow(11203).getByText('AccI')).toBeTruthy();
      expect(capsRow(11182).getByText('dCAPS')).toBeTruthy();
    });

    it('reads "unknown", not "none", when the host supplies no sequence', async () => {
      const fake = new FakePrimersClient();
      fake.onListVariants = () => variantList;
      render(<VariantPicker client={fake} {...base()} />);
      const table = await screen.findByRole('table', { name: /variants/ });
      expect(within(table).getAllByText('Unknown')).toHaveLength(variantList.variants.length);
      expect(screen.getByText(/supplies no reference sequence/)).toBeTruthy();
      expect(screen.getByRole('checkbox', { name: 'CAPS-able only' })).toBeDisabled();
    });

    it('refuses the whole window when the sequence disagrees with the reported alleles', async () => {
      const fake = new FakePrimersClient();
      fake.onListVariants = () => variantList;
      // One wrong base is enough: it means the wrong release, and every call in
      // the window would be wrong in the same invisible way.
      const corrupt = async (q: { start: number; end: number }) => {
        const seq = await sequenceForRegion(q);
        const i = 11193 - q.start;
        return seq.slice(0, i) + (seq[i] === 'A' ? 'C' : 'A') + seq.slice(i + 1);
      };
      render(<VariantPicker client={fake} {...base({ sequenceForRegion: corrupt })} />);
      const table = await screen.findByRole('table', { name: /variants/ });
      await waitFor(() => expect(within(table).getAllByText('Unknown')).toHaveLength(variantList.variants.length));
      expect(screen.getByText(/probably different releases/)).toBeTruthy();
    });

    it('narrows the table to variants with a natural site', async () => {
      const fake = new FakePrimersClient();
      fake.onListVariants = () => variantList;
      const user = userEvent.setup();
      render(<VariantPicker client={fake} {...base({ sequenceForRegion })} />);
      const table = await screen.findByRole('table', { name: /variants/ });
      await waitFor(() => expect(within(table).queryAllByText('Unknown')).toHaveLength(0));
      const all = within(table).getAllByRole('row').length;
      await user.click(screen.getByRole('checkbox', { name: 'CAPS-able only' }));
      const narrowed = within(screen.getByRole('table', { name: /variants/ })).getAllByRole('row').length;
      expect(narrowed).toBeGreaterThan(1);
      expect(narrowed).toBeLessThan(all);
      await user.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(within(screen.getByRole('table', { name: /variants/ })).getAllByRole('row')).toHaveLength(all);
    });

    it('offers only enzymes that discriminate something in the window', async () => {
      const fake = new FakePrimersClient();
      fake.onListVariants = () => variantList;
      const user = userEvent.setup();
      render(<VariantPicker client={fake} {...base({ sequenceForRegion })} />);
      await screen.findByRole('table', { name: /variants/ });
      const select = screen.getByRole('combobox', { name: 'Enzyme' });
      await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
      const options = within(select).getAllByRole('option').map((o) => o.textContent ?? '');
      expect(options[0]).toBe('Any enzyme');
      expect(options.join(' ')).toContain('XbaI');
      await user.selectOptions(select, 'XbaI');
      // Only 1:11193 carries an XbaI site, and at one row the caption is singular.
      const rows = within(screen.getByRole('table', { name: /cannot be designed/ })).getAllByRole('row');
      expect(rows).toHaveLength(2);
      expect(within(rows[1]!).getByText('XbaI')).toBeTruthy();
    });

    it('honours a host-supplied enzyme panel', async () => {
      const fake = new FakePrimersClient();
      fake.onListVariants = () => variantList;
      render(<VariantPicker client={fake} {...base({ sequenceForRegion, enzymes: [] })} />);
      const table = await screen.findByRole('table', { name: /variants/ });
      // An empty panel discriminates nothing, but that is "None", not "Unknown".
      await waitFor(() => expect(within(table).getAllByText('None')).toHaveLength(variantList.variants.length));
      expect(screen.getByRole('combobox', { name: 'Enzyme' })).toBeDisabled();
    });
  });
});

describe('ManualVariantInputs', () => {
  const base = () => ({ idPrefix: 't', value: undefined, issues: [], onChange: vi.fn() });

  it('collects the four VCF fields and keeps the rest of the value', () => {
    const p = base();
    render(<ManualVariantInputs {...p} value={{ region: '1', position: 11109 }} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Reference allele' }), { target: { value: 'C' } });
    expect(p.onChange).toHaveBeenCalledWith({ region: '1', position: 11109, ref: 'C' });
  });

  it('spells out both accepted styles, since an Ensembl insertion is positioned differently', () => {
    render(<ManualVariantInputs {...base()} />);
    const hint = screen.getByText(/Either style works/);
    expect(hint).toHaveTextContent('after');
    expect(hint).toHaveTextContent('50 bases');
  });

  it('routes an issue to its own field and lists ones that name no field', () => {
    render(
      <ManualVariantInputs
        {...base()}
        value={{ region: '1', position: 0, ref: 'C', alt: 'A' }}
        issues={[
          { field: 'position', code: 'INVALID_POSITION', message: 'Position must be a whole number of at least 1' },
          { field: 'variant', code: 'REQUIRED', message: 'Choose a variant' },
        ]}
      />,
    );
    expect(screen.getByRole('spinbutton', { name: 'Position' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Choose a variant')).toBeTruthy();
  });

  it('names the base the genome actually has when the reference does not match', () => {
    render(<ManualVariantInputs {...base()} value={{ region: '1', position: 11109, ref: 'G', alt: 'A' }} refMismatch={{ given: 'G', genome: 'C' }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('has C at this position, not G');
  });

  it('offers a reference check that designs nothing', async () => {
    const onCheck = vi.fn();
    const user = userEvent.setup();
    render(<ManualVariantInputs {...base()} onCheckReference={onCheck} />);
    await user.click(screen.getByRole('button', { name: 'Check reference' }));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });
});

describe('AlleleMatrix', () => {
  const genotypeCapture = (name: string) =>
    (JSON.parse(readFileSync(pkgPath('test', 'fixtures', 'genotyping', `${name}.json`), 'utf8')) as { response: CheckJob }).response;
  const ambiguous = genotypeCapture('capture-check-genotyping-ambiguous');
  const runningJob = genotypeCapture('capture-check-genotyping-running');
  const results = () => ambiguous.results!.genotyping!;

  it('reports the server summary, not a count of the rows it happens to hold', () => {
    const g = results();
    render(<AlleleMatrix results={g} />);
    const readout = screen.getByText(/genomes:/);
    // The job summarises every genome; the response carries only some of the rows.
    expect(g.genomes.length).toBeLessThan(g.summary.genomes_total);
    expect(readout).toHaveTextContent(String(g.summary.genomes_total));
    expect(readout).toHaveTextContent(`${g.summary.ref} reference`);
    expect(readout).toHaveTextContent(`${g.summary.alt} alternative`);
    expect(readout).toHaveTextContent(`${g.genomes.length} shown`);
  });

  it('renders an ambiguous genome that reports no sequence, rather than treating it as an error', () => {
    const g = results();
    const row = g.genomes.find((x) => x.allele === 'ambiguous');
    expect(row).toBeTruthy();
    // Copies disagreed, so there is no single observed core to show.
    expect(row!.observed).toBeNull();
    render(<AlleleMatrix results={g} />);
    const cell = screen.getByRole('gridcell', { name: new RegExp(`^${row!.display_name}: Copies disagree`) });
    expect(cell).toBeTruthy();
  });

  it('shows a withheld prediction as not predictable, not as a disagreement', () => {
    const g = results();
    const withheld = g.sets[0]!.genomes.find((p) => p.predicted === 'unknown');
    expect(withheld?.agrees).toBeNull();
    render(<AlleleMatrix results={g} />);
    expect(screen.getAllByRole('gridcell', { name: /Cannot be predicted/ }).length).toBeGreaterThan(0);
  });

  it('a running job with an all-zero summary reads as still working', () => {
    const g = runningJob.results!.genotyping!;
    expect(g.summary.genomes_total).toBe(0);
    render(<AlleleMatrix results={g} running />);
    expect(screen.getByText(/Calling alleles/)).toBeTruthy();
    expect(screen.queryByText(/0 genomes:/)).toBeNull();
  });

  it('does not count a withheld comparison as a disagreement', async () => {
    const g = results();
    // Every row here either agrees or cannot be compared; `agrees: null` is not a disagreement.
    expect(g.sets.every((s) => s.summary.disagree === 0)).toBe(true);
    expect(g.sets.some((s) => s.summary.not_comparable > 0)).toBe(true);
    const user = userEvent.setup();
    render(<AlleleMatrix results={g} />);
    await user.click(screen.getByRole('checkbox', { name: 'Disagreements only' }));
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.getByText('No genomes match these filters.')).toBeTruthy();
  });

  it('keeps exactly the disagreeing genomes when a panel has some', async () => {
    const g = genotypeCapture('capture-check-genotyping-result').results!.genotyping!;
    const disagreeing = new Set<string>();
    for (const s of g.sets) {
      if (s.reference?.agrees === false) disagreeing.add(s.reference.system_name);
      for (const r of s.genomes ?? []) if (r.agrees === false) disagreeing.add(r.system_name);
    }
    expect(disagreeing.size).toBeGreaterThan(0);
    const user = userEvent.setup();
    render(<AlleleMatrix results={g} />);
    await user.click(screen.getByRole('checkbox', { name: 'Disagreements only' }));
    // the header row, plus one row per disagreeing genome
    expect(screen.getAllByRole('row')).toHaveLength(disagreeing.size + 1);
  });
});

describe('AssayOptions', () => {
  const base = () => ({
    idPrefix: 't',
    assay: undefined,
    params: undefined,
    issues: [],
    onAssay: vi.fn(),
    onParam: vi.fn(),
    onResetParams: vi.fn(),
    onRepeats: vi.fn(),
  });

  it('sends the mismatch position as a number, since a select hands back a string', () => {
    const p = base();
    render(<AssayOptions {...p} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Mismatch position' }), { target: { value: '3' } });
    expect(p.onAssay).toHaveBeenCalledWith({ mismatch_position: 3 });
  });

  it('sends the genuinely textual options as strings', () => {
    const p = base();
    render(<AssayOptions {...p} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Orientation' }), { target: { value: 'reverse' } });
    expect(p.onAssay).toHaveBeenCalledWith({ orientation: 'reverse' });
  });

  it('offers tails for KASP and hides them for untailed AS-PCR', () => {
    const { unmount } = render(<AssayOptions {...base()} />);
    expect(screen.getByRole('combobox', { name: 'Tails' })).toBeTruthy();
    unmount();
    render(<AssayOptions {...base()} assay={{ type: 'as_pcr' }} />);
    expect(screen.queryByRole('combobox', { name: 'Tails' })).toBeNull();
  });

  it('says when a parameter was pinned, because a sent value is never relaxed', () => {
    render(
      <AssayOptions
        {...base()}
        params={{ max_size: 30 }}
        settings={{ preset: 'kasp', params: {}, pinned: ['max_size'], ladder: [], floors: { as_min_tm: 52, as_min_gc: 15 } }}
      />,
    );
    expect(screen.getByText(/Pinned: this value was sent/)).toBeTruthy();
  });
});

describe('SetsTable', () => {
  const kasp = (JSON.parse(readFileSync(pkgPath('test', 'fixtures', 'genotyping', 'capture-genotyping-design-rs871475760-kasp.json'), 'utf8')) as { response: GenotypingDesignResponse })
    .response;

  it('identifies a set by its content key, not the positional id', async () => {
    const onChecked = vi.fn();
    const user = userEvent.setup();
    render(<SetsTable sets={kasp.sets} checkedKeys={[]} onCheckedChange={onChecked} />);
    const table = screen.getByRole('table', { name: /^2 primer sets/ });
    // header + one row per set
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    await user.click(within(table).getByRole('checkbox', { name: 'Check set S1' }));
    expect(onChecked).toHaveBeenCalledWith([kasp.sets[0]!.key]);
    expect(kasp.sets[0]!.key).not.toBe(kasp.sets[0]!.id);
  });

  it('shows the orientation, product size and quality the design reported', () => {
    render(<SetsTable sets={kasp.sets} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('reverse');
    expect(rows[0]).toHaveTextContent('Usable');
    expect(rows[0]).toHaveTextContent(String(kasp.sets[0]!.products.ref.size));
    expect(rows[1]).toHaveTextContent('forward');
    expect(rows[1]).toHaveTextContent('Poor');
  });

  it('offers the annealing sequence and the tailed order sequence as separate copies', () => {
    render(<SetsTable sets={kasp.sets} />);
    expect(screen.getByRole('button', { name: 'Copy the REF primer of set S1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy the tailed order sequence of the REF primer of set S1' })).toBeTruthy();
    // The common primer is untailed, so there is nothing separate to order.
    expect(screen.queryByRole('button', { name: /order sequence of the common primer of set S1/ })).toBeNull();
  });

  it('expands a set into its per-oligo detail table', async () => {
    const user = userEvent.setup();
    render(<SetsTable sets={kasp.sets} />);
    await user.click(screen.getAllByRole('button', { name: /^Details/ })[0]!);
    expect(screen.getByRole('table', { name: /Primer statistics, set S1/ })).toBeTruthy();
  });

  it('caps the selection at five sets by disabling the rest', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...kasp.sets[0]!, id: `S${i + 1}`, key: String(i).repeat(12) }));
    const checked = many.slice(0, 5).map((s) => s.key);
    render(<SetsTable sets={many} checkedKeys={checked} onCheckedChange={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Check set S1' })).not.toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Check set S6' })).toBeDisabled();
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

describe('designerReducer: genotyping', () => {
  const start = (): PrimerDesignerState => ({ ...initialDesignerState({ gene: gene200 }), mode: 'genotyping' });

  it('a new variant clears the sets, the selection and the check job designed for the old one', () => {
    let s = start();
    s = designerReducer(s, { type: 'setGenotypingVariant', variantId: 'rs871475760', variantKey: '1:11109:C:A' });
    s = designerReducer(s, { type: 'genotypingDesignDone', templateOnly: false, noSets: false, checkedSetKeys: ['f9df650ad116'], selectedSetKey: 'f9df650ad116' });
    s = designerReducer(s, { type: 'genotypingCheckJob', jobId: 'abc' });
    expect(s.genotyping).toMatchObject({ designed: true, checkedSetKeys: ['f9df650ad116'], check: { jobId: 'abc' } });

    s = designerReducer(s, { type: 'setGenotypingVariant', variantKey: '1:11283:A:-' });
    expect(s.genotyping).toEqual({ variantKey: '1:11283:A:-' });
  });

  it('switching assay type re-derives the defaults, but the first assay keeps its fields', () => {
    let s = designerReducer(start(), { type: 'setGenotypingAssay', assay: { type: 'kasp', num_sets: 2 } });
    expect(s.genotyping?.assay).toEqual({ type: 'kasp', num_sets: 2 });
    s = designerReducer(s, { type: 'setGenotypingAssay', assay: { orientation: 'reverse' } });
    expect(s.genotyping?.assay).toEqual({ type: 'kasp', num_sets: 2, orientation: 'reverse' });
    s = designerReducer(s, { type: 'setGenotypingAssay', assay: { type: 'as_pcr' } });
    expect(s.genotyping?.assay).toEqual({ type: 'as_pcr' });
  });

  it('caps the checked sets at five and ignores a repeat tick', () => {
    let s = start();
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) s = designerReducer(s, { type: 'setGenotypingChecked', key: k.repeat(12), checked: true });
    expect(s.genotyping?.checkedSetKeys).toEqual(['a', 'b', 'c', 'd', 'e'].map((k) => k.repeat(12)));
    expect(designerReducer(s, { type: 'setGenotypingChecked', key: 'a'.repeat(12), checked: true })).toBe(s);
    expect(designerReducer(s, { type: 'setGenotypingChecked', key: 'z'.repeat(12), checked: false })).toBe(s);
    s = designerReducer(s, { type: 'setGenotypingCheckedKeys', keys: ['x'.repeat(12), 'x'.repeat(12), 'y'.repeat(12)] });
    expect(s.genotyping?.checkedSetKeys).toEqual(['x'.repeat(12), 'y'.repeat(12)]);
  });

  it('unticking the last set drops the key list, and an empty slice drops with it', () => {
    // With something else in the slice, only the key list goes.
    let kept = designerReducer(start(), { type: 'setGenotypingVariant', variantKey: '1:11109:C:A' });
    kept = designerReducer(kept, { type: 'setGenotypingChecked', key: 'a'.repeat(12), checked: true });
    kept = designerReducer(kept, { type: 'setGenotypingChecked', key: 'a'.repeat(12), checked: false });
    expect(kept.genotyping).toEqual({ variantKey: '1:11109:C:A' });

    // With nothing else, the slice itself is dropped rather than left empty.
    let bare = designerReducer(start(), { type: 'setGenotypingChecked', key: 'a'.repeat(12), checked: true });
    bare = designerReducer(bare, { type: 'setGenotypingChecked', key: 'a'.repeat(12), checked: false });
    expect(bare).not.toHaveProperty('genotyping');
  });

  it('keeps params compact and drops the slice once it holds nothing', () => {
    let s = designerReducer(start(), { type: 'setGenotypingParam', key: 'max_size', value: 30 });
    expect(s.genotyping?.params).toEqual({ max_size: 30 });
    s = designerReducer(s, { type: 'setGenotypingParam', key: 'max_size', value: undefined });
    expect(s).not.toHaveProperty('genotyping');
    s = designerReducer(s, { type: 'setGenotypingParam', key: 'opt_tm', value: 60 });
    s = designerReducer(s, { type: 'resetGenotypingParams' });
    expect(s).not.toHaveProperty('genotyping');
  });

  it('carries the check slice and stays JSON-serializable', () => {
    let s = designerReducer(start(), { type: 'setGenotypingVariant', variantKey: '1:11109:C:A' });
    s = designerReducer(s, { type: 'setGenotypingPangenome', enabled: true });
    s = designerReducer(s, { type: 'setGenotypingGenomes', genomes: ['sorghum_is19953'] });
    s = designerReducer(s, { type: 'setGenotypingCheckParam', key: 'ignore_mismatches', value: 5 });
    s = designerReducer(s, {
      type: 'genotypingCheckJob',
      jobId: 'job1',
      submitted: [{ id: 'S1', ref: { id: 'S1_REF', left: 'ACGT', right: 'TTGG' }, alt: { id: 'S1_ALT', left: 'ACGA', right: 'TTGG' } }],
    });
    expect(s.genotyping?.check).toMatchObject({ checks: ['specificity', 'pangenome'], genomes: ['sorghum_is19953'], params: { ignore_mismatches: 5 }, jobId: 'job1' });
    s = designerReducer(s, { type: 'clearGenotypingCheckJob' });
    expect(s.genotyping?.check).not.toHaveProperty('jobId');
    expect(s.genotyping?.check).not.toHaveProperty('submitted');
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('a template-only design changes nothing, and a design with no sets stays on the sets tab', () => {
    const s = designerReducer(start(), { type: 'setGenotypingVariant', variantKey: '1:11109:C:A' });
    expect(designerReducer(s, { type: 'genotypingDesignDone', templateOnly: true, noSets: false })).toBe(s);
    const none = designerReducer(s, { type: 'genotypingDesignDone', templateOnly: false, noSets: true });
    expect(none.genotyping).toMatchObject({ designed: true, view: { tab: 'sets' } });
    expect(designerReducer(none, { type: 'setGenotypingTab', tab: 'sets' })).toBe(none);
    expect(designerReducer(none, { type: 'setGenotypingTab', tab: 'alleles' }).genotyping?.view).toEqual({ tab: 'alleles' });
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

describe('DigestPanel', () => {
  const geneMinus = designFixture('gene-SORBI_3001G000200-flanks').response;
  const span = { start: geneMinus.pairs[0]!.left.start, end: geneMinus.pairs[0]!.right.end };

  it('lists each enzyme with its site, count, positions and fragment sizes', () => {
    render(<DigestPanel template={geneMinus.template} span={span} />);
    const table = screen.getByRole('table', { name: /Restriction sites/ });
    const row = within(table).getByRole('row', { name: /RsaI/ });
    const cells = within(row).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('GT^AC');
    expect(cells[1]).toHaveTextContent('1');
    // Positions are template coordinates, inside the product.
    const [from, to] = (cells[2]!.textContent ?? '').split('–').map((n) => Number(n.replace(/,/g, '')));
    expect(from).toBeGreaterThanOrEqual(span.start);
    expect(to).toBeLessThanOrEqual(span.end);
    expect(to! - from! + 1).toBe(4);
    expect(cells[3]).toHaveTextContent('71 / 61');
  });

  it('orders enzymes by how few times they cut', () => {
    render(<DigestPanel template={geneMinus.template} span={span} />);
    const rows = within(screen.getByRole('table', { name: /Restriction sites/ })).getAllByRole('row').slice(1);
    const counts = rows.map((r) => Number(within(r).getAllByRole('cell')[1]!.textContent));
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  });

  it('names the enzymes that leave the product alone', () => {
    render(<DigestPanel template={geneMinus.template} span={span} />);
    expect(screen.getByText(/have no site in this product/)).toBeTruthy();
  });

  it('keeps the unreadably busy enzymes behind a control', async () => {
    const user = userEvent.setup();
    render(<DigestPanel template={geneMinus.template} span={span} maxCuts={1} />);
    const table = () => within(screen.getByRole('table', { name: /Restriction sites/ })).getAllByRole('row').slice(1);
    const few = table().length;
    await user.click(screen.getByRole('button', { name: /Show \d+ more/ }));
    expect(table().length).toBeGreaterThan(few);
  });

  it('renders nothing without a template sequence', () => {
    const { container } = render(<DigestPanel template={null} span={span} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PairDetail restriction marks', () => {
  const geneMinus = designFixture('gene-SORBI_3001G000200-flanks').response;

  it('marks the chosen enzyme’s recognition site and cut in the amplicon', async () => {
    const user = userEvent.setup();
    const { container } = render(<PairDetail pair={geneMinus.pairs[0]!} template={geneMinus.template} />);
    // Scoped to the sequence: the legend reuses the class as its swatch, the
    // way the masked-bases legend already does.
    const marked = () => [...container.querySelectorAll('.gpr-amplicon-seq .gpr-seq-site')];
    expect(marked()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'RsaI' }));
    // The four bases of GTAC are highlighted, and the single cut is barred.
    expect(marked().map((n) => n.textContent).join('')).toBe('GTAC');
    expect(container.querySelectorAll('.gpr-cut-bar')).toHaveLength(1);
    expect(screen.getByText(/RsaI site/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'RsaI' }));
    expect(marked()).toHaveLength(0);
  });

  it('lets the host own the selection so the map can follow it', async () => {
    const onSelectEnzyme = vi.fn();
    const user = userEvent.setup();
    render(
      <PairDetail pair={geneMinus.pairs[0]!} template={geneMinus.template} selectedEnzyme={null} onSelectEnzyme={onSelectEnzyme} />,
    );
    await user.click(screen.getByRole('button', { name: 'TaqI' }));
    expect(onSelectEnzyme).toHaveBeenCalledWith('TaqI');
  });
});

describe('TemplateMap restriction sites', () => {
  const geneMinus = designFixture('gene-SORBI_3001G000200-flanks').response;
  const sites = [
    { start: 400, end: 405 },
    { start: 1200, end: 1205 },
  ];

  it('draws a mark per site and grows to fit the track', () => {
    const bare = render(<TemplateMap template={geneMinus.template} pairs={geneMinus.pairs} />).container.querySelector('svg')!;
    const { container } = render(<TemplateMap template={geneMinus.template} pairs={geneMinus.pairs} sites={sites} selectedEnzyme="RsaI" />);
    expect(container.querySelectorAll('.gpr-map-site')).toHaveLength(2);
    expect(container.querySelector('.gpr-map-site title')?.textContent).toContain('RsaI');
    expect(Number(container.querySelector('svg')!.getAttribute('height'))).toBeGreaterThan(Number(bare.getAttribute('height')));
  });

  it('offers only enzymes that have a site in the template', async () => {
    const onSelectEnzyme = vi.fn();
    const user = userEvent.setup();
    render(
      <TemplateMap
        template={geneMinus.template}
        pairs={geneMinus.pairs}
        enzymeOptions={[['RsaI', 12] as const, ['TaqI', 5] as const]}
        selectedEnzyme={null}
        onSelectEnzyme={onSelectEnzyme}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Restriction sites' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['None', 'RsaI (12)', 'TaqI (5)']);
    await user.selectOptions(select, 'TaqI');
    expect(onSelectEnzyme).toHaveBeenCalledWith('TaqI');
  });

  it('hides the picker and the track when no enzyme cuts the template', () => {
    const { container } = render(<TemplateMap template={geneMinus.template} pairs={geneMinus.pairs} />);
    expect(container.querySelectorAll('.gpr-map-site')).toHaveLength(0);
    expect(screen.queryByRole('combobox', { name: 'Restriction sites' })).toBeNull();
  });
});
