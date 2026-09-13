/**
 * Real client against a running gramene-swagger with /primers (opt-in):
 *   PRIMERS_IT_BASE=http://localhost:50111/sorghum_v11 npm run test:it
 *   PRIMERS_IT_CHECKS=1 additionally submits one specificity check (BLAST on the server).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPrimersClient } from '../../src/client';
import { spansJunction } from '../../src/coords';
import { PrimersApiError } from '../../src/errors';
import { buildCheckRequest, buildDesignRequest } from '../../src/request';
import { initialDesignerState } from '../../src/state';
import type { CheckJob, DesignRequest, DesignResponse, GrameneGene, PrimerPair } from '../../src/types';
import { fixturePath } from '../paths';

const BASE = process.env.PRIMERS_IT_BASE ?? '';
const CHECKS = process.env.PRIMERS_IT_CHECKS === '1';
const client = createPrimersClient({ apiBase: BASE || 'http://127.0.0.1:9', timeouts: { design: 120_000, other: 30_000 } });

function assertPairInvariants(res: DesignResponse): void {
  for (const p of res.pairs) {
    expect(p.product_size, `pair ${p.rank}`).toBe(p.right.end - p.left.start + 1);
    expect(p.left.end - p.left.start + 1).toBe(p.left.len);
    expect(p.right.end - p.right.start + 1).toBe(p.right.len);
    expect(p.left.seq).toBe(p.left.seq.toUpperCase());
    expect(p.right.seq).toBe(p.right.seq.toUpperCase());
    expect(p.left.seq).toHaveLength(p.left.len);
  }
}

async function apiError(promise: Promise<unknown>): Promise<PrimersApiError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof PrimersApiError) return e;
    throw e;
  }
  throw new Error('expected PrimersApiError');
}

describe.skipIf(!BASE)('live API: genomes and design', () => {
  let gene200: GrameneGene;

  it('getGene returns the gene doc', async () => {
    const g = await client.getGene('SORBI_3001G000200');
    expect(g?._id).toBe('SORBI_3001G000200');
    gene200 = g as GrameneGene;
  });

  it('listGenomes: query genome first, no filesystem paths (V3 #9)', async () => {
    const res = await client.listGenomes('sorghum_bicolor');
    expect(res.genomes[0]?.system_name).toBe('sorghum_bicolor');
    expect(res.genomes[0]?.is_query).toBe(true);
    expect(res.counts.total).toBe(res.genomes.length);
    expect(JSON.stringify(res)).not.toMatch(/\/scratch|\.fa\.gz|\.nal|\.nin/);
    expect(res.genomes.find((g) => g.system_name === 'sorghum_rio')?.repeat_masking).toBe('soft_masked');
  });

  it('transcript SORBI_3001G000200 via buildDesignRequest (V3 #1)', async () => {
    const state = initialDesignerState({ gene: gene200, defaultMode: 'transcript' });
    const req = buildDesignRequest(state, { gene: gene200 });
    const res = await client.design(req);
    expect(res.template.length).toBe(1982);
    expect(res.template.features?.junctions?.slice(0, 3)).toEqual([397, 493, 597]);
    expect(res.pairs.length).toBeGreaterThan(0);
    expect(res.pairs.length).toBeLessThanOrEqual(5);
    assertPairInvariants(res);
    const min5 = res.settings?.params?.min_5_prime_overlap_of_junction ?? 7;
    const min3 = res.settings?.params?.min_3_prime_overlap_of_junction ?? 4;
    const junctions = res.template.features?.junctions ?? [];
    for (const p of res.pairs) {
      expect(p.product_size).toBeGreaterThanOrEqual(70);
      expect(p.product_size).toBeLessThanOrEqual(150);
      expect(p.left.junction || p.right.junction, `pair ${p.rank} spans a junction`).toBeTruthy();
      const spans = junctions.some((j) => spansJunction('left', p.left, j, min5, min3) || spansJunction('right', p.right, j, min5, min3));
      expect(spans).toBe(true);
    }
  });

  it('gene with flanks 200/100 (V3 #2)', async () => {
    const req = buildDesignRequest({ ...initialDesignerState({ gene: gene200 }), flankUp: 200, flankDown: 100 }, { gene: gene200 });
    const res = await client.design(req);
    expect(res.template).toMatchObject({ region: '1', start: 11080, end: 15099, strand: -1, length: 4020 });
    expect(res.template.features?.exons?.[0]).toMatchObject({ start: 201, end: 597 });
    expect(res.template.features?.cds?.start).toBe(499);
    assertPairInvariants(res);
  });

  it('+ strand gene SORBI_3001G000700 (V3 #4)', async () => {
    const res = await client.design(buildDesignRequest({ v: 1, mode: 'gene' }, { geneId: 'SORBI_3001G000700' }));
    expect(res.template.strand).toBe(1);
    assertPairInvariants(res);
  });

  it('region with target/included/excluded honours every bound (V3 #5)', async () => {
    const req: DesignRequest = {
      mode: 'region',
      system_name: 'sorghum_bicolor',
      region: { region: '1', start: 11080, end: 15099, strand: -1 },
      target: [499, 50],
      included: [100, 3000],
      excluded: [[1000, 40]],
      params: { min_size: 19, max_size: 22, min_tm: 58, max_tm: 61, min_gc: 40, max_gc: 60, max_tm_diff: 2, product_size_ranges: [[200, 300]] },
    };
    const res = await client.design(req);
    assertPairInvariants(res);
    for (const p of res.pairs as PrimerPair[]) {
      expect(p.left.start).toBeLessThanOrEqual(499);
      expect(p.right.end).toBeGreaterThanOrEqual(548);
      expect(p.left.start).toBeGreaterThanOrEqual(100);
      expect(p.right.end).toBeLessThanOrEqual(3099);
      for (const o of [p.left, p.right]) {
        expect(o.end < 1000 || o.start > 1039).toBe(true);
        expect(o.len).toBeGreaterThanOrEqual(19);
        expect(o.len).toBeLessThanOrEqual(22);
      }
      expect(p.product_size).toBeGreaterThanOrEqual(200);
      expect(p.product_size).toBeLessThanOrEqual(300);
    }
    expect(res.settings?.params).toMatchObject({ min_size: 19, max_size: 22 });
  });

  it('sequence with IUPAC codes warns IUPAC_CONVERTED (V3 #6)', async () => {
    const cdna = readFileSync(fixturePath('sequences', 'SORBI_3001G000200.1.cdna.txt'), 'utf8').trim();
    const seq = `>iupac\n${cdna.slice(700, 820)}RY${cdna.slice(822, 1100)}`;
    const res = await client.design({ mode: 'sequence', sequence: seq });
    expect(res.warnings.map((w) => w.code)).toContain('IUPAC_CONVERTED');
  });

  it('maps error responses (V3 #7)', async () => {
    expect(await apiError(client.design({ mode: 'gene', gene_id: 'NOPE' }))).toMatchObject({ status: 404, code: 'UNKNOWN_GENE' });
    expect(await apiError(client.design({ mode: 'gene', gene_id: 'X', bogus: 1 } as unknown as DesignRequest))).toMatchObject({ status: 400, code: 'VALIDATION' });
    expect(await apiError(client.design({ mode: 'transcript', gene_id: 'SORBI_3001G000200', params: { max_size: 24, min_5_prime_overlap_of_junction: 13 } }))).toMatchObject({ status: 400, code: 'INVALID_PARAMS' });
  });

  it('accepts every generated design contract fixture', async () => {
    const dir = fixturePath('contract', 'requests');
    for (const f of readdirSync(dir).filter((x) => x.startsWith('design-'))) {
      const body = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as DesignRequest;
      const res = await client.design({ ...body, template_only: true });
      expect(res.template.length, f).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!BASE || !CHECKS)('live API: check job', () => {
  it('P2 specificity: 202 then 200 with the same id, off-targets found', async () => {
    const gene = (await client.getGene('SORBI_3004G087700')) as GrameneGene;
    const g0 = gene.location.start;
    const pair: PrimerPair = {
      rank: 1,
      penalty: 0,
      product_size: 210,
      product_tm: null,
      left: { seq: 'GGACAGCTCCACAACATATCAG', start: 7423537 - g0 + 1, end: 7423558 - g0 + 1, len: 22, tm: 60, gc: 50 },
      right: { seq: 'GGACATTTGAAGCCCATGGCC', start: 7423726 - g0 + 1, end: 7423746 - g0 + 1, len: 21, tm: 60, gc: 57 },
      product: { start: 7423537 - g0 + 1, end: 7423746 - g0 + 1, genomic: { region: '4', start: 7423537, end: 7423746, strand: 1 } },
    };
    const req = buildCheckRequest({ mode: 'gene', systemName: 'sorghum_bicolor', geneId: 'SORBI_3004G087700', pairs: [pair] });
    const first = await client.submitCheck(req);
    const second = await client.submitCheck(req);
    expect(second.job_id).toBe(first.job_id);
    expect(second.created).toBe(false);
    const updates: CheckJob[] = [];
    const done = await client.pollCheck(first.job_id, { onUpdate: (j) => updates.push(j), pauseWhenHidden: false });
    expect(done.status).toBe('done');
    const spec = done.results?.specificity?.pairs.find((p) => p.id === 'P2');
    expect(spec?.verdict).toBe('off_targets');
    const offs = (spec?.off_targets ?? []).map((o) => `${o.region}:${o.start}-${o.end}`);
    expect(offs).toEqual(expect.arrayContaining(['4:7437317-7437526', '5:66890615-66890824']));
  });
});
