import { useEffect, useRef, useState, type ReactNode } from 'react';
import { copyText } from '../clipboard';
import { useAnnounce } from './hooks/announcer';
import { cx } from './util';

export interface CopyButtonProps {
  text: string | (() => string);
  /** Accessible name, e.g. "Copy left primer of pair 1". */
  label: string;
  children?: ReactNode;
  className?: string;
}

/** Copies with `navigator.clipboard` (textarea fallback) and announces the result. */
export function CopyButton({ text, label, children, className }: CopyButtonProps): JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const announce = useAnnounce();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = async () => {
    const value = typeof text === 'function' ? text() : text;
    const ok = await copyText(value);
    setState(ok ? 'copied' : 'failed');
    announce(ok ? 'Copied to the clipboard' : 'Copy failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1500);
  };
  return (
    <button
      type="button"
      className={cx('gpr-btn', 'gpr-btn-small', 'gpr-copy', className)}
      aria-label={label}
      title={label}
      data-state={state === 'idle' ? undefined : state}
      onClick={onClick}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Failed' : children ?? 'Copy'}
    </button>
  );
}
