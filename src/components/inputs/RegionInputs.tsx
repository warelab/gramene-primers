import { useEffect, useRef, useState } from 'react';
import { regionFromGene } from '../../request';
import type { GenomeEntry, GrameneGene, Strand } from '../../types';
import { DESIGN_LIMITS, type ValidationIssue } from '../../validate';
import { fmtInt, sameJson } from '../util';
import { GenomeSelect } from './selects';

type RegionValue = { region: string; start: number; end: number; strand: Strand };

interface Draft {
  region: string;
  start: string;
  end: string;
  strand: '1' | '-1';
}

function toDraft(r: RegionValue | undefined): Draft {
  return { region: r?.region ?? '', start: r ? String(r.start) : '', end: r ? String(r.end) : '', strand: r?.strand === -1 ? '-1' : '1' };
}

function parseRegionDraft(d: Draft): { value: RegionValue | undefined; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const region = d.region.trim();
  if (!region) issues.push({ field: 'region.region', code: 'REQUIRED', message: 'Enter a chromosome or scaffold name.' });
  else if (region.length > DESIGN_LIMITS.maxIdLength) issues.push({ field: 'region.region', code: 'TOO_LONG', message: 'The region name is too long.' });
  const start = /^\d+$/.test(d.start.trim()) ? Number(d.start) : null;
  const end = /^\d+$/.test(d.end.trim()) ? Number(d.end) : null;
  if (start === null || start < 1) issues.push({ field: 'region.start', code: 'INVALID', message: 'Start must be a whole number of at least 1.' });
  if (end === null || end < 1) issues.push({ field: 'region.end', code: 'INVALID', message: 'End must be a whole number of at least 1.' });
  if (start !== null && end !== null && start >= 1 && end >= 1) {
    if (end < start) issues.push({ field: 'region.end', code: 'END_BEFORE_START', message: 'End must not be before start.' });
    else if (end - start + 1 > DESIGN_LIMITS.maxTemplateLength) {
      issues.push({
        field: 'region.end',
        code: 'TEMPLATE_TOO_LONG',
        message: `Regions are limited to ${fmtInt(DESIGN_LIMITS.maxTemplateLength)} bp (this one is ${fmtInt(end - start + 1)} bp).`,
      });
    }
  }
  const value = issues.length ? undefined : { region, start: start!, end: end!, strand: (d.strand === '-1' ? -1 : 1) as Strand };
  return { value, issues };
}

export interface RegionInputsProps {
  idPrefix: string;
  region: RegionValue | undefined;
  systemName: string | undefined;
  genomes: ReadonlyArray<GenomeEntry> | null;
  gene: GrameneGene | null;
  onRegion: (region: RegionValue) => void;
  onSystemName: (systemName: string | undefined) => void;
  onIssues: (issues: ValidationIssue[]) => void;
  disabled?: boolean;
}

/** Region mode: genome, region, start, end, strand; prefilled from the gene (spec §C.3). */
export function RegionInputs(p: RegionInputsProps): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => toDraft(p.region));
  const committed = useRef(p.region);
  useEffect(() => {
    if (!sameJson(p.region, committed.current)) {
      committed.current = p.region;
      setDraft(toDraft(p.region));
    }
  }, [p.region]);

  const parsed = parseRegionDraft(draft);
  const issues = [...parsed.issues];
  if (!p.systemName) issues.unshift({ field: 'system_name', code: 'REQUIRED', message: 'Choose a genome.' });
  else if (!DESIGN_LIMITS.systemNamePattern.test(p.systemName) || p.systemName.length > 128) {
    // Free-text fallback when the genome list is unavailable; the server's pattern is ^[a-z0-9_]+$.
    issues.unshift({ field: 'system_name', code: 'INVALID', message: 'The genome name is not valid.' });
  }
  const onIssues = useRef(p.onIssues);
  onIssues.current = p.onIssues;
  const issuesKey = JSON.stringify(issues);
  useEffect(() => {
    onIssues.current(JSON.parse(issuesKey) as ValidationIssue[]);
  }, [issuesKey]);
  useEffect(() => () => onIssues.current([]), []);

  const update = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    const r = parseRegionDraft(next);
    if (r.value && !sameJson(r.value, p.region)) {
      committed.current = r.value;
      p.onRegion(r.value);
    }
  };
  const id = (k: string) => `${p.idPrefix}-region-${k}`;
  const fieldIssues = (field: string) => issues.filter((i) => i.field === field);
  const errText = (field: string) => fieldIssues(field).map((i) => i.message).join(' ');
  const geneRegion = regionFromGene(p.gene);

  return (
    <fieldset className="gpr-fieldset" disabled={p.disabled}>
      <legend className="gpr-legend">Genomic region</legend>
      <GenomeSelect id={id('genome')} label="Genome" value={p.systemName} genomes={p.genomes} onChange={p.onSystemName} />
      <div className="gpr-field-grid">
        {(
          [
            ['region', 'Region', 'text', 'e.g. 1'],
            ['start', 'Start', 'numeric', ''],
            ['end', 'End', 'numeric', ''],
          ] as const
        ).map(([key, label, mode, placeholder]) => {
          const err = errText(`region.${key}`);
          return (
            <div className="gpr-field" key={key}>
              <label className="gpr-label" htmlFor={id(key)}>
                {label}
              </label>
              <input
                id={id(key)}
                className="gpr-input"
                type="text"
                inputMode={mode}
                spellCheck={false}
                autoComplete="off"
                placeholder={placeholder || undefined}
                value={draft[key]}
                aria-invalid={err ? true : undefined}
                aria-describedby={err ? `${id(key)}-err` : undefined}
                onChange={(e) => update({ [key]: e.target.value })}
              />
              {err ? (
                <span id={`${id(key)}-err`} className="gpr-field-error">
                  {err}
                </span>
              ) : null}
            </div>
          );
        })}
        <div className="gpr-field">
          <label className="gpr-label" htmlFor={id('strand')}>
            Strand
          </label>
          <select id={id('strand')} className="gpr-select" value={draft.strand} onChange={(e) => update({ strand: e.target.value === '-1' ? '-1' : '1' })}>
            <option value="1">+ (forward)</option>
            <option value="-1">− (reverse)</option>
          </select>
        </div>
      </div>
      {parsed.value ? <p className="gpr-readout">Template: {fmtInt(parsed.value.end - parsed.value.start + 1)} bp</p> : null}
      {geneRegion ? (
        <div className="gpr-button-row">
          <button type="button" className="gpr-btn gpr-btn-small" disabled={sameJson(geneRegion, p.region)} onClick={() => p.onRegion(geneRegion)}>
            Use gene location
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
