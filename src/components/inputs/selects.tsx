import type { ReactNode } from 'react';
import { canonicalTranscriptId } from '../../coords';
import type { GenomeEntry, GrameneGene, GrameneTranscript } from '../../types';
import { DESIGN_LIMITS } from '../../validate';
import { fmtInt, geneTranscripts } from '../util';

export function transcriptOptionLabel(t: GrameneTranscript, canonicalId: string | null): string {
  const n = Array.isArray(t.exons) ? t.exons.length : 0;
  const parts = [`${n} exon${n === 1 ? '' : 's'}`, `${fmtInt(t.length)} nt`, t.cds ? `CDS ${fmtInt(t.cds.start)}–${fmtInt(t.cds.end)}` : 'non-coding'];
  return `${t.id}${t.id === canonicalId ? ' (canonical)' : ''} · ${parts.join(', ')}`;
}

export interface TranscriptSelectProps {
  id: string;
  label: string;
  gene: GrameneGene | null;
  /** `undefined` = the canonical transcript. */
  value: string | undefined;
  onChange: (transcriptId: string | undefined) => void;
  disabled?: boolean;
}

/** Transcript picker with exon count, cDNA length and CDS; the canonical one is badged. */
export function TranscriptSelect({ id, label, gene, value, onChange, disabled }: TranscriptSelectProps): JSX.Element | null {
  const transcripts = geneTranscripts(gene);
  if (!transcripts.length) return null;
  const canonical = canonicalTranscriptId(gene);
  const selected = value && transcripts.some((t) => t.id === value) ? value : canonical ?? transcripts[0]!.id;
  return (
    <div className="gpr-field">
      <label className="gpr-label" htmlFor={id}>
        {label}
      </label>
      <div className="gpr-inline">
        <select
          id={id}
          className="gpr-select"
          value={selected}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === canonical ? undefined : e.target.value)}
        >
          {transcripts.map((t) => (
            <option key={t.id} value={t.id}>
              {transcriptOptionLabel(t, canonical)}
            </option>
          ))}
        </select>
        {selected === canonical ? <span className="gpr-badge">canonical</span> : null}
      </div>
    </div>
  );
}

export interface GenomeSelectProps {
  id: string;
  label: ReactNode;
  value: string | undefined;
  genomes: ReadonlyArray<GenomeEntry> | null;
  onChange: (systemName: string | undefined) => void;
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  hint?: ReactNode;
}

/** Genome `<select>` from `listGenomes`; a `system_name` text field when no list is available. */
export function GenomeSelect({ id, label, value, genomes, onChange, allowNone, noneLabel, disabled, hint }: GenomeSelectProps): JSX.Element {
  const hintId = `${id}-hint`;
  if (!genomes || genomes.length === 0) {
    const invalid = !!value && !DESIGN_LIMITS.systemNamePattern.test(value);
    return (
      <div className="gpr-field">
        <label className="gpr-label" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          className="gpr-input"
          type="text"
          value={value ?? ''}
          spellCheck={false}
          autoComplete="off"
          placeholder="e.g. sorghum_bicolor"
          disabled={disabled}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value.trim() || undefined)}
        />
        <span id={hintId} className={invalid ? 'gpr-field-error' : 'gpr-hint'}>
          {invalid ? 'Use the genome system name: lowercase letters, digits and _.' : hint ?? 'Genome system name.'}
        </span>
      </div>
    );
  }
  const known = !!value && genomes.some((g) => g.system_name === value);
  return (
    <div className="gpr-field">
      <label className="gpr-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="gpr-select"
        value={value ?? ''}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        {allowNone || !value ? <option value="">{noneLabel ?? '— choose a genome —'}</option> : null}
        {value && !known ? <option value={value}>{value}</option> : null}
        {genomes.map((g) => (
          <option key={g.system_name} value={g.system_name}>
            {g.display_name || g.system_name}
            {g.is_query ? ' (this genome)' : ''}
          </option>
        ))}
      </select>
      {hint ? (
        <span id={hintId} className="gpr-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
