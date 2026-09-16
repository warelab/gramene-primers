import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './util';

export interface IssueLike {
  message: string;
}

export interface NumberFieldProps {
  id: string;
  label: ReactNode;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number | 'any';
  issues?: ReadonlyArray<IssueLike>;
  hint?: ReactNode;
  disabled?: boolean;
  /** Marks a value that differs from the preset (`data-state="changed"`). */
  changed?: boolean;
  /** Shown after the label, e.g. a help button. */
  labelAddon?: ReactNode;
  /** Ids of more descriptions outside the field, e.g. an open help text. */
  describedBy?: string;
  className?: string;
}

function parseDraft(draft: string): number | undefined | null {
  const t = draft.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Number input with a local draft, so partial input ("57.", "-") is not
 * clobbered by the parsed value; empty input means "not set".
 */
export function NumberField(p: NumberFieldProps): JSX.Element {
  const [draft, setDraft] = useState(p.value === undefined ? '' : String(p.value));
  useEffect(() => {
    setDraft((d) => {
      const parsed = parseDraft(d);
      if (parsed === p.value || (parsed === null && p.value === undefined)) return d;
      return p.value === undefined ? '' : String(p.value);
    });
  }, [p.value]);
  const issues = p.issues ?? [];
  const errId = `${p.id}-err`;
  const hintId = `${p.id}-hint`;
  const describedBy = [p.hint ? hintId : null, p.describedBy ?? null, issues.length ? errId : null].filter(Boolean).join(' ') || undefined;
  const label = (
    <label className="gpr-label" htmlFor={p.id}>
      {p.label}
    </label>
  );
  return (
    <div className={cx('gpr-field', p.className)} data-state={issues.length ? 'invalid' : p.changed ? 'changed' : undefined}>
      {p.labelAddon ? (
        <span className="gpr-label-row">
          {label}
          {p.labelAddon}
        </span>
      ) : (
        label
      )}
      <input
        id={p.id}
        className="gpr-input gpr-input-number"
        type="number"
        inputMode="decimal"
        value={draft}
        placeholder={p.placeholder}
        min={p.min}
        max={p.max}
        step={p.step ?? 'any'}
        disabled={p.disabled}
        aria-invalid={issues.length ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => {
          const v = e.target.value;
          setDraft(v);
          const parsed = parseDraft(v);
          if (parsed !== null) p.onChange(parsed);
        }}
      />
      {p.hint ? (
        <span id={hintId} className="gpr-hint">
          {p.hint}
        </span>
      ) : null}
      {issues.length ? (
        <span id={errId} className="gpr-field-error">
          {issues.map((i) => i.message).join(' ')}
        </span>
      ) : null}
    </div>
  );
}

export interface TextFieldProps {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  issues?: ReadonlyArray<IssueLike>;
  disabled?: boolean;
  /** Narrow input, for short values such as an allele or a region name. */
  short?: boolean;
  type?: 'text' | 'search';
  className?: string;
}

/** Single-line text input with the same label, hint and error wiring as `NumberField`. */
export function TextField(p: TextFieldProps): JSX.Element {
  const issues = p.issues ?? [];
  const errId = `${p.id}-err`;
  const hintId = `${p.id}-hint`;
  const describedBy = [p.hint ? hintId : null, issues.length ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('gpr-field', p.className)} data-state={issues.length ? 'invalid' : undefined}>
      <label className="gpr-label" htmlFor={p.id}>
        {p.label}
      </label>
      <input
        id={p.id}
        className={cx('gpr-input', p.short && 'gpr-input-short')}
        type={p.type ?? 'text'}
        value={p.value}
        placeholder={p.placeholder}
        disabled={p.disabled}
        aria-invalid={issues.length ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => p.onChange(e.target.value)}
      />
      {p.hint ? (
        <span id={hintId} className="gpr-hint">
          {p.hint}
        </span>
      ) : null}
      {issues.length ? (
        <span id={errId} className="gpr-field-error">
          {issues.map((i) => i.message).join(' ')}
        </span>
      ) : null}
    </div>
  );
}

export interface CheckboxFieldProps {
  id: string;
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: ReactNode;
  className?: string;
}

export function CheckboxField(p: CheckboxFieldProps): JSX.Element {
  const hintId = `${p.id}-hint`;
  return (
    <div className={cx('gpr-check-row', p.className)}>
      <input
        id={p.id}
        className="gpr-checkbox"
        type="checkbox"
        checked={p.checked}
        disabled={p.disabled}
        aria-describedby={p.hint ? hintId : undefined}
        onChange={(e) => p.onChange(e.target.checked)}
      />
      <label className="gpr-label gpr-label-inline" htmlFor={p.id}>
        {p.label}
      </label>
      {p.hint ? (
        <span id={hintId} className="gpr-hint gpr-check-hint">
          {p.hint}
        </span>
      ) : null}
    </div>
  );
}

export interface PresetOption<T extends string> {
  id: T;
  label: ReactNode;
  description?: ReactNode;
}

export interface PresetRadiosProps<T extends string> {
  idPrefix: string;
  legend: string;
  options: ReadonlyArray<PresetOption<T>>;
  value: T;
  onChange: (id: T) => void;
}

/** A radio group of presets; the set of presets differs by mode (design vs genotyping assay). */
export function PresetRadios<T extends string>(p: PresetRadiosProps<T>): JSX.Element {
  return (
    <fieldset className="gpr-subfieldset gpr-presets">
      <legend className="gpr-legend gpr-legend-small">{p.legend}</legend>
      {p.options.map((o) => {
        const id = `${p.idPrefix}-preset-${o.id}`;
        const descId = `${id}-desc`;
        return (
          <div className="gpr-radio-row" key={o.id}>
            <input
              type="radio"
              className="gpr-radio"
              id={id}
              name={`${p.idPrefix}-preset`}
              checked={p.value === o.id}
              aria-describedby={o.description ? descId : undefined}
              onChange={() => p.onChange(o.id)}
            />
            <label className="gpr-label gpr-label-inline" htmlFor={id}>
              {o.label}
            </label>
            {o.description ? (
              <span id={descId} className="gpr-hint gpr-preset-desc">
                {o.description}
              </span>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Renders the tab `aria-disabled` and skips it in keyboard navigation. */
  disabledReason?: string | null;
  describedBy?: string;
}

export interface TabListProps<T extends string> {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  idPrefix: string;
  panelId: string;
  className?: string;
}

export function tabDomId(idPrefix: string, id: string): string {
  return `${idPrefix}-tab-${id}`;
}

/** WAI-ARIA tabs with automatic activation and roving tabindex. */
export function TabList<T extends string>(p: TabListProps<T>): JSX.Element {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const enabled = p.items.filter((i) => !i.disabledReason);
  const anySelected = p.items.some((i) => i.id === p.value);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled.length) return;
    const idx = enabled.findIndex((i) => i.id === p.value);
    let next: TabItem<T> | undefined;
    switch (e.key) {
      case 'ArrowRight':
        next = enabled[(idx + 1) % enabled.length];
        break;
      case 'ArrowLeft':
        next = enabled[(idx <= 0 ? enabled.length : idx) - 1];
        break;
      case 'Home':
        next = enabled[0];
        break;
      case 'End':
        next = enabled[enabled.length - 1];
        break;
      default:
        return;
    }
    if (!next) return;
    e.preventDefault();
    p.onChange(next.id);
    refs.current.get(next.id)?.focus();
  };
  return (
    <div role="tablist" aria-label={p.label} className={cx('gpr-tabs', p.className)} onKeyDown={onKeyDown}>
      {p.items.map((item, index) => {
        const selected = item.id === p.value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              if (el) refs.current.set(item.id, el);
              else refs.current.delete(item.id);
            }}
            type="button"
            role="tab"
            id={tabDomId(p.idPrefix, item.id)}
            className="gpr-tab"
            aria-selected={selected}
            aria-controls={p.panelId}
            aria-disabled={item.disabledReason ? true : undefined}
            aria-describedby={item.describedBy}
            tabIndex={selected || (!anySelected && index === 0) ? 0 : -1}
            onClick={() => {
              if (!item.disabledReason) p.onChange(item.id);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
