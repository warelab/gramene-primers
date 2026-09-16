/**
 * `npm run fixtures`: writes builder output for every mode to
 * test/fixtures/contract/requests/*.json (plus manifest.json one level up).
 * Copy the requests into gramene-swagger test/primers/fixtures/contract/requests/,
 * where contract.test.js validates them against swagger.yaml with sway.
 *
 * File naming: `design-*.json` → POST /primers/design (PrimerDesignRequest),
 * `check-*.json` → POST /primers/check (PrimerCheckRequest). Each file is the raw body.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { effectiveDesignParams } from '../src/presets';
import { buildCheckRequest, buildDesignRequest, buildGenotypingCheckRequest, buildGenotypingRequest, CHECK_LIMITS, validateCheckParams } from '../src/request';
import { initialDesignerState } from '../src/state';
import type { CheckRequest, DesignRequest, GenotypingDesignRequest, GenotypingSet, PrimerDesignerState, PrimerPair, VariantEntry } from '../src/types';
import { readFileSync } from 'node:fs';
import { cleanSequenceInput, DESIGN_LIMITS, validateDesignParams, validateGenotypingParams } from '../src/validate';
import { gene200, gene46200, gene700, gene87700, genePair, genePairs, genomesResponse, qpcrCheckPair, readSequenceFixture, SEQS, sequencePair } from './fixtures/samples';
import { fixturePath } from './paths';

const REQ_DIR = fixturePath('contract', 'requests');
const MANIFEST = fixturePath('contract', 'manifest.json');

type Case =
  | { name: string; kind: 'design'; body: DesignRequest }
  | { name: string; kind: 'check'; body: CheckRequest }
  | { name: string; kind: 'genotyping'; body: GenotypingDesignRequest }
  /** GETs have no body: the wrapper form carries `query` instead. */
  | { name: string; kind: 'variants'; method: 'GET'; path: string; query: Record<string, unknown> };

const st = (ctx: Parameters<typeof initialDesignerState>[0], over: Partial<PrimerDesignerState>): PrimerDesignerState => ({ ...initialDesignerState(ctx), ...over });

function withSeqs(p: PrimerPair, left: string, right: string): PrimerPair {
  return { ...p, left: { ...p.left, seq: left }, right: { ...p.right, seq: right } };
}

// Real cDNA (SORBI_3001G000200.1) for the sequence-mode bodies: the server rejects a design whose template is shorter
// than every product_size_ranges start (spec §A.5), and api.it.test.ts designs every fixture live.
const CDNA_200_1 = readSequenceFixture('SORBI_3001G000200.1.cdna.txt');

const KASP_CAPTURE = JSON.parse(readFileSync(fixturePath('genotyping', 'capture-genotyping-design-rs871475760-kasp.json'), 'utf8')) as {
  response: { sets: GenotypingSet[]; variant: VariantEntry };
};
const KASP_SETS = KASP_CAPTURE.response.sets;
const KASP_VARIANT = KASP_CAPTURE.response.variant;

const cases: Case[] = [
  // ---- design ----
  { name: 'design-gene', kind: 'design', body: buildDesignRequest(st({ gene: gene200 }, { mode: 'gene', flankUp: 200, flankDown: 100, params: { product_size_ranges: [[300, 800]] } }), { gene: gene200 }) },
  { name: 'design-gene-id-only', kind: 'design', body: buildDesignRequest({ v: 1, mode: 'gene' }, { geneId: 'SORBI_3001G000700' }) },
  {
    name: 'design-gene-overlay-intervals',
    kind: 'design',
    body: buildDesignRequest(
      st({ gene: gene87700 }, { mode: 'gene', transcriptId: 'SORBI_3004G087700.3', flankUp: 1000, flankDown: 500, target: [2000, 300], included: [1000, 4000], excluded: [[2500, 40], [3000, 20]], avoidRepeats: true, repeatMaskMode: 'three_prime', params: { num_return: 10, opt_tm: 61, max_tm: 64 } }),
      { gene: gene87700 },
    ),
  },
  { name: 'design-transcript', kind: 'design', body: buildDesignRequest(st({ gene: gene200 }, { mode: 'transcript', preset: 'qpcr' }), { gene: gene200 }) },
  { name: 'design-transcript-single-exon', kind: 'design', body: buildDesignRequest(st({ gene: gene46200 }, { mode: 'transcript', preset: 'qpcr', transcriptId: 'SORBI_3001G046200.2', junctionSpanning: false }), { gene: gene46200 }) },
  { name: 'design-transcript-pcr-preset', kind: 'design', body: buildDesignRequest(st({ gene: gene700 }, { mode: 'transcript', preset: 'pcr', transcriptId: 'SORBI_3001G000700.1' }), { gene: gene700 }) },
  {
    name: 'design-transcript-all-params',
    kind: 'design',
    body: buildDesignRequest(
      st({ gene: gene87700 }, {
        mode: 'transcript',
        preset: 'qpcr',
        transcriptId: 'SORBI_3004G087700.3',
        params: {
          opt_size: 21, min_size: 19, max_size: 26, opt_tm: 61, min_tm: 59, max_tm: 63, opt_gc: 50, min_gc: 40, max_gc: 60, max_tm_diff: 1.5,
          max_poly_x: 3, gc_clamp: 1, max_end_stability: 9, max_ns: 1, salt_monovalent: 50, salt_divalent: 3, dntp_conc: 0.8, dna_conc: 250,
          num_return: 20, min_3_prime_overlap_of_junction: 5, min_5_prime_overlap_of_junction: 8, product_size_ranges: [[80, 120], [120, 200]],
        },
      }),
      { gene: gene87700 },
    ),
  },
  {
    name: 'design-region',
    kind: 'design',
    body: buildDesignRequest(
      st({ systemName: 'sorghum_bicolor' }, {
        mode: 'region',
        region: { region: '1', start: 11080, end: 15099, strand: -1 },
        target: [499, 50],
        included: [100, 3000],
        excluded: [[1000, 40]],
        params: { min_size: 19, max_size: 22, min_tm: 58, max_tm: 61, min_gc: 40, max_gc: 60, max_tm_diff: 2, product_size_ranges: [[200, 300]] },
      }),
      { systemName: 'sorghum_bicolor' },
    ),
  },
  { name: 'design-region-softmask', kind: 'design', body: buildDesignRequest(st({ systemName: 'sorghum_tx436pac' }, { mode: 'region', region: { region: '4', start: 7547610, end: 7564601, strand: 1 }, avoidRepeats: true, repeatMaskMode: 'n_mask' }), {}) },
  { name: 'design-sequence', kind: 'design', body: buildDesignRequest({ v: 1, mode: 'sequence', sequence: `>amp\n${CDNA_200_1.slice(700, 820)}RY${CDNA_200_1.slice(822, 1100)}\n`, systemName: 'sorghum_bicolor' }, {}) },
  { name: 'design-sequence-template-only', kind: 'design', body: buildDesignRequest({ v: 1, mode: 'sequence', sequence: `acgtacgtac${CDNA_200_1.slice(1100, 1290)}`, avoidRepeats: true, repeatMaskMode: 'three_prime' }, { templateOnly: true }) },

  // ---- check ----
  { name: 'check-gene-specificity', kind: 'check', body: buildCheckRequest({ mode: 'gene', systemName: 'sorghum_bicolor', geneId: 'SORBI_3004G087700', pairs: [genePairs[1]!] }) },
  { name: 'check-gene-three-pairs', kind: 'check', body: buildCheckRequest({ mode: 'gene', systemName: 'sorghum_bicolor', geneId: 'SORBI_3004G087700', pairs: genePairs }) },
  {
    name: 'check-gene-pangenome-subset',
    kind: 'check',
    body: buildCheckRequest({ mode: 'gene', systemName: 'sorghum_bicolor', geneId: 'SORBI_3004G087700', pairs: [genePairs[2]!], checks: ['specificity', 'pangenome'], genomes: ['sorghum_353', 'sorghum_grassl', 'sorghum_leoti'], allGenomes: [...genomesResponse().genomes, { ...genomesResponse().genomes[1]!, system_name: 'sorghum_rio' }] }),
  },
  {
    name: 'check-gene-pangenome-all',
    kind: 'check',
    body: buildCheckRequest({ mode: 'gene', systemName: 'sorghum_bicolor', geneId: 'SORBI_3004G087700', pairs: [genePairs[2]!], checks: ['pangenome'], genomes: ['sorghum_353', 'sorghum_grassl', 'sorghum_leoti'], allGenomes: genomesResponse() }),
  },
  {
    name: 'check-region-params',
    kind: 'check',
    body: buildCheckRequest({
      mode: 'region',
      systemName: 'sorghum_bicolor',
      pairs: [genePairs[0]!],
      params: { max_product_size: 3000, ignore_mismatches: 5, max_amplifying_mismatches: 2, min_total_mismatches: 1, min_3p_mismatches: 1, three_prime_window: 4, include_unlikely: true, repeat_site_threshold: 10 },
    }),
  },
  {
    name: 'check-region-large-expected',
    kind: 'check',
    body: buildCheckRequest({ mode: 'region', systemName: 'sorghum_bicolor', pairs: [genePair(0, SEQS.P2_L, SEQS.P1_R, 7422190, 7428000)] }),
  },
  { name: 'check-transcript', kind: 'check', body: buildCheckRequest({ mode: 'transcript', systemName: 'sorghum_bicolor', geneId: 'SORBI_3004G087700', transcriptId: 'SORBI_3004G087700.3', pairs: [qpcrCheckPair] }) },
  {
    name: 'check-transcript-pangenome',
    kind: 'check',
    body: buildCheckRequest({ mode: 'transcript', systemName: 'sorghum_bicolor', geneId: 'SORBI_3004G087700', transcriptId: 'SORBI_3004G087700.3', pairs: [qpcrCheckPair], checks: ['pangenome'], genomes: ['sorghum_353'], allGenomes: genomesResponse() }),
  },
  {
    name: 'check-sequence-sensitivity',
    kind: 'check',
    body: buildCheckRequest({
      mode: 'sequence',
      systemName: 'sorghum_bicolor',
      pairs: [withSeqs(sequencePair(0, 210), 'GGACAGATCCACATCATATC', SEQS.P2_R), withSeqs(sequencePair(1, 210), 'GGACAGCTCCACAACATTCAG', SEQS.P2_R), withSeqs(sequencePair(2, 210), SEQS.P5_L, SEQS.P2_R)],
    }),
  },
  { name: 'check-sequence-raised', kind: 'check', body: buildCheckRequest({ mode: 'sequence', systemName: 'sorghum_bicolor', pairs: [sequencePair(0, 5000)] }) },
  {
    name: 'check-ten-pairs',
    kind: 'check',
    body: buildCheckRequest({
      mode: 'gene',
      systemName: 'sorghum_bicolor',
      geneId: 'SORBI_3004G087700',
      pairs: Array.from({ length: 10 }, (_, i) => withSeqs(genePair(i, SEQS.P2_L, SEQS.P2_R, 7423537, 7423746), `${'ACGT'.repeat(4)}${'ACGT'.slice(0, (i % 4) + 1)}${'T'.repeat(i)}`, `${'TTGCA'.repeat(3)}${'G'.repeat(i + 1)}`)),
    }),
  },

  // ---- genotyping design ----
  { name: 'genotyping-design-id', kind: 'genotyping', body: buildGenotypingRequest({ v: 1, mode: 'genotyping', systemName: 'sorghum_bicolor', genotyping: { variantId: 'rs871475760' } })! },
  { name: 'genotyping-design-vcf', kind: 'genotyping', body: buildGenotypingRequest({ v: 1, mode: 'genotyping', systemName: 'sorghum_bicolor', genotyping: { variantKey: '1:11109:C:A' } })! },
  {
    name: 'genotyping-design-aspcr',
    kind: 'genotyping',
    body: buildGenotypingRequest({ v: 1, mode: 'genotyping', systemName: 'sorghum_bicolor', genotyping: { variantKey: '1:11109:C:A', assay: { type: 'as_pcr', orientation: 'forward', deliberate_mismatch: 'auto', num_sets: 3 } } })!,
  },
  {
    name: 'genotyping-design-manual-deletion',
    kind: 'genotyping',
    body: buildGenotypingRequest({ v: 1, mode: 'genotyping', systemName: 'sorghum_bicolor', genotyping: { manual: { region: '1', position: 11282, ref: 'CA', alt: 'C' } } })!,
  },
  {
    name: 'genotyping-design-template-only',
    kind: 'genotyping',
    body: buildGenotypingRequest({ v: 1, mode: 'genotyping', systemName: 'sorghum_bicolor', genotyping: { variantKey: '1:11109:C:A' } }, { templateOnly: true })!,
  },
  {
    name: 'genotyping-design-all-fields',
    kind: 'genotyping',
    body: buildGenotypingRequest({
      v: 1,
      mode: 'genotyping',
      systemName: 'sorghum_bicolor',
      genotyping: {
        variantKey: '1:11109:C:A',
        label: 'contract',
        avoidRepeats: true,
        repeatMaskMode: 'three_prime',
        assay: { type: 'kasp', orientation: 'both', tails: 'ref_hex_alt_fam', deliberate_mismatch: 'auto', mismatch_position: 3, num_sets: 4, max_relaxation: 1, neighbour_policy: 'ignore' },
        params: { opt_size: 22, min_size: 18, max_size: 30, opt_tm: 60, min_tm: 57, max_tm: 63, min_gc: 30, max_gc: 70, max_tm_diff: 3, max_poly_x: 5, product_size_ranges: [[61, 120]] },
      },
    })!,
  },

  // ---- genotyping check (the design hands back a ready body) ----
  {
    name: 'check-genotyping-two-sets',
    kind: 'check',
    body: buildGenotypingCheckRequest({ sets: KASP_SETS, variant: KASP_VARIANT, systemName: 'sorghum_bicolor', mode: 'region', checks: ['specificity', 'pangenome'] }),
  },
  {
    name: 'check-genotyping-gene-mode',
    kind: 'check',
    body: buildGenotypingCheckRequest({ sets: KASP_SETS.slice(0, 1), variant: KASP_VARIANT, systemName: 'sorghum_bicolor', mode: 'gene', geneId: 'SORBI_3001G000200', checks: ['specificity'] }),
  },

  // ---- variant lookups (GET: query, no body) ----
  { name: 'variants-list', kind: 'variants', method: 'GET', path: '/primers/variants', query: { system_name: 'sorghum_bicolor', region: '1', start: 11180, end: 11290, types: 'snv,deletion', include_ems: false, limit: 500 } },
  { name: 'variants-lookup', kind: 'variants', method: 'GET', path: '/primers/variants/{id}', query: { id: 'tmp_1_11502_C_CGT', system_name: 'sorghum_bicolor' } },
];

const DESIGN_KEYS = new Set(['mode', 'gene_id', 'transcript_id', 'system_name', 'region', 'sequence', 'flank_up', 'flank_down', 'target', 'included', 'excluded', 'avoid_repeats', 'repeat_mask_mode', 'junction_spanning', 'template_only', 'params']);
const CHECK_KEYS = new Set(['system_name', 'mode', 'gene_id', 'transcript_id', 'checks', 'genomes', 'params', 'pairs', 'genotyping']);
const GENOTYPING_KEYS = new Set(['system_name', 'variant', 'assay', 'params', 'avoid_repeats', 'repeat_mask_mode', 'label', 'template_only']);

describe('contract request fixtures', () => {
  it('builds schema-shaped bodies for every mode', () => {
    for (const c of cases) {
      if (c.kind === 'variants') {
        // A GET has no body; the wrapper carries its query.
        expect(JSON.parse(JSON.stringify(c.query)), c.name).toEqual(c.query);
        expect(c.path.startsWith('/primers/variants'), c.name).toBe(true);
        expect(c.query.system_name, c.name).toBe('sorghum_bicolor');
        continue;
      }
      const body = c.body as unknown as Record<string, unknown>;
      expect(JSON.parse(JSON.stringify(body)), c.name).toEqual(body);
      if (c.kind === 'genotyping') {
        for (const k of Object.keys(body)) expect(GENOTYPING_KEYS.has(k), `${c.name}: ${k}`).toBe(true);
        expect(c.body.system_name).toMatch(DESIGN_LIMITS.systemNamePattern);
        expect(validateGenotypingParams(c.body.params), c.name).toEqual([]);
        continue;
      }
      if (c.kind === 'design') {
        for (const k of Object.keys(body)) expect(DESIGN_KEYS.has(k), `${c.name}: ${k}`).toBe(true);
        const d = c.body;
        if (d.system_name) expect(d.system_name).toMatch(DESIGN_LIMITS.systemNamePattern);
        if (d.sequence) expect(d.sequence.length).toBeLessThanOrEqual(DESIGN_LIMITS.maxSequenceInput);
        const effective = effectiveDesignParams(d.mode === 'transcript' ? 'qpcr' : 'pcr', d.params);
        // Sequence mode knows its template length up front; mirror the server's product-range-fits check (spec §A.5).
        const cleaned = d.mode === 'sequence' && d.sequence ? cleanSequenceInput(d.sequence) : null;
        if (cleaned) expect(cleaned.ok, c.name).toBe(true);
        expect(validateDesignParams(effective, { mode: d.mode, junctionSpanning: d.junction_spanning, templateLength: cleaned?.length }), c.name).toEqual([]);
      } else {
        for (const k of Object.keys(body)) expect(CHECK_KEYS.has(k), `${c.name}: ${k}`).toBe(true);
        const r = c.body as CheckRequest;
        expect(r.pairs.length).toBeGreaterThanOrEqual(1);
        expect(r.pairs.length).toBeLessThanOrEqual(CHECK_LIMITS.maxPairs);
        for (const p of r.pairs) {
          expect(Object.keys(p).every((k) => ['id', 'left', 'right', 'expected'].includes(k))).toBe(true);
          expect(p.id).toMatch(CHECK_LIMITS.pairIdPattern);
          expect(p.left).toMatch(CHECK_LIMITS.primerPattern);
          expect(p.right).toMatch(CHECK_LIMITS.primerPattern);
          if (p.expected) expect(Object.keys(p.expected).sort()).toEqual(['end', 'region', 'start']);
        }
        expect(validateCheckParams(r.params), c.name).toEqual([]);
        expect(r.checks?.[0]).toBe('specificity');
      }
    }
    expect(cases.filter((c) => c.kind === 'design').map((c) => (c.body as DesignRequest).mode)).toEqual(expect.arrayContaining(['gene', 'transcript', 'region', 'sequence']));
    expect(cases.filter((c) => c.kind === 'check').map((c) => (c.body as CheckRequest).mode)).toEqual(expect.arrayContaining(['gene', 'transcript', 'region', 'sequence']));
  });

  it('writes test/fixtures/contract/requests/*.json and manifest.json', () => {
    mkdirSync(REQ_DIR, { recursive: true });
    const names = new Set(cases.map((c) => `${c.name}.json`));
    for (const f of readdirSync(REQ_DIR)) {
      if (/^(design|check|genotyping|variants)-.*\.json$/.test(f) && !names.has(f)) rmSync(join(REQ_DIR, f));
    }
    for (const c of cases) {
      const contents = c.kind === 'variants' ? { method: c.method, path: c.path, query: c.query, expect: 'valid' } : c.body;
      writeFileSync(join(REQ_DIR, `${c.name}.json`), `${JSON.stringify(contents, null, 2)}\n`);
    }
    const PATHS = { design: '/primers/design', check: '/primers/check', genotyping: '/primers/genotyping/design' } as const;
    const DEFS = { design: 'PrimerDesignRequest', check: 'PrimerCheckRequest', genotyping: 'PrimerGenotypingRequest' } as const;
    const manifest = cases.map((c) =>
      c.kind === 'variants'
        ? { file: `requests/${c.name}.json`, method: c.method, path: c.path }
        : { file: `requests/${c.name}.json`, method: 'POST', path: PATHS[c.kind], definition: DEFS[c.kind] },
    );
    writeFileSync(MANIFEST, `${JSON.stringify({ generator: 'gramene-primers test/fixtures.gen.test.ts', requests: manifest }, null, 2)}\n`);
    expect(readdirSync(REQ_DIR).filter((f) => f.endsWith('.json')).sort()).toEqual([...names].sort());
  });
});
