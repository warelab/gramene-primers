import type { GenotypingState } from '../types';
import { GENOTYPING_LIMITS, type ValidationIssue } from '../validate';
import { NumberField, TextField } from './fields';

export type ManualVariant = NonNullable<GenotypingState['manual']>;

export interface ManualVariantInputsProps {
  idPrefix: string;
  value: Partial<ManualVariant> | undefined;
  /** `validateVariantInput` output; issues that name no known field are listed together. */
  issues: ReadonlyArray<ValidationIssue>;
  /** The base the genome actually has, from a `400 REF_MISMATCH`. */
  refMismatch?: { given: string; genome: string } | null;
  onChange: (value: Partial<ManualVariant>) => void;
  /** Verifies REF without designing (`template_only: true`). */
  onCheckReference?: () => void;
  checking?: boolean;
  disabled?: boolean;
}

/**
 * A variant entered by hand, in either accepted style: VCF (neither allele `-`)
 * or Ensembl (exactly one allele `-`). For an Ensembl-style insertion the
 * position is the base *after* the insertion point, which is why the two styles
 * are spelled out rather than left to be inferred.
 */
export function ManualVariantInputs(p: ManualVariantInputsProps): JSX.Element {
  const v = p.value ?? {};
  const id = (s: string) => `${p.idPrefix}-manual-${s}`;
  const known = new Set(['region', 'position', 'ref', 'alt']);
  const forField = (field: string) => p.issues.filter((i) => i.field === field);
  const others = p.issues.filter((i) => !known.has(i.field));
  const set = (patch: Partial<ManualVariant>) => p.onChange({ ...v, ...patch });

  return (
    <div className="gpr-manual-variant">
      <div className="gpr-field-grid">
        <TextField
          id={id('region')}
          label="Sequence"
          value={v.region ?? ''}
          placeholder="1"
          issues={forField('region')}
          disabled={p.disabled}
          short
          onChange={(region) => set({ region })}
        />
        <NumberField
          id={id('position')}
          label="Position"
          value={typeof v.position === 'number' ? v.position : undefined}
          min={1}
          step={1}
          issues={forField('position')}
          disabled={p.disabled}
          onChange={(position) => set({ position })}
        />
        <TextField
          id={id('ref')}
          label="Reference allele"
          value={v.ref ?? ''}
          placeholder="C"
          issues={forField('ref')}
          disabled={p.disabled}
          short
          onChange={(ref) => set({ ref })}
        />
        <TextField
          id={id('alt')}
          label="Alternative allele"
          value={v.alt ?? ''}
          placeholder="A"
          issues={forField('alt')}
          disabled={p.disabled}
          short
          onChange={(alt) => set({ alt })}
        />
      </div>

      {p.refMismatch ? (
        <p className="gpr-field-error" role="alert" data-code="REF_MISMATCH">
          The genome has <code className="gpr-code">{p.refMismatch.genome}</code> at this position, not <code className="gpr-code">{p.refMismatch.given}</code>.
        </p>
      ) : null}

      {others.length ? (
        <ul className="gpr-plain-list gpr-manual-issues">
          {others.map((i) => (
            <li key={`${i.field}-${i.code}`} className="gpr-field-error">
              {i.message}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="gpr-hint">
        Either style works. VCF: neither allele is <code className="gpr-code">-</code>, and both carry the base before an indel. Ensembl: exactly one allele is{' '}
        <code className="gpr-code">-</code>, and for an insertion the position is the base <em>after</em> the insertion point. Alleles are A, C, G or T, up to{' '}
        {GENOTYPING_LIMITS.maxAlleleLength} bases.
      </p>

      {p.onCheckReference ? (
        <div className="gpr-button-row">
          <button type="button" className="gpr-btn gpr-btn-small" disabled={p.disabled || p.checking} onClick={p.onCheckReference}>
            {p.checking ? 'Checking…' : 'Check reference'}
          </button>
          <span className="gpr-hint">Verifies the reference allele against the genome without designing primers.</span>
        </div>
      ) : null}
    </div>
  );
}
