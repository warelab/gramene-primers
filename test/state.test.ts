import { describe, expect, it } from 'vitest';
import { availableModes, designerIdentity, hashString, initialDesignerState, normalizeDesignerState, toPersistedState } from '../src/state';
import type { PrimerDesignerState } from '../src/types';
import { gene200 } from './fixtures/samples';

describe('availableModes', () => {
  it('requires a gene for gene/transcript and a genome for region', () => {
    expect(availableModes({ gene: gene200 })).toEqual(['gene', 'transcript', 'region', 'sequence']);
    expect(availableModes({ geneId: 'X' })).toEqual(['gene', 'transcript', 'sequence']);
    expect(availableModes({ systemName: 'sorghum_bicolor' })).toEqual(['region', 'sequence']);
    expect(availableModes({})).toEqual(['sequence']);
    expect(availableModes({ gene: gene200, modes: ['transcript', 'gene', 'bogus' as never] })).toEqual(['transcript', 'gene']);
    expect(availableModes({ modes: ['gene'] })).toEqual(['sequence']);
  });
});

describe('initialDesignerState', () => {
  it('prefills from the gene and uses the mode preset', () => {
    const s = initialDesignerState({ gene: gene200 });
    expect(s).toEqual({
      v: 1,
      mode: 'gene',
      preset: 'pcr',
      flankUp: 0,
      flankDown: 0,
      junctionSpanning: true,
      avoidRepeats: false,
      repeatMaskMode: 'n_mask',
      designed: false,
      checkedRanks: [],
      check: { checks: ['specificity'] },
      view: { resultsTab: 'pairs' },
      systemName: 'sorghum_bicolor',
      region: { region: '1', start: 11180, end: 14899, strand: -1 },
    });
  });

  it('honours defaultMode, defaultParams and persistSequence', () => {
    const s = initialDesignerState({ gene: gene200, defaultMode: 'transcript', defaultParams: { num_return: 10, opt_tm: 'x' as never } });
    expect(s.mode).toBe('transcript');
    expect(s.preset).toBe('qpcr');
    expect(s.params).toEqual({ num_return: 10 });
    expect(initialDesignerState({ defaultMode: 'gene', sequence: 'ACGT' })).toMatchObject({ mode: 'sequence', sequence: 'ACGT' });
    expect(initialDesignerState({ sequence: 'ACGT', persistSequence: false }).sequence).toBeUndefined();
  });
});

describe('normalizeDesignerState', () => {
  const ctx = { gene: gene200 };

  it('returns the initial state for non-v1 input', () => {
    const init = initialDesignerState(ctx);
    expect(normalizeDesignerState(null, ctx)).toEqual(init);
    expect(normalizeDesignerState('x', ctx)).toEqual(init);
    expect(normalizeDesignerState({ v: 2, mode: 'region' }, ctx)).toEqual(init);
  });

  it('round-trips a valid state unchanged and stays JSON-serializable', () => {
    const saved: PrimerDesignerState = {
      v: 1,
      mode: 'transcript',
      preset: 'pcr',
      transcriptId: 'SORBI_3001G000200.1',
      flankUp: 200,
      flankDown: 100,
      region: { region: '1', start: 11080, end: 15099, strand: -1 },
      systemName: 'sorghum_bicolor',
      target: [499, 50],
      included: [100, 3000],
      excluded: [[1000, 40]],
      junctionSpanning: false,
      avoidRepeats: true,
      repeatMaskMode: 'three_prime',
      params: { max_size: 24, product_size_ranges: [[70, 150], [200, 300]] },
      designed: true,
      selectedRank: 2,
      checkedRanks: [0, 2],
      check: {
        checks: ['specificity', 'pangenome'],
        genomes: ['sorghum_353'],
        params: { ignore_mismatches: 5, max_amplifying_mismatches: 2, include_unlikely: true },
        jobId: '9f2c0a4be1d34c7a8e5f00112233aabb',
        submitted: [{ id: 'P1', left: 'ACGTACGTACGTACGTACGT', right: 'TTGCATGCATGCATGCATGC' }],
      },
      view: { resultsTab: 'pangenome', explainOpen: false },
    };
    const n = normalizeDesignerState(JSON.parse(JSON.stringify(saved)), ctx);
    expect(n).toEqual(saved);
    expect(JSON.parse(JSON.stringify(n))).toEqual(n);
  });

  it('drops or clamps invalid fields', () => {
    const n = normalizeDesignerState(
      {
        v: 1,
        mode: 'gene',
        preset: 'weird',
        flankUp: -5,
        flankDown: 20000.4,
        region: { region: '', start: 1, end: 2 },
        systemName: '../etc',
        target: [0, 5],
        included: ['1', 2],
        excluded: [...Array.from({ length: 60 }, (_, i) => [i + 1, 1]), 'x'],
        repeatMaskMode: 'hard',
        params: { max_size: 'big', min_size: 18.5, num_return: 3, product_size_ranges: [[70, 150.5]] },
        selectedRank: -1,
        checkedRanks: [3, 1, 3, -2, 1.5],
        check: { checks: ['transcriptome', 'pangenome'], genomes: ['ok_1', 'Bad', 7], jobId: 'nothex', submitted: [{ id: 'P1', left: 'acgt', right: 'tttt' }, { id: 2 }], params: { max_product_size: '9' } },
        view: { resultsTab: 'nope', explainOpen: 'yes' },
      },
      ctx,
    );
    expect(n.preset).toBe('pcr');
    expect(n.flankUp).toBe(0);
    expect(n.flankDown).toBe(10000);
    expect(n.region).toEqual({ region: '1', start: 11180, end: 14899, strand: -1 });
    expect(n.systemName).toBe('sorghum_bicolor');
    expect(n.target).toBeUndefined();
    expect(n.included).toBeUndefined();
    expect(n.excluded).toHaveLength(50);
    expect(n.repeatMaskMode).toBe('n_mask');
    expect(n.params).toEqual({ num_return: 3 });
    expect(n.selectedRank).toBeUndefined();
    expect(n.checkedRanks).toEqual([1, 3]);
    expect(n.check).toEqual({ checks: ['specificity', 'pangenome'], genomes: ['ok_1'], submitted: [{ id: 'P1', left: 'ACGT', right: 'TTTT' }] });
    expect(n.view).toEqual({ resultsTab: 'pairs' });
  });

  it('falls back to an available mode and drops the sequence when not persisted', () => {
    const n = normalizeDesignerState({ v: 1, mode: 'gene', sequence: 'ACGT' }, { systemName: 'sorghum_bicolor', persistSequence: false });
    expect(n.mode).toBe('region');
    expect(n.sequence).toBeUndefined();
  });
});

describe('toPersistedState and identity', () => {
  it('toPersistedState deep-copies and optionally drops the sequence', () => {
    const s: PrimerDesignerState = { v: 1, mode: 'sequence', sequence: 'ACGT', excluded: [[1, 2]] };
    const p = toPersistedState(s, { persistSequence: false });
    expect(p).toEqual({ v: 1, mode: 'sequence', excluded: [[1, 2]] });
    (p.excluded as [number, number][])[0]![0] = 9;
    expect(s.excluded?.[0]?.[0]).toBe(1);
    expect(toPersistedState(s).sequence).toBe('ACGT');
  });

  it('designerIdentity prefers gene._id, then geneId, then genome+region, then the sequence hash', () => {
    expect(designerIdentity({ gene: gene200, geneId: 'OTHER' })).toBe('gene:SORBI_3001G000200');
    expect(designerIdentity({ geneId: 'SORBI_3001G000200' })).toBe('gene:SORBI_3001G000200');
    expect(designerIdentity({ systemName: 'sorghum_bicolor', region: { region: '1', start: 5, end: 10, strand: -1 } })).toBe('region:sorghum_bicolor:1:5-10:-1');
    expect(designerIdentity({ systemName: 'sorghum_bicolor', region: { region: '1', start: 5, end: 10 } })).toBe('region:sorghum_bicolor:1:5-10:1');
    const a = designerIdentity({ sequence: 'ACGTACGT' });
    expect(a).toBe(designerIdentity({ sequence: 'ACGTACGT' }));
    expect(a).not.toBe(designerIdentity({ sequence: 'ACGTACGA' }));
    expect(designerIdentity({})).toBe('empty');
  });

  it('hashString is FNV-1a 32', () => {
    expect(hashString('')).toBe('811c9dc5');
    expect(hashString('a')).toBe('e40c292c');
    expect(hashString('foobar')).toBe('bf9cf968');
  });
});
