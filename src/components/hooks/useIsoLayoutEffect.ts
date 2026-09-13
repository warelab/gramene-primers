import { useEffect, useLayoutEffect } from 'react';

/** `useLayoutEffect` in browsers, `useEffect` elsewhere (no SSR warning). */
export const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
