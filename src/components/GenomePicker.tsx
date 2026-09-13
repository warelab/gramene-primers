import { useState } from 'react';
import type { DesignMode, GenomeEntry, GenomesResponse } from '../types';
import { GprRoot, type StyleProps } from './Root';
import { useIdPrefix } from './util';

export interface GenomePickerProps extends StyleProps {
  genomes: GenomesResponse | ReadonlyArray<GenomeEntry>;
  mode: DesignMode;
  /** The reference genome (never listed). */
  systemName?: string | null;
  /** `null`/`undefined` means every available genome. */
  selected?: ReadonlyArray<string> | null;
  /** Receives `undefined` when every available genome is selected (the request then omits `genomes`). */
  onChange: (selected: string[] | undefined) => void;
  disabled?: boolean;
  label?: string;
}

/** Whether a genome can be searched: a genome BLAST DB, or a cDNA DB in transcript mode. */
export function genomeAvailability(g: GenomeEntry, mode: DesignMode): { ok: true } | { ok: false; reason: string } {
  if (mode === 'transcript') return g.has_cdna_blastdb ? { ok: true } : { ok: false, reason: 'no cDNA BLAST database' };
  return g.has_blastdb ? { ok: true } : { ok: false, reason: 'no BLAST database' };
}

/** Filterable genome checklist with All/None (spec §C.3 GenomePicker). */
export function GenomePicker(props: GenomePickerProps): JSX.Element {
  const idp = useIdPrefix('gpr-genomes');
  const list: ReadonlyArray<GenomeEntry> = Array.isArray(props.genomes) ? props.genomes : (props.genomes as GenomesResponse).genomes ?? [];
  const reference = props.systemName ?? (Array.isArray(props.genomes) ? null : (props.genomes as GenomesResponse).system_name);
  const candidates = list.filter((g) => !g.is_query && g.system_name !== reference);
  const available = candidates.filter((g) => genomeAvailability(g, props.mode).ok).map((g) => g.system_name);
  const selected = new Set(props.selected ?? available);
  const selectedCount = available.filter((n) => selected.has(n)).length;
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const visible = f ? candidates.filter((g) => g.system_name.toLowerCase().includes(f) || (g.display_name ?? '').toLowerCase().includes(f)) : candidates;
  const visibleAvailable = visible.filter((g) => genomeAvailability(g, props.mode).ok).map((g) => g.system_name);

  const emit = (next: Set<string>) => {
    const names = available.filter((n) => next.has(n)).sort();
    props.onChange(names.length === available.length ? undefined : names);
  };

  return (
    <GprRoot theme={props.theme} injectStyles={props.injectStyles} className={props.className} style={props.style}>
      <fieldset className="gpr-fieldset gpr-genome-picker" disabled={props.disabled}>
        <legend className="gpr-legend">{props.label ?? 'Genomes to search'}</legend>
        <div className="gpr-picker-toolbar">
          <label className="gpr-visually-hidden" htmlFor={`${idp}-filter`}>
            Filter genomes
          </label>
          <input
            id={`${idp}-filter`}
            className="gpr-input gpr-picker-filter"
            type="search"
            placeholder="Filter genomes"
            autoComplete="off"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            type="button"
            className="gpr-btn gpr-btn-small"
            aria-label={f ? 'Select all shown genomes' : 'Select all genomes'}
            onClick={() => emit(new Set([...selected, ...visibleAvailable]))}
          >
            All
          </button>
          <button
            type="button"
            className="gpr-btn gpr-btn-small"
            aria-label={f ? 'Deselect all shown genomes' : 'Deselect all genomes'}
            onClick={() => {
              const next = new Set(selected);
              for (const n of visibleAvailable) next.delete(n);
              emit(next);
            }}
          >
            None
          </button>
          <span className="gpr-sub gpr-picker-count">
            {selectedCount} of {available.length} selected
          </span>
        </div>
        <ul className="gpr-genome-list">
          {visible.map((g) => {
            const av = genomeAvailability(g, props.mode);
            const id = `${idp}-${g.system_name}`;
            return (
              <li key={g.system_name} className="gpr-genome-item" data-state={av.ok ? undefined : 'unavailable'}>
                <input
                  id={id}
                  type="checkbox"
                  className="gpr-checkbox"
                  checked={av.ok && selected.has(g.system_name)}
                  disabled={!av.ok}
                  aria-describedby={av.ok ? undefined : `${id}-why`}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(g.system_name);
                    else next.delete(g.system_name);
                    emit(next);
                  }}
                />
                <label className="gpr-label gpr-label-inline" htmlFor={id}>
                  {g.display_name || g.system_name}
                </label>{' '}
                <span className="gpr-sub">{g.system_name}</span>
                {!av.ok ? (
                  <span id={`${id}-why`} className="gpr-sub gpr-unavailable">
                    {' '}
                    ({av.reason})
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {visible.length === 0 ? <p className="gpr-hint">No genomes match the filter.</p> : null}
      </fieldset>
    </GprRoot>
  );
}
