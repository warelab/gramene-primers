import { alleleMeta, predictionMeta, primerStatusMeta, type GenotypeStatusMeta } from '../genotyping';
import type { GenotypeAllele, GenotypePrediction, GenotypePrimerStatus } from '../types';
import { cx } from './util';

/**
 * A genotype status as glyph + colour + text. Colour is never the only channel:
 * the glyph is always drawn and the label is always available to a screen
 * reader, so the chip still reads correctly in monochrome (spec §C.5).
 */
export interface GenotypeChipProps {
  meta: GenotypeStatusMeta<string>;
  /** Screen-reader prefix, e.g. "Allele" or "Set S1". */
  context?: string;
  /** Hides the label visually; it stays in the accessible name. */
  compact?: boolean;
  /** Extra text after the label, e.g. "weak" or "2 copies". */
  detail?: string;
  className?: string;
}

export function GenotypeChip({ meta, context, compact, detail, className }: GenotypeChipProps): JSX.Element {
  const text = detail ? `${meta.label} · ${detail}` : meta.label;
  return (
    <span
      className={cx('gpr-chip', 'gpr-genotype-chip', compact && 'gpr-genotype-chip-compact', className)}
      data-status={meta.status}
      data-severity={meta.severity}
      style={meta.color ? { color: meta.color } : undefined}
    >
      <span className="gpr-chip-glyph" aria-hidden="true">
        {meta.glyph}
      </span>
      {compact ? (
        <span className="gpr-visually-hidden">
          {context ? `${context}: ` : ''}
          {text}
        </span>
      ) : (
        <span className="gpr-chip-text">
          {context ? <span className="gpr-visually-hidden">{context}: </span> : null}
          {text}
        </span>
      )}
    </span>
  );
}

/** The allele a genome carries. */
export function AlleleChip(p: { allele: GenotypeAllele | null | undefined; context?: string; compact?: boolean; detail?: string }): JSX.Element {
  return <GenotypeChip meta={alleleMeta(p.allele)} context={p.context ?? 'Allele'} compact={p.compact} detail={p.detail} />;
}

/** What a set is predicted to read in a genome. */
export function PredictionChip(p: { predicted: GenotypePrediction | null | undefined; context?: string; compact?: boolean; detail?: string }): JSX.Element {
  return <GenotypeChip meta={predictionMeta(p.predicted)} context={p.context ?? 'Predicted'} compact={p.compact} detail={p.detail} />;
}

/** How one primer of a set behaves in a genome. */
export function PrimerStatusChip(p: { status: GenotypePrimerStatus | null | undefined; context?: string; compact?: boolean }): JSX.Element {
  return <GenotypeChip meta={primerStatusMeta(p.status)} context={p.context} compact={p.compact} />;
}

function LegendRow({ meta }: { meta: GenotypeStatusMeta<string> }): JSX.Element {
  return (
    <li className="gpr-legend-item gpr-genotype-legend-item">
      <span className="gpr-genotype-legend-glyph" aria-hidden="true" style={meta.color ? { color: meta.color } : undefined}>
        {meta.glyph}
      </span>
      <span className="gpr-genotype-legend-label">{meta.label}</span>
    </li>
  );
}

/**
 * Keys for the allele matrix. Both scales are listed because the same glyph can
 * mean different things in the two columns: `●` is the reference allele a genome
 * carries, and separately the REF dye a set is predicted to light.
 */
export function AlleleLegend(): JSX.Element {
  return (
    <div className="gpr-genotype-legend">
      <div className="gpr-genotype-legend-group">
        <p className="gpr-genotype-legend-title" id="gpr-legend-allele">
          Allele observed
        </p>
        <ul className="gpr-plain-list gpr-genotype-legend-list" aria-labelledby="gpr-legend-allele">
          {(['ref', 'alt', 'other', 'ambiguous', 'missing', 'unavailable'] as const).map((s) => (
            <LegendRow key={s} meta={alleleMeta(s)} />
          ))}
        </ul>
      </div>
      <div className="gpr-genotype-legend-group">
        <p className="gpr-genotype-legend-title" id="gpr-legend-predicted">
          Predicted by the set
        </p>
        <ul className="gpr-plain-list gpr-genotype-legend-list" aria-labelledby="gpr-legend-predicted">
          {(['ref', 'alt', 'both', 'none', 'no_call', 'unknown'] as const).map((s) => (
            <LegendRow key={s} meta={predictionMeta(s)} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/** ✓ / ✗ / – for `agrees`, which is null whenever a genome cannot be compared. */
export function AgreementMark({ agrees }: { agrees: boolean | null | undefined }): JSX.Element {
  const meta =
    agrees === true
      ? { glyph: '✓', label: 'Agrees with the observed allele', tone: 'ok' }
      : agrees === false
        ? { glyph: '✗', label: 'Disagrees with the observed allele', tone: 'bad' }
        : { glyph: '–', label: 'Cannot be compared', tone: 'muted' };
  return (
    <span className={cx('gpr-agreement', `gpr-agreement-${meta.tone}`)} title={meta.label}>
      <span aria-hidden="true">{meta.glyph}</span>
      <span className="gpr-visually-hidden">{meta.label}</span>
    </span>
  );
}
