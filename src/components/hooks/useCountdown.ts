import { useEffect, useState } from 'react';

function secondsUntil(target: number | null | undefined): number {
  return typeof target === 'number' ? Math.max(0, Math.ceil((target - Date.now()) / 1000)) : 0;
}

/** Whole seconds until `targetMs` (a `Date.now()` value); 0 when past or null. */
export function useCountdown(targetMs: number | null | undefined): number {
  const [left, setLeft] = useState(() => secondsUntil(targetMs));
  useEffect(() => {
    setLeft(secondsUntil(targetMs));
    if (typeof targetMs !== 'number') return;
    const id = setInterval(() => {
      const v = secondsUntil(targetMs);
      setLeft(v);
      if (v <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [targetMs]);
  return left;
}
