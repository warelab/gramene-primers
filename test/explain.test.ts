import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPLAIN_HINTS, explainRows, parseExplainString, summarizeExplain } from '../src/explain';
import { fixturePath } from './paths';

/** Every label printed by p3_oligo_explain_string / p3_pair_explain_string in Primer3 2.6.1 libprimer3.cc. */
const PRIMER3_261_LABELS = [
  // oligo
  'sequencing locations', 'considered', 'would not amplify any of the ORF', 'too many Ns', 'overlap target', 'overlap excluded region',
  'GC content failed', 'GC clamp failed', 'low tm', 'high tm', 'low faction bound', 'high fraction bound', 'high any compl',
  'high end compl', 'high hairpin stability', 'high repeat similarity', 'long poly-x seq', 'low sequence quality',
  "high 3' stability", 'high template mispriming score', "lowercase masking of 3' end", 'failed must_match requirements',
  'not in any ok left region', 'not in any ok right region', 'no overlap of required point', 'ok',
  // pair
  'no target', 'unacceptable product size', 'low product Tm', 'high product Tm', 'tm diff too large', 'no internal oligo',
  'high mispriming library similarity', 'primer in pair overlaps a primer in a better pair', 'not in any ok region',
  'left primer to right of right primer',
];

describe('EXPLAIN_HINTS', () => {
  it('is keyed by exactly the Primer3 2.6.1 labels', () => {
    expect(Object.keys(EXPLAIN_HINTS).sort()).toEqual([...new Set(PRIMER3_261_LABELS)].sort());
    for (const label of ['too many Ns', 'no overlap of required point', 'low faction bound', 'unacceptable product size']) {
      expect(EXPLAIN_HINTS[label]?.hint, label).toBeTruthy();
    }
  });

  it('covers every label in real primer3_core 2.6.1 explain output', () => {
    const text = readFileSync(fixturePath('primer3', 'explain_2.6.1.txt'), 'utf8');
    const values = text
      .split('\n')
      .filter((l) => /^PRIMER_(LEFT|RIGHT|PAIR)_EXPLAIN=/.test(l))
      .map((l) => l.slice(l.indexOf('=') + 1));
    expect(values.length).toBeGreaterThanOrEqual(6);
    const seen = new Set<string>();
    for (const v of values) {
      const parsed = parseExplainString(v);
      expect(parsed.raw).toBe(v);
      for (const k of Object.keys(parsed)) if (k !== 'raw') seen.add(k);
    }
    for (const label of seen) expect(EXPLAIN_HINTS, label).toHaveProperty([label]);
    for (const label of ['considered', 'ok', 'too many Ns', 'no overlap of required point']) expect(seen.has(label), label).toBe(true);
  });
});

describe('parseExplainString', () => {
  it('parses counts, including labels with quotes and leading tallies', () => {
    expect(parseExplainString('considered 9120, low tm 3280, ok 1022')).toEqual({ raw: 'considered 9120, low tm 3280, ok 1022', considered: 9120, 'low tm': 3280, ok: 1022 });
    expect(parseExplainString("considered 50, high 3' stability 7, ok 3")["high 3' stability"]).toBe(7);
    expect(parseExplainString('sequencing locations 3, considered 10, ok 2')).toMatchObject({ 'sequencing locations': 3, considered: 10, ok: 2 });
    expect(parseExplainString('')).toEqual({ raw: '' });
    expect(parseExplainString(null)).toEqual({ raw: '' });
  });
});

describe('explainRows and summarizeExplain', () => {
  it('orders rejection reasons by count and puts tallies last', () => {
    const r = explainRows('considered 9120, too many Ns 10, low tm 3280, high tm 50, ok 0');
    expect(r.map((x) => x.label)).toEqual(['low tm', 'high tm', 'too many Ns', 'considered', 'ok']);
    expect(r[0]).toMatchObject({ count: 3280, informational: false });
    expect(r[0]!.hint).toContain('Melting temperature');
    expect(r[2]!.suggestion).toContain('repeat');
    expect(explainRows({ raw: 'x', 'mystery label': 4 })).toEqual([{ label: 'mystery label', count: 4, hint: null, suggestion: null, informational: false }]);
    expect(explainRows(null)).toEqual([]);
  });

  it('summarizes each side with its top reasons', () => {
    const s = summarizeExplain({
      left: { raw: 'considered 100, no overlap of required point 90, low tm 5, ok 0' },
      right: { raw: 'considered 80, ok 12', considered: 80, ok: 12 },
      pair: { raw: 'considered 0, ok 0', considered: 0, ok: 0 },
    });
    expect(s).toEqual([
      { side: 'left', considered: 100, ok: 0, reasons: [expect.objectContaining({ label: 'no overlap of required point', count: 90 }), expect.objectContaining({ label: 'low tm', count: 5 })] },
      { side: 'right', considered: 80, ok: 12, reasons: [] },
      { side: 'pair', considered: 0, ok: 0, reasons: [] },
    ]);
    expect(summarizeExplain(null)).toEqual([]);
  });
});
