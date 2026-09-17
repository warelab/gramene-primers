import { Fragment, useMemo, useState } from 'react';
import { amplifiesFraction, truncatedGenomeCount } from '../pangenome';
import type { Primer3DocTopic } from '../primer3Docs';
import { canAddPairToCheck, CHECK_LIMITS, pairCheckability } from '../request';
import { matchCheckResults } from '../results';
import type { CheckJob, CheckPrimerInfo, PrimerOligo, PrimerPair, PrimerTemplate, SubmittedPair } from '../types';
import { CopyButton } from './CopyButton';
import type { RestrictionEnzyme } from '../enzymes';
import { PairDetail } from './PairDetail';
import { Primer3DocText } from './Primer3Help';
import { GprRoot, type StyleProps } from './Root';
import { VerdictChip } from './VerdictChip';
import { fmtInt, fmtNum, useIdPrefix } from './util';

/** "About these columns": the table's Primer3 statistics, plus those in a pair's Details. */
const COLUMN_HELP: ReadonlyArray<readonly [string, Primer3DocTopic]> = [
  ['Tm °C, GC %', 'tm_gc'],
  ['Product bp', 'product'],
  ['Penalty', 'penalty'],
  ['Compl. any/3′', 'complementarity'],
  ['Hairpin', 'hairpin'],
  ['Self-complementarity (Details)', 'self_complementarity'],
  ['3′ end stability (Details)', 'end_stability'],
  ['Product Tm (Details)', 'product_tm'],
];

export interface PairsTableProps extends StyleProps {
  pairs: ReadonlyArray<PrimerPair>;
  template?: PrimerTemplate | null;
  /** Ranks selected for a check; shown only with `onCheckedChange`. */
  checkedRanks?: ReadonlyArray<number>;
  onCheckedChange?: (ranks: number[]) => void;
  selectedRank?: number | null;
  onSelect?: (rank: number) => void;
  /** A check job whose results are matched to pairs by UPPERCASE primer sequence. */
  check?: Pick<CheckJob, 'request' | 'results' | 'status'> | null;
  /** Fallback for matching when `check.request` is absent. */
  submitted?: ReadonlyArray<SubmittedPair> | null;
  /** FASTA label for amplicon copies. */
  label?: string;
  caption?: string;
  /** Restriction enzymes to consider. Defaults to the bundled panel. */
  enzymes?: ReadonlyArray<RestrictionEnzyme>;
  /** Enzymes whose sites are marked, shared with the template map. */
  selectedEnzymes?: ReadonlyArray<string>;
  onSelectEnzymes?: (enzymes: string[]) => void;
  /** Their colours, allocated by whoever owns the selection. */
  enzymeColours?: ReadonlyMap<string, string>;
}

function PrimerCell({ oligo, side, n, info }: { oligo: PrimerOligo; side: 'left' | 'right'; n: number; info: CheckPrimerInfo | null }): JSX.Element {
  return (
    <div className="gpr-primer">
      <span className="gpr-primer-line">
        <code className="gpr-seq">{oligo.seq}</code>
        <CopyButton text={oligo.seq} label={`Copy the ${side} primer of pair ${n}`} />
      </span>
      <span className="gpr-sub gpr-block">
        {fmtInt(oligo.start)}–{fmtInt(oligo.end)} · {oligo.len} nt
      </span>
      {info?.repetitive ? (
        <span className="gpr-badge gpr-badge-warn" title={`${fmtInt(info.near_perfect_sites)} near-perfect genome sites`}>
          repetitive<span className="gpr-visually-hidden">: {fmtInt(info.near_perfect_sites)} near-perfect genome sites</span>
        </span>
      ) : null}
    </div>
  );
}

function JunctionBadges({ pair }: { pair: PrimerPair }): JSX.Element {
  const badges = (
    [
      ['L', 'left', pair.left],
      ['R', 'right', pair.right],
    ] as const
  ).filter(([, , o]) => !!o.junction);
  if (!badges.length) return <span className="gpr-sub">–</span>;
  return (
    <>
      {badges.map(([short, side, o]) => (
        <span key={short} className="gpr-badge gpr-badge-junction" title={`The ${side} primer spans the junction at ${o.junction!.position}`}>
          <span aria-hidden="true">
            {short} ⟂ {fmtInt(o.junction!.position)}
          </span>
          <span className="gpr-visually-hidden">
            {side} primer spans the junction at {fmtInt(o.junction!.position)} ({o.junction!.overlap_5p} nt 5′, {o.junction!.overlap_3p} nt 3′)
          </span>
        </span>
      ))}
    </>
  );
}

/** Designed pairs with copy buttons, stats, junction badges, check selection and verdict chips (spec §C.3). */
export function PairsTable(props: PairsTableProps): JSX.Element {
  const { pairs, template, checkedRanks, onCheckedChange, selectedRank, onSelect, check, submitted, label, caption } = props;
  const idp = useIdPrefix('gpr-pairs');
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const matched = useMemo(() => (check ? matchCheckResults(pairs, check, submitted) : null), [pairs, check, submitted]);
  const checkedSet = new Set(checkedRanks ?? []);
  const selectedPairs = pairs.filter((p) => checkedSet.has(p.rank));
  const showCheckbox = !!onCheckedChange;
  const showVerdict = !!check;
  const running = check?.status === 'queued' || check?.status === 'running';
  const primers = check?.results?.primers ?? null;
  const isTranscript = template?.mode === 'transcript';
  const colCount = 11 + (showCheckbox ? 1 : 0) + (showVerdict ? 1 : 0);

  const toggleChecked = (rank: number, on: boolean) => {
    const next = new Set(checkedSet);
    if (on) next.add(rank);
    else next.delete(rank);
    onCheckedChange?.([...next].sort((a, b) => a - b));
  };

  return (
    <GprRoot theme={props.theme} injectStyles={props.injectStyles} className={props.className} style={props.style}>
      <div className="gpr-table-wrap">
        <table className="gpr-table gpr-pairs-table">
          <caption className="gpr-caption">
            {caption ?? `${pairs.length} primer pair${pairs.length === 1 ? '' : 's'}`}
            {showCheckbox ? (
              <span className="gpr-sub">
                {' '}
                · tick up to {CHECK_LIMITS.maxPairs} pairs ({CHECK_LIMITS.maxUniquePrimers} distinct primers) to check them
              </span>
            ) : null}
          </caption>
          <thead>
            <tr>
              {showCheckbox ? (
                <th scope="col" className="gpr-col-check">
                  <span className="gpr-visually-hidden">Select for check</span>
                </th>
              ) : null}
              <th scope="col">#</th>
              <th scope="col">Left primer 5′→3′</th>
              <th scope="col">Right primer 5′→3′</th>
              <th scope="col">Tm °C L/R</th>
              <th scope="col">GC % L/R</th>
              <th scope="col">Product bp</th>
              <th scope="col">Penalty</th>
              <th scope="col">Compl. any/3′</th>
              <th scope="col">Hairpin L/R</th>
              <th scope="col">Junction</th>
              {showVerdict ? <th scope="col">Check</th> : null}
              <th scope="col">
                <span className="gpr-visually-hidden">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => {
              const n = p.rank + 1;
              const selected = p.rank === selectedRank;
              const isExpanded = expanded.has(p.rank);
              const detailId = `${idp}-detail-${p.rank}`;
              const checkability = pairCheckability(p);
              const isChecked = checkedSet.has(p.rank);
              const canAdd = isChecked || canAddPairToCheck(selectedPairs, p);
              const reason = !checkability.ok
                ? checkability.message
                : !canAdd
                  ? `At most ${CHECK_LIMITS.maxPairs} pairs and ${CHECK_LIMITS.maxUniquePrimers} distinct primers can be checked at once`
                  : null;
              const reasonId = `${idp}-why-${p.rank}`;
              const m = matched?.byRank.get(p.rank) ?? null;
              const pan = m?.pangenome ? amplifiesFraction(m.pangenome.summary) : null;
              const incomplete = m?.pangenome ? truncatedGenomeCount(m.pangenome) : 0;
              return (
                <Fragment key={p.rank}>
                  <tr className="gpr-pair-row" data-state={selected ? 'selected' : undefined} data-rank={p.rank}>
                    {showCheckbox ? (
                      <td className="gpr-col-check">
                        <input
                          type="checkbox"
                          className="gpr-checkbox"
                          aria-label={`Check pair ${n}`}
                          checked={isChecked}
                          disabled={!!reason && !isChecked}
                          aria-describedby={reason ? reasonId : undefined}
                          onChange={(e) => toggleChecked(p.rank, e.target.checked)}
                        />
                        {reason ? (
                          <span id={reasonId} className="gpr-visually-hidden">
                            {reason}
                          </span>
                        ) : null}
                        {!checkability.ok ? (
                          <span className="gpr-sub gpr-block gpr-not-checkable" aria-hidden="true" title={checkability.message}>
                            not checkable
                          </span>
                        ) : null}
                      </td>
                    ) : null}
                    <th scope="row" className="gpr-col-rank">
                      {onSelect ? (
                        <button type="button" className="gpr-rank" aria-pressed={selected} aria-label={`Select pair ${n}`} onClick={() => onSelect(p.rank)}>
                          {n}
                        </button>
                      ) : (
                        n
                      )}
                    </th>
                    <td className="gpr-col-primer">
                      <PrimerCell oligo={p.left} side="left" n={n} info={primers?.[p.left.seq.toUpperCase()] ?? null} />
                    </td>
                    <td className="gpr-col-primer">
                      <PrimerCell oligo={p.right} side="right" n={n} info={primers?.[p.right.seq.toUpperCase()] ?? null} />
                    </td>
                    <td className="gpr-num">
                      {fmtNum(p.left.tm)} / {fmtNum(p.right.tm)}
                    </td>
                    <td className="gpr-num">
                      {fmtNum(p.left.gc)} / {fmtNum(p.right.gc)}
                    </td>
                    <td className="gpr-num">
                      {fmtInt(p.product_size)}
                      {isTranscript && p.product?.genomic_size != null ? <span className="gpr-sub gpr-block">gDNA {fmtInt(p.product.genomic_size)}</span> : null}
                    </td>
                    <td className="gpr-num">{fmtNum(p.penalty, 2)}</td>
                    <td className="gpr-num">
                      {fmtNum(p.compl_any_th)} / {fmtNum(p.compl_end_th)}
                    </td>
                    <td className="gpr-num">
                      {fmtNum(p.left.hairpin_th)} / {fmtNum(p.right.hairpin_th)}
                    </td>
                    <td className="gpr-col-junction">
                      <JunctionBadges pair={p} />
                    </td>
                    {showVerdict ? (
                      <td className="gpr-col-verdict">
                        {m ? (
                          <span className="gpr-verdicts">
                            {m.specificity ? (
                              <VerdictChip verdict={m.specificity.verdict} count={m.specificity.off_target_count} inferred={m.specificity.on_target_inferred} context="Genome" />
                            ) : (
                              <VerdictChip verdict={running ? 'pending' : 'not_checked'} context="Genome" />
                            )}
                            {m.transcriptome ? (
                              <span className="gpr-verdict-line">
                                <span className="gpr-sub" aria-hidden="true">
                                  cDNA
                                </span>{' '}
                                <VerdictChip verdict={m.transcriptome.verdict} count={m.transcriptome.off_target_count} context="Transcriptome" />
                              </span>
                            ) : null}
                            {pan ? (
                              <span className="gpr-sub gpr-block gpr-amplifies">
                                amplifies {pan.amplifies}/{pan.total}
                                {incomplete ? ` · ${incomplete} incomplete` : ''}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <VerdictChip verdict="not_checked" />
                        )}
                      </td>
                    ) : null}
                    <td className="gpr-col-expand">
                      <button
                        type="button"
                        className="gpr-btn gpr-btn-small gpr-btn-quiet"
                        aria-expanded={isExpanded}
                        aria-controls={isExpanded ? detailId : undefined}
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(p.rank)) next.delete(p.rank);
                            else next.add(p.rank);
                            return next;
                          })
                        }
                      >
                        {isExpanded ? 'Hide' : 'Details'}
                        <span className="gpr-visually-hidden"> of pair {n}</span>
                      </button>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr className="gpr-detail-row">
                      <td colSpan={colCount}>
                        <PairDetail
                          id={detailId}
                          pair={p}
                          template={template}
                          label={label}
                          primers={primers}
                          enzymes={props.enzymes}
                          selectedEnzymes={props.selectedEnzymes}
                          onSelectEnzymes={props.onSelectEnzymes}
                          enzymeColours={props.enzymeColours}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <details className="gpr-details gpr-column-help">
        <summary className="gpr-summary">About these columns</summary>
        <dl className="gpr-dl gpr-column-help-list">
          {COLUMN_HELP.map(([term, topic]) => (
            <div className="gpr-dl-row" key={topic}>
              <dt>{term}</dt>
              <dd>
                <Primer3DocText topic={topic} />
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </GprRoot>
  );
}
