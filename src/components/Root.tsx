import { createContext, useContext, useInsertionEffect, type CSSProperties, type ReactNode } from 'react';
import { ensureStylesInjected } from '../styles/inject';
import { cx } from './util';

export type Theme = 'light' | 'dark' | 'auto';

/** Shared props of every top-level component. */
export interface StyleProps {
  /** Default `auto` (follows `prefers-color-scheme`). */
  theme?: Theme;
  /** Default true; pass false and import `gramene-primers/style.css` on CSP-strict pages. */
  injectStyles?: boolean;
  className?: string;
  style?: CSSProperties;
}

const InsideRoot = createContext(false);

/** Injects the stylesheet once per document (spec §C.5). */
export function useStyleInjection(enabled: boolean): void {
  useInsertionEffect(() => {
    if (enabled) ensureStylesInjected();
  }, [enabled]);
}

export function themeClass(theme: Theme | undefined): string {
  return `gpr-theme-${theme === 'light' || theme === 'dark' ? theme : 'auto'}`;
}

/**
 * Wraps standalone components in `.gpr-root` (all styles are scoped under
 * it). Inside a PrimerDesigner, renders children only.
 */
export function GprRoot(props: StyleProps & { children: ReactNode }): JSX.Element {
  const inside = useContext(InsideRoot);
  // Inside a PrimerDesigner (or another root) the outer component injects, honouring its own injectStyles.
  useStyleInjection(!inside && props.injectStyles !== false);
  if (inside) return <>{props.children}</>;
  return (
    <InsideRoot.Provider value={true}>
      <div className={cx('gpr-root', themeClass(props.theme), props.className)} style={props.style}>
        {props.children}
      </div>
    </InsideRoot.Provider>
  );
}

/** Marks a subtree as already inside `.gpr-root` (used by PrimerDesigner). */
export function RootMarker({ children }: { children: ReactNode }): JSX.Element {
  return <InsideRoot.Provider value={true}>{children}</InsideRoot.Provider>;
}
