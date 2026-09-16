import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PrimerDesigner } from '../../src/components/PrimerDesigner';
import { designerReducer } from '../../src/components/reducer';
import { maxFormWidth } from '../../src/components/Splitter';
import { initialDesignerState, LAYOUT_LIMITS, normalizeDesignerState } from '../../src/state';
import type { PrimerDesignerState } from '../../src/types';
import { gene200, genomesResponse } from '../fixtures/samples';
import { FakePrimersClient } from './fakeClient';
import { API } from './fixtures';

// The stylesheet hides the splitter outside the two-column layout, which jsdom never reaches.
const separator = () => screen.getByRole('separator', { name: 'Resize the form and results columns', hidden: true });
const layoutOf = (el: HTMLElement) => el.parentElement as HTMLElement;
const widthVar = (el: HTMLElement) => layoutOf(el).style.getPropertyValue('--gpr-form-width');

function renderDesigner(state?: PrimerDesignerState) {
  const fake = new FakePrimersClient();
  fake.genomes = genomesResponse();
  const states: PrimerDesignerState[] = [];
  const view = render(<PrimerDesigner apiBase={API} client={fake} gene={gene200} state={state} onStateChange={(s) => states.push(s)} />);
  const last = () => states[states.length - 1];
  return { ...view, states, last };
}

describe('form/results splitter', () => {
  it('keeps view.formWidth compact, rounded and within the limits', () => {
    let s = initialDesignerState({ gene: gene200 });
    s = designerReducer(s, { type: 'setFormWidth', width: 480 });
    expect(s.view).toEqual({ resultsTab: 'pairs', formWidth: 480 });
    expect(designerReducer(s, { type: 'setFormWidth', width: 480 })).toBe(s);
    s = designerReducer(s, { type: 'setFormWidth', width: undefined });
    expect(s.view).toEqual({ resultsTab: 'pairs' });

    const restored = (formWidth: unknown) => normalizeDesignerState({ v: 1, mode: 'gene', view: { resultsTab: 'pairs', formWidth } }, { gene: gene200 }).view;
    expect(restored(512.6)).toEqual({ resultsTab: 'pairs', formWidth: 513 });
    expect(restored(10)?.formWidth).toBe(LAYOUT_LIMITS.formMin);
    expect(restored(1e6)?.formWidth).toBe(LAYOUT_LIMITS.formMax);
    expect(restored('wide')).toEqual({ resultsTab: 'pairs' });

    expect(maxFormWidth(1200)).toBe(1200 - LAYOUT_LIMITS.splitter - LAYOUT_LIMITS.resultsMin);
    expect(maxFormWidth(500)).toBe(LAYOUT_LIMITS.formMin);
    expect(maxFormWidth(0)).toBe(LAYOUT_LIMITS.formMax);
  });

  it('resizes with the keyboard, resets on double-click, and restores a saved width', () => {
    const { last, unmount } = renderDesigner();
    const sep = separator();
    expect(sep).toHaveAttribute('aria-orientation', 'vertical');
    expect(sep).toHaveAttribute('aria-valuenow', String(LAYOUT_LIMITS.formDefault));
    expect(sep).toHaveAttribute('tabindex', '0');
    expect(document.getElementById(sep.getAttribute('aria-controls')!)).toHaveClass('gpr-inputs');
    expect(layoutOf(sep)).not.toHaveAttribute('data-resized');

    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(last()?.view?.formWidth).toBe(LAYOUT_LIMITS.formDefault + 16);
    expect(widthVar(sep)).toBe(`${LAYOUT_LIMITS.formDefault + 16}px`);
    expect(layoutOf(sep)).toHaveAttribute('data-resized');
    expect(sep).toHaveAttribute('aria-valuenow', String(LAYOUT_LIMITS.formDefault + 16));

    fireEvent.keyDown(sep, { key: 'ArrowLeft', shiftKey: true });
    expect(last()?.view?.formWidth).toBe(LAYOUT_LIMITS.formDefault + 16 - 64);
    fireEvent.keyDown(sep, { key: 'Home' });
    expect(last()?.view?.formWidth).toBe(LAYOUT_LIMITS.formMin);

    fireEvent.doubleClick(sep);
    expect(last()?.view).not.toHaveProperty('formWidth');
    expect(widthVar(sep)).toBe('');
    expect(layoutOf(sep)).not.toHaveAttribute('data-resized');
    unmount();

    renderDesigner({ ...initialDesignerState({ gene: gene200 }), view: { resultsTab: 'pairs', formWidth: 520 } });
    expect(widthVar(separator())).toBe('520px');
    expect(separator()).toHaveAttribute('aria-valuenow', '520');
  });

  it('previews a pointer drag on the layout and reports the width once, on release; a cancelled drag is undone', () => {
    const { states, last } = renderDesigner();
    const sep = separator();
    const before = states.length;
    fireEvent.pointerDown(sep, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 160 });
    expect(widthVar(sep)).toBe(`${LAYOUT_LIMITS.formDefault + 60}px`);
    expect(layoutOf(sep)).toHaveAttribute('data-dragging');
    expect(states.slice(before).some((s) => s.view?.formWidth !== undefined)).toBe(false);
    fireEvent.pointerUp(sep, { pointerId: 1, clientX: 160 });
    expect(last()?.view?.formWidth).toBe(LAYOUT_LIMITS.formDefault + 60);
    expect(layoutOf(sep)).not.toHaveAttribute('data-dragging');

    fireEvent.pointerDown(sep, { button: 0, pointerId: 2, clientX: 100 });
    fireEvent.pointerMove(sep, { pointerId: 2, clientX: 0 });
    expect(widthVar(sep)).toBe(`${LAYOUT_LIMITS.formDefault + 60 - 100}px`);
    fireEvent.pointerCancel(sep, { pointerId: 2 });
    expect(widthVar(sep)).toBe(`${LAYOUT_LIMITS.formDefault + 60}px`);
    expect(last()?.view?.formWidth).toBe(LAYOUT_LIMITS.formDefault + 60);
  });
});
