import { Fragment, useMemo, useState } from 'react';
import { GENOTYPING_CHECK_LIMITS } from '../request';
import { matchGenotypingResults } from '../results';
import type { CheckJob, GenotypingOligo, GenotypingQuality, GenotypingSet, SubmittedGenotypingSet } from '../types';
import { CopyButton } from './CopyButton';
import { AgreementMark } from './GenotypeChip';
import { GprRoot, type StyleProps } from './Root';
import { SetDetail } from './SetDetail';
import { VerdictChip } from './VerdictChip';
import { cx, fmtInt, fmtNum, useIdPrefix } from './util';

const QUALITY_META: Readonly<Record<GenotypingQuality, { glyph: string; label: string; tone: 'ok' | 'warn' | 'bad' }>> = Object.freeze({
  good: { glyph: '✓', label: 'Good', tone: 'ok' },
  usable: { glyph: '~', label: 'Usable', tone: 'warn' },
  poor: { glyph: '!', label: 'Poor', tone: 'bad' },
});

const ORIENTATION_ARROW = { forward: '→', reverse: '←' } as const;

export interface SetsTableProps extends StyleProps {
  sets: ReadonlyArray<GenotypingSet>;
  /** Set keys selected for a check; shown only with `onCheckedChange`. */
  checkedKeys?: ReadonlyArray<string>;
  onCheckedChange?: (keys: string[]) => void;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  /** A check job whose allele results are matched to sets by target-sequence triple. */
  check?: Pick<CheckJob, 'request' | 'results' | 'status'> | null;
  /** Fallback for matching when `check.request` is absent. */
  submitted?: ReadonlyArray<SubmittedGenotypingSet> | null;
  caption?: string;
}

/** One allele-specific or common primer, with its two sequences copied separately. */
function PrimerCell({ oligo, set }: { oligo: GenotypingOligo; set: GenotypingSet }): JSX.Element {
  const role = oligo.role === 'common' ? 'common primer' : `${oligo.role === 'as_ref' ? 'REF' : 'ALT'} primer`;
  // The 3′ base carries the discrimination, so it is marked rather than left to be counted.
  const body = oligo.target_seq.slice(0, -1);
  const last = oligo.target_seq.slice(-1);
  return (
    <div className="gpr-primer gpr-set-primer">
      <span className="gpr-primer-line">
        <code className="gpr-seq">
          {body}
          <span className="gpr-seq-3p">{last}</span>
        </code>
        <CopyButton text={oligo.target_seq} label={`Copy the ${role} of set ${set.id}`} />
      </span>
      <span className="gpr-sub gpr-block">
        {oligo.allele ? (
          <span className="gpr-badge gpr-allele-badge" title={`Reads the ${oligo.allele} allele`}>
            {oligo.allele}
          </span>
        ) : null}{' '}
        {oligo.dye ? <span className="gpr-badge gpr-dye-badge">{oligo.dye}</span> : null} {oligo.len} nt · {fmtNum(oligo.tm, 1)} °C · {fmtNum(oligo.gc, 0)} % GC
      </span>
      {oligo.tail_seq ? (
        <span className="gpr-sub gpr-block">
          tailed: {oligo.order_len} nt <CopyButton text={oligo.order_seq} label={`Copy the tailed order sequence of the ${role} of set ${set.id}`}>Copy order</CopyButton>
        </span>
      ) : null}
      {oligo.inserted_bases > 0 ? (
        <span className="gpr-sub gpr-block">{oligo.inserted_bases} base{oligo.inserted_bases === 1 ? '' : 's'} with no reference coordinate</span>
      ) : null}
    </div>
  );
}

/**
 * Designed genotyping sets: one row per set, keyed by `set.key` (content-derived
 * and stable), never by `set.id`, which is positional and changes when a design
 * is re-run (spec §3.3).
 */
export function SetsTable(props: SetsTableProps): JSX.Element {
  const { sets, checkedKeys, onCheckedChange, selectedKey, onSelect, check, submitted, caption } = props;
  const idp = useIdPrefix('gpr-sets');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const matched = useMemo(() => (check ? matchGenotypingResults(sets, check, submitted) : null), [sets, check, submitted]);
  const checkedSet = new Set(checkedKeys ?? []);
  const showCheckbox = !!onCheckedChange;
  const showVerdict = !!check;
  const running = check?.status === 'queued' || check?.status === 'running';
  const atSetCap = checkedSet.size >= GENOTYPING_CHECK_LIMITS.maxSets;
  const colCount = 9 + (showCheckbox ? 1 : 0) + (showVerdict ? 1 : 0);

  const toggleChecked = (key: string, on: boolean) => {
    const next = checkedKeys ? [...checkedKeys] : [];
    const at = next.indexOf(key);
    if (on && at < 0) next.push(key);
    else if (!on && at >= 0) next.splice(at, 1);
    onCheckedChange?.(next);
  };

  return (
    <GprRoot theme={props.theme} injectStyles={props.injectStyles} className={props.className} style={props.style}>
      <div className="gpr-table-wrap">
        <table className="gpr-table gpr-sets-table">
          <caption className="gpr-caption">
            {caption ?? `${sets.length} primer set${sets.length === 1 ? '' : 's'}`}
            {showCheckbox ? <span className="gpr-sub"> · tick up to {GENOTYPING_CHECK_LIMITS.maxSets} sets to check them</span> : null}
          </caption>
          <thead>
            <tr>
              {showCheckbox ? (
                <th scope="col" className="gpr-col-check">
                  <span className="gpr-visually-hidden">Select for check</span>
                </th>
              ) : null}
              <th scope="col">Set</th>
              <th scope="col">REF primer 5′→3′</th>
              <th scope="col">ALT primer 5′→3′</th>
              <th scope="col">Common primer 5′→3′</th>
              <th scope="col">Product bp</th>
              <th scope="col">Tm balance °C</th>
              <th scope="col">Variants</th>
              <th scope="col">Quality</th>
              {showVerdict ? <th scope="col">Check</th> : null}
              <th scope="col">
                <span className="gpr-visually-hidden">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sets.map((set) => {
              const isChecked = checkedSet.has(set.key);
              const isExpanded = expanded.has(set.key);
              const selected = set.key === selectedKey;
              const detailId = `${idp}-detail-${set.key}`;
              const reasonId = `${idp}-why-${set.key}`;
              const reason = !isChecked && atSetCap ? `At most ${GENOTYPING_CHECK_LIMITS.maxSets} sets can be checked at once` : null;
              const quality = QUALITY_META[set.quality] ?? QUALITY_META.poor;
              const m = matched?.bySetKey.get(set.key) ?? null;
              const r = m?.results ?? null;
              const highIssues = set.issues.filter((i) => i.severity === 'high');
              return (
                <Fragment key={set.key}>
                  <tr className="gpr-set-row" data-state={selected ? 'selected' : undefined} data-key={set.key}>
                    {showCheckbox ? (
                      <td className="gpr-col-check">
                        <input
                          type="checkbox"
                          className="gpr-checkbox"
                          aria-label={`Check set ${set.id}`}
                          checked={isChecked}
                          disabled={!!reason}
                          aria-describedby={reason ? reasonId : undefined}
                          onChange={(e) => toggleChecked(set.key, e.target.checked)}
                        />
                        {reason ? (
                          <span id={reasonId} className="gpr-visually-hidden">
                            {reason}
                          </span>
                        ) : null}
                      </td>
                    ) : null}
                    <th scope="row" className="gpr-col-set">
                      {onSelect ? (
                        <button type="button" className="gpr-rank" aria-pressed={selected} aria-label={`Select set ${set.id}`} onClick={() => onSelect(set.key)}>
                          {set.id}
                        </button>
                      ) : (
                        set.id
                      )}
                      <span className="gpr-sub gpr-block">
                        <span aria-hidden="true">{ORIENTATION_ARROW[set.orientation]} </span>
                        {set.orientation}
                      </span>
                      {set.relaxation_level > 0 ? (
                        <span className="gpr-sub gpr-block" title="These constraints were relaxed to find a set">
                          level {set.relaxation_level}
                        </span>
                      ) : null}
                    </th>
                    <td className="gpr-col-primer">
                      <PrimerCell oligo={set.primers.as_ref} set={set} />
                    </td>
                    <td className="gpr-col-primer">
                      <PrimerCell oligo={set.primers.as_alt} set={set} />
                    </td>
                    <td className="gpr-col-primer">
                      <PrimerCell oligo={set.primers.common} set={set} />
                    </td>
                    <td className="gpr-num">
                      {fmtInt(set.products.ref.size)}
                      {set.products.alt.size !== set.products.ref.size ? <span className="gpr-sub gpr-block">ALT {fmtInt(set.products.alt.size)}</span> : null}
                    </td>
                    <td className="gpr-num">
                      {fmtNum(set.tm_balance.as_tm_diff, 1)}
                      <span className="gpr-sub gpr-block">common {fmtNum(set.tm_balance.common_minus_as, 1)}</span>
                    </td>
                    <td className="gpr-num">{set.neighbour_sites === 0 ? <span className="gpr-sub">none</span> : fmtInt(set.neighbour_sites)}</td>
                    <td className="gpr-col-quality">
                      <span className={cx('gpr-chip', `gpr-chip-${quality.tone}`)} data-quality={set.quality}>
                        <span className="gpr-chip-glyph" aria-hidden="true">
                          {quality.glyph}
                        </span>
                        <span className="gpr-chip-text">{quality.label}</span>
                      </span>
                      {highIssues.map((issue) => (
                        <span key={issue.code} className="gpr-badge gpr-badge-warn gpr-issue-badge" data-code={issue.code} title={issue.message}>
                          {issue.code.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      ))}
                    </td>
                    {showVerdict ? (
                      <td className="gpr-col-verdict">
                        {r ? (
                          <span className="gpr-verdicts">
                            <span className="gpr-agreement-line">
                              <AgreementMark agrees={r.summary.disagree === 0 ? true : false} />{' '}
                              <span className="gpr-sub">
                                {r.summary.agree}/{r.summary.agree + r.summary.disagree} agree
                              </span>
                            </span>
                            <span className="gpr-verdict-line">
                              <span className="gpr-sub" aria-hidden="true">
                                REF
                              </span>{' '}
                              <VerdictChip verdict={r.specificity.ref_pair.verdict} count={r.specificity.off_target_count} context="REF pair genome specificity" />
                            </span>
                            <span className="gpr-verdict-line">
                              <span className="gpr-sub" aria-hidden="true">
                                ALT
                              </span>{' '}
                              <VerdictChip verdict={r.specificity.alt_pair.verdict} context="ALT pair genome specificity" />
                            </span>
                            {r.control.status !== 'pass' ? (
                              <span className="gpr-sub gpr-block gpr-control-warn">reference control {r.control.status}</span>
                            ) : null}
                          </span>
                        ) : (
                          <VerdictChip verdict={running ? 'pending' : 'not_checked'} context="Allele check" />
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
                            if (next.has(set.key)) next.delete(set.key);
                            else next.add(set.key);
                            return next;
                          })
                        }
                      >
                        {isExpanded ? 'Hide' : 'Details'}
                        <span className="gpr-visually-hidden"> of set {set.id}</span>
                      </button>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr className="gpr-detail-row">
                      <td colSpan={colCount}>
                        <SetDetail id={detailId} set={set} results={r} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {matched?.notChecked.length ? (
        <p className="gpr-hint">
          {matched.notChecked.length} set{matched.notChecked.length === 1 ? ' was' : 's were'} not part of this check.
        </p>
      ) : null}
      {matched?.orphanIds.length ? (
        <p className="gpr-hint">
          The check also returned results for {matched.orphanIds.length} set{matched.orphanIds.length === 1 ? '' : 's'} that {matched.orphanIds.length === 1 ? 'is' : 'are'} not in
          this design.
        </p>
      ) : null}
    </GprRoot>
  );
}
