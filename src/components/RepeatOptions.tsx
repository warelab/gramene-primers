import { useState } from 'react';
import type { DesignMode, GenomeEntry, MaskSource, PrimerTemplate, RepeatMaskMode, RepeatMasking } from '../types';
import { CheckboxField } from './fields';
import { HelpButton, Primer3DocText } from './Primer3Help';
import { fmtPercent } from './util';

type KnownMaskSource = Exclude<MaskSource, null>;

/** Names of the repeat-mask sources (plan override: the UI names the source). */
export const MASK_SOURCE_LABELS: Readonly<Record<KnownMaskSource, string>> = Object.freeze({
  softmask: 'RepeatMasker soft-mask',
  blast_depth: 'BLAST copy-number heuristic',
  user_lowercase: 'lowercase letters in the pasted sequence',
});

const REPEAT_MASKING_TEXT: Readonly<Record<RepeatMasking, string>> = Object.freeze({
  soft_masked: 'soft-masked by RepeatMasker',
  unmasked_copy: 'no real soft-mask (the soft-masked FASTA is an unmasked copy)',
  absent: 'no soft-masked FASTA',
});

/** The mask the server will use: the real soft-mask when the genome has one, else the BLAST heuristic; lowercase in sequence mode. */
export function expectedMaskSource(mode: DesignMode, genome: GenomeEntry | null, hasLowercase: boolean): MaskSource {
  if (mode === 'sequence') return hasLowercase ? 'user_lowercase' : null;
  if (!genome) return null;
  return genome.repeat_masking === 'soft_masked' ? 'softmask' : 'blast_depth';
}

export interface RepeatOptionsProps {
  idPrefix: string;
  mode: DesignMode;
  avoidRepeats: boolean;
  repeatMaskMode: RepeatMaskMode;
  onChange: (change: { avoidRepeats?: boolean; repeatMaskMode?: RepeatMaskMode }) => void;
  /** The template genome's catalog entry (from `listGenomes`). */
  genome: GenomeEntry | null;
  /** The last design's template, whose `mask_source` is authoritative. */
  template: PrimerTemplate | null;
  hasLowercase: boolean;
  disabled?: boolean;
}

export function RepeatOptions(p: RepeatOptionsProps): JSX.Element {
  const [helpOpen, setHelpOpen] = useState(false);
  const expected = expectedMaskSource(p.mode, p.genome, p.hasLowercase);
  const tpl = p.template && p.template.mode === p.mode ? p.template : null;
  const actual = tpl?.mask_source ?? null;
  const source = actual ?? expected;
  const name = `${p.idPrefix}-maskmode`;
  const legendId = `${p.idPrefix}-maskmode-legend`;
  const helpId = `${p.idPrefix}-help-repeat_masking`;
  let sourceText: JSX.Element | string;
  if (source) {
    sourceText = (
      <>
        Mask source: <strong className="gpr-mask-source-name">{MASK_SOURCE_LABELS[source]}</strong>
        {source === 'blast_depth' ? ' — it also masks multi-copy gene families, not only repeats.' : '.'}
      </>
    );
  } else if (p.mode === 'sequence') {
    sourceText = 'Pasted sequences are masked only where you type lowercase letters.';
  } else {
    sourceText = 'Mask source: not known until the genome list has loaded.';
  }
  return (
    <fieldset className="gpr-fieldset" disabled={p.disabled}>
      <legend className="gpr-legend">Repeats</legend>
      <CheckboxField id={`${p.idPrefix}-avoid-repeats`} label="Avoid repeats" checked={p.avoidRepeats} onChange={(v) => p.onChange({ avoidRepeats: v })} />
      <fieldset className="gpr-subfieldset" disabled={p.disabled || !p.avoidRepeats} aria-labelledby={legendId}>
        {/* The first legend's button stays usable while the fieldset is disabled. */}
        <legend className="gpr-legend gpr-legend-small">
          <span className="gpr-label-row">
            <span id={legendId}>Masked bases</span>
            <HelpButton subject="Masked bases" expanded={helpOpen} controls={helpId} onToggle={() => setHelpOpen((o) => !o)} />
          </span>
        </legend>
        {helpOpen ? (
          <p id={helpId} className="gpr-hint gpr-help-text">
            <Primer3DocText topic="repeat_masking" />
          </p>
        ) : null}
        <div className="gpr-radio-row">
          <input
            type="radio"
            className="gpr-radio"
            id={`${name}-n`}
            name={name}
            value="n_mask"
            checked={p.repeatMaskMode !== 'three_prime'}
            onChange={() => p.onChange({ repeatMaskMode: 'n_mask' })}
          />
          <label className="gpr-label gpr-label-inline" htmlFor={`${name}-n`}>
            Replace with N: no primer may overlap a repeat
          </label>
        </div>
        <div className="gpr-radio-row">
          <input
            type="radio"
            className="gpr-radio"
            id={`${name}-3p`}
            name={name}
            value="three_prime"
            checked={p.repeatMaskMode === 'three_prime'}
            onChange={() => p.onChange({ repeatMaskMode: 'three_prime' })}
          />
          <label className="gpr-label gpr-label-inline" htmlFor={`${name}-3p`}>
            Keep, but no primer 3′ end in a repeat
          </label>
        </div>
      </fieldset>
      <p className="gpr-hint gpr-mask-source" data-source={source ?? 'none'}>
        {sourceText}
      </p>
      {p.genome && p.mode !== 'sequence' ? (
        <p className="gpr-hint">
          {p.genome.display_name || p.genome.system_name}: {REPEAT_MASKING_TEXT[p.genome.repeat_masking] ?? p.genome.repeat_masking}.
        </p>
      ) : null}
      {tpl && actual ? (
        <p className="gpr-readout">
          Last template: {fmtPercent(tpl.masked_fraction ?? 0)} masked ({MASK_SOURCE_LABELS[actual]}).
        </p>
      ) : null}
    </fieldset>
  );
}
