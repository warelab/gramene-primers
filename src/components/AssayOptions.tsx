import { Fragment, useState } from 'react';
import {
  defaultGenotypingAssay,
  effectiveGenotypingAssay,
  GENOTYPING_FLOORS,
  GENOTYPING_LADDER,
  GENOTYPING_LEVEL0_PARAMS,
  GENOTYPING_PRESETS,
} from '../presets';
import type { GenomeEntry, GenotypingAssay, GenotypingAssayType, GenotypingParams, GenotypingSettings, RepeatMaskMode } from '../types';
import { GENOTYPING_LIMITS, GENOTYPING_PARAM_LIMITS, type ValidationIssue } from '../validate';
import { NumberField, PresetRadios, type PresetOption } from './fields';
import { RepeatOptions } from './RepeatOptions';
import { fmtNum } from './util';

const ASSAY_OPTIONS: ReadonlyArray<PresetOption<GenotypingAssayType>> = (['kasp', 'as_pcr'] as const).map((id) => ({
  id,
  label: GENOTYPING_PRESETS[id].label,
  description: GENOTYPING_PRESETS[id].description,
}));

type NumericParamKey = Exclude<keyof GenotypingParams, 'product_size_ranges'>;

/** Primer3 parameters, grouped as the design panel groups them. */
const PARAM_TRIPLES: ReadonlyArray<{ label: string; unit: string; keys: readonly [NumericParamKey, NumericParamKey, NumericParamKey] }> = [
  { label: 'Primer size', unit: 'nt', keys: ['min_size', 'opt_size', 'max_size'] },
  { label: 'Melting temperature', unit: '°C', keys: ['min_tm', 'opt_tm', 'max_tm'] },
  { label: 'GC content', unit: '%', keys: ['min_gc', 'opt_gc', 'max_gc'] },
];

const PARAM_SINGLES: ReadonlyArray<{ key: NumericParamKey; label: string }> = [
  { key: 'max_tm_diff', label: 'Max Tm difference (°C)' },
  { key: 'max_poly_x', label: 'Max mononucleotide run (nt)' },
  { key: 'gc_clamp', label: 'GC clamp (3′ G/C bases)' },
  { key: 'max_end_stability', label: 'Max 3′ end stability (kcal/mol)' },
  { key: 'salt_monovalent', label: 'Monovalent cations (mM)' },
  { key: 'salt_divalent', label: 'Divalent cations (mM)' },
  { key: 'dntp_conc', label: 'dNTP (mM)' },
  { key: 'dna_conc', label: 'Oligo DNA (nM)' },
];

export interface AssayOptionsProps {
  idPrefix: string;
  assay: Partial<GenotypingAssay> | undefined;
  params: Partial<GenotypingParams> | undefined;
  /** The server's echo of the last design: pinned params, the ladder and the floors. */
  settings?: GenotypingSettings | null;
  /** `assay.ems_target`: every record of the target is an EMS mutation. */
  emsTarget?: boolean;
  issues: ReadonlyArray<ValidationIssue>;
  avoidRepeats?: boolean;
  repeatMaskMode?: RepeatMaskMode;
  /** The reference genome's catalog entry, so the repeat options can name its real mask source. */
  genome?: GenomeEntry | null;
  onAssay: (patch: Partial<GenotypingAssay>) => void;
  onParam: (key: keyof GenotypingParams, value: GenotypingParams[keyof GenotypingParams] | undefined) => void;
  onResetParams: () => void;
  onRepeats: (change: { avoidRepeats?: boolean; repeatMaskMode?: RepeatMaskMode }) => void;
  disabled?: boolean;
}

/**
 * Assay type and its options (spec §3.2). Every parameter the client sends is
 * **pinned** by the server and excluded from the relaxation ladder, so a field
 * left empty is not the same as a field set to the preset's value: empty lets
 * the ladder relax it.
 *
 * `product_size_ranges` is edited in the shared ranges editor, which still lives
 * inside `ParamsPanel`; it is wired here once that is extracted.
 */
export function AssayOptions(p: AssayOptionsProps): JSX.Element {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const effective = effectiveGenotypingAssay(p.assay);
  const defaults = defaultGenotypingAssay(effective.type);
  const overrides = (p.params ?? {}) as Record<string, unknown>;
  const pinned = new Set(p.settings?.pinned ?? []);
  const issuesFor = (field: string) => p.issues.filter((i) => i.field === field);
  const id = (suffix: string) => `${p.idPrefix}-gt-${suffix}`;

  // `numeric` matters: `mismatch_position` is a number, and a select always
  // hands back a string, which would otherwise be stored (and sent) as "2".
  const select = <T extends string>(key: keyof GenotypingAssay, label: string, options: ReadonlyArray<[T, string]>, hint?: string, numeric = false) => {
    const fieldId = id(String(key));
    const hintId = `${fieldId}-hint`;
    return (
      <div className="gpr-field">
        <label className="gpr-label" htmlFor={fieldId}>
          {label}
        </label>
        <select
          id={fieldId}
          className="gpr-select"
          value={String(effective[key])}
          disabled={p.disabled}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => p.onAssay({ [key]: numeric ? Number(e.target.value) : e.target.value } as Partial<GenotypingAssay>)}
        >
          {options.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
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
  };

  const paramField = (key: NumericParamKey, label: string) => {
    const lim = GENOTYPING_PARAM_LIMITS[key];
    const v = overrides[key];
    const preset = (GENOTYPING_LEVEL0_PARAMS as Record<string, unknown>)[key];
    return (
      <NumberField
        key={key}
        id={id(`param-${key}`)}
        label={label}
        value={typeof v === 'number' ? v : undefined}
        placeholder={typeof preset === 'number' ? String(preset) : ''}
        min={lim.min}
        max={lim.max}
        step={lim.integer ? 1 : 'any'}
        issues={issuesFor(key)}
        changed={typeof v === 'number'}
        disabled={p.disabled}
        hint={pinned.has(key) ? 'Pinned: this value was sent, so it was never relaxed.' : undefined}
        onChange={(value) => p.onParam(key, value)}
      />
    );
  };

  return (
    <div className="gpr-assay-options">
      <PresetRadios idPrefix={`${p.idPrefix}-assay`} legend="Assay" options={ASSAY_OPTIONS} value={effective.type} onChange={(type) => p.onAssay({ type })} />

      {p.emsTarget ? (
        <p className="gpr-note" role="note" data-code="EMS_TARGET">
          This is an EMS mutation, private to one mutant line. Natural variants nearby warn instead of blocking a primer.
        </p>
      ) : null}

      <fieldset className="gpr-fieldset gpr-assay-fieldset" disabled={p.disabled}>
        <legend className="gpr-legend gpr-legend-small">Assay options</legend>
        <div className="gpr-field-grid">
          {select('orientation', 'Orientation', [
            ['both', 'Both'],
            ['forward', 'Forward only'],
            ['reverse', 'Reverse only'],
          ] as const, 'An orientation you do not ask for is reported as skipped.')}

          {effective.type === 'kasp' || showAdvanced
            ? select('tails', 'Tails', [
                ['ref_fam_alt_hex', 'REF → FAM, ALT → HEX'],
                ['ref_hex_alt_fam', 'REF → HEX, ALT → FAM'],
                ['none', 'No tails'],
              ] as const, 'The tail is never part of a check; it is only synthesized.')
            : null}

          {select('deliberate_mismatch', 'Deliberate mismatch', [
            ['none', 'None'],
            ['auto', 'Add automatically'],
          ] as const, 'A second mismatch near the 3′ end sharpens discrimination.')}

          {select(
            'mismatch_position',
            'Mismatch position',
            [
              ['2', '−2 (Little 1995)'],
              ['3', '−3 (extrapolated)'],
            ] as const,
            'Little (1995) is defined for −2; −3 is extrapolated from it.',
            true,
          )}

          {select('neighbour_policy', 'Known variants at the 3′ end', [
            ['avoid_3p', 'Avoid them'],
            ['ignore', 'Allow, and report as an issue'],
          ] as const)}

          <NumberField
            id={id('num_sets')}
            label="Sets to design"
            value={effective.num_sets}
            min={GENOTYPING_LIMITS.minSets}
            max={GENOTYPING_LIMITS.maxSets}
            step={1}
            disabled={p.disabled}
            changed={effective.num_sets !== defaults.num_sets}
            hint={`${GENOTYPING_LIMITS.minSets}–${GENOTYPING_LIMITS.maxSets}; at most 5 can be checked at once.`}
            onChange={(v) => p.onAssay({ num_sets: v ?? defaults.num_sets })}
          />

          <NumberField
            id={id('max_relaxation')}
            label="Relaxation levels allowed"
            value={effective.max_relaxation}
            min={0}
            max={GENOTYPING_LIMITS.maxRelaxation}
            step={1}
            disabled={p.disabled}
            changed={effective.max_relaxation !== defaults.max_relaxation}
            hint="How far the constraints may be loosened when no set is found."
            onChange={(v) => p.onAssay({ max_relaxation: v ?? defaults.max_relaxation })}
          />
        </div>
      </fieldset>

      <RepeatOptions
        idPrefix={`${p.idPrefix}-gt`}
        mode="region"
        avoidRepeats={!!p.avoidRepeats}
        repeatMaskMode={p.repeatMaskMode ?? 'n_mask'}
        onChange={p.onRepeats}
        genome={p.genome ?? null}
        // Genotyping templates are a different shape from design templates, so there is
        // none to hand over; RepeatOptions then names the genome's expected mask source.
        template={null}
        hasLowercase={false}
        disabled={p.disabled}
      />

      <details className="gpr-details gpr-assay-advanced" onToggle={(e) => setShowAdvanced((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="gpr-summary">Primer3 parameters</summary>
        <p className="gpr-hint">
          An empty field uses the value shown in grey and may be relaxed. A value you enter is pinned: the server keeps it exactly, at every relaxation level.
        </p>
        {PARAM_TRIPLES.map((g) => (
          <fieldset className="gpr-subfieldset gpr-triple" key={g.label}>
            <legend className="gpr-legend gpr-legend-small">
              {g.label} ({g.unit})
            </legend>
            <div className="gpr-triple-grid">
              {g.keys.map((k) => (
                <Fragment key={k}>{paramField(k, k.startsWith('min') ? 'Min' : k.startsWith('opt') ? 'Optimum' : 'Max')}</Fragment>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="gpr-field-grid">{PARAM_SINGLES.map((f) => paramField(f.key, f.label))}</div>
        <div className="gpr-button-row">
          <button type="button" className="gpr-btn gpr-btn-small" disabled={p.disabled || !p.params} onClick={p.onResetParams}>
            Reset parameters
          </button>
        </div>

        <dl className="gpr-dl gpr-assay-limits">
          <div className="gpr-dl-row">
            <dt>Hard floors</dt>
            <dd>
              allele-specific Tm at least {fmtNum(GENOTYPING_FLOORS.as_min_tm, 0)} °C, GC at least {fmtNum(GENOTYPING_FLOORS.as_min_gc, 0)} %
            </dd>
          </div>
          {(p.settings?.ladder ?? GENOTYPING_LADDER).map((step) => (
            <div className="gpr-dl-row" key={step.level}>
              <dt>Relaxation level {step.level}</dt>
              <dd>
                {Object.entries(step.changes)
                  .map(([k, v]) => `${k} ${Array.isArray(v) ? v.map((r) => (Array.isArray(r) ? r.join('–') : r)).join(', ') : v}`)
                  .join(' · ')}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
