import { useState } from 'react';
import { effectiveDesignParams, PRESETS, PRIMER3_DEFAULTS } from '../presets';
import type { DesignMode, DesignParamKey, DesignParams, DesignRequest, DesignSettings, NumericDesignParamKey, PresetName, ProductSizeRange } from '../types';
import { DESIGN_LIMITS, DESIGN_PARAM_LIMITS, type ValidationIssue } from '../validate';
import { NumberField } from './fields';
import { fmtInt } from './util';

const TRIPLES: ReadonlyArray<{ label: string; unit: string; keys: readonly [NumericDesignParamKey, NumericDesignParamKey, NumericDesignParamKey] }> = [
  { label: 'Primer size', unit: 'nt', keys: ['min_size', 'opt_size', 'max_size'] },
  { label: 'Melting temperature', unit: '°C', keys: ['min_tm', 'opt_tm', 'max_tm'] },
  { label: 'GC content', unit: '%', keys: ['min_gc', 'opt_gc', 'max_gc'] },
];

const ADVANCED: ReadonlyArray<{ key: NumericDesignParamKey; label: string; transcriptOnly?: boolean }> = [
  { key: 'max_poly_x', label: 'Max mononucleotide run (nt)' },
  { key: 'gc_clamp', label: 'GC clamp (3′ G/C bases)' },
  { key: 'max_end_stability', label: 'Max 3′ end stability (kcal/mol)' },
  { key: 'max_ns', label: 'Max Ns accepted' },
  { key: 'salt_monovalent', label: 'Monovalent cations (mM)' },
  { key: 'salt_divalent', label: 'Divalent cations (mM)' },
  { key: 'dntp_conc', label: 'dNTP (mM)' },
  { key: 'dna_conc', label: 'Oligo DNA (nM)' },
  { key: 'min_5_prime_overlap_of_junction', label: 'Min junction overlap, 5′ side (nt)', transcriptOnly: true },
  { key: 'min_3_prime_overlap_of_junction', label: 'Min junction overlap, 3′ side (nt)', transcriptOnly: true },
];

/**
 * Placeholder for a parameter: the preset value, else the server's echo in
 * `settings.params` (when the last request did not set it), else the Primer3
 * default.
 */
export function paramPlaceholder(
  key: NumericDesignParamKey,
  preset: PresetName,
  mode: DesignMode,
  settings: DesignSettings | null | undefined,
  lastRequest: DesignRequest | null | undefined,
): string {
  const presetValue = (PRESETS[preset].params as Record<string, unknown>)[key];
  if (typeof presetValue === 'number') return String(presetValue);
  const sentByUser = !!lastRequest?.params && key in lastRequest.params;
  if (settings?.params && lastRequest?.mode === mode && !sentByUser) {
    const echoed = (settings.params as Record<string, unknown>)[key];
    if (typeof echoed === 'number') return String(echoed);
  }
  const d = (PRIMER3_DEFAULTS as Record<string, unknown>)[key];
  return typeof d === 'number' ? String(d) : '';
}

export interface ParamsPanelProps {
  idPrefix: string;
  mode: DesignMode;
  preset: PresetName;
  params: Partial<DesignParams> | undefined;
  onPreset: (preset: PresetName) => void;
  onParam: (key: DesignParamKey, value: DesignParams[DesignParamKey] | undefined) => void;
  onReset: () => void;
  settings: DesignSettings | null;
  lastRequest: DesignRequest | null;
  /** `validateDesignParams` output for the effective params. */
  issues: ReadonlyArray<ValidationIssue>;
  disabled?: boolean;
}

function ProductRanges(props: {
  idPrefix: string;
  ranges: ProductSizeRange[];
  changed: boolean;
  issues: ReadonlyArray<ValidationIssue>;
  onChange: (ranges: ProductSizeRange[] | undefined) => void;
}): JSX.Element {
  const { idPrefix, ranges, changed, issues, onChange } = props;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const a = Number(from);
  const b = Number(to);
  const valid =
    /^\d+$/.test(from.trim()) && /^\d+$/.test(to.trim()) && a < b && a >= DESIGN_LIMITS.minProductSize && b <= DESIGN_LIMITS.maxProductSize;
  const canAdd = valid && ranges.length < DESIGN_LIMITS.maxProductRanges;
  const add = () => {
    if (!canAdd) return;
    onChange([...ranges, [a, b] as ProductSizeRange].sort((x, y) => x[0] - y[0] || x[1] - y[1]));
    setFrom('');
    setTo('');
  };
  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };
  const errId = `${idPrefix}-ranges-err`;
  return (
    <fieldset className="gpr-subfieldset gpr-ranges" data-state={changed ? 'changed' : undefined}>
      <legend className="gpr-legend gpr-legend-small">Product size ranges (bp)</legend>
      <ul className="gpr-range-chips" aria-describedby={issues.length ? errId : undefined}>
        {ranges.map((r, i) => (
          <li key={`${r[0]}-${r[1]}-${i}`} className="gpr-range-chip">
            <span>
              {fmtInt(r[0])}–{fmtInt(r[1])}
            </span>
            <button
              type="button"
              className="gpr-range-chip-remove"
              aria-label={`Remove range ${r[0]}–${r[1]} bp`}
              disabled={ranges.length <= 1 && !changed}
              onClick={() => {
                const next = ranges.filter((_, j) => j !== i);
                onChange(next.length ? next : undefined);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="gpr-range-add">
        <label className="gpr-visually-hidden" htmlFor={`${idPrefix}-range-from`}>
          New range from (bp)
        </label>
        <input
          id={`${idPrefix}-range-from`}
          className="gpr-input gpr-input-short"
          type="text"
          inputMode="numeric"
          placeholder="from"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          onKeyDown={onEnter}
        />
        <span aria-hidden="true">–</span>
        <label className="gpr-visually-hidden" htmlFor={`${idPrefix}-range-to`}>
          New range to (bp)
        </label>
        <input
          id={`${idPrefix}-range-to`}
          className="gpr-input gpr-input-short"
          type="text"
          inputMode="numeric"
          placeholder="to"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={onEnter}
        />
        <button type="button" className="gpr-btn gpr-btn-small" disabled={!canAdd} onClick={add}>
          Add range
        </button>
      </div>
      {issues.length ? (
        <p id={errId} className="gpr-field-error">
          {issues.map((i) => i.message).join(' ')}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Presets plus Primer3 parameters with inline validation; only changed values are sent (spec §C.3). */
export function ParamsPanel(p: ParamsPanelProps): JSX.Element {
  const effective = effectiveDesignParams(p.preset, p.params);
  const issuesFor = (field: string) => p.issues.filter((i) => i.field === field);
  const overrides = (p.params ?? {}) as Record<string, unknown>;
  const field = (key: NumericDesignParamKey, label: React.ReactNode) => {
    const lim = DESIGN_PARAM_LIMITS[key];
    const v = overrides[key];
    return (
      <NumberField
        key={key}
        id={`${p.idPrefix}-param-${key}`}
        label={label}
        value={typeof v === 'number' ? v : undefined}
        placeholder={paramPlaceholder(key, p.preset, p.mode, p.settings, p.lastRequest)}
        min={lim.min}
        max={lim.max}
        step={lim.integer ? 1 : 'any'}
        issues={issuesFor(key)}
        changed={typeof v === 'number'}
        onChange={(value) => p.onParam(key, value)}
      />
    );
  };
  const rangeIssues = p.issues.filter((i) => i.field === 'product_size_ranges' || i.field.startsWith('product_size_ranges['));
  return (
    <fieldset className="gpr-fieldset gpr-params" disabled={p.disabled}>
      <legend className="gpr-legend">Primer3 parameters</legend>
      <fieldset className="gpr-subfieldset gpr-presets">
        <legend className="gpr-legend gpr-legend-small">Preset</legend>
        {(['pcr', 'qpcr'] as const).map((id) => (
          <div className="gpr-radio-row" key={id}>
            <input
              type="radio"
              className="gpr-radio"
              id={`${p.idPrefix}-preset-${id}`}
              name={`${p.idPrefix}-preset`}
              checked={p.preset === id}
              aria-describedby={`${p.idPrefix}-preset-${id}-desc`}
              onChange={() => p.onPreset(id)}
            />
            <label className="gpr-label gpr-label-inline" htmlFor={`${p.idPrefix}-preset-${id}`}>
              {PRESETS[id].label}
            </label>
            <span id={`${p.idPrefix}-preset-${id}-desc`} className="gpr-hint gpr-preset-desc">
              {PRESETS[id].description}
            </span>
          </div>
        ))}
      </fieldset>
      {TRIPLES.map((g) => (
        <fieldset className="gpr-subfieldset gpr-triple" key={g.label}>
          <legend className="gpr-legend gpr-legend-small">
            {g.label} ({g.unit})
          </legend>
          <div className="gpr-triple-grid">
            {field(g.keys[0], <><span className="gpr-visually-hidden">{g.label}</span> min</>)}
            {field(g.keys[1], <><span className="gpr-visually-hidden">{g.label}</span> opt</>)}
            {field(g.keys[2], <><span className="gpr-visually-hidden">{g.label}</span> max</>)}
          </div>
        </fieldset>
      ))}
      <div className="gpr-field-grid">
        {field('max_tm_diff', 'Max Tm difference (°C)')}
        {field('num_return', 'Pairs to return')}
      </div>
      <ProductRanges
        idPrefix={p.idPrefix}
        ranges={effective.product_size_ranges ?? []}
        changed={Array.isArray(p.params?.product_size_ranges)}
        issues={rangeIssues}
        onChange={(ranges) => p.onParam('product_size_ranges', ranges)}
      />
      <details className="gpr-details">
        <summary className="gpr-summary">Advanced parameters</summary>
        <div className="gpr-field-grid">{ADVANCED.filter((a) => !a.transcriptOnly || p.mode === 'transcript').map((a) => field(a.key, a.label))}</div>
      </details>
      <div className="gpr-button-row">
        <button type="button" className="gpr-btn gpr-btn-small gpr-btn-quiet" disabled={!p.params} onClick={p.onReset}>
          Reset to preset
        </button>
      </div>
    </fieldset>
  );
}
