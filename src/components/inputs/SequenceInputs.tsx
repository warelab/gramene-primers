import type { GenomeEntry } from '../../types';
import { DESIGN_LIMITS, type CleanedSequence } from '../../validate';
import { fmtInt } from '../util';
import { GenomeSelect } from './selects';

export interface SequenceInputsProps {
  idPrefix: string;
  sequence: string;
  cleaned: CleanedSequence;
  systemName: string | undefined;
  genomes: ReadonlyArray<GenomeEntry> | null;
  onSequence: (sequence: string) => void;
  onSystemName: (systemName: string | undefined) => void;
  disabled?: boolean;
}

/** Sequence mode: FASTA textarea with live cleaned length and a genome select for checks (spec §C.3). */
export function SequenceInputs(p: SequenceInputsProps): JSX.Element {
  const c = p.cleaned;
  const statusId = `${p.idPrefix}-sequence-status`;
  const problems: string[] = [];
  if (c.invalidChars.length) {
    problems.push(`invalid characters: ${c.invalidChars.slice(0, 10).map((ch) => `“${ch}”`).join(' ')}`);
  }
  if (c.length > 0 && c.tooShort) problems.push(`at least ${DESIGN_LIMITS.minSequenceLength} nt are needed`);
  if (c.tooLong) problems.push(`at most ${fmtInt(DESIGN_LIMITS.maxSequenceLength)} nt are allowed`);
  const invalid = c.length > 0 && !c.ok;
  return (
    <fieldset className="gpr-fieldset" disabled={p.disabled}>
      <legend className="gpr-legend">Sequence</legend>
      <div className="gpr-field">
        <label className="gpr-label" htmlFor={`${p.idPrefix}-sequence`}>
          Sequence (FASTA or plain, {DESIGN_LIMITS.minSequenceLength}–{fmtInt(DESIGN_LIMITS.maxSequenceLength)} nt)
        </label>
        <textarea
          id={`${p.idPrefix}-sequence`}
          className="gpr-textarea"
          rows={8}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          value={p.sequence}
          maxLength={DESIGN_LIMITS.maxSequenceInput}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={statusId}
          onChange={(e) => p.onSequence(e.target.value)}
        />
        <p id={statusId} className={invalid ? 'gpr-field-error' : 'gpr-readout'}>
          {fmtInt(c.length)} nt{problems.length ? ` · ${problems.join(' · ')}` : ''}
          {c.iupacConverted ? ' · IUPAC codes will be converted to N' : ''}
        </p>
        {c.records > 1 ? (
          <p className="gpr-note" role="note" data-code="MULTIPLE_RECORDS">
            {fmtInt(c.records)} FASTA records will be joined into one template, so a primer pair may span a join. Paste one record to design on it alone.
          </p>
        ) : null}
      </div>
      <GenomeSelect
        id={`${p.idPrefix}-sequence-genome`}
        label="Genome (needed for checks)"
        value={p.systemName}
        genomes={p.genomes}
        onChange={p.onSystemName}
        allowNone
        noneLabel="None (design only)"
      />
    </fieldset>
  );
}
