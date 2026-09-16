import { Fragment, useMemo } from 'react';
import { ampliconsToFasta } from '../exporters';
import type { PrimerPair, PrimerTemplate } from '../types';
import { CopyButton } from './CopyButton';
import { cx, fmtInt } from './util';

export const AMPLICON_LINE_WIDTH = 60;

export interface AmpliconSequenceProps {
  pair: PrimerPair;
  template: Pick<PrimerTemplate, 'seq' | 'length' | 'mask' | 'features'> | null | undefined;
  /** FASTA record prefix. */
  label?: string;
  /**
   * Template positions where a chosen enzyme severs the top strand; the break
   * is drawn before each base. One enzyme at a time — every site in the panel
   * at once would bar the sequence into confetti.
   */
  cuts?: ReadonlyArray<number>;
  /** Named in the legend beside the cut marks. */
  cutLabel?: string;
}

interface Segment {
  text: string;
  cls: string;
  barAfter: boolean;
  cutAfter: boolean;
}

/** The amplicon in 60-nt lines with primer footprints, masked bases and junction bars (spec §C.3 PairDetail). */
export function AmpliconSequence({ pair, template, label, cuts, cutLabel }: AmpliconSequenceProps): JSX.Element {
  const seq = template?.seq ?? '';
  const start = pair.left.start;
  const end = pair.right.end;
  const valid = !!seq && start >= 1 && end <= seq.length && end >= start;
  const junctionList = template?.features?.junctions;
  const maskList = template?.mask;
  const cutKey = (cuts ?? []).join(',');

  const { lines, hasMask, hasJunction, hasCut } = useMemo(() => {
    if (!valid) return { lines: [], hasMask: false, hasJunction: false, hasCut: false };
    const junctions = new Set((junctionList ?? []).filter((j) => j >= start && j < end));
    // A cut before base p is a break after p-1, which is where the bar goes.
    const cutAfterSet = new Set((cuts ?? []).map((c) => c - 1).filter((t) => t >= start && t < end));
    const masked = new Uint8Array(end - start + 1);
    for (const [s, l] of maskList ?? []) {
      for (let t = Math.max(s, start); t <= Math.min(end, s + l - 1); t++) masked[t - start] = 1;
    }
    const out: Array<{ pos: number; segs: Segment[] }> = [];
    let anyMask = false;
    for (let lineStart = start; lineStart <= end; lineStart += AMPLICON_LINE_WIDTH) {
      const lineEnd = Math.min(end, lineStart + AMPLICON_LINE_WIDTH - 1);
      const segs: Segment[] = [];
      let cur: Segment | null = null;
      for (let t = lineStart; t <= lineEnd; t++) {
        const isMasked = masked[t - start] === 1;
        anyMask = anyMask || isMasked;
        const cls =
          cx(
            t >= pair.left.start && t <= pair.left.end && 'gpr-fp-left',
            t >= pair.right.start && t <= pair.right.end && 'gpr-fp-right',
            isMasked && 'gpr-seq-masked',
          ) || 'gpr-seq-plain';
        if (!cur || cur.cls !== cls) {
          cur = { text: '', cls, barAfter: false, cutAfter: false };
          segs.push(cur);
        }
        cur.text += seq[t - 1] ?? '';
        if (junctions.has(t) || cutAfterSet.has(t)) {
          cur.barAfter = junctions.has(t);
          cur.cutAfter = cutAfterSet.has(t);
          cur = null;
        }
      }
      out.push({ pos: lineStart, segs });
    }
    return { lines: out, hasMask: anyMask, hasJunction: junctions.size > 0, hasCut: cutAfterSet.size > 0 };
  }, [valid, seq, start, end, pair.left.start, pair.left.end, pair.right.start, pair.right.end, junctionList, maskList, cutKey]);

  if (!valid) return <p className="gpr-hint">The amplicon sequence is not available.</p>;
  const n = pair.rank + 1;
  const posWidth = String(end).length;
  return (
    <div className="gpr-amplicon">
      <div className="gpr-amplicon-head">
        <span className="gpr-amplicon-title">
          Amplicon: {fmtInt(end - start + 1)} bp (template {fmtInt(start)}–{fmtInt(end)})
        </span>
        <CopyButton text={() => ampliconsToFasta([pair], template ? { seq, length: template.length } : null, { label })} label={`Copy the amplicon of pair ${n} as FASTA`}>
          Copy FASTA
        </CopyButton>
      </div>
      <div className="gpr-amplicon-seq" role="group" aria-label={`Amplicon sequence of pair ${n}`}>
        {lines.map((line) => (
          <div key={line.pos} className="gpr-amplicon-line">
            <span className="gpr-amplicon-pos" aria-hidden="true">
              {String(line.pos).padStart(posWidth, ' ')}
            </span>
            {line.segs.map((s, i) => (
              <Fragment key={i}>
                <span className={s.cls}>{s.text}</span>
                {s.barAfter ? <span className="gpr-junction-bar" aria-hidden="true" /> : null}
                {s.cutAfter ? <span className="gpr-cut-bar" aria-hidden="true" /> : null}
              </Fragment>
            ))}
          </div>
        ))}
      </div>
      <p className="gpr-amplicon-legend">
        <span className="gpr-fp-left">left primer</span> <span className="gpr-fp-right">right primer site (reverse complement)</span>
        {hasJunction ? (
          <>
            {' '}
            <span className="gpr-junction-sample" aria-hidden="true" /> exon–exon junction
          </>
        ) : null}
        {hasCut ? (
          <>
            {' '}
            <span className="gpr-cut-sample" aria-hidden="true" /> {cutLabel ? `${cutLabel} cut` : 'cut site'}
          </>
        ) : null}
        {hasMask ? (
          <>
            {' '}
            <span className="gpr-seq-masked">masked</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
