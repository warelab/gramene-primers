import { formatRegion, geneLength, geneTemplateExtent } from '../../coords';
import type { GrameneGene } from '../../types';
import { DESIGN_LIMITS } from '../../validate';
import { clamp, fmtInt, geneTooLong } from '../util';
import { TranscriptSelect } from './selects';

export const FLANK_STEP = 50;

export interface GeneInputsProps {
  idPrefix: string;
  gene: GrameneGene | null;
  geneId: string | null;
  geneLabel?: string;
  transcriptId: string | undefined;
  flankUp: number;
  flankDown: number;
  onTranscript: (transcriptId: string | undefined) => void;
  onFlanks: (flanks: { flankUp?: number; flankDown?: number }) => void;
  disabled?: boolean;
}

/** The largest flank that keeps the template within the limit. */
export function maxFlankFor(gene: GrameneGene | null, otherFlank: number): number {
  if (!gene?.location) return DESIGN_LIMITS.maxFlank;
  return clamp(DESIGN_LIMITS.maxTemplateLength - geneLength(gene) - Math.max(0, otherFlank), 0, DESIGN_LIMITS.maxFlank);
}

function FlankControl(props: { id: string; label: string; value: number; max: number; onChange: (v: number) => void; disabled?: boolean }): JSX.Element {
  const { id, label, value, max, onChange, disabled } = props;
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const set = (v: number) => onChange(clamp(Math.round(v), 0, max));
  return (
    <div className="gpr-field gpr-flank">
      <label className="gpr-label" id={labelId} htmlFor={id}>
        {label}
      </label>
      <div className="gpr-flank-controls">
        <input
          type="range"
          className="gpr-range"
          min={0}
          max={max}
          step={FLANK_STEP}
          value={Math.min(value, max)}
          aria-labelledby={labelId}
          aria-describedby={hintId}
          disabled={disabled || max === 0}
          onChange={(e) => set(Number(e.target.value))}
        />
        <input
          id={id}
          type="number"
          className="gpr-input gpr-input-number gpr-input-short"
          min={0}
          max={max}
          step={FLANK_STEP}
          value={value}
          disabled={disabled}
          aria-describedby={hintId}
          onChange={(e) => {
            const n = e.target.value.trim() === '' ? 0 : Number(e.target.value);
            if (Number.isFinite(n)) set(n);
          }}
        />
      </div>
      <span id={hintId} className="gpr-hint">
        0–{fmtInt(max)} bp
      </span>
    </div>
  );
}

/** Gene mode: transcript overlay, flanks and the template-size readout (spec §C.3). */
export function GeneInputs(p: GeneInputsProps): JSX.Element {
  const gene = p.gene;
  const loc = gene?.location ?? null;
  const tooLong = geneTooLong(gene);
  const extent = gene && loc ? geneTemplateExtent(gene, p.flankUp, p.flankDown) : null;
  return (
    <fieldset className="gpr-fieldset" disabled={p.disabled}>
      <legend className="gpr-legend">Gene</legend>
      <p className="gpr-gene-summary">
        <span className="gpr-gene-name">{p.geneLabel ?? gene?.name ?? gene?._id ?? p.geneId}</span>
        {gene && loc ? (
          <span className="gpr-sub">
            {' '}
            {formatRegion(loc.region, loc.start, loc.end, loc.strand)} · {fmtInt(geneLength(gene))} bp
          </span>
        ) : null}
      </p>
      {tooLong ? (
        <p className="gpr-note" role="note">
          This gene is longer than the {fmtInt(DESIGN_LIMITS.maxTemplateLength)} bp template limit: use Transcript or Region mode.
        </p>
      ) : null}
      <TranscriptSelect id={`${p.idPrefix}-overlay`} label="Transcript features shown" gene={gene} value={p.transcriptId} onChange={p.onTranscript} />
      <FlankControl
        id={`${p.idPrefix}-flank-up`}
        label="Upstream flank (bp)"
        value={p.flankUp}
        max={maxFlankFor(gene, p.flankDown)}
        disabled={tooLong}
        onChange={(v) => p.onFlanks({ flankUp: v })}
      />
      <FlankControl
        id={`${p.idPrefix}-flank-down`}
        label="Downstream flank (bp)"
        value={p.flankDown}
        max={maxFlankFor(gene, p.flankUp)}
        disabled={tooLong}
        onChange={(v) => p.onFlanks({ flankDown: v })}
      />
      {extent && loc ? (
        <p className="gpr-readout" data-testid="gpr-template-size">
          Template: {fmtInt(extent.length)} bp ({formatRegion(loc.region, extent.start, extent.end, loc.strand)})
        </p>
      ) : null}
    </fieldset>
  );
}
