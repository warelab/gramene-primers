import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { Interval, PrimerOligo, PrimerPair, PrimerTemplate, TemplateExon } from '../types';
import { useIsoLayoutEffect } from './hooks/useIsoLayoutEffect';
import { enzymeColor, siteWithCut, type RestrictionEnzyme } from '../enzymes';
import { useEnzymeColours } from './hooks/useEnzymeColours';
import { GprRoot, type StyleProps } from './Root';
import { clamp, fmtInt, pairLabel, strandSign, templateGenomicPosition, useIdPrefix } from './util';

export interface TemplateMapProps extends StyleProps {
  template: PrimerTemplate;
  pairs?: ReadonlyArray<PrimerPair>;
  selectedRank?: number | null;
  /** Click or Enter on a pair lane. */
  onSelect?: (rank: number) => void;
  target?: Interval | null;
  included?: Interval | null;
  excluded?: ReadonlyArray<Interval> | null;
  /**
   * Every enzyme with a site in the template, with those sites. The map lists
   * them all, counts each within the current view, and draws the selected ones.
   */
  enzymeSites?: ReadonlyArray<MapEnzymeSites>;
  selectedEnzymes?: ReadonlyArray<string>;
  onSelectEnzymes?: (enzymes: string[]) => void;
  /** The colour each selected enzyme is drawn in; allocated here when not supplied. */
  enzymeColours?: ReadonlyMap<string, string>;
  title?: string;
}

/** A recognition site in template coordinates. */
export interface MapSite {
  start: number;
  end: number;
  strand?: 1 | -1;
}

/** One enzyme and every site it has in the template. */
export interface MapEnzymeSites {
  enzyme: Pick<RestrictionEnzyme, 'name' | 'site' | 'cut'>;
  sites: ReadonlyArray<MapSite>;
}

const MARGIN = 30;
const RULER_Y = 24;
const FEATURE_Y = 36;
const FEATURE_H = 16;
const MASK_Y = 60;
const MASK_H = 8;
const INTERVAL_Y = 74;
const INTERVAL_H = 10;
const LANES_Y = 94;
const SITE_Y = 88;
const SITE_H = 8;
/** Lane pitch in the site track: a mark and the gap below it. */
const SITE_LANE_H = 11;
/** Beyond this the track stops growing and further overlaps share the last lane. */
const MAX_SITE_LANES = 8;
/** Horizontal clearance, in pixels, two marks need to share a lane. */
const SITE_GAP_PX = 2;
/** The narrowest a mark's hover target gets, however thin the mark itself. */
const SITE_HIT_PX = 8;
const LANE_H = 20;
const PRIMER_H = 12;
const MAX_LANES = 30;
const MIN_SPAN = 20;

/** Greedy lane packing by product start; `gap` in bases. */
export function packPairLanes(pairs: ReadonlyArray<Pick<PrimerPair, 'rank' | 'left' | 'right'>>, gap: number): Map<number, number> {
  const sorted = [...pairs].sort((a, b) => a.left.start - b.left.start || a.right.end - b.right.end || a.rank - b.rank);
  const laneEnds: number[] = [];
  const lanes = new Map<number, number>();
  for (const p of sorted) {
    let lane = laneEnds.findIndex((end) => end + gap < p.left.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(p.right.end);
    } else {
      laneEnds[lane] = p.right.end;
    }
    lanes.set(p.rank, lane);
  }
  return lanes;
}

/** Sites overlapping `[v0, v1]`, the part of the template currently in view. */
export function sitesInView<T extends { start: number; end: number }>(sites: ReadonlyArray<T>, v0: number, v1: number): T[] {
  return sites.filter((s) => s.end >= v0 && s.start <= v1);
}

/**
 * Greedy lane packing for marks already laid out in pixels, sorted by left
 * edge: each mark takes the first lane whose last mark ends clear of it.
 *
 * Packing in pixels rather than bases is what makes the track behave like a
 * genome browser. Two sites 40 bp apart collide when zoomed out and separate
 * when zoomed in, so the lanes are recomputed for the view rather than fixed
 * for the template. Past `maxLanes` the last lane takes the overflow, drawn
 * over itself, rather than growing without limit.
 */
export function packSiteLanes(marks: ReadonlyArray<{ x0: number; x1: number }>, gapPx: number, maxLanes: number): number[] {
  const laneEnds: number[] = [];
  return marks.map((m) => {
    let lane = laneEnds.findIndex((end) => end + gapPx <= m.x0);
    if (lane === -1) {
      if (laneEnds.length < maxLanes) {
        lane = laneEnds.length;
        laneEnds.push(m.x1);
        return lane;
      }
      lane = maxLanes - 1;
    }
    laneEnds[lane] = Math.max(laneEnds[lane] ?? m.x1, m.x1);
    return lane;
  });
}

/** Round tick positions (1-2-5 steps) within `[start, end]`. */
export function niceTicks(start: number, end: number, target = 8): number[] {
  const span = Math.max(1, end - start);
  const raw = span / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow);
  const ticks: number[] = [];
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) ticks.push(t);
  return ticks;
}

type PartKind = 'cds' | 'utr5' | 'utr3' | 'nc';

function exonParts(e: { start: number; end: number }, cds: { start: number; end: number } | null | undefined): Array<{ s: number; e: number; kind: PartKind }> {
  if (!cds) return [{ s: e.start, e: e.end, kind: 'nc' }];
  const parts: Array<{ s: number; e: number; kind: PartKind }> = [];
  if (e.start < cds.start) parts.push({ s: e.start, e: Math.min(e.end, cds.start - 1), kind: 'utr5' });
  const cs = Math.max(e.start, cds.start);
  const ce = Math.min(e.end, cds.end);
  if (cs <= ce) parts.push({ s: cs, e: ce, kind: 'cds' });
  if (e.end > cds.end) parts.push({ s: Math.max(e.start, cds.end + 1), e: e.end, kind: 'utr3' });
  return parts.filter((p) => p.s <= p.e);
}

function arrowPath(x0: number, x1: number, y: number, h: number, dir: 1 | -1): string {
  const width = Math.max(4, x1 - x0);
  const head = Math.min(5, width * 0.6);
  if (dir === 1) {
    const xe = x0 + width;
    return `M${x0},${y}H${xe - head}L${xe},${y + h / 2}L${xe - head},${y + h}H${x0}Z`;
  }
  const xs = x1 - width;
  return `M${x1},${y}H${xs + head}L${xs},${y + h / 2}L${xs + head},${y + h}H${x1}Z`;
}

/**
 * What a restriction site is, on hover: the enzyme, where the site sits in the
 * template and — when the template has coordinates — in the genome, the
 * recognition sequence with its cut, and the bases actually there. The last two
 * differ for a degenerate site such as AccI (GTMKAC), which is exactly when it
 * is worth seeing both.
 */
function SiteTip(p: {
  template: PrimerTemplate;
  colour: string;
  mark: { enzyme: MapEnzymeSites['enzyme']; site: MapSite };
  left: number;
  top: number;
}): JSX.Element {
  const { enzyme, site } = p.mark;
  const a = templateGenomicPosition(p.template, site.start);
  const b = templateGenomicPosition(p.template, site.end);
  const genomic =
    a && b ? `${a.region}:${fmtInt(Math.min(a.pos, b.pos))}–${fmtInt(Math.max(a.pos, b.pos))}` : null;
  const bases = p.template.seq?.slice(site.start - 1, site.end) ?? '';
  return (
    <div className="gpr-map-tip" role="tooltip" style={{ left: p.left, top: p.top }}>
      <div className="gpr-map-tip-head">
        <span className="gpr-map-enzyme-swatch" aria-hidden="true" style={{ backgroundColor: p.colour }} />
        <strong>{enzyme.name}</strong>
      </div>
      <dl className="gpr-map-tip-rows">
        <dt>Location</dt>
        <dd>
          template {fmtInt(site.start)}–{fmtInt(site.end)}
          {genomic ? <span className="gpr-block">{genomic}</span> : null}
          {site.strand === -1 ? <span className="gpr-block">reverse strand</span> : null}
        </dd>
        <dt>Recognition</dt>
        <dd>
          <code className="gpr-seq">{siteWithCut(enzyme)}</code>
        </dd>
        <dt>Sequence</dt>
        <dd>
          <code className="gpr-seq">{bases}</code>
        </dd>
      </dl>
    </div>
  );
}

/** SVG template map: ruler, exons/CDS/junctions, repeat mask, intervals and pair lanes (spec §C.3). */
export function TemplateMap(props: TemplateMapProps): JSX.Element {
  const { template, pairs = [], selectedRank, onSelect, target, included, excluded, enzymeSites = [] } = props;
  const chosenEnzymes = useMemo(() => new Set(props.selectedEnzymes ?? []), [props.selectedEnzymes]);
  const ownColours = useEnzymeColours(props.selectedEnzymes ?? []);
  const colours = props.enzymeColours ?? ownColours;
  const colourOf = (name: string) => colours.get(name) ?? enzymeColor(name);
  const L = Math.max(1, template.length || template.seq?.length || 1);
  const idp = useIdPrefix('gpr-map');
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(760);
  useIsoLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(Math.max(320, Math.round(w)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [view, setView] = useState<[number, number]>([1, L]);
  useEffect(() => {
    setView([1, L]);
  }, [template, L]);
  const v0 = clamp(view[0], 1, L);
  const v1 = clamp(view[1], v0, L);
  const span = v1 - v0 + 1;
  const inner = width - 2 * MARGIN;
  const x = (t: number) => MARGIN + ((t - v0) / span) * inner;
  const wOf = (s: number, e: number) => Math.max(1, x(e + 1) - x(s));

  const lanes = useMemo(() => packPairLanes(pairs, Math.ceil((28 * L) / Math.max(1, inner))), [pairs, L, inner]);
  const laneCount = Math.min(MAX_LANES, pairs.length ? Math.max(...[...lanes.values()]) + 1 : 0);
  // ---- restriction sites -----------------------------------------------------
  // Counts follow the view, so zooming into a region says how many of each
  // enzyme's sites are actually there rather than repeating the template total.
  const viewCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { enzyme, sites } of enzymeSites) counts.set(enzyme.name, sitesInView(sites, v0, v1).length);
    return counts;
  }, [enzymeSites, v0, v1]);

  const chosenKey = [...chosenEnzymes].sort().join(',');
  const siteMarks = useMemo(() => {
    const marks: Array<{ enzyme: MapEnzymeSites['enzyme']; site: MapSite; x0: number; x1: number; lane: number }> = [];
    for (const { enzyme, sites } of enzymeSites) {
      if (!chosenEnzymes.has(enzyme.name)) continue;
      for (const site of sitesInView(sites, v0, v1)) {
        const x0 = x(site.start);
        // A six-base site is sub-pixel on a long template, so it is widened to
        // stay visible rather than vanishing.
        marks.push({ enzyme, site, x0, x1: x0 + Math.max(2, wOf(site.start, site.end)), lane: 0 });
      }
    }
    marks.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1 || a.enzyme.name.localeCompare(b.enzyme.name));
    const lanesOf = packSiteLanes(marks, SITE_GAP_PX, MAX_SITE_LANES);
    marks.forEach((m, i) => (m.lane = lanesOf[i] ?? 0));
    return marks;
  }, [enzymeSites, chosenKey, v0, v1, inner]);
  const siteLaneCount = siteMarks.length ? Math.max(...siteMarks.map((m) => m.lane)) + 1 : 0;

  // The site track sits between the intervals and the pair lanes, grows a lane
  // at a time as marks collide, and takes no room when there is nothing in it.
  const lanesY = LANES_Y + (siteLaneCount ? (siteLaneCount - 1) * SITE_LANE_H + SITE_H + 6 : 0);

  const [siteTip, setSiteTip] = useState<{ mark: (typeof siteMarks)[number]; left: number; top: number } | null>(null);
  // A pan or zoom moves the marks out from under a still pointer.
  useEffect(() => setSiteTip(null), [v0, v1, chosenKey]);
  const showSiteTip = (mark: (typeof siteMarks)[number], e: MouseEvent<SVGElement>) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    const TIP_W = 250;
    const px = e.clientX - box.left;
    const left = px + 14 + TIP_W > box.width ? Math.max(0, px - 14 - TIP_W) : px + 14;
    setSiteTip({ mark, left, top: e.clientY - box.top + 14 });
  };
  const height = lanesY + Math.max(1, laneCount) * LANE_H + 6;
  const ticks = niceTicks(v0, v1, Math.max(3, Math.floor(inner / 90)));

  const [hover, setHover] = useState<number | null>(null);
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * width;
    if (px < MARGIN || px > width - MARGIN) {
      setHover(null);
      return;
    }
    setHover(clamp(Math.floor(v0 + ((px - MARGIN) / inner) * span), v0, v1));
  };
  const hoverGenomic = hover !== null ? templateGenomicPosition(template, hover) : null;

  const selectedPair = pairs.find((p) => p.rank === selectedRank) ?? null;
  const setSpan = (center: number, newSpan: number) => {
    const s = clamp(Math.round(newSpan), Math.min(MIN_SPAN, L), L);
    let start = Math.round(center - s / 2);
    start = clamp(start, 1, L - s + 1);
    setView([start, start + s - 1]);
  };
  const center = (v0 + v1) / 2;
  const fitted = v0 === 1 && v1 === L;

  const features = template.features ?? {};
  const exons: TemplateExon[] = [...(features.exons ?? [])].sort((a, b) => a.start - b.start);
  const cds = features.cds ?? null;
  const junctions = features.junctions ?? [];
  const mask = template.mask ?? [];
  const mode = template.mode;
  const midY = FEATURE_Y + FEATURE_H / 2;

  const region = template.region;
  const location =
    region && typeof template.start === 'number' && typeof template.end === 'number'
      ? `${region}:${fmtInt(template.start)}–${fmtInt(template.end)} (${strandSign(template.strand)})`
      : null;
  const description = [
    `${fmtInt(L)} bp ${mode} template${location ? ` at ${location}` : ''}`,
    exons.length ? `${exons.length} exon${exons.length === 1 ? '' : 's'}` : null,
    junctions.length ? `${junctions.length} junction${junctions.length === 1 ? '' : 's'}` : null,
    mask.length ? `${mask.length} masked run${mask.length === 1 ? '' : 's'}` : null,
    `${pairs.length} primer pair${pairs.length === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(', ');

  const notch = (o: PrimerOligo, y: number) =>
    o.junction ? <line className="gpr-map-notch" x1={x(o.junction.position + 1)} x2={x(o.junction.position + 1)} y1={y - 2} y2={y + PRIMER_H + 2} /> : null;

  const featureTrack: JSX.Element[] = [];
  if (exons.length) {
    const first = exons[0]!;
    const last = exons[exons.length - 1]!;
    if (mode !== 'transcript') {
      featureTrack.push(<line key="intron" className="gpr-map-intron" x1={x(first.start)} x2={x(last.end + 1)} y1={midY} y2={midY} />);
    }
    exons.forEach((e, i) => {
      if (mode === 'transcript') {
        featureTrack.push(
          <rect key={`ex-${i}`} className={i % 2 ? 'gpr-map-exon gpr-map-exon-alt' : 'gpr-map-exon'} x={x(e.start)} y={FEATURE_Y + 2} width={wOf(e.start, e.end)} height={FEATURE_H - 6}>
            <title>{`${e.id}: cDNA ${fmtInt(e.start)}–${fmtInt(e.end)}`}</title>
          </rect>,
        );
      } else {
        for (const part of exonParts(e, cds)) {
          const full = part.kind === 'cds' || part.kind === 'nc';
          featureTrack.push(
            <rect
              key={`ex-${i}-${part.kind}-${part.s}`}
              className={`gpr-map-feature gpr-map-${part.kind}`}
              x={x(part.s)}
              y={full ? FEATURE_Y : FEATURE_Y + 3}
              width={wOf(part.s, part.e)}
              height={full ? FEATURE_H : FEATURE_H - 6}
            >
              <title>{`${e.id} ${part.kind === 'nc' ? 'exon' : part.kind.toUpperCase()}: ${fmtInt(part.s)}–${fmtInt(part.e)}`}</title>
            </rect>,
          );
        }
      }
    });
    if (mode === 'transcript' && cds) {
      featureTrack.push(
        <rect key="cds-band" className="gpr-map-cds-band" x={x(cds.start)} y={FEATURE_Y + FEATURE_H - 3} width={wOf(cds.start, cds.end)} height={3}>
          <title>{`CDS: ${fmtInt(cds.start)}–${fmtInt(cds.end)}`}</title>
        </rect>,
      );
    }
  } else if (features.gene) {
    featureTrack.push(
      <rect key="gene" className="gpr-map-feature gpr-map-nc" x={x(features.gene.start)} y={FEATURE_Y + 3} width={wOf(features.gene.start, features.gene.end)} height={FEATURE_H - 6}>
        <title>{`Gene: ${fmtInt(features.gene.start)}–${fmtInt(features.gene.end)}`}</title>
      </rect>,
    );
  }
  junctions.forEach((j) =>
    featureTrack.push(<line key={`j-${j}`} className="gpr-map-junction" x1={x(j + 1)} x2={x(j + 1)} y1={FEATURE_Y - 3} y2={FEATURE_Y + FEATURE_H + 2} />),
  );

  const legend: Array<[string, string]> = [];
  if (exons.length && mode !== 'transcript') {
    if (cds) legend.push(['gpr-map-cds', 'CDS'], ['gpr-map-utr5', '5′ UTR'], ['gpr-map-utr3', '3′ UTR']);
    else legend.push(['gpr-map-nc', 'exon']);
    legend.push(['gpr-map-intron', 'intron']);
  }
  if (mode === 'transcript' && exons.length) legend.push(['gpr-map-exon', 'exon'], ['gpr-map-cds-band', 'CDS'], ['gpr-map-junction', 'junction']);
  if (mask.length) legend.push(['gpr-map-mask', 'repeat mask']);
  if (target) legend.push(['gpr-map-target', 'target']);
  if (included) legend.push(['gpr-map-included', 'included']);
  if (excluded?.length) legend.push(['gpr-map-excluded', 'excluded']);
  if (pairs.length) legend.push(['gpr-map-primer', 'primers']);

  return (
    <GprRoot theme={props.theme} injectStyles={props.injectStyles} className={props.className} style={props.style}>
      <div className="gpr-map" ref={wrapRef}>
        <div className="gpr-map-toolbar">
          <span className="gpr-map-actions">
            <button type="button" className="gpr-btn gpr-btn-small" disabled={fitted} onClick={() => setView([1, L])}>
              Fit
            </button>
            <button type="button" className="gpr-btn gpr-btn-small" disabled={span <= Math.min(MIN_SPAN, L)} onClick={() => setSpan(center, span / 2)}>
              Zoom in
            </button>
            <button type="button" className="gpr-btn gpr-btn-small" disabled={fitted} onClick={() => setSpan(center, span * 2)}>
              Zoom out
            </button>
            <button type="button" className="gpr-btn gpr-btn-small" disabled={v0 <= 1} aria-label="Pan left" onClick={() => setSpan(center - span / 2, span)}>
              ←
            </button>
            <button type="button" className="gpr-btn gpr-btn-small" disabled={v1 >= L} aria-label="Pan right" onClick={() => setSpan(center + span / 2, span)}>
              →
            </button>
            <button
              type="button"
              className="gpr-btn gpr-btn-small"
              disabled={!selectedPair}
              onClick={() => {
                if (!selectedPair) return;
                const s = selectedPair.left.start;
                const e = selectedPair.right.end;
                const pad = Math.max(10, Math.round((e - s + 1) * 0.15));
                const start = clamp(s - pad, 1, L);
                const end = clamp(e + pad, start, L);
                setView([start, end]);
              }}
            >
              Zoom to pair
            </button>
          </span>

          <span className="gpr-map-view">
            {fmtInt(v0)}–{fmtInt(v1)} of {fmtInt(L)} bp
            <span className="gpr-map-hover" aria-hidden="true">
              {hover !== null ? ` · position ${fmtInt(hover)}${hoverGenomic ? ` = ${hoverGenomic.region}:${fmtInt(hoverGenomic.pos)}` : ''}` : ''}
            </span>
          </span>
        </div>
        <svg
          ref={svgRef}
          className="gpr-map-svg"
          role="group"
          /* Named by aria-label, not a root <title>: browsers show the nearest
             <title> above the pointer as a native tooltip, and every element
             without one of its own — the restriction-site marks among them —
             would pop up "Template map" over their own tooltip. */
          aria-label={props.title ?? 'Template map'}
          aria-describedby={`${idp}-desc`}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <desc id={`${idp}-desc`}>{description}</desc>
          <defs>
            <clipPath id={`${idp}-clip`}>
              <rect x={MARGIN} y={0} width={inner} height={height} />
            </clipPath>
            <pattern id={`${idp}-hatch`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line className="gpr-map-hatch-line" x1={0} y1={0} x2={0} y2={6} />
            </pattern>
            <pattern id={`${idp}-exhatch`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <line className="gpr-map-exhatch-line" x1={0} y1={0} x2={0} y2={6} />
            </pattern>
          </defs>
          <g className="gpr-map-ruler">
            <title>{`Template positions ${fmtInt(v0)}–${fmtInt(v1)}${location ? `; genomic ${location}` : ''}`}</title>
            <line className="gpr-map-axis" x1={MARGIN} x2={width - MARGIN} y1={RULER_Y} y2={RULER_Y} />
            {ticks.map((t) => (
              <g key={t}>
                <line className="gpr-map-tick" x1={x(t)} x2={x(t)} y1={RULER_Y} y2={RULER_Y + 4} />
                <text className="gpr-map-tick-label" x={x(t)} y={RULER_Y - 6} textAnchor="middle">
                  {fmtInt(t)}
                </text>
              </g>
            ))}
          </g>
          <g clipPath={`url(#${idp}-clip)`}>
            <g className="gpr-map-features">{featureTrack}</g>
            <g className="gpr-map-masks">
              {mask.map(([s, l], i) => (
                <rect key={`m-${i}`} className="gpr-map-mask" x={x(s)} y={MASK_Y} width={wOf(s, s + l - 1)} height={MASK_H} fill={`url(#${idp}-hatch)`}>
                  <title>{`Masked ${fmtInt(s)}–${fmtInt(s + l - 1)}`}</title>
                </rect>
              ))}
            </g>
            <g className="gpr-map-intervals">
              {included ? (
                <rect className="gpr-map-included" x={x(included[0])} y={INTERVAL_Y} width={wOf(included[0], included[0] + included[1] - 1)} height={INTERVAL_H}>
                  <title>{`Included ${fmtInt(included[0])}–${fmtInt(included[0] + included[1] - 1)}`}</title>
                </rect>
              ) : null}
              {(excluded ?? []).map(([s, l], i) => (
                <rect key={`x-${i}`} className="gpr-map-excluded" x={x(s)} y={INTERVAL_Y} width={wOf(s, s + l - 1)} height={INTERVAL_H} fill={`url(#${idp}-exhatch)`}>
                  <title>{`Excluded ${fmtInt(s)}–${fmtInt(s + l - 1)}`}</title>
                </rect>
              ))}
              {target ? (
                <rect className="gpr-map-target" x={x(target[0])} y={INTERVAL_Y + 2} width={wOf(target[0], target[0] + target[1] - 1)} height={INTERVAL_H - 4}>
                  <title>{`Target ${fmtInt(target[0])}–${fmtInt(target[0] + target[1] - 1)}`}</title>
                </rect>
              ) : null}
            </g>
            {siteMarks.length ? (
              <g className="gpr-map-sites" onMouseLeave={() => setSiteTip(null)}>
                {siteMarks.map((m) => {
                  const on = siteTip?.mark === m;
                  const y = SITE_Y + m.lane * SITE_LANE_H;
                  const w = m.x1 - m.x0;
                  // A mark can be two pixels wide, which nobody can hover
                  // reliably, so an invisible target at least SITE_HIT_PX wide
                  // and a full lane tall takes the pointer instead.
                  const hitW = Math.max(w, SITE_HIT_PX);
                  return (
                    <g
                      key={`${m.enzyme.name}-${m.site.start}-${m.site.strand ?? 1}`}
                      onMouseEnter={(e) => showSiteTip(m, e)}
                      onMouseMove={(e) => showSiteTip(m, e)}
                    >
                      <rect
                        className="gpr-map-site"
                        data-enzyme={m.enzyme.name}
                        data-lane={m.lane}
                        data-state={on ? 'hover' : undefined}
                        x={m.x0}
                        y={y}
                        width={w}
                        height={SITE_H}
                        /* An inline style, not the fill attribute: any stylesheet
                           rule for fill beats a presentation attribute, and the
                           mark must match its swatch in the key. */
                        style={{ fill: colourOf(m.enzyme.name) }}
                      />
                      <rect
                        className="gpr-map-site-hit"
                        x={m.x0 + w / 2 - hitW / 2}
                        y={y - (SITE_LANE_H - SITE_H) / 2}
                        width={hitW}
                        height={SITE_LANE_H}
                      />
                    </g>
                  );
                })}
              </g>
            ) : null}
            <g className="gpr-map-pairs">
              {pairs.map((p) => {
                const lane = Math.min(MAX_LANES - 1, lanes.get(p.rank) ?? 0);
                const y = lanesY + lane * LANE_H;
                const selected = p.rank === selectedRank;
                const label = `Pair ${p.rank + 1}: ${fmtInt(p.product_size)} bp product, left primer ${fmtInt(p.left.start)}–${fmtInt(p.left.end)}, right primer ${fmtInt(p.right.start)}–${fmtInt(p.right.end)}`;
                const interactive = !!onSelect;
                return (
                  <g
                    key={p.rank}
                    className="gpr-map-pair"
                    data-state={selected ? 'selected' : undefined}
                    data-rank={p.rank}
                    role={interactive ? 'button' : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    aria-pressed={interactive ? selected : undefined}
                    aria-label={interactive ? label : undefined}
                    onClick={interactive ? () => onSelect!(p.rank) : undefined}
                    onKeyDown={
                      interactive
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelect!(p.rank);
                            }
                          }
                        : undefined
                    }
                  >
                    {interactive ? null : <title>{label}</title>}
                    <rect className="gpr-map-pair-hit" x={x(p.left.start) - 24} y={y - 3} width={Math.max(8, x(p.right.end + 1) - x(p.left.start) + 26)} height={LANE_H - 2} />
                    <line className="gpr-map-product" x1={x(p.left.start)} x2={x(p.right.end + 1)} y1={y + PRIMER_H / 2} y2={y + PRIMER_H / 2} />
                    <path className="gpr-map-primer gpr-map-primer-left" d={arrowPath(x(p.left.start), x(p.left.end + 1), y, PRIMER_H, 1)} />
                    <path className="gpr-map-primer gpr-map-primer-right" d={arrowPath(x(p.right.start), x(p.right.end + 1), y, PRIMER_H, -1)} />
                    {notch(p.left, y)}
                    {notch(p.right, y)}
                    <text className="gpr-map-pair-label" x={x(p.left.start) - 3} y={y + PRIMER_H - 2} textAnchor="end">
                      {pairLabel(p.rank)}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
          {hover !== null ? <line className="gpr-map-guide" x1={x(hover) + wOf(hover, hover) / 2} x2={x(hover) + wOf(hover, hover) / 2} y1={RULER_Y} y2={height} /> : null}
        </svg>
        {siteTip ? <SiteTip template={template} colour={colourOf(siteTip.mark.enzyme.name)} {...siteTip} /> : null}
        {enzymeSites.length ? (
          <details className="gpr-map-enzymes">
            <summary>
              Restriction sites
              <span className="gpr-sub">
                {' '}
                {chosenEnzymes.size ? `${fmtInt(chosenEnzymes.size)} shown` : 'none shown'}
              </span>
            </summary>
            <div className="gpr-map-enzyme-actions">
              <button
                type="button"
                className="gpr-btn gpr-btn-small gpr-btn-quiet"
                disabled={chosenEnzymes.size === enzymeSites.length}
                onClick={() => props.onSelectEnzymes?.(enzymeSites.map((e) => e.enzyme.name))}
              >
                Select all
              </button>
              <button
                type="button"
                className="gpr-btn gpr-btn-small gpr-btn-quiet"
                disabled={chosenEnzymes.size === 0}
                onClick={() => props.onSelectEnzymes?.([])}
              >
                Select none
              </button>
              <span className="gpr-sub">
                {fitted ? 'Sites in the whole template' : `Sites in view, ${fmtInt(v0)}–${fmtInt(v1)}`}
              </span>
            </div>
            <ul className="gpr-map-enzyme-list">
              {enzymeSites.map(({ enzyme }) => {
                const name = enzyme.name;
                const on = chosenEnzymes.has(name);
                const n = viewCounts.get(name) ?? 0;
                return (
                  // Greyed rather than hidden or disabled: the list stays put as
                  // the view moves, and an enzyme with nothing here may well
                  // have sites a pan away.
                  <li key={name} data-empty={n === 0 ? 'true' : undefined}>
                    <label className="gpr-check-row">
                      <input
                        type="checkbox"
                        className="gpr-checkbox"
                        checked={on}
                        onChange={(e) => {
                          const next = new Set(chosenEnzymes);
                          if (e.target.checked) next.add(name);
                          else next.delete(name);
                          props.onSelectEnzymes?.([...next]);
                        }}
                      />
                      {/* Coloured only once ticked: a swatch means "drawn in this colour". */}
                      <span
                        className="gpr-map-enzyme-swatch"
                        aria-hidden="true"
                        data-off={on ? undefined : 'true'}
                        style={on ? { backgroundColor: colourOf(name) } : undefined}
                      />
                      <span className="gpr-label">
                        {name} <span className="gpr-map-enzyme-count">({fmtInt(n)})</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}
        {legend.length ? (
          <ul className="gpr-map-legend" aria-label="Map legend">
            {legend.map(([cls, text]) => (
              <li key={cls} className="gpr-map-legend-item">
                <svg className="gpr-map-swatch" width={14} height={10} aria-hidden="true" focusable="false">
                  {cls === 'gpr-map-intron' || cls === 'gpr-map-junction' ? (
                    <line className={cls} x1={0} x2={14} y1={5} y2={5} />
                  ) : (
                    <rect className={cls} x={0} y={0} width={14} height={10} fill={cls === 'gpr-map-mask' ? `url(#${idp}-hatch)` : cls === 'gpr-map-excluded' ? `url(#${idp}-exhatch)` : undefined} />
                  )}
                </svg>
                {text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </GprRoot>
  );
}
