#!/usr/bin/env node
// Captures real /primers API responses into test/fixtures/api/ for component tests
// and the playground's ?api=mock mode. Run against the dev server, never production:
//
//   PRIMERS_IT_BASE=http://localhost:50111/sorghum_v11 node scripts/capture-fixtures.mjs            design, genomes, genes, errors
//   PRIMERS_IT_BASE=... node scripts/capture-fixtures.mjs --checks                                   also finished check jobs (BLAST)
//   PRIMERS_IT_BASE=... node scripts/capture-fixtures.mjs --only design-transcript-SORBI_3001G000200
//
// Check captures expect a fresh job: when POST /primers/check answers anything but 202 (for example 200 because
// `npm run test:it` or an earlier capture already created the same deterministic job id), the script warns and
// exits non-zero. Delete the job from the dev store first (primers:<site>:job:<id>, primers:<site>:result:<id>,
// ZREM primers:<site>:finished <id>) or pass --allow-existing to accept a 200 submit.
// A stale <name>-running.json is deleted before polling, so a job that finishes between polls cannot leave a
// running capture from an earlier run.
//
// Each file is {captured_at, base, method, path, request, status, headers, body}.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'test/fixtures/api');
const BASE = (process.env.PRIMERS_IT_BASE || '').replace(/\/+$/, '');
const argv = process.argv.slice(2);
const withChecks = argv.includes('--checks');
const allowExisting = argv.includes('--allow-existing');
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx >= 0 ? new Set((argv[onlyIdx + 1] || '').split(',').filter(Boolean)) : null;
const POLL_MS = 2000;
const CHECK_TIMEOUT_MS = 30 * 60 * 1000;

if (!BASE) {
  console.error('capture-fixtures: set PRIMERS_IT_BASE, e.g. http://localhost:50111/sorghum_v11');
  process.exit(2);
}
if (/data\.sorghumbase\.org|:50011\b/.test(BASE)) {
  console.error('capture-fixtures: refusing to run against a production API; use the dev server');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });

async function http(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { non_json_body: text.slice(0, 2000) };
  }
  return {
    status: res.status,
    headers: { 'cache-control': res.headers.get('cache-control'), 'retry-after': res.headers.get('retry-after') },
    body: parsed,
  };
}

function save(name, method, path, request, result) {
  const file = resolve(OUT, `${name}.json`);
  const doc = { captured_at: new Date().toISOString(), base: BASE, method, path, request: request ?? null, ...result };
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  const pairs = Array.isArray(result.body?.pairs) ? ` pairs=${result.body.pairs.length}` : '';
  console.log(`  ${String(result.status).padEnd(3)} ${name}${pairs}`);
}

const wanted = (name) => !only || only.has(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdna = readFileSync(resolve(root, 'test/fixtures/sequences/SORBI_3001G000200.1.cdna.txt'), 'utf8').trim();

const designs = {
  'design-transcript-SORBI_3001G000200': { mode: 'transcript', gene_id: 'SORBI_3001G000200', junction_spanning: true },
  'design-transcript-SORBI_3001G046200-canonical': { mode: 'transcript', gene_id: 'SORBI_3001G046200' },
  'design-transcript-SORBI_3001G046200.1': { mode: 'transcript', gene_id: 'SORBI_3001G046200', transcript_id: 'SORBI_3001G046200.1', junction_spanning: true },
  'design-transcript-SORBI_3004G087700.3': { mode: 'transcript', gene_id: 'SORBI_3004G087700', transcript_id: 'SORBI_3004G087700.3' },
  'design-gene-SORBI_3001G000200-flanks': { mode: 'gene', gene_id: 'SORBI_3001G000200', flank_up: 200, flank_down: 100 },
  'design-gene-SORBI_3001G000700': { mode: 'gene', gene_id: 'SORBI_3001G000700' },
  'design-region-target-included-excluded': {
    mode: 'region',
    system_name: 'sorghum_bicolor',
    region: { region: '1', start: 11080, end: 15099, strand: -1 },
    target: [499, 50],
    included: [100, 3000],
    excluded: [[1000, 40]],
    params: { min_size: 19, max_size: 22, min_tm: 58, max_tm: 61, min_gc: 40, max_gc: 60, max_tm_diff: 2, product_size_ranges: [[200, 300]] },
  },
  'design-sequence-iupac': { mode: 'sequence', system_name: 'sorghum_bicolor', sequence: `>iupac\n${cdna.slice(700, 820)}RY${cdna.slice(822, 1100)}\n` },
  'design-no-pairs': { mode: 'transcript', gene_id: 'SORBI_3001G000200', params: { opt_tm: 78, min_tm: 76, max_tm: 80 } },
  'design-template-only-softmask': { mode: 'region', system_name: 'sorghum_tx436pac', region: { region: '4', start: 7547610, end: 7564601, strand: 1 }, avoid_repeats: true, template_only: true },
  'design-softmask-pairs': { mode: 'region', system_name: 'sorghum_tx436pac', region: { region: '4', start: 7547610, end: 7564601, strand: 1 }, avoid_repeats: true },
  'error-validation-additional-property': { mode: 'gene', gene_id: 'X', bogus: 1 },
  'error-unknown-gene': { mode: 'gene', gene_id: 'NOPE' },
  'error-invalid-params-junction-overlap': { mode: 'transcript', gene_id: 'SORBI_3001G000200', params: { max_size: 24, min_5_prime_overlap_of_junction: 13 } },
};

const checks = {
  'check-gene-P2': {
    system_name: 'sorghum_bicolor',
    mode: 'gene',
    gene_id: 'SORBI_3004G087700',
    checks: ['specificity'],
    pairs: [{ id: 'P2', left: 'GGACAGCTCCACAACATATCAG', right: 'GGACATTTGAAGCCCATGGCC', expected: { region: '4', start: 7423537, end: 7423746 } }],
  },
  'check-transcript-qpcr': {
    system_name: 'sorghum_bicolor',
    mode: 'transcript',
    gene_id: 'SORBI_3004G087700',
    checks: ['specificity'],
    pairs: [{ id: 'P1', left: 'CCAACAAAGTCATGGATGCACT', right: 'GTGAACATCATGCTGCCCGATG' }],
  },
  'check-pangenome-P3': {
    system_name: 'sorghum_bicolor',
    mode: 'gene',
    gene_id: 'SORBI_3004G087700',
    checks: ['specificity', 'pangenome'],
    genomes: ['sorghum_353', 'sorghum_grassl', 'sorghum_leoti'],
    pairs: [{ id: 'P3', left: 'GATATCAGTGGAATCATAAGACCG', right: 'CATCGATATCAGGATCTGGCTT', expected: { region: '4', start: 7422482, end: 7423061 } }],
  },
};

async function main() {
  console.log(`capture-fixtures: ${BASE} -> ${OUT}`);

  if (wanted('genes')) {
    const path = `/genes?idList=${encodeURIComponent('SORBI_3001G000200,SORBI_3001G000700,SORBI_3001G046200,SORBI_3004G087700')}`;
    save('genes', 'GET', path, null, await http('GET', path));
  }
  if (wanted('genomes-sorghum_bicolor')) {
    const path = '/primers/genomes?system_name=sorghum_bicolor';
    save('genomes-sorghum_bicolor', 'GET', path, null, await http('GET', path));
  }
  if (wanted('error-unknown-job')) {
    const path = '/primers/check/0123456789abcdef0123456789abcdef';
    save('error-unknown-job', 'GET', path, null, await http('GET', path));
  }
  for (const [name, body] of Object.entries(designs)) {
    if (!wanted(name)) continue;
    save(name, 'POST', '/primers/design', body, await http('POST', '/primers/design', body));
  }

  if (!withChecks) {
    console.log('capture-fixtures: skipping check jobs (pass --checks to run BLAST on the server)');
    return;
  }
  for (const [name, body] of Object.entries(checks)) {
    if (!wanted(name)) continue;
    const submitted = await http('POST', '/primers/check', body);
    save(`${name}-submit`, 'POST', '/primers/check', body, submitted);
    const id = submitted.body?.job_id;
    if (submitted.status !== 202 && !(allowExisting && submitted.status === 200)) {
      console.error(
        `  !! ${name}: POST /primers/check answered ${submitted.status}, not 202 queued. ` +
          (submitted.status === 200
            ? `Job ${id} already exists on this server, so ${name}-submit.json is not a fresh submit. Delete the job from the dev store ` +
              '(primers:<site>:job:<id>, primers:<site>:result:<id>, ZREM primers:<site>:finished <id>) and re-run, or pass --allow-existing.'
            : 'See the saved submit capture.'),
      );
      process.exitCode = 1;
    }
    if (!id || submitted.status >= 400) continue;
    const path = `/primers/check/${id}`;
    // A running capture from an earlier run must not survive when this job is already done by the first poll.
    rmSync(resolve(OUT, `${name}-running.json`), { force: true });
    const started = Date.now();
    let last;
    let savedRunning = false;
    for (;;) {
      last = await http('GET', path);
      const status = last.body?.status;
      if (status === 'running' && last.body?.partial && !savedRunning) {
        save(`${name}-running`, 'GET', path, null, last);
        savedRunning = true;
      }
      if (last.status !== 200 || status === 'done' || status === 'error') break;
      if (Date.now() - started > CHECK_TIMEOUT_MS) {
        console.error(`  ${name}: gave up after ${CHECK_TIMEOUT_MS / 60000} min`);
        process.exitCode = 1;
        break;
      }
      await sleep(POLL_MS);
    }
    save(`${name}-final`, 'GET', path, null, last);
  }
}

main().catch((err) => {
  console.error('capture-fixtures failed:', err);
  process.exit(1);
});
