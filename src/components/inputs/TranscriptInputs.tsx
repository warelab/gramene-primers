import type { GrameneGene, Interval } from '../../types';
import { CheckboxField } from '../fields';
import { fmtInt, selectedTranscript } from '../util';
import { TranscriptSelect } from './selects';

export interface TranscriptInputsProps {
  idPrefix: string;
  gene: GrameneGene | null;
  transcriptId: string | undefined;
  junctionSpanning: boolean;
  included: Interval | undefined;
  /** Effective junction overlaps for the hint text. */
  overlaps: { min5: number; min3: number };
  onTranscript: (transcriptId: string | undefined) => void;
  onJunctionSpanning: (value: boolean) => void;
  onIncluded: (included: Interval | undefined) => void;
  disabled?: boolean;
}

/** True when the selected transcript has a single exon (no junction to span). */
export function isSingleExon(gene: GrameneGene | null, transcriptId: string | undefined): boolean {
  const tr = selectedTranscript(gene, transcriptId);
  return !!tr && (tr.exons?.length ?? 0) <= 1;
}

/** Transcript mode: transcript select, junction toggle, Restrict to CDS (spec §C.3). */
export function TranscriptInputs(p: TranscriptInputsProps): JSX.Element {
  const tr = selectedTranscript(p.gene, p.transcriptId);
  const exons = tr?.exons?.length ?? 0;
  const single = !!tr && exons <= 1;
  const junctions = Math.max(0, exons - 1);
  const cds = tr?.cds ?? null;
  const cdsInterval: Interval | null = cds ? [cds.start, cds.end - cds.start + 1] : null;
  const restricted = !!cdsInterval && !!p.included && p.included[0] === cdsInterval[0] && p.included[1] === cdsInterval[1];
  let hint: string | undefined;
  if (single) hint = 'Single-exon transcript: there is no junction to span.';
  else if (tr) {
    hint = `${junctions} junction${junctions === 1 ? '' : 's'}; a spanning primer overlaps one by at least ${p.overlaps.min5} nt on its 5′ side and ${p.overlaps.min3} nt on its 3′ side.`;
  }
  return (
    <fieldset className="gpr-fieldset" disabled={p.disabled}>
      <legend className="gpr-legend">Transcript</legend>
      <TranscriptSelect id={`${p.idPrefix}-transcript`} label="Transcript" gene={p.gene} value={p.transcriptId} onChange={p.onTranscript} />
      {!p.gene ? <p className="gpr-hint">Transcript details are not loaded; the canonical transcript is used.</p> : null}
      <CheckboxField
        id={`${p.idPrefix}-junction`}
        label="One primer must span an exon–exon junction"
        checked={!single && p.junctionSpanning}
        disabled={single}
        onChange={p.onJunctionSpanning}
        hint={hint}
      />
      <div className="gpr-button-row">
        <button type="button" className="gpr-btn gpr-btn-small" disabled={!cdsInterval || restricted} onClick={() => cdsInterval && p.onIncluded(cdsInterval)}>
          Restrict to CDS
        </button>
        <button type="button" className="gpr-btn gpr-btn-small" disabled={!p.included} onClick={() => p.onIncluded(undefined)}>
          Clear
        </button>
      </div>
      {cds ? (
        <p className="gpr-hint">
          CDS at cDNA {fmtInt(cds.start)}–{fmtInt(cds.end)}
          {restricted ? '; primers are restricted to the CDS.' : '.'}
        </p>
      ) : tr ? (
        <p className="gpr-hint">Non-coding transcript.</p>
      ) : null}
    </fieldset>
  );
}
