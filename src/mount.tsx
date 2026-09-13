import { createRoot, type Root } from 'react-dom/client';
import { PrimerDesigner } from './components/PrimerDesigner';
import type { PrimerDesignerProps } from './types';

export interface MountHandle {
  /** Merges `props` into the current props and re-renders. */
  update(props: Partial<PrimerDesignerProps>): void;
  /** Unmounts the designer; in-flight design and polling requests are aborted. */
  unmount(): void;
}

/**
 * Renders a PrimerDesigner into `el` (an element or a selector) for hosts
 * without React (spec §C.2).
 */
export function mount(el: Element | string, props: PrimerDesignerProps): MountHandle {
  const target = typeof el === 'string' ? (typeof document !== 'undefined' ? document.querySelector(el) : null) : el;
  if (!target) throw new Error(`gramene-primers mount: no element matches ${typeof el === 'string' ? el : 'the given target'}`);
  let current: PrimerDesignerProps = { ...props };
  let root: Root | null = createRoot(target);
  root.render(<PrimerDesigner {...current} />);
  return {
    update(next) {
      if (!root) return;
      current = { ...current, ...next };
      root.render(<PrimerDesigner {...current} />);
    },
    unmount() {
      root?.unmount();
      root = null;
    },
  };
}
