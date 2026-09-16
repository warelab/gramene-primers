import type { ReactNode } from 'react';
import { formatGenomic } from '../coords';
import type { GenotypeSetResults, GenotypingOligo, GenotypingSet } from '../types';
import { CopyButton } from './CopyButton';
import { PrimerStatusChip } from './GenotypeChip';
import { fmtInt, fmtNum } from './util';

export interface SetDetailProps {
  set: GenotypingSet;
  /** Allele-call results for this set, when a check has run. */
  results?: GenotypeSetResults | null;
  id?: string;
}

const ROLE_LABEL = { as_ref: 'REF primer', as_alt: 'ALT primer', common: 'Common primer' } as const;

/**
 * Per-oligo statistics. `target_seq` is what anneals and what a check receives;
 * `order_seq` is what the vendor synthesizes, so both are shown and copied
 * separately.
 */
const ROWS: ReadonlyArray<[string, (o: GenotypingOligo) => ReactNode]> = [
  ['Target sequence (5′→3′)', (o) => <code className="gpr-seq">{o.target_seq}</code>],
  ['Order sequence (5′→3′)', (o) => (o.tail_seq ? <code className="gpr-seq">{o.order_seq}</code> : <span className="gpr-sub">same as the target sequence</span>)],
  ['Tail', (o) => (o.tail_seq ? <code className="gpr-seq">{o.tail_seq}</code> : '–')],
  ['Dye', (o) => o.dye ?? '–'],
  ['Allele read', (o) => o.allele ?? '–'],
  ['3′ base', (o) => o.three_prime_base],
  ['Length', (o) => `${o.len} nt${o.order_len !== o.len ? ` (${o.order_len} nt ordered)` : ''}`],
  ['Tm', (o) => `${fmtNum(o.tm, 2)} °C${o.tm_method === 'ntthal_duplex' ? ' (template duplex)' : ''}`],
  ['Perfect-match Tm', (o) => (o.matched_tm == null ? '–' : `${fmtNum(o.matched_tm, 2)} °C`)],
  ['GC', (o) => `${fmtNum(o.gc, 1)} %`],
  ['Hairpin (Tm °C)', (o) => fmtNum(o.hairpin_th)],
  ['Self-complementarity, any / 3′ (Tm °C)', (o) => `${fmtNum(o.self_any_th)} / ${fmtNum(o.self_end_th)}`],
  ['Tailed hairpin / self 3′ (Tm °C)', (o) => (o.tailed ? `${fmtNum(o.tailed.hairpin_th)} / ${fmtNum(o.tailed.self_end_th)}` : '–')],
  ['3′ end stability (kcal/mol)', (o) => fmtNum(o.end_stability, 2)],
  ['Template position', (o) => `${fmtInt(o.template.start)}–${fmtInt(o.template.end)} (${o.template.sequence.toUpperCase()})`],
  [
    'Genomic',
    (o) =>
      o.genomic ? (
        <>
          {formatGenomic(o.genomic)}
          {o.genomic.blocks.length > 1 ? <span className="gpr-sub gpr-block">{o.genomic.blocks.length} blocks — the primer spans the indel</span> : null}
        </>
      ) : (
        '–'
      ),
  ],
  ['Bases with no reference coordinate', (o) => (o.inserted_bases > 0 ? `${o.inserted_bases} inserted` : '–')],
  [
    'Deliberate mismatch',
    (o) =>
      o.deliberate_mismatch
        ? `−${o.deliberate_mismatch.position}${o.deliberate_mismatch.from && o.deliberate_mismatch.to ? ` ${o.deliberate_mismatch.from}→${o.deliberate_mismatch.to}` : ''}`
        : '–',
  ],
  [
    'Discrimination',
    (o) =>
      o.discrimination ? (
        <>
          own {o.discrimination.own_allele.likelihood}, other {o.discrimination.other_allele.likelihood}
          <span className="gpr-sub gpr-block">
            terminal class {o.discrimination.terminal_mismatch_class}
            {o.discrimination.in_shift_tract ? ' · 3′ base inside the shift tract' : ''}
          </span>
        </>
      ) : (
        '–'
      ),
  ],
  ['Primer3 notes', (o) => o.primer3_problems ?? '–'],
];

/** The expanded set: the three oligos side by side, products, structures and neighbours. */
export function SetDetail({ set, results, id }: SetDetailProps): JSX.Element {
  const oligos: GenotypingOligo[] = [set.primers.as_ref, set.primers.as_alt, set.primers.common];
  const neighbours = oligos.flatMap((o) => o.neighbours.map((n) => ({ role: o.role, n })));
  const reference = results?.reference ?? null;
  return (
    <div className="gpr-set-detail" id={id}>
      <div className="gpr-table-wrap">
        <table className="gpr-table gpr-detail-table">
          <caption className="gpr-caption">Primer statistics, set {set.id}</caption>
          <thead>
            <tr>
              <th scope="col">Statistic</th>
              {oligos.map((o) => (
                <th scope="col" key={o.role}>
                  {ROLE_LABEL[o.role]}
                  <CopyButton text={o.target_seq} label={`Copy the target sequence of the ${ROLE_LABEL[o.role].toLowerCase()} of set ${set.id}`} />
                  {o.tail_seq ? <CopyButton text={o.order_seq} label={`Copy the order sequence of the ${ROLE_LABEL[o.role].toLowerCase()} of set ${set.id}`}>Copy order</CopyButton> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([name, render]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                {oligos.map((o) => (
                  <td key={o.role}>{render(o)}</td>
                ))}
              </tr>
            ))}
            {reference ? (
              <tr>
                <th scope="row">Reference genome reads</th>
                {(['ref_primer', 'alt_primer', 'common_primer'] as const).map((k) => (
                  <td key={k}>
                    <PrimerStatusChip status={reference[k].status} context={ROLE_LABEL[oligos[(['ref_primer', 'alt_primer', 'common_primer'] as const).indexOf(k)]!.role]} />
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <dl className="gpr-dl gpr-set-stats">
        <div className="gpr-dl-row">
          <dt>Products</dt>
          <dd>
            REF {fmtInt(set.products.ref.size)} bp · ALT {fmtInt(set.products.alt.size)} bp
          </dd>
        </div>
        <div className="gpr-dl-row">
          <dt>Tm balance</dt>
          <dd>
            allele-specific primers differ by {fmtNum(set.tm_balance.as_tm_diff, 2)} °C; common primer {fmtNum(set.tm_balance.common_minus_as, 2)} °C above them
          </dd>
        </div>
        <div className="gpr-dl-row">
          <dt>Cross-complementarity, any / 3′ (Tm °C)</dt>
          <dd>
            REF+common {fmtNum(set.thermo.ref_common.compl_any_th)} / {fmtNum(set.thermo.ref_common.compl_end_th)} · ALT+common {fmtNum(set.thermo.alt_common.compl_any_th)} /{' '}
            {fmtNum(set.thermo.alt_common.compl_end_th)}
          </dd>
        </div>
        {set.thermo.tailed ? (
          <div className="gpr-dl-row">
            <dt>Tailed cross-complementarity, any / 3′ (Tm °C)</dt>
            <dd>
              REF+ALT {fmtNum(set.thermo.tailed.ref_alt_any_th)} / {fmtNum(set.thermo.tailed.ref_alt_end_th)} · REF+common {fmtNum(set.thermo.tailed.ref_common_any_th)} /{' '}
              {fmtNum(set.thermo.tailed.ref_common_end_th)} · ALT+common {fmtNum(set.thermo.tailed.alt_common_any_th)} / {fmtNum(set.thermo.tailed.alt_common_end_th)}
            </dd>
          </div>
        ) : null}
        <div className="gpr-dl-row">
          <dt>Score</dt>
          <dd>
            {fmtNum(set.score, 2)} <span className="gpr-sub">(lower is better; Primer3 penalty {fmtNum(set.primer3_penalty, 2)})</span>
          </dd>
        </div>
      </dl>

      {set.issues.length ? (
        <div className="gpr-set-issues">
          <p className="gpr-h4">Issues</p>
          <ul className="gpr-plain-list">
            {set.issues.map((issue) => (
              <li key={issue.code} className="gpr-set-issue" data-severity={issue.severity} data-code={issue.code}>
                <span className="gpr-set-issue-severity">{issue.severity === 'high' ? 'Important' : issue.severity === 'warn' ? 'Check' : 'Note'}</span> {issue.message}{' '}
                <code className="gpr-code">{issue.code}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {neighbours.length ? (
        <div className="gpr-table-wrap">
          <table className="gpr-table gpr-neighbour-table">
            <caption className="gpr-caption">
              Known variants under the primers of set {set.id} · a filled marker is a natural variant, hollow is EMS
            </caption>
            <thead>
              <tr>
                <th scope="col">Primer</th>
                <th scope="col">Variant</th>
                <th scope="col">Alleles</th>
                <th scope="col">From the 3′ end</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {neighbours.map(({ role, n }) => (
                <tr key={`${role}-${n.key}`}>
                  <th scope="row">{ROLE_LABEL[role]}</th>
                  <td>{n.label}</td>
                  <td>{n.alleles}</td>
                  <td className="gpr-num">
                    {n.distance_from_3p} nt{n.distance_from_3p === 1 ? ' (the 3′ base)' : ''}
                  </td>
                  <td>
                    <span aria-hidden="true">{n.ems ? '○' : '●'}</span> {n.ems ? 'EMS' : 'natural'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
