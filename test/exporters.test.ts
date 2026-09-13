import { describe, expect, it } from 'vitest';
import { revcomp } from '../src/coords';
import {
  ampliconsToFasta,
  OFF_TARGETS_TSV_HEADER,
  offTargetsToTSV,
  PAIRS_TSV_HEADER,
  pairsToTSV,
  PANGENOME_TSV_HEADER,
  pangenomeToTSV,
  primersToFasta,
  toTSV,
  tsvCell,
} from '../src/exporters';
import type { PrimerPair } from '../src/types';
import { doneCheckJob, geneDesign, genePairs, SEQS, sequencePair, transcriptCheckJob, transcriptDesign, transcriptPair0 } from './fixtures/samples';

const rows = (tsv: string) => tsv.replace(/\n$/, '').split('\n').map((l) => l.split('\t'));

describe('tsvCell (formula-injection safe)', () => {
  it.each([
    ['=SUM(A1:A2)', "'=SUM(A1:A2)"],
    ['+cmd|x', "'+cmd|x"],
    ['-2+3', "'-2+3"],
    ['@SUM(1)', "'@SUM(1)"],
    ['  =1+1', "'  =1+1"],
    ['＝1+1', "'＝1+1"],
    ['=\tx', "'= x"],
    ['-177', '-177'],
    ['+22', '+22'],
    ['1e5', '1e5'],
    ['-0.5', '-0.5'],
    ['4:7423537-7423746', '4:7423537-7423746'],
    ['ACGT', 'ACGT'],
    ['a\tb\r\nc', 'a b c'],
  ])('%j → %j', (input, expected) => {
    expect(tsvCell(input)).toBe(expected);
  });

  it('formats non-strings', () => {
    expect(tsvCell(null)).toBe('');
    expect(tsvCell(undefined)).toBe('');
    expect(tsvCell(Number.NaN)).toBe('');
    expect(tsvCell(-177)).toBe('-177');
    expect(tsvCell(12.5)).toBe('12.5');
    expect(tsvCell(true)).toBe('true');
    expect(toTSV(['a', '=b'], [[1, '@x']])).toBe("a\t'=b\n1\t'@x\n");
  });
});

describe('pairsToTSV', () => {
  it('writes one row per pair with genomic footprints', () => {
    const r = rows(pairsToTSV(genePairs));
    expect(r[0]).toEqual([...PAIRS_TSV_HEADER]);
    expect(r).toHaveLength(4);
    expect(r[1]).toEqual([
      'P1', '1', SEQS.P1_L, '834', '23', '60.14', '50', '', '4:7422190-7422212(+)',
      SEQS.P1_R, '1466', '22', '61.02', '57.14', '', '4:7422822-7422843(-)',
      '654', '82.5', '4:7422190-7422843(+)', '', '0.2', '0', '0', '0', '0', '', '', '', '',
    ]);
    for (const row of r) expect(row).toHaveLength(PAIRS_TSV_HEADER.length);
  });

  it('adds verdicts matched by sequence and marks unmatched pairs', () => {
    const r = rows(pairsToTSV(genePairs, { check: doneCheckJob() }));
    const col = (name: string) => PAIRS_TSV_HEADER.indexOf(name as (typeof PAIRS_TSV_HEADER)[number]);
    expect(r[1]![col('specificity')]).toBe('not checked');
    expect(r[2]!.slice(col('specificity'))).toEqual(['off_targets', '2', '', '2/3']);
    expect(r[3]!.slice(col('specificity'))).toEqual(['off_targets', '1', '', '3/3']);
  });

  it('transcript pairs include the junction and genomic size', () => {
    const r = rows(pairsToTSV([transcriptPair0]));
    expect(r[1]![PAIRS_TSV_HEADER.indexOf('left_junction')]).toBe('869 (14/6)');
    expect(r[1]![PAIRS_TSV_HEADER.indexOf('left_genomic')]).toBe('1:13395-13400,13637-13650(-)');
    expect(r[1]![PAIRS_TSV_HEADER.indexOf('genomic_size')]).toBe('360');
  });
});

describe('FASTA exports', () => {
  it('primersToFasta writes >{label}_P{n}_F|R tm= gc= {genomic}', () => {
    expect(primersToFasta(genePairs.slice(1, 2), { label: 'SORBI_3004G087700' })).toBe(
      [
        '>SORBI_3004G087700_P2_F tm=60.1 gc=50 4:7423537-7423558(+)',
        SEQS.P2_L,
        '>SORBI_3004G087700_P2_R tm=61 gc=57.1 4:7423726-7423746(-)',
        SEQS.P2_R,
        '',
      ].join('\n'),
    );
  });

  it('sanitizes labels, uppercases sequences and omits null genomic', () => {
    const p = sequencePair(0, 200);
    const lower: PrimerPair = { ...p, left: { ...p.left, seq: p.left.seq.toLowerCase() } };
    const fa = primersToFasta([lower], { label: 'my gene/1\n>x' });
    expect(fa.split('\n')[0]).toBe('>my_gene_1_x_P1_F tm=60 gc=50');
    expect(fa.split('\n')[1]).toBe(p.left.seq);
    expect(primersToFasta([], {})).toBe('');
    expect(primersToFasta([p]).startsWith('>primers_P1_F')).toBe(true);
  });

  it('ampliconsToFasta cuts real amplicons from the template in 60-nt lines', () => {
    const design = geneDesign();
    const fa = ampliconsToFasta(design.pairs, design.template, { label: 'SORBI_3004G087700' });
    const records = fa.trimEnd().split(/\n(?=>)/);
    expect(records).toHaveLength(3);
    const [header, ...lines] = records[1]!.split('\n');
    expect(header).toBe('>SORBI_3004G087700_P2_amplicon size=210 template=2181-2390 4:7423537-7423746(+)');
    const seq = lines.join('');
    expect(seq).toHaveLength(210);
    expect(seq.startsWith(SEQS.P2_L)).toBe(true);
    expect(seq.endsWith(revcomp(SEQS.P2_R))).toBe(true);
    expect(lines[0]).toHaveLength(60);
    expect(lines.every((l) => l.length <= 60)).toBe(true);

    const tx = transcriptDesign();
    const txSeq = ampliconsToFasta(tx.pairs, tx.template).split('\n').slice(1).join('');
    expect(txSeq).toHaveLength(124);
    expect(txSeq.startsWith(SEQS.QPCR_L)).toBe(true);
    expect(txSeq.endsWith(revcomp(SEQS.QPCR_R))).toBe(true);
  });

  it('skips pairs outside the template', () => {
    expect(ampliconsToFasta([sequencePair(0, 500)], { seq: 'ACGT'.repeat(50), length: 200 })).toBe('');
    expect(ampliconsToFasta(genePairs, null)).toBe('');
  });
});

describe('check exports', () => {
  it('offTargetsToTSV lists on-target, off-target and gDNA amplicons', () => {
    const r = rows(offTargetsToTSV(doneCheckJob().results));
    expect(r[0]).toEqual([...OFF_TARGETS_TSV_HEADER]);
    expect(r).toHaveLength(6);
    expect(r[1]!.slice(0, 8)).toEqual(['genome', 'P2', 'off_targets', 'on_target', '4', '7423537', '7423746', '210']);
    expect(r[2]).toEqual(['genome', 'P2', 'off_targets', 'off_target', '4', '7437317', '7437526', '210', '', '', 'LR', 'likely', '0', '0', '0', '0', '', '', 'false', 'SORBI_3004G087800']);
    expect(r[3]!.slice(12, 20)).toEqual(['2', '2', '0', '0', '10,7', '15,10', 'false', 'SORBI_3005G183900']);
    expect(r[5]!.slice(1, 12)).toEqual(['P3', 'off_targets', 'off_target', '4', '7436221', '7436845', '625', '', '', 'LR', 'likely_weak']);
    for (const row of r) expect(row).toHaveLength(OFF_TARGETS_TSV_HEADER.length);
  });

  it('includes transcriptome groups by gene with isoforms', () => {
    const r = rows(offTargetsToTSV(transcriptCheckJob().results));
    expect(r.map((x) => `${x[0]}:${x[3]}`)).toEqual(['target:kind', 'genome:gdna_product', 'cdna:on_target', 'cdna:off_target', 'cdna:off_target']);
    expect(r[2]!.slice(7, 10)).toEqual(['278', 'SORBI_3004G087700', 'SORBI_3004G087700.1,SORBI_3004G087700.2,SORBI_3004G087700.3']);
    expect(r[4]![18]).toBe('true');
    expect(offTargetsToTSV(null)).toBe(`${OFF_TARGETS_TSV_HEADER.join('\t')}\n`);
  });

  it('pangenomeToTSV writes pair × genome rows and neutralizes formulas', () => {
    const r = rows(pangenomeToTSV(doneCheckJob().results));
    expect(r[0]).toEqual([...PANGENOME_TSV_HEADER]);
    expect(r).toHaveLength(7);
    expect(r[2]![3]).toBe('\'=HYPERLINK("http://x")');
    expect(r[3]!.slice(0, 6)).toEqual(['P2', '210', 'sorghum_leoti', 'Sb leoti', 'no_amplicon', 'false']);
    expect(r[3]![10]).toBe('');
    expect(r[4]!.slice(10, 22)).toEqual(['580', '0', 'LR', 'likely_weak', '1', '0', '1', '0', 'true', 'true', 'true', '353.004G093500']);
    expect(r[6]!.slice(10, 12)).toEqual(['581', '1']);
    for (const row of r) expect(row).toHaveLength(PANGENOME_TSV_HEADER.length);
    const tx = rows(pangenomeToTSV(transcriptCheckJob().results));
    expect(tx[1]![21]).toBe('353.004G093400');
  });

  it('pangenomeToTSV has a truncated column so an incomplete search is not exported as definitive', () => {
    const results = doneCheckJob().results!;
    const p2 = results.pangenome!.pairs[0]!;
    const genomes = p2.genomes.map((x, i) => (i === 2 ? { ...x, truncated: true } : x));
    const r = rows(pangenomeToTSV({ ...results, pangenome: { target: 'genome', pairs: [{ ...p2, genomes }] } }));
    const col = PANGENOME_TSV_HEADER.indexOf('truncated');
    expect(col).toBe(PANGENOME_TSV_HEADER.length - 1);
    expect(r.slice(1).map((row) => [row[2], row[col]])).toEqual([
      ['sorghum_353', ''],
      ['sorghum_grassl', ''],
      ['sorghum_leoti', 'true'],
    ]);
  });
});
