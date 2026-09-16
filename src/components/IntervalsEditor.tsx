import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Interval } from '../types';
import { DESIGN_LIMITS, validateInterval, type ValidationIssue } from '../validate';
import { Primer3Links } from './Primer3Help';
import { fmtInt } from './util';

interface Draft {
  s: string;
  l: string;
}

interface Drafts {
  target: Draft;
  included: Draft;
  excluded: Array<Draft & { key: number }>;
}

export interface IntervalsValue {
  target?: Interval;
  included?: Interval;
  excluded?: Interval[];
}

function toDraft(iv: Interval | null | undefined): Draft {
  return iv ? { s: String(iv[0]), l: String(iv[1]) } : { s: '', l: '' };
}

/** `undefined` for an empty row, `null` for an incomplete one. */
function parseDraft(d: Draft): Interval | undefined | null {
  const s = d.s.trim();
  const l = d.l.trim();
  if (!s && !l) return undefined;
  if (!/^\d+$/.test(s) || !/^\d+$/.test(l)) return null;
  return [Number(s), Number(l)];
}

function committedValue(d: Drafts): Required<Pick<IntervalsValue, 'excluded'>> & IntervalsValue {
  return {
    target: parseDraft(d.target) ?? undefined,
    included: parseDraft(d.included) ?? undefined,
    excluded: d.excluded.map(parseDraft).filter((x): x is Interval => !!x),
  };
}

function valueKey(v: IntervalsValue): string {
  return JSON.stringify({ target: v.target ?? null, included: v.included ?? null, excluded: v.excluded ?? [] });
}

export interface IntervalsEditorProps {
  idPrefix: string;
  target: Interval | undefined;
  included: Interval | undefined;
  excluded: Interval[] | undefined;
  onChange: (value: IntervalsValue) => void;
  templateLength: number | null;
  onIssues: (issues: ValidationIssue[]) => void;
  disabled?: boolean;
}

/** Target, included and excluded intervals as start/length rows (spec §C.3). */
export function IntervalsEditor(p: IntervalsEditorProps): JSX.Element {
  const keyRef = useRef(0);
  const fromProps = (): Drafts => ({
    target: toDraft(p.target),
    included: toDraft(p.included),
    excluded: (p.excluded ?? []).map((iv) => ({ ...toDraft(iv), key: ++keyRef.current })),
  });
  const [drafts, setDrafts] = useState<Drafts>(fromProps);
  const propsKey = valueKey({ target: p.target, included: p.included, excluded: p.excluded });
  useEffect(() => {
    setDrafts((d) => (valueKey(committedValue(d)) === propsKey ? d : fromProps()));
    // fromProps reads the current props
  }, [propsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (next: Drafts) => {
    setDrafts(next);
    const value = committedValue(next);
    if (valueKey(value) !== propsKey) p.onChange(value);
  };

  const issues: ValidationIssue[] = [];
  const collect = (field: string, label: string, d: Draft) => {
    const v = parseDraft(d);
    if (v === null) issues.push({ field, code: 'INCOMPLETE', message: `${label}: enter a whole-number start and length.` });
    else if (v) for (const i of validateInterval(field, v, p.templateLength)) issues.push({ ...i, message: `${label}: ${i.message}` });
  };
  collect('target', 'Target', drafts.target);
  collect('included', 'Included region', drafts.included);
  drafts.excluded.forEach((d, i) => collect(`excluded[${i}]`, `Excluded ${i + 1}`, d));

  const onIssues = useRef(p.onIssues);
  onIssues.current = p.onIssues;
  const issuesKey = JSON.stringify(issues);
  useEffect(() => {
    onIssues.current(JSON.parse(issuesKey) as ValidationIssue[]);
  }, [issuesKey]);
  useEffect(() => () => onIssues.current([]), []);

  const row = (field: string, label: string, idBase: string, d: Draft, set: (d: Draft) => void, extra?: ReactNode) => {
    const rowIssues = issues.filter((i) => i.field === field);
    const errId = `${idBase}-err`;
    const v = parseDraft(d);
    return (
      <div className="gpr-interval-row" role="group" aria-labelledby={`${idBase}-label`} key={idBase} data-state={rowIssues.length ? 'invalid' : undefined}>
        <span className="gpr-interval-label" id={`${idBase}-label`}>
          {label}
        </span>
        <label className="gpr-visually-hidden" htmlFor={`${idBase}-start`}>
          {label} start
        </label>
        <input
          id={`${idBase}-start`}
          className="gpr-input gpr-input-short"
          type="text"
          inputMode="numeric"
          placeholder="start"
          autoComplete="off"
          value={d.s}
          aria-invalid={rowIssues.length ? true : undefined}
          aria-describedby={rowIssues.length ? errId : undefined}
          onChange={(e) => set({ ...d, s: e.target.value })}
        />
        <label className="gpr-visually-hidden" htmlFor={`${idBase}-len`}>
          {label} length
        </label>
        <input
          id={`${idBase}-len`}
          className="gpr-input gpr-input-short"
          type="text"
          inputMode="numeric"
          placeholder="length"
          autoComplete="off"
          value={d.l}
          aria-invalid={rowIssues.length ? true : undefined}
          aria-describedby={rowIssues.length ? errId : undefined}
          onChange={(e) => set({ ...d, l: e.target.value })}
        />
        <span className="gpr-sub gpr-interval-end">{v ? `to ${fmtInt(v[0] + v[1] - 1)}` : ''}</span>
        {extra}
        {rowIssues.length ? (
          <span id={errId} className="gpr-field-error gpr-interval-error">
            {rowIssues.map((i) => i.message).join(' ')}
          </span>
        ) : null}
      </div>
    );
  };

  const clearButton = (label: string, d: Draft, set: (d: Draft) => void) => (
    <button type="button" className="gpr-btn gpr-btn-small gpr-btn-quiet" aria-label={`Clear ${label.toLowerCase()}`} disabled={!d.s && !d.l} onClick={() => set({ s: '', l: '' })}>
      Clear
    </button>
  );

  return (
    <fieldset className="gpr-fieldset gpr-intervals" disabled={p.disabled}>
      <legend className="gpr-legend">Target and excluded regions</legend>
      <p className="gpr-hint">
        1-based template positions as start and length{p.templateLength ? ` (template ${fmtInt(p.templateLength)} bp)` : ''}. The product must cover the target; primers stay inside the included region and outside excluded regions.{' '}
        <Primer3Links topic="intervals" />
      </p>
      {row('target', 'Target', `${p.idPrefix}-iv-target`, drafts.target, (d) => apply({ ...drafts, target: d }), clearButton('Target', drafts.target, (d) => apply({ ...drafts, target: d })))}
      {row('included', 'Included region', `${p.idPrefix}-iv-included`, drafts.included, (d) => apply({ ...drafts, included: d }), clearButton('Included region', drafts.included, (d) => apply({ ...drafts, included: d })))}
      {drafts.excluded.map((d, i) =>
        row(
          `excluded[${i}]`,
          `Excluded ${i + 1}`,
          `${p.idPrefix}-iv-ex-${d.key}`,
          d,
          (nd) => apply({ ...drafts, excluded: drafts.excluded.map((x) => (x.key === d.key ? { ...nd, key: d.key } : x)) }),
          <button
            type="button"
            className="gpr-btn gpr-btn-small gpr-btn-quiet"
            aria-label={`Remove excluded interval ${i + 1}`}
            onClick={() => apply({ ...drafts, excluded: drafts.excluded.filter((x) => x.key !== d.key) })}
          >
            Remove
          </button>,
        ),
      )}
      <div className="gpr-button-row">
        <button
          type="button"
          className="gpr-btn gpr-btn-small"
          disabled={drafts.excluded.length >= DESIGN_LIMITS.maxExcluded}
          onClick={() => apply({ ...drafts, excluded: [...drafts.excluded, { s: '', l: '', key: ++keyRef.current }] })}
        >
          Add excluded interval
        </button>
      </div>
    </fieldset>
  );
}
