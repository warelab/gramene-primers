import { Fragment, useMemo } from 'react';
import { ampliconsToFasta } from '../exporters';
import type { PrimerPair, PrimerTemplate } from '../types';
import { enzymeColor } from '../enzymes';
import { CopyButton } from './CopyButton';
import { cx, fmtInt } from './util';

export const AMPLICON_LINE_WIDTH = 60;

export interface AmpliconSequenceProps {
  pair: PrimerPair;
  template: Pick<PrimerTemplate, 'seq' | 'length' | 'mask' | 'features'> | null | undefined;
  /** FASTA record prefix. */
  label?: string;
  /**
   * Recognition sites to highlight, in template coordinates, each naming the
   * enzyme it belongs to so several can be shown at once in their own colours.
   */
  sites?: ReadonlyArray<{ start: number; end: number; enzyme: string }>;
  /** Template positions where the strand is severed; the break is drawn before each base. */
  cuts?: ReadonlyArray<{ position: number; enzyme: string }>;
}

interface Segment {
  text: string;
  cls: string;
  barAfter: boolean;
  /** Enzymes severing the strand after this segment. */
  cutAfter: string[];
  /** Enzymes whose site covers these bases; the first one colours them. */
  siteOf: string[];
}

/** The amplicon in 60-nt lines with primer footprints, masked bases and junction bars (spec §C.3 PairDetail). */
export function AmpliconSequence({ pair, template, label, sites, cuts }: AmpliconSequenceProps): JSX.Element {
  const seq = template?.seq ?? '';
  const start = pair.left.start;
  const end = pair.right.end;
  const valid = !!seq && start >= 1 && end <= seq.length && end >= start;
  const junctionList = template?.features?.junctions;
  const maskList = template?.mask;
  const cutKey = (cuts ?? []).map((c) => `${c.position}:${c.enzyme}`).join(',');
  const siteKey = (sites ?? []).map((x) => `${x.start}:${x.end}:${x.enzyme}`).join(',');

  const { lines, hasMask, hasJunction, shown } = useMemo(() => {
    if (!valid) return { lines: [], hasMask: false, hasJunction: false, shown: [] as string[] };
    const junctions = new Set((junctionList ?? []).filter((j) => j >= start && j < end));
    // Several enzymes can cover a base or cut in the same place, so each
    // position carries a list rather than a flag. A cut before base p is a
    // break after p-1, which is where the bar goes.
    const cutsAt = new Map<number, string[]>();
    for (const c of cuts ?? []) {
      const t = c.position - 1;
      if (t < start || t >= end) continue;
      const list = cutsAt.get(t) ?? [];
      if (!list.includes(c.enzyme)) list.push(c.enzyme);
      cutsAt.set(t, list);
    }
    const siteAt = new Map<number, string[]>();
    for (const s of sites ?? []) {
      for (let t = Math.max(s.start, start); t <= Math.min(s.end, end); t++) {
        const list = siteAt.get(t) ?? [];
        if (!list.includes(s.enzyme)) list.push(s.enzyme);
        siteAt.set(t, list);
      }
    }
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
        const siteOf = siteAt.get(t) ?? [];
        const cls =
          cx(
            t >= pair.left.start && t <= pair.left.end && 'gpr-fp-left',
            t >= pair.right.start && t <= pair.right.end && 'gpr-fp-right',
            isMasked && 'gpr-seq-masked',
            siteOf.length > 0 && 'gpr-seq-site',
          ) || 'gpr-seq-plain';
        // Bases belonging to different enzymes must not merge into one span, or
        // they would all take the first enzyme's colour.
        if (!cur || cur.cls !== cls || cur.siteOf.join('+') !== siteOf.join('+')) {
          cur = { text: '', cls, barAfter: false, cutAfter: [], siteOf };
          segs.push(cur);
        }
        cur.text += seq[t - 1] ?? '';
        const cutHere = cutsAt.get(t);
        if (junctions.has(t) || cutHere) {
          cur.barAfter = junctions.has(t);
          cur.cutAfter = cutHere ?? [];
          cur = null;
        }
      }
      out.push({ pos: lineStart, segs });
    }
    return {
      lines: out,
      hasMask: anyMask,
      hasJunction: junctions.size > 0,
      // Only enzymes actually visible in this amplicon belong in its legend.
      shown: [...new Set((sites ?? []).filter((s) => s.end >= start && s.start <= end).map((s) => s.enzyme))],
    };
  }, [valid, seq, start, end, pair.left.start, pair.left.end, pair.right.start, pair.right.end, junctionList, maskList, cutKey, siteKey]);

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
                <span
                  className={s.cls}
                  style={s.siteOf.length ? { boxShadow: `inset 0 -2px 0 ${enzymeColor(s.siteOf[0] as string)}` } : undefined}
                  title={s.siteOf.length ? `${s.siteOf.join(', ')} site` : undefined}
                >
                  {s.text}
                </span>
                {s.barAfter ? <span className="gpr-junction-bar" aria-hidden="true" /> : null}
                {s.cutAfter.map((name) => (
                  <span key={name} className="gpr-cut-bar" style={{ borderLeftColor: enzymeColor(name) }} aria-hidden="true" />
                ))}
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
        {shown.map((name) => (
          <Fragment key={name}>
            {' '}
            <span className="gpr-seq-site" style={{ boxShadow: `inset 0 -2px 0 ${enzymeColor(name)}` }}>
              {name}
            </span>
          </Fragment>
        ))}
        {shown.length ? (
          <>
            {' '}
            <span className="gpr-cut-sample" aria-hidden="true" /> cut
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
