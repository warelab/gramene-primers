#!/usr/bin/env node
/**
 * Builds realistic POST /primers/design fixtures for the component tests and
 * the playground mock from real sorghum_bicolor sequence (fastaIdx, read-only
 * GETs) and Primer3 2.6.1, following spec §A.3–A.5 (template construction,
 * Boulder tags, coordinate mapping). Only runs where both are available (squam):
 *
 *   node test/components/fixtures/build-designs.mjs
 *
 * Every primer is verified against the fetched sequence: template slices,
 * and genomic blocks read back from the forward strand.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const OUT = join(HERE, 'designs');
const FASTAIDX = (process.env.PRIMERS_FASTAIDX || 'http://localhost:8888').replace(/\/+$/, '');
const PRIMER3 = process.env.PRIMER3_CORE || '/home/olson/bin/primer3_core';
const SYSTEM = 'sorghum_bicolor';

const COMP = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N', R: 'Y', Y: 'R', K: 'M', M: 'K', S: 'S', W: 'W', B: 'V', V: 'B', D: 'H', H: 'D' };
const rc = (s) => [...s].reverse().map((c) => COMP[c] ?? c).join('');

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

const geneDoc = (id) => JSON.parse(readFileSync(join(ROOT, 'test/fixtures/genes', `${id}.json`), 'utf8'));

let gets = 0;
async function fetchSeq(region, start, end, strand) {
  const url = `${FASTAIDX}/sequence/region/${SYSTEM}/${region}:${start}..${end}:${strand}`;
  gets += 1;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const seq = String((await res.json()).seq).toUpperCase();
  assert(seq.length === end - start + 1, `${url}: ${seq.length} bases`);
  return seq;
}

const PRESETS = {
  pcr: { opt_size: 20, min_size: 18, max_size: 25, opt_tm: 60, min_tm: 57, max_tm: 63, min_gc: 30, max_gc: 70, max_tm_diff: 3, max_poly_x: 4, product_size_ranges: [[100, 1000]], num_return: 5 },
  qpcr: {
    opt_size: 20, min_size: 18, max_size: 24, opt_tm: 60, min_tm: 58, max_tm: 62, min_gc: 35, max_gc: 65, max_tm_diff: 2, max_poly_x: 4,
    product_size_ranges: [[70, 150]], num_return: 5, min_3_prime_overlap_of_junction: 4, min_5_prime_overlap_of_junction: 7,
  },
};
const P3_DEFAULTS = { gc_clamp: 0, max_end_stability: 100, max_ns: 0, salt_monovalent: 50, salt_divalent: 1.5, dntp_conc: 0.6, dna_conc: 50 };
const TAGS = {
  opt_size: 'PRIMER_OPT_SIZE', min_size: 'PRIMER_MIN_SIZE', max_size: 'PRIMER_MAX_SIZE', opt_tm: 'PRIMER_OPT_TM', min_tm: 'PRIMER_MIN_TM', max_tm: 'PRIMER_MAX_TM',
  opt_gc: 'PRIMER_OPT_GC_PERCENT', min_gc: 'PRIMER_MIN_GC', max_gc: 'PRIMER_MAX_GC', max_tm_diff: 'PRIMER_PAIR_MAX_DIFF_TM', max_poly_x: 'PRIMER_MAX_POLY_X',
  gc_clamp: 'PRIMER_GC_CLAMP', max_end_stability: 'PRIMER_MAX_END_STABILITY', max_ns: 'PRIMER_MAX_NS_ACCEPTED', salt_monovalent: 'PRIMER_SALT_MONOVALENT',
  salt_divalent: 'PRIMER_SALT_DIVALENT', dntp_conc: 'PRIMER_DNTP_CONC', dna_conc: 'PRIMER_DNA_CONC', num_return: 'PRIMER_NUM_RETURN',
};

let p3runs = 0;
function runPrimer3(templateSeq, params, extraTags) {
  const lines = [
    'SEQUENCE_ID=fixture', `SEQUENCE_TEMPLATE=${templateSeq}`, 'PRIMER_TASK=generic', 'PRIMER_PICK_LEFT_PRIMER=1', 'PRIMER_PICK_RIGHT_PRIMER=1',
    'PRIMER_PICK_INTERNAL_OLIGO=0', 'PRIMER_FIRST_BASE_INDEX=1', 'PRIMER_EXPLAIN_FLAG=1', 'PRIMER_LIBERAL_BASE=1', 'PRIMER_THERMODYNAMIC_OLIGO_ALIGNMENT=1',
    'PRIMER_THERMODYNAMIC_TEMPLATE_ALIGNMENT=0', 'PRIMER_PRODUCT_MIN_TM=0', 'PRIMER_PRODUCT_MAX_TM=150', 'P3_FILE_FLAG=0',
    `PRIMER_PRODUCT_SIZE_RANGE=${params.product_size_ranges.map(([a, b]) => `${a}-${b}`).join(' ')}`,
  ];
  for (const [key, tag] of Object.entries(TAGS)) if (typeof params[key] === 'number') lines.push(`${tag}=${params[key]}`);
  lines.push(...extraTags);
  p3runs += 1;
  const p = spawnSync(PRIMER3, ['-strict_tags'], { input: `${lines.join('\n')}\n=\n`, encoding: 'utf8', cwd: tmpdir(), env: { PATH: '/usr/bin:/bin' }, timeout: 30_000 });
  if (p.status !== 0) throw new Error(`primer3_core exit ${p.status}: ${p.stderr}`);
  const kv = {};
  for (const line of p.stdout.split('\n')) {
    if (line === '=') break;
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1);
  }
  if (kv.PRIMER_ERROR) throw new Error(`PRIMER_ERROR: ${kv.PRIMER_ERROR}`);
  return kv;
}

function parseExplain(raw) {
  if (raw == null) return null;
  const out = { raw };
  for (const part of raw.split(',')) {
    const m = /^\s*(.*?)\s+(\d+)\s*$/.exec(part);
    if (m && m[1]) out[m[1]] = Number(m[2]);
  }
  return out;
}

// Primer3 prints limited decimals already; keep them as the server does (e.g. penalty 0.026415).
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function parsePairs(kv, mapper) {
  const n = Number(kv.PRIMER_PAIR_NUM_RETURNED || 0);
  const pairs = [];
  for (let i = 0; i < n; i++) {
    const [lp, ll] = kv[`PRIMER_LEFT_${i}`].split(',').map(Number);
    const [rp, rl] = kv[`PRIMER_RIGHT_${i}`].split(',').map(Number);
    const size = Number(kv[`PRIMER_PAIR_${i}_PRODUCT_SIZE`]);
    assert(size === rp - lp + 1, `pair ${i} product size`);
    const oligo = (side, pos, len) => {
      const pre = `PRIMER_${side.toUpperCase()}_${i}`;
      const start = side === 'left' ? pos : pos - len + 1;
      const end = side === 'left' ? pos + len - 1 : pos;
      return {
        seq: kv[`${pre}_SEQUENCE`].toUpperCase(), start, end, len,
        tm: num(kv[`${pre}_TM`]), gc: num(kv[`${pre}_GC_PERCENT`]), self_any_th: num(kv[`${pre}_SELF_ANY_TH`]), self_end_th: num(kv[`${pre}_SELF_END_TH`]),
        hairpin_th: num(kv[`${pre}_HAIRPIN_TH`]), end_stability: num(kv[`${pre}_END_STABILITY`]), penalty: num(kv[`${pre}_PENALTY`]),
        ...mapper.oligo(side, start, end),
      };
    };
    const trustTm = kv[`PRIMER_PAIR_${i}_PRODUCT_TM_OLIGO_TM_DIFF`] !== undefined;
    pairs.push({
      rank: i, penalty: num(kv[`PRIMER_PAIR_${i}_PENALTY`]), product_size: size, product_tm: trustTm ? num(kv[`PRIMER_PAIR_${i}_PRODUCT_TM`]) : null,
      compl_any_th: num(kv[`PRIMER_PAIR_${i}_COMPL_ANY_TH`]), compl_end_th: num(kv[`PRIMER_PAIR_${i}_COMPL_END_TH`]),
      left: oligo('left', lp, ll), right: oligo('right', rp, rl), product: { start: lp, end: rp, ...mapper.product(lp, rp) },
    });
  }
  return pairs;
}

function explainOf(kv) {
  return { left: parseExplain(kv.PRIMER_LEFT_EXPLAIN), right: parseExplain(kv.PRIMER_RIGHT_EXPLAIN), pair: parseExplain(kv.PRIMER_PAIR_EXPLAIN) };
}

/** Gene/region templates: `strand==1 ? gStart+t-1 : gEnd-t+1` (spec §A.4.3). */
function genomicMapper(region, gStart, gEnd, strand) {
  const toG = (t) => (strand === 1 ? gStart + t - 1 : gEnd - t + 1);
  const span = (s, e) => ({ start: Math.min(toG(s), toG(e)), end: Math.max(toG(s), toG(e)) });
  return {
    oligo: (side, s, e) => {
      const b = span(s, e);
      return { junction: null, genomic: { region, start: b.start, end: b.end, strand: side === 'left' ? strand : -strand, blocks: [b] } };
    },
    product: (s, e) => ({ genomic: { region, ...span(s, e), strand } }),
  };
}

/** Transcript templates: clip to exon segments, map each piece, sort ascending (spec §A.4.4). */
function transcriptMapper(region, strand, segments, junctions, min5, min3) {
  const blocksFor = (s, e) => {
    const blocks = [];
    for (const seg of segments) {
      const lo = Math.max(s, seg.tStart);
      const hi = Math.min(e, seg.tEnd);
      if (lo > hi) continue;
      blocks.push(strand === 1 ? { start: seg.gStart + lo - seg.tStart, end: seg.gStart + hi - seg.tStart } : { start: seg.gEnd - (hi - seg.tStart), end: seg.gEnd - (lo - seg.tStart) });
    }
    return blocks.sort((a, b) => a.start - b.start);
  };
  const junctionFor = (side, a, b) => {
    for (const j of junctions) {
      const up = j - a + 1;
      const down = b - j;
      if (up < 1 || down < 1) continue;
      const o5 = side === 'left' ? up : down;
      const o3 = side === 'left' ? down : up;
      if (o5 >= min5 && o3 >= min3) return { position: j, overlap_5p: o5, overlap_3p: o3 };
    }
    return null;
  };
  return {
    oligo: (side, s, e) => {
      const blocks = blocksFor(s, e);
      return { junction: junctionFor(side, s, e), genomic: { region, start: blocks[0].start, end: blocks[blocks.length - 1].end, strand: side === 'left' ? strand : -strand, blocks } };
    },
    product: (s, e) => {
      const blocks = blocksFor(s, e);
      const start = blocks[0].start;
      const end = blocks[blocks.length - 1].end;
      return { genomic: { region, start, end, strand }, genomic_size: end - start + 1 };
    },
  };
}

function verifyPairs(name, pairs, templateSeq, forward, origin) {
  for (const p of pairs) {
    assert(templateSeq.slice(p.left.start - 1, p.left.end) === p.left.seq, `${name} P${p.rank + 1} left template`);
    assert(rc(templateSeq.slice(p.right.start - 1, p.right.end)) === p.right.seq, `${name} P${p.rank + 1} right template`);
    assert(p.product_size === p.right.end - p.left.start + 1, `${name} P${p.rank + 1} product_size`);
    if (!forward) continue;
    for (const o of [p.left, p.right]) {
      const read = o.genomic.blocks.map((b) => forward.slice(b.start - origin, b.end - origin + 1)).join('');
      assert((o.genomic.strand === 1 ? read : rc(read)) === o.seq, `${name} P${p.rank + 1} genomic blocks of ${o.seq}`);
    }
  }
}

function effectiveParams(preset, overrides = {}) {
  return { ...P3_DEFAULTS, ...PRESETS[preset], ...overrides };
}

function segmentsOf(gene, transcriptId) {
  const loc = gene.location;
  const exons = new Map(gene.gene_structure.exons.map((e) => [e.id, e]));
  const tr = gene.gene_structure.transcripts.find((t) => t.id === transcriptId);
  let cum = 0;
  const segments = tr.exons.map((id) => {
    const e = exons.get(id);
    const n = e.end - e.start + 1;
    const seg = {
      id, e, tStart: cum + 1, tEnd: cum + n,
      gStart: loc.strand === 1 ? loc.start + e.start - 1 : loc.end - e.end + 1,
      gEnd: loc.strand === 1 ? loc.start + e.end - 1 : loc.end - e.start + 1,
    };
    cum += n;
    return seg;
  });
  return { tr, segments, length: cum, junctions: segments.slice(0, -1).map((s) => s.tEnd) };
}

const fixtures = {};

async function geneDesign(name, geneId, flankUp, flankDown) {
  const gene = geneDoc(geneId);
  const loc = gene.location;
  const gStart = loc.strand === 1 ? loc.start - flankUp : loc.start - flankDown;
  const gEnd = loc.strand === 1 ? loc.end + flankDown : loc.end + flankUp;
  const effUp = loc.strand === 1 ? loc.start - gStart : gEnd - loc.end;
  const seq = await fetchSeq(loc.region, gStart, gEnd, loc.strand);
  const tid = gene.gene_structure.canonical_transcript;
  const { tr, segments } = segmentsOf(gene, tid);
  const cdnaToGeneRel = (c) => {
    const s = segments.find((x) => c >= x.tStart && c <= x.tEnd);
    return s.e.start + (c - s.tStart);
  };
  const params = effectiveParams('pcr');
  const kv = runPrimer3(seq, params, []);
  const pairs = parsePairs(kv, genomicMapper(loc.region, gStart, gEnd, loc.strand));
  verifyPairs(name, pairs, seq, loc.strand === 1 ? seq : rc(seq), gStart);
  const request = { mode: 'gene', gene_id: geneId, system_name: SYSTEM };
  if (flankUp) request.flank_up = flankUp;
  if (flankDown) request.flank_down = flankDown;
  const geneLen = loc.end - loc.start + 1;
  fixtures[name] = {
    request,
    response: {
      template: {
        mode: 'gene', system_name: SYSTEM, gene_id: geneId, transcript_id: tid, region: loc.region, start: gStart, end: gEnd, strand: loc.strand,
        length: seq.length, seq, masked: false, mask_source: null, mask: [], masked_fraction: 0,
        features: {
          gene: { start: effUp + 1, end: effUp + geneLen },
          exons: segments.map((s) => ({ id: s.id, start: s.e.start + effUp, end: s.e.end + effUp, genomic: { start: s.gStart, end: s.gEnd } })),
          cds: tr.cds ? { start: cdnaToGeneRel(tr.cds.start) + effUp, end: cdnaToGeneRel(tr.cds.end) + effUp } : null,
          junctions: [],
        },
      },
      pairs,
      explain: explainOf(kv),
      settings: { preset: 'pcr', junction_spanning: false, avoid_repeats: false, repeat_mask_mode: null, params },
      engine: { primer3: '2.6.1' },
      warnings: pairs.length ? [] : [{ code: 'NO_PAIRS', message: 'Primer3 found no acceptable primer pairs' }],
    },
  };
  return fixtures[name];
}

const geneSpans = new Map();
async function geneSpan(gene) {
  if (!geneSpans.has(gene._id)) {
    const loc = gene.location;
    geneSpans.set(gene._id, await fetchSeq(loc.region, loc.start, loc.end, loc.strand));
  }
  return geneSpans.get(gene._id);
}

async function transcriptDesign(name, geneId, transcriptId, { junctionSpanning = true, sendTranscriptId = true, overrides = {} } = {}) {
  const gene = geneDoc(geneId);
  const loc = gene.location;
  const span = await geneSpan(gene);
  const tid = transcriptId ?? gene.gene_structure.canonical_transcript;
  const { tr, segments, length, junctions } = segmentsOf(gene, tid);
  const cdna = segments.map((s) => span.slice(s.e.start - 1, s.e.end)).join('');
  assert(cdna.length === tr.length && length === tr.length, `${tid} cDNA length`);
  const params = effectiveParams('qpcr', overrides);
  const useJunctions = junctionSpanning && junctions.length > 0;
  const extra = useJunctions
    ? [
        `SEQUENCE_OVERLAP_JUNCTION_LIST=${junctions.join(' ')}`,
        `PRIMER_MIN_3_PRIME_OVERLAP_OF_JUNCTION=${params.min_3_prime_overlap_of_junction}`,
        `PRIMER_MIN_5_PRIME_OVERLAP_OF_JUNCTION=${params.min_5_prime_overlap_of_junction}`,
        `PRIMER_INTERNAL_MIN_3_PRIME_OVERLAP_OF_JUNCTION=${params.min_3_prime_overlap_of_junction}`,
        `PRIMER_INTERNAL_MIN_5_PRIME_OVERLAP_OF_JUNCTION=${params.min_5_prime_overlap_of_junction}`,
      ]
    : [];
  const kv = runPrimer3(cdna, params, extra);
  const pairs = parsePairs(kv, transcriptMapper(loc.region, loc.strand, segments, junctions, params.min_5_prime_overlap_of_junction, params.min_3_prime_overlap_of_junction));
  const forward = loc.strand === 1 ? span : rc(span);
  verifyPairs(name, pairs, cdna, forward, loc.start);
  if (useJunctions) for (const p of pairs) assert(p.left.junction || p.right.junction, `${name} P${p.rank + 1} spans a junction`);
  const request = { mode: 'transcript', gene_id: geneId };
  if (sendTranscriptId) request.transcript_id = tid;
  request.junction_spanning = junctionSpanning;
  if (Object.keys(overrides).length) request.params = overrides;
  const warnings = [];
  if (!pairs.length) warnings.push({ code: 'NO_PAIRS', message: 'Primer3 found no acceptable primer pairs' });
  fixtures[name] = {
    request,
    response: {
      template: {
        // The server reports the transcript's genomic envelope, not the gene span.
        mode: 'transcript', system_name: SYSTEM, gene_id: geneId, transcript_id: tid, region: loc.region,
        start: Math.min(...segments.map((s) => s.gStart)), end: Math.max(...segments.map((s) => s.gEnd)), strand: loc.strand,
        length: cdna.length, seq: cdna, masked: false, mask_source: null, mask: [], masked_fraction: 0,
        features: {
          gene: null,
          exons: segments.map((s) => ({ id: s.id, start: s.tStart, end: s.tEnd, genomic: { start: s.gStart, end: s.gEnd } })),
          cds: tr.cds ? { start: tr.cds.start, end: tr.cds.end } : null,
          junctions,
        },
      },
      pairs,
      explain: explainOf(kv),
      settings: { preset: 'qpcr', junction_spanning: useJunctions, avoid_repeats: false, repeat_mask_mode: null, params },
      engine: { primer3: '2.6.1' },
      warnings,
    },
  };
  return fixtures[name];
}

async function regionDesign(name) {
  const region = { region: '1', start: 11080, end: 15099, strand: -1 };
  const overrides = { min_size: 19, max_size: 22, min_tm: 58, max_tm: 61, min_gc: 40, max_gc: 60, max_tm_diff: 2, product_size_ranges: [[200, 300]] };
  const target = [499, 50];
  const included = [100, 3000];
  const excluded = [[1000, 40]];
  const seq = await fetchSeq(region.region, region.start, region.end, region.strand);
  const params = effectiveParams('pcr', overrides);
  const kv = runPrimer3(seq, params, [`SEQUENCE_TARGET=${target.join(',')}`, `SEQUENCE_INCLUDED_REGION=${included.join(',')}`, `SEQUENCE_EXCLUDED_REGION=${excluded.map((x) => x.join(',')).join(' ')}`]);
  const pairs = parsePairs(kv, genomicMapper(region.region, region.start, region.end, region.strand));
  verifyPairs(name, pairs, seq, rc(seq), region.start);
  for (const p of pairs) {
    assert(p.left.start <= target[0] && p.right.end >= target[0] + target[1] - 1, `${name} P${p.rank + 1} covers the target`);
    assert(p.left.start >= included[0] && p.right.end <= included[0] + included[1] - 1, `${name} P${p.rank + 1} inside included`);
    assert(p.product_size >= 200 && p.product_size <= 300, `${name} P${p.rank + 1} product range`);
  }
  fixtures[name] = {
    request: { mode: 'region', system_name: SYSTEM, region, target, included, excluded, params: overrides },
    response: {
      template: { mode: 'region', system_name: SYSTEM, gene_id: null, transcript_id: null, region: region.region, start: region.start, end: region.end, strand: region.strand, length: seq.length, seq, masked: false, mask_source: null, mask: [], masked_fraction: 0, features: {} },
      pairs,
      explain: explainOf(kv),
      settings: { preset: 'pcr', junction_spanning: false, avoid_repeats: false, repeat_mask_mode: null, params },
      engine: { primer3: '2.6.1' },
      warnings: [],
    },
  };
}

async function sequenceDesign(name) {
  const gene = geneDoc('SORBI_3004G087700');
  const span = await geneSpan(gene);
  const chars = [...span.slice(799, 1999)];
  const iupac = { 99: 'R', 100: 'Y', 699: 'W' };
  for (const [i, c] of Object.entries(iupac)) chars[Number(i)] = c;
  const pasted = chars.join('');
  const templateSeq = pasted.replace(/[RYKMSWBDHV]/g, 'N');
  const params = effectiveParams('pcr');
  const kv = runPrimer3(templateSeq, params, []);
  const pairs = parsePairs(kv, { oligo: () => ({ junction: null, genomic: null }), product: () => ({ genomic: null }) });
  verifyPairs(name, pairs, templateSeq, null, 0);
  const fasta = `>SORBI_3004G087700_800-2000\n${pasted.match(/.{1,60}/g).join('\n')}\n`;
  fixtures[name] = {
    request: { mode: 'sequence', sequence: fasta, system_name: SYSTEM },
    response: {
      template: { mode: 'sequence', system_name: SYSTEM, gene_id: null, transcript_id: null, region: null, start: null, end: null, strand: null, length: templateSeq.length, seq: templateSeq, masked: false, mask_source: null, mask: [], masked_fraction: 0, features: {} },
      pairs,
      explain: explainOf(kv),
      settings: { preset: 'pcr', junction_spanning: false, avoid_repeats: false, repeat_mask_mode: null, params },
      engine: { primer3: '2.6.1' },
      warnings: [{ code: 'IUPAC_CONVERTED', message: '3 IUPAC ambiguity codes were converted to N' }],
    },
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await geneDesign('gene-SORBI_3001G000200-flanks', 'SORBI_3001G000200', 200, 100);
  await geneDesign('gene-SORBI_3001G000700', 'SORBI_3001G000700', 0, 0);
  await transcriptDesign('transcript-SORBI_3001G000200', 'SORBI_3001G000200', null, { sendTranscriptId: false });
  await transcriptDesign('transcript-SORBI_3004G087700.3', 'SORBI_3004G087700', 'SORBI_3004G087700.3');
  await transcriptDesign('transcript-SORBI_3001G046200.2', 'SORBI_3001G046200', null, { junctionSpanning: false, sendTranscriptId: false });
  await transcriptDesign('transcript-SORBI_3001G046200.1', 'SORBI_3001G046200', 'SORBI_3001G046200.1');
  await regionDesign('region-1-11080-15099-minus');
  await sequenceDesign('sequence-iupac');
  // No pairs: tight Tm window with a narrow product range on SORBI_3001G000200.1.
  const tries = [
    { opt_tm: 61.5, min_tm: 61.3, max_tm: 61.7, max_tm_diff: 0.2, product_size_ranges: [[70, 72]] },
    // Only values that differ from the qPCR preset, as the UI sends them.
    { opt_tm: 61.9, min_tm: 61.85, max_tm: 61.95, min_gc: 60, max_tm_diff: 0.05, product_size_ranges: [[70, 71]] },
  ];
  for (const overrides of tries) {
    const f = await transcriptDesign('no-pairs-SORBI_3001G000200', 'SORBI_3001G000200', null, { sendTranscriptId: false, overrides });
    if (f.response.pairs.length === 0) break;
  }
  assert(fixtures['no-pairs-SORBI_3001G000200'].response.pairs.length === 0, 'no-pairs fixture has no pairs');

  const index = {};
  for (const [name, f] of Object.entries(fixtures)) {
    const doc = { generated_by: 'test/components/fixtures/build-designs.mjs', sources: { fastaidx: FASTAIDX, primer3: '2.6.1' }, ...f };
    writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(doc, null, 1)}\n`);
    const r = f.response;
    index[name] = { mode: r.template.mode, length: r.template.length, pairs: r.pairs.length, products: r.pairs.map((p) => p.product_size) };
  }
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(JSON.stringify(index, null, 2));
  console.log(`fastaIdx GETs: ${gets}, primer3 runs: ${p3runs}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
