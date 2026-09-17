import type { ReactNode } from 'react';
import { formatGenomic } from '../coords';
import type { CheckPrimerInfo, PrimerOligo, PrimerPair, PrimerTemplate } from '../types';
import { useMemo, useState } from 'react';
import { digestAmplicon } from '../amplicon';
import { findEnzyme, type RestrictionEnzyme } from '../enzymes';
import { AmpliconSequence } from './AmpliconSequence';
import { DigestPanel } from './DigestPanel';
import { fmtInt, fmtNum } from './util';

export interface PairDetailProps {
  pair: PrimerPair;
  template: PrimerTemplate | null | undefined;
  label?: string;
  /** `results.primers` of a matching check. */
  primers?: Readonly<Record<string, CheckPrimerInfo>> | null;
  id?: string;
  /** Restriction enzymes to consider. Defaults to the bundled panel. */
  enzymes?: ReadonlyArray<RestrictionEnzyme>;
  /** Enzymes whose sites are marked, shared across the design results. */
  selectedEnzymes?: ReadonlyArray<string>;
  onSelectEnzymes?: (enzymes: string[]) => void;
}

const ROWS: ReadonlyArray<[string, (o: PrimerOligo) => ReactNode]> = [
  ['Sequence (5′→3′)', (o) => <code className="gpr-seq">{o.seq}</code>],
  ['Template position', (o) => `${fmtInt(o.start)}–${fmtInt(o.end)}`],
  ['Length', (o) => `${o.len} nt`],
  ['Tm', (o) => `${fmtNum(o.tm, 2)} °C`],
  ['GC', (o) => `${fmtNum(o.gc, 1)} %`],
  ['Self-complementarity, any (Tm °C)', (o) => fmtNum(o.self_any_th)],
  ['Self-complementarity, 3′ end (Tm °C)', (o) => fmtNum(o.self_end_th)],
  ['Hairpin (Tm °C)', (o) => fmtNum(o.hairpin_th)],
  ['3′ end stability (kcal/mol)', (o) => fmtNum(o.end_stability, 2)],
  ['Penalty', (o) => fmtNum(o.penalty, 3)],
  ['Exon–exon junction', (o) => (o.junction ? `at ${fmtInt(o.junction.position)}: ${o.junction.overlap_5p} nt 5′, ${o.junction.overlap_3p} nt 3′` : '–')],
  ['Genomic', (o) => (o.genomic ? formatGenomic(o.genomic) : '–')],
];

/** Expanded pair: primer statistics, product, genomic blocks and the amplicon sequence. */
export function PairDetail({ pair, template, label, primers, id, enzymes, selectedEnzymes, onSelectEnzymes }: PairDetailProps): JSX.Element {
  const n = pair.rank + 1;
  const [ownSelection, setOwnSelection] = useState<string[]>([]);
  // The host may hold the selection so the template map can follow it; standing
  // alone the detail keeps its own.
  const selected = onSelectEnzymes ? selectedEnzymes ?? [] : ownSelection;
  const setSelected = onSelectEnzymes ?? setOwnSelection;
  const span = { start: pair.left.start, end: pair.right.end };
  const selectedKey = [...selected].sort().join(',');
  // Each marked site and cut names its enzyme, so several can be drawn at once
  // in their own colours.
  const marks = useMemo(() => {
    const chosen = selected.map((name) => findEnzyme(name, enzymes)).filter((e) => e !== null);
    if (!chosen.length || !template?.seq) return { sites: [], cuts: [] };
    const sites: Array<{ start: number; end: number; enzyme: string }> = [];
    const cuts: Array<{ position: number; enzyme: string }> = [];
    for (const d of digestAmplicon(template.seq, span, { enzymes: chosen })) {
      for (const site of d.sites) sites.push({ start: site.start, end: site.end, enzyme: d.enzyme.name });
      for (const at of d.cuts) cuts.push({ position: at, enzyme: d.enzyme.name });
    }
    return { sites, cuts };
  }, [selectedKey, enzymes, template?.seq, span.start, span.end]);
  const info = (o: PrimerOligo) => primers?.[o.seq.toUpperCase()] ?? null;
  const hasCheckInfo = !!(info(pair.left) || info(pair.right));
  return (
    <div className="gpr-pair-detail" id={id}>
      <div className="gpr-table-wrap">
        <table className="gpr-table gpr-detail-table">
          <caption className="gpr-caption">Primer statistics, pair {n}</caption>
          <thead>
            <tr>
              <th scope="col">Statistic</th>
              <th scope="col">Left primer</th>
              <th scope="col">Right primer</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([name, render]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{render(pair.left)}</td>
                <td>{render(pair.right)}</td>
              </tr>
            ))}
            {hasCheckInfo ? (
              <tr>
                <th scope="row">Near-perfect genome sites</th>
                {[pair.left, pair.right].map((o, i) => {
                  const p = info(o);
                  return (
                    <td key={i}>
                      {p ? `${fmtInt(p.near_perfect_sites)}${p.repetitive ? ' (repetitive)' : ''}` : '–'}
                    </td>
                  );
                })}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <dl className="gpr-dl gpr-product-stats">
        <div className="gpr-dl-row">
          <dt>Product</dt>
          <dd>
            {fmtInt(pair.product_size)} bp, template {fmtInt(pair.product.start)}–{fmtInt(pair.product.end)}
          </dd>
        </div>
        <div className="gpr-dl-row">
          <dt>Product Tm</dt>
          <dd>{pair.product_tm == null ? 'not reported' : `${fmtNum(pair.product_tm, 1)} °C`}</dd>
        </div>
        <div className="gpr-dl-row">
          <dt>Pair complementarity, any / 3′ (Tm °C)</dt>
          <dd>
            {fmtNum(pair.compl_any_th)} / {fmtNum(pair.compl_end_th)}
          </dd>
        </div>
        {pair.product.genomic ? (
          <div className="gpr-dl-row">
            <dt>Genomic</dt>
            <dd>
              {formatGenomic(pair.product.genomic)}
              {pair.product.genomic_size != null ? ` (${fmtInt(pair.product.genomic_size)} bp in the genome)` : ''}
            </dd>
          </div>
        ) : null}
      </dl>
      <AmpliconSequence
        pair={pair}
        template={template}
        label={label}
        sites={marks.sites}
        cuts={marks.cuts}
      />
      <DigestPanel template={template} span={span} enzymes={enzymes} selected={selected} onSelect={setSelected} />
    </div>
  );
}
