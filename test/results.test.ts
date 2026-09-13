import { describe, expect, it } from 'vitest';
import { isRepetitivePrimer, matchCheckResults, pairKey, submittedPairs } from '../src/results';
import type { PrimerPair } from '../src/types';
import { doneCheckJob, genePair, genePairs, P2_REQUEST, SEQS } from './fixtures/samples';

describe('matchCheckResults (by UPPERCASE sequence, never by rank)', () => {
  it('maps results to designed pairs and reports unchecked pairs', () => {
    const m = matchCheckResults(genePairs, doneCheckJob());
    expect(m.notChecked).toEqual([0]);
    expect(m.orphanIds).toEqual([]);
    const p2 = m.byRank.get(1)!;
    expect(p2.id).toBe('P2');
    expect(p2.specificity?.verdict).toBe('off_targets');
    expect(p2.specificity?.off_target_count).toBe(2);
    expect(p2.pangenome?.summary.amplifies).toBe(2);
    expect(p2.transcriptome).toBeNull();
    expect(p2.leftPrimer?.near_perfect_sites).toBe(2);
    const p3 = m.byRank.get(2)!;
    expect(p3.id).toBe('P3');
    expect(p3.rightPrimer?.repetitive).toBe(true);
  });

  it('still matches after a re-design changes ranks and letter case', () => {
    const redesigned: PrimerPair[] = [
      genePair(0, SEQS.P3_L.toLowerCase(), SEQS.P3_R, 7422482, 7423061),
      genePair(4, SEQS.P2_L, SEQS.P2_R.toLowerCase(), 7423537, 7423746),
      genePair(1, SEQS.P2_R, SEQS.P2_L, 7423537, 7423746),
    ];
    const m = matchCheckResults(redesigned, doneCheckJob());
    expect(m.byRank.get(0)?.id).toBe('P3');
    expect(m.byRank.get(4)?.id).toBe('P2');
    expect(m.byRank.get(4)?.specificity?.id).toBe('P2');
    expect(m.notChecked).toEqual([1]);
  });

  it('falls back to the saved submitted list and reports orphans', () => {
    const job = doneCheckJob();
    delete job.request;
    const submitted = [{ id: 'P2', left: SEQS.P2_L.toLowerCase(), right: SEQS.P2_R }, { id: 'P9', left: 'AAAA', right: 'CCCC' }];
    const m = matchCheckResults(genePairs, job, submitted);
    expect([...m.byRank.keys()]).toEqual([1]);
    expect(m.notChecked).toEqual([0, 2]);
    expect(m.orphanIds).toEqual(['P9']);
  });

  it('handles partial or missing results', () => {
    const job = doneCheckJob();
    job.results = { specificity: null, pangenome: null };
    const m = matchCheckResults(genePairs, job);
    expect(m.byRank.get(1)).toMatchObject({ id: 'P2', specificity: null, pangenome: null, leftPrimer: null });
    const none = matchCheckResults(genePairs, null);
    expect(none.notChecked).toEqual([0, 1, 2]);
  });

  it('helpers', () => {
    expect(pairKey('acgt', 'TtTt')).toBe('ACGT|TTTT');
    expect(submittedPairs({ pairs: [{ id: 'P1', left: 'acgt', right: 'ggcc' }] })).toEqual([{ id: 'P1', left: 'ACGT', right: 'GGCC' }]);
    expect(submittedPairs(P2_REQUEST).map((p) => p.id)).toEqual(['P2', 'P3']);
    const results = doneCheckJob().results;
    expect(isRepetitivePrimer(results, SEQS.P3_R.toLowerCase())).toBe(true);
    expect(isRepetitivePrimer(results, SEQS.P2_L)).toBe(false);
    expect(isRepetitivePrimer(null, SEQS.P2_L)).toBe(false);
  });
});
