import type { DesignExplain, ExplainCounts } from './types';

export interface ExplainHint {
  /** Plain-language description of the rejection. */
  hint: string;
  /** What to try; omitted for informational labels. */
  suggestion?: string;
  /** The label is a tally, not a rejection reason (`considered`, `ok`). */
  informational?: boolean;
}

/**
 * Hints keyed by the exact Primer3 2.6.1 explain labels
 * (`p3_oligo_explain_string` / `p3_pair_explain_string` in libprimer3.cc),
 * including Primer3's own spelling `low faction bound`.
 */
export const EXPLAIN_HINTS: Readonly<Record<string, ExplainHint>> = Object.freeze({
  considered: { hint: 'Candidates examined.', informational: true },
  ok: { hint: 'Candidates that passed every filter.', informational: true },
  'sequencing locations': { hint: 'Sequencing-primer locations evaluated.', informational: true },
  // oligo (left/right) labels
  'would not amplify any of the ORF': { hint: 'The primer would not amplify any part of the ORF.' },
  'too many Ns': {
    hint: 'The primer overlaps N bases — ambiguity codes or masked repeats.',
    suggestion: 'Turn off repeat avoidance, switch the mask mode to 3′ end only, or allow Ns.',
  },
  'overlap target': { hint: 'The primer would overlap the target region.', suggestion: 'Shrink the target or widen the template.' },
  'overlap excluded region': { hint: 'The primer overlaps an excluded region.', suggestion: 'Remove or shrink excluded intervals.' },
  'GC content failed': { hint: 'GC% outside the allowed range.', suggestion: 'Widen the GC range.' },
  'GC clamp failed': { hint: 'Not enough G/C at the 3′ end.', suggestion: 'Lower the GC clamp.' },
  'low tm': { hint: 'Melting temperature below the minimum.', suggestion: 'Lower the minimum Tm or allow longer primers.' },
  'high tm': { hint: 'Melting temperature above the maximum.', suggestion: 'Raise the maximum Tm or allow shorter primers.' },
  'low faction bound': { hint: 'Too small a fraction of primer bound at the annealing temperature.' },
  'high fraction bound': { hint: 'Too large a fraction of primer bound at the annealing temperature.' },
  'high any compl': { hint: 'Self-complementarity (any position) is too stable.', suggestion: 'Try another region.' },
  'high end compl': { hint: '3′ self-complementarity is too stable (primer-dimer risk).', suggestion: 'Try another region.' },
  'high hairpin stability': { hint: 'The primer forms a stable hairpin.', suggestion: 'Try another region.' },
  'high repeat similarity': { hint: 'Too similar to a mispriming library sequence.' },
  'long poly-x seq': { hint: 'Mononucleotide run longer than allowed.', suggestion: 'Raise max poly-X.' },
  'low sequence quality': { hint: 'Sequence quality below the minimum.' },
  "high 3' stability": { hint: '3′ end stability above the maximum.', suggestion: 'Raise max end stability.' },
  'high template mispriming score': { hint: 'The primer may misprime elsewhere in the template.' },
  "lowercase masking of 3' end": {
    hint: 'The 3′ end falls in a masked (lowercase) repeat.',
    suggestion: 'Turn off repeat avoidance or pick a less repetitive region.',
  },
  'failed must_match requirements': { hint: 'Did not match the required 5′/3′ pattern.' },
  'not in any ok left region': { hint: 'Outside every allowed left-primer region.' },
  'not in any ok right region': { hint: 'Outside every allowed right-primer region.' },
  'no overlap of required point': {
    hint: 'Does not span an exon–exon junction by the required overlap.',
    suggestion: 'Lower the junction overlaps, pick another transcript, or turn off junction spanning.',
  },
  // pair labels
  'no target': { hint: 'The pair does not flank the target.', suggestion: 'Move or shrink the target.' },
  'unacceptable product size': { hint: 'Product size outside every allowed range.', suggestion: 'Widen the product size ranges.' },
  'low product Tm': { hint: 'Product Tm below the minimum.' },
  'high product Tm': { hint: 'Product Tm above the maximum.' },
  'tm diff too large': { hint: 'Left/right Tm difference is too large.', suggestion: 'Raise the max Tm difference.' },
  'no internal oligo': { hint: 'No acceptable internal oligo.' },
  'high mispriming library similarity': { hint: 'The pair is too similar to a mispriming library.' },
  'primer in pair overlaps a primer in a better pair': { hint: 'A primer is shared with a better-ranked pair.' },
  'not in any ok region': { hint: 'The pair lies outside the allowed regions.' },
  'left primer to right of right primer': { hint: 'Left primer lies to the right of the right primer.' },
});

/** Parses `considered 9120, low tm 3280, ok 1022` into `{raw, considered: 9120, 'low tm': 3280, ok: 1022}`. */
export function parseExplainString(raw: string | null | undefined): ExplainCounts {
  const out: ExplainCounts = { raw: raw ?? '' };
  for (const part of (raw ?? '').split(',')) {
    const m = /^\s*(.*?)\s+(\d+)\s*$/.exec(part);
    if (m && m[1]) out[m[1]] = Number(m[2]);
  }
  return out;
}

export interface ExplainRow {
  label: string;
  count: number;
  hint: string | null;
  suggestion: string | null;
  informational: boolean;
}

/** Rows of one explain block, rejection reasons first (by count, descending). */
export function explainRows(counts: ExplainCounts | string | null | undefined): ExplainRow[] {
  if (!counts) return [];
  const parsed = typeof counts === 'string' ? parseExplainString(counts) : counts;
  const rows: ExplainRow[] = [];
  for (const [label, value] of Object.entries(parsed)) {
    if (label === 'raw' || typeof value !== 'number') continue;
    const h = EXPLAIN_HINTS[label];
    rows.push({ label, count: value, hint: h?.hint ?? null, suggestion: h?.suggestion ?? null, informational: !!h?.informational });
  }
  return rows.sort((a, b) => Number(a.informational) - Number(b.informational) || b.count - a.count);
}

export interface ExplainSummaryItem {
  side: 'left' | 'right' | 'pair';
  considered: number | null;
  ok: number | null;
  /** Largest rejection reasons first. */
  reasons: ExplainRow[];
}

/** Per-side summary for the ExplainPanel; sides with `ok === 0` are the likely culprits. */
export function summarizeExplain(explain: DesignExplain | null | undefined, maxReasons = 3): ExplainSummaryItem[] {
  if (!explain) return [];
  const out: ExplainSummaryItem[] = [];
  for (const side of ['left', 'right', 'pair'] as const) {
    const block = explain[side];
    if (!block) continue;
    const parsed = typeof block.raw === 'string' && Object.keys(block).length <= 1 ? parseExplainString(block.raw) : block;
    const considered = typeof parsed.considered === 'number' ? parsed.considered : null;
    const ok = typeof parsed.ok === 'number' ? parsed.ok : null;
    const reasons = explainRows(parsed).filter((r) => !r.informational && r.count > 0).slice(0, maxReasons);
    out.push({ side, considered, ok, reasons });
  }
  return out;
}
