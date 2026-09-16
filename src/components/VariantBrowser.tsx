import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { GenesInRegion, RegionGene, VariantEntry } from '../types';
import { consequenceColor, consequenceLabel } from '../variants';
import { useGenesInRegion } from './hooks/useGenesInRegion';
import { niceTicks } from './TemplateMap';
import { fmtInt, useIdPrefix } from './util';

const MARGIN = 34;
const RULER_Y = 18;
const GENES_Y = 34;
const GENE_H = 11;
const GENE_LANE = 16;
const MAX_GENE_LANES = 6;
const VARIANT_STEM = 16;
const MIN_SPAN = 40;

interface GeneModel {
  id: string;
  label: string;
  start: number;
  end: number;
  strand: 1 | -1;
  exons: Array<{ start: number; end: number }>;
  cds: { start: number; end: number } | null;
}

/** A gene the host supplied, with a single block when it carries no exons. */
function toModel(gene: RegionGene): GeneModel | null {
  if (!Number.isFinite(gene.start) || !Number.isFinite(gene.end)) return null;
  return {
    id: gene.id,
    label: gene.label || gene.id,
    start: gene.start,
    end: gene.end,
    strand: gene.strand === -1 ? -1 : 1,
    exons: gene.exons?.length ? [...gene.exons].sort((a, b) => a.start - b.start) : [{ start: gene.start, end: gene.end }],
    cds: gene.cds ?? null,
  };
}

/** Greedy lane packing so overlapping genes stack instead of drawing over each other. */
function packGeneLanes(models: ReadonlyArray<GeneModel>, gap: number): Map<string, number> {
  const sorted = [...models].sort((a, b) => a.start - b.start || a.end - b.end);
  const ends: number[] = [];
  const lanes = new Map<string, number>();
  for (const g of sorted) {
    let lane = ends.findIndex((e) => e + gap < g.start);
    if (lane === -1) {
      lane = ends.length;
      ends.push(g.end);
    } else {
      ends[lane] = g.end;
    }
    lanes.set(g.id, lane);
  }
  return lanes;
}

export interface VariantBrowserProps {
  region: string;
  /** The listing window; the browser opens here. */
  window: { start: number; end: number };
  /** The rows the table is showing, so the browser and the table never disagree. */
  variants: ReadonlyArray<VariantEntry>;
  systemName: string;
  /** Host-supplied gene search; without it no gene track is drawn. */
  genesInRegion?: GenesInRegion;
  selectedKey?: string | null;
  onSelect?: (variant: VariantEntry) => void;
  /** Re-lists the table over the browsed region. */
  onUseRegion?: (start: number, end: number) => void;
  maxWindow: number;
  disabled?: boolean;
}

/**
 * A region view of the gene models and the variants the table is showing
 * (spec §3.1). It draws the *filtered* rows, so what you see here and what you
 * can select there are always the same set.
 */
export function VariantBrowser(p: VariantBrowserProps): JSX.Element {
  const idp = useIdPrefix('gpr-browser');
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(320, el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [view, setView] = useState<[number, number]>([p.window.start, p.window.end]);
  // A new listing window re-frames the view; panning from there is the user's.
  useEffect(() => {
    setView([p.window.start, p.window.end]);
  }, [p.window.start, p.window.end]);

  const v0 = Math.max(1, Math.round(view[0]));
  const v1 = Math.max(v0 + MIN_SPAN - 1, Math.round(view[1]));
  const span = v1 - v0 + 1;
  const inner = width - 2 * MARGIN;
  const x = (pos: number) => MARGIN + ((pos - v0) / span) * inner;

  // Genes follow the browsed view, not the listing window, so panning reveals them.
  const geneQuery = p.systemName && p.region ? { system_name: p.systemName, region: p.region, start: v0, end: v1 } : null;
  const geneState = useGenesInRegion(p.genesInRegion, geneQuery);
  const models = useMemo(() => geneState.genes.map(toModel).filter((g): g is GeneModel => !!g), [geneState.genes]);
  const visible = models.filter((g) => g.end >= v0 && g.start <= v1);
  const laneOf = useMemo(() => packGeneLanes(visible, Math.ceil((60 * span) / Math.max(1, inner))), [visible, span, inner]);
  const laneCount = Math.min(MAX_GENE_LANES, visible.length ? Math.max(...laneOf.values()) + 1 : 0);
  const variantsY = GENES_Y + laneCount * GENE_LANE + 12;
  const height = variantsY + VARIANT_STEM + 22;

  const inView = p.variants.filter((v) => v.vcf.position >= v0 && v.vcf.position <= v1);
  const legend = useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of inView) if (!seen.has(v.consequence ?? '')) seen.set(v.consequence ?? '', consequenceColor(v.consequence));
    return [...seen].sort((a, b) => a[0].localeCompare(b[0]));
  }, [inView]);

  const setSpan = (center: number, next: number) => {
    const s = Math.max(MIN_SPAN, Math.round(next));
    const start = Math.max(1, Math.round(center - s / 2));
    setView([start, start + s - 1]);
  };
  const panBy = (fraction: number) => {
    const delta = Math.round(span * fraction);
    setView([Math.max(1, v0 + delta), Math.max(1 + span - 1, v1 + delta)]);
  };

  // Drag to pan. Pointer capture keeps the gesture if the cursor leaves the svg.
  const drag = useRef<{ x: number; v0: number; v1: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (p.disabled) return;
    drag.current = { x: e.clientX, v0, v1 };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not fatal: the drag still works while the pointer stays inside.
    }
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || inner <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const perPx = span / Math.max(1, (rect.width * inner) / width);
    const delta = Math.round((d.x - e.clientX) * perPx);
    const start = Math.max(1, d.v0 + delta);
    setView([start, start + (d.v1 - d.v0)]);
  };
  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Already released.
    }
  };

  const ticks = niceTicks(v0, v1, Math.max(3, Math.floor(inner / 90)));
  const tooWide = span > p.maxWindow;
  const label = `${p.region}:${fmtInt(v0)}–${fmtInt(v1)}, ${fmtInt(span)} bp, ${fmtInt(inView.length)} variant${inView.length === 1 ? '' : 's'}${
    visible.length ? `, ${fmtInt(visible.length)} gene${visible.length === 1 ? '' : 's'}` : ''
  }`;

  return (
    <div className="gpr-browser" ref={wrapRef}>
      <div className="gpr-browser-toolbar">
        <span className="gpr-browser-loc">
          <code className="gpr-code">
            {p.region}:{fmtInt(v0)}–{fmtInt(v1)}
          </code>{' '}
          <span className="gpr-sub">{fmtInt(span)} bp</span>
        </span>
        <span className="gpr-button-row">
          <button type="button" className="gpr-btn gpr-btn-small" disabled={p.disabled} aria-label="Pan left" onClick={() => panBy(-0.25)}>
            ←
          </button>
          <button type="button" className="gpr-btn gpr-btn-small" disabled={p.disabled} aria-label="Pan right" onClick={() => panBy(0.25)}>
            →
          </button>
          <button type="button" className="gpr-btn gpr-btn-small" disabled={p.disabled} aria-label="Zoom in" onClick={() => setSpan((v0 + v1) / 2, span / 2)}>
            +
          </button>
          <button type="button" className="gpr-btn gpr-btn-small" disabled={p.disabled} aria-label="Zoom out" onClick={() => setSpan((v0 + v1) / 2, span * 2)}>
            −
          </button>
          <button
            type="button"
            className="gpr-btn gpr-btn-small gpr-btn-quiet"
            disabled={p.disabled}
            onClick={() => setView([p.window.start, p.window.end])}
          >
            Fit to listing
          </button>
        </span>
        {p.onUseRegion ? (
          <button
            type="button"
            className="gpr-btn gpr-btn-small"
            disabled={p.disabled || tooWide}
            title={tooWide ? `Zoom in: at most ${fmtInt(p.maxWindow)} bp can be listed` : undefined}
            onClick={() => p.onUseRegion?.(v0, v1)}
          >
            List this region
          </button>
        ) : null}
      </div>

      {tooWide ? (
        <p className="gpr-hint">This view spans {fmtInt(span)} bp; at most {fmtInt(p.maxWindow)} bp can be listed at once.</p>
      ) : null}

      <svg
        className="gpr-browser-svg"
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="gpr-map-tick" x1={x(t)} x2={x(t)} y1={RULER_Y - 4} y2={RULER_Y} />
            <text className="gpr-map-tick-label" x={x(t)} y={RULER_Y - 6} textAnchor="middle">
              {fmtInt(t)}
            </text>
          </g>
        ))}
        <line className="gpr-map-axis" x1={MARGIN} x2={width - MARGIN} y1={RULER_Y} y2={RULER_Y} />

        {visible.map((g) => {
          const lane = laneOf.get(g.id) ?? 0;
          if (lane >= MAX_GENE_LANES) return null;
          const y = GENES_Y + lane * GENE_LANE;
          return (
            <g key={g.id} className="gpr-browser-gene">
              <title>{`${g.label} ${g.start}–${g.end} (${g.strand === -1 ? '−' : '+'})`}</title>
              <line className="gpr-map-intron" x1={x(g.start)} x2={x(g.end)} y1={y + GENE_H / 2} y2={y + GENE_H / 2} />
              {g.exons.map((e, i) => {
                const coding = g.cds && e.end >= g.cds.start && e.start <= g.cds.end;
                return (
                  <rect
                    key={i}
                    className={coding ? 'gpr-map-cds' : 'gpr-map-exon'}
                    x={x(e.start)}
                    y={y}
                    width={Math.max(1, x(e.end + 1) - x(e.start))}
                    height={GENE_H}
                  />
                );
              })}
              <text className="gpr-browser-gene-label" x={x(Math.max(g.start, v0)) + 2} y={y - 1}>
                {g.label} {g.strand === -1 ? '←' : '→'}
              </text>
            </g>
          );
        })}

        {inView.map((v) => {
          const px = x(v.vcf.position);
          const selected = p.selectedKey === v.key;
          return (
            <g
              key={v.key}
              className="gpr-browser-variant"
              data-state={selected ? 'selected' : undefined}
              data-designable={v.designable ? 'true' : 'false'}
              // A row the table disables must not be selectable here either.
              onClick={() => {
                if (v.designable) p.onSelect?.(v);
              }}
            >
              <title>{`${v.label} · ${v.kind} · ${consequenceLabel(v.consequence)}${v.designable ? '' : ' · cannot be designed'}`}</title>
              <line x1={px} x2={px} y1={variantsY} y2={variantsY + VARIANT_STEM} stroke={consequenceColor(v.consequence)} />
              <circle cx={px} cy={variantsY + VARIANT_STEM} r={selected ? 5 : 3.5} fill={consequenceColor(v.consequence)} />
            </g>
          );
        })}
      </svg>

      <div className="gpr-browser-legend">
        {geneState.unsupported ? <span className="gpr-sub">Gene models are not available here.</span> : null}
        {geneState.loading ? <span className="gpr-sub">Loading gene models…</span> : null}
        {geneState.error ? <span className="gpr-sub">Gene models could not be loaded.</span> : null}
        {legend.map(([consequence, color]) => (
          <span key={consequence} className="gpr-browser-key">
            <span className="gpr-browser-swatch" aria-hidden="true" style={{ backgroundColor: color }} />
            {consequenceLabel(consequence)}
          </span>
        ))}
      </div>
      <p className="gpr-hint" id={`${idp}-help`}>
        Drag to pan, or use the buttons. The browser shows the rows the table is showing, so filtering here and there agree.
      </p>
    </div>
  );
}
