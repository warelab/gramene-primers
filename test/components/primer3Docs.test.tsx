import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ExplainPanel } from '../../src/components/ExplainPanel';
import { PairsTable } from '../../src/components/PairsTable';
import { ParamsPanel } from '../../src/components/ParamsPanel';
import { PrimerDesigner } from '../../src/components/PrimerDesigner';
import { RepeatOptions } from '../../src/components/RepeatOptions';
import { PRIMER3_CITATION, PRIMER3_DOCS, PRIMER3_MANUAL_URL, primer3ManualUrl } from '../../src/primer3Docs';
import { gene200, genomesResponse } from '../fixtures/samples';
import { expectNoAxeViolations } from './axe';
import { FakePrimersClient } from './fakeClient';
import { API, designFixture } from './fixtures';

// Anchors used by the docs, checked in the Primer3 2.6.1 manual (https://primer3.org/manual.html) on 2026-09-15.
const MANUAL_ANCHORS = new Set([
  'PRIMER_MIN_SIZE', 'PRIMER_OPT_SIZE', 'PRIMER_MAX_SIZE', 'PRIMER_MIN_TM', 'PRIMER_OPT_TM', 'PRIMER_MAX_TM', 'PRIMER_TM_FORMULA',
  'PRIMER_MIN_GC', 'PRIMER_OPT_GC_PERCENT', 'PRIMER_MAX_GC', 'PRIMER_PAIR_MAX_DIFF_TM', 'PRIMER_NUM_RETURN', 'PRIMER_PRODUCT_SIZE_RANGE',
  'PRIMER_MAX_POLY_X', 'PRIMER_GC_CLAMP', 'PRIMER_MAX_END_STABILITY', 'PRIMER_MAX_NS_ACCEPTED', 'PRIMER_SALT_MONOVALENT',
  'PRIMER_SALT_DIVALENT', 'PRIMER_DNTP_CONC', 'PRIMER_DNA_CONC', 'PRIMER_MIN_5_PRIME_OVERLAP_OF_JUNCTION',
  'PRIMER_MIN_3_PRIME_OVERLAP_OF_JUNCTION', 'SEQUENCE_OVERLAP_JUNCTION_LIST', 'PRIMER_LOWERCASE_MASKING', 'SEQUENCE_TARGET',
  'SEQUENCE_INCLUDED_REGION', 'SEQUENCE_EXCLUDED_REGION', 'PRIMER_LEFT_EXPLAIN', 'PRIMER_PAIR_EXPLAIN', 'findNoPrimers',
  'PRIMER_LEFT_4_TM', 'PRIMER_LEFT_4_GC_PERCENT', 'PRIMER_PAIR_4_PRODUCT_SIZE', 'PRIMER_PAIR_4_PENALTY', 'calculatePenalties',
  'PRIMER_PAIR_4_COMPL_ANY_TH', 'PRIMER_PAIR_4_COMPL_END_TH', 'PRIMER_LEFT_4_HAIRPIN_TH', 'PRIMER_LEFT_4_SELF_ANY_TH',
  'PRIMER_LEFT_4_SELF_END_TH', 'PRIMER_LEFT_4_END_STABILITY', 'PRIMER_PAIR_4_PRODUCT_TM', 'globalTags',
]);

const noop = () => {};

const helpFor = (button: HTMLElement): HTMLElement => {
  const id = button.getAttribute('aria-controls');
  expect(id).toBeTruthy();
  return document.getElementById(id!)!;
};

describe('Primer3 documentation', () => {
  it('links only to anchors of the Primer3 2.6.1 manual', () => {
    for (const [topic, doc] of Object.entries(PRIMER3_DOCS)) {
      expect(doc.text, topic).not.toBe('');
      expect(doc.links.length, topic).toBeGreaterThan(0);
      for (const link of doc.links) expect(MANUAL_ANCHORS.has(link.anchor), `${topic}: ${link.anchor}`).toBe(true);
    }
    expect(primer3ManualUrl('PRIMER_NUM_RETURN')).toBe(`${PRIMER3_MANUAL_URL}#PRIMER_NUM_RETURN`);
  });

  it('ParamsPanel: a ? button shows one help text at a time, with manual links that open in a new tab', async () => {
    const user = userEvent.setup();
    render(
      <ParamsPanel idPrefix="t" mode="gene" preset="pcr" params={undefined} onPreset={noop} onParam={noop} onReset={noop} settings={null} lastRequest={null} issues={[]} />,
    );
    expect(screen.getByRole('link', { name: /^Primer3 manual/ })).toHaveAttribute('href', `${PRIMER3_MANUAL_URL}#globalTags`);

    const size = screen.getByRole('button', { name: 'About Primer size (nt)' });
    expect(size).toHaveAttribute('aria-expanded', 'false');
    await user.click(size);
    expect(size).toHaveAttribute('aria-expanded', 'true');
    const sizeHelp = helpFor(size);
    expect(sizeHelp).toHaveTextContent('Primer length.');
    const link = within(sizeHelp).getByRole('link', { name: /PRIMER_OPT_SIZE/ });
    expect(link).toHaveAttribute('href', `${PRIMER3_MANUAL_URL}#PRIMER_OPT_SIZE`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    // The group keeps its plain name; the button does not become part of it.
    expect(screen.getByRole('group', { name: 'Primer size (nt)' })).toBeInTheDocument();

    screen.getByText('Advanced parameters').closest('details')!.open = true;
    const poly = screen.getByRole('button', { name: 'About Max mononucleotide run (nt)' });
    await user.click(poly);
    expect(size).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('t-help-size')).toBeNull();
    const polyHelp = helpFor(poly);
    expect(polyHelp).toHaveTextContent('4 accepts AAAA but rejects AAAAA');
    expect(screen.getByRole('spinbutton', { name: 'Max mononucleotide run (nt)' }).getAttribute('aria-describedby')).toContain(polyHelp.id);

    await user.click(screen.getByRole('button', { name: 'About Product size ranges (bp)' }));
    expect(screen.getByRole('link', { name: /PRIMER_PRODUCT_SIZE_RANGE/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Product size ranges (bp)' })).toBeInTheDocument();
  });

  it('RepeatOptions explains the two masking modes', async () => {
    const user = userEvent.setup();
    render(<RepeatOptions idPrefix="r" mode="gene" avoidRepeats repeatMaskMode="n_mask" onChange={noop} genome={null} template={null} hasLowercase={false} />);
    const button = screen.getByRole('button', { name: 'About Masked bases' });
    await user.click(button);
    const help = helpFor(button);
    expect(help).toHaveTextContent('Replace with N turns masked bases into N');
    expect(within(help).getByRole('link', { name: /PRIMER_LOWERCASE_MASKING/ })).toHaveAttribute('href', `${PRIMER3_MANUAL_URL}#PRIMER_LOWERCASE_MASKING`);
    expect(screen.getByRole('group', { name: 'Masked bases' })).toBeInTheDocument();
  });

  it('PairsTable defines its columns; ExplainPanel links to the explain tags', () => {
    const { response } = designFixture('gene-SORBI_3001G000200-flanks');
    const { unmount } = render(<PairsTable pairs={response.pairs} template={response.template} />);
    const columns = screen.getByText('About these columns').closest('details')!;
    expect(within(columns).getByText('Penalty')).toBeInTheDocument();
    expect(within(columns).getByRole('link', { name: /PRIMER_PAIR_4_PENALTY/ })).toHaveAttribute('href', `${PRIMER3_MANUAL_URL}#PRIMER_PAIR_4_PENALTY`);
    expect(within(columns).getByRole('link', { name: /How Primer3 calculates the penalty/ })).toHaveAttribute('href', `${PRIMER3_MANUAL_URL}#calculatePenalties`);
    unmount();

    render(<ExplainPanel explain={response.explain} open onToggle={noop} noPairs={false} idPrefix="e" />);
    expect(screen.getByRole('link', { name: /PRIMER_LEFT_EXPLAIN/ })).toHaveAttribute('href', `${PRIMER3_MANUAL_URL}#PRIMER_LEFT_EXPLAIN`);
    expect(screen.getByRole('link', { name: /What to do if Primer3 cannot find primers/ })).toHaveAttribute('href', `${PRIMER3_MANUAL_URL}#findNoPrimers`);
  });

  it('PrimerDesigner links the interval tags, credits Primer3 with its citation, and stays accessible with help open', async () => {
    const fake = new FakePrimersClient();
    fake.genomes = genomesResponse();
    fake.onDesign = () => designFixture('gene-SORBI_3001G000200-flanks').response;
    const user = userEvent.setup();
    const { container } = render(<PrimerDesigner apiBase={API} client={fake} gene={gene200} />);
    expect(screen.getByRole('link', { name: /SEQUENCE_TARGET/ })).toHaveAttribute('href', `${PRIMER3_MANUAL_URL}#SEQUENCE_TARGET`);
    await user.click(screen.getByRole('button', { name: 'About Primer size (nt)' }));
    await user.click(screen.getByRole('button', { name: 'Design primers' }));
    await screen.findByRole('table', { name: /^5 primer pairs/ });
    const credit = screen.getByText(/Designed with Primer3/);
    expect(within(credit).getByRole('link', { name: /Untergasser et al\. 2012/ })).toHaveAttribute('href', PRIMER3_CITATION.url);
    screen.getByText('About these columns').closest('details')!.open = true;
    await expectNoAxeViolations(container, 'designed, with Primer3 help open');
  });
});
