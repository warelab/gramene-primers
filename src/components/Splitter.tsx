import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clampFormWidth, LAYOUT_LIMITS } from '../state';
import { useIsoLayoutEffect } from './hooks/useIsoLayoutEffect';

const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;

/** The widest form column that leaves the results column its minimum; `formMax` while the layout has no size. */
export function maxFormWidth(layoutWidth: number): number {
  if (!(layoutWidth > 0)) return LAYOUT_LIMITS.formMax;
  return clampFormWidth(Math.floor(layoutWidth - LAYOUT_LIMITS.splitter - LAYOUT_LIMITS.resultsMin));
}

export interface SplitterProps {
  /** Id of the form column, which the splitter resizes. */
  controls: string;
  /** The saved form-column width (`view.formWidth`); `undefined` is the default layout. */
  width: number | undefined;
  /** A new width, or `undefined` to reset. A pointer drag reports once, when it ends. */
  onChange: (width: number | undefined) => void;
}

interface Drag {
  pointerId: number;
  startX: number;
  startWidth: number;
  last: number;
}

/**
 * The bar between the form and results columns of its parent `.gpr-layout`. It sets the
 * layout's `--gpr-form-width` (the stylesheet shows the bar only in the two-column layout),
 * previews a pointer drag on the layout, and resizes with the arrow keys, Home and End.
 * Double-click resets the default layout.
 */
export function Splitter({ controls, width, onChange }: SplitterProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);

  const layout = (): HTMLElement | null => ref.current?.parentElement ?? null;
  const show = (w: number | undefined) => {
    const el = layout();
    if (!el) return;
    if (w === undefined) {
      el.style.removeProperty('--gpr-form-width');
      el.removeAttribute('data-resized');
    } else {
      el.style.setProperty('--gpr-form-width', `${w}px`);
      el.setAttribute('data-resized', '');
    }
  };
  useIsoLayoutEffect(() => {
    if (!drag.current) show(width);
  }, [width]);

  const max = () => maxFormWidth(layout()?.getBoundingClientRect().width ?? 0);
  const clamp = (w: number) => Math.min(max(), clampFormWidth(w));
  const current = () => {
    if (width !== undefined) return Math.min(max(), width);
    const rendered = layout()?.firstElementChild?.getBoundingClientRect().width ?? 0;
    return rendered > 0 ? Math.round(rendered) : LAYOUT_LIMITS.formDefault;
  };

  const finish = (commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    layout()?.removeAttribute('data-dragging');
    if (commit && d.last !== d.startWidth) onChange(d.last);
    else show(width);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current) return;
    e.preventDefault();
    const start = current();
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: start, last: start };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not an active pointer (e.g. a synthetic event): moves over the bar still resize.
    }
    setDragging(true);
    layout()?.setAttribute('data-dragging', '');
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const next = clamp(d.startWidth + e.clientX - d.startX);
    if (next !== d.last) {
      d.last = next;
      show(next);
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === e.pointerId) finish(true);
  };
  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === e.pointerId) finish(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && drag.current) {
      e.preventDefault();
      finish(false);
      return;
    }
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    let next: number;
    if (e.key === 'ArrowLeft') next = clamp(current() - step);
    else if (e.key === 'ArrowRight') next = clamp(current() + step);
    else if (e.key === 'Home') next = LAYOUT_LIMITS.formMin;
    else if (e.key === 'End') next = max();
    else return;
    e.preventDefault();
    if (next !== width) onChange(next);
  };

  const maxNow = max();
  const valueNow = Math.min(maxNow, width ?? LAYOUT_LIMITS.formDefault);
  return (
    <div
      ref={ref}
      className="gpr-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the form and results columns"
      aria-controls={controls}
      aria-valuemin={LAYOUT_LIMITS.formMin}
      aria-valuemax={maxNow}
      aria-valuenow={valueNow}
      aria-valuetext={`Form column ${valueNow} pixels wide`}
      tabIndex={0}
      title="Drag to resize the columns; double-click to reset"
      data-state={dragging ? 'dragging' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(undefined)}
    />
  );
}
