import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type Politeness = 'polite' | 'assertive';
export type Announce = (message: string, politeness?: Politeness) => void;

const AnnouncerContext = createContext<Announce>(() => {});

/** Announces through the nearest PrimerDesigner's live regions (no-op standalone). */
export function useAnnounce(): Announce {
  return useContext(AnnouncerContext);
}

/** Polite and assertive live regions plus the `announce` function (spec §C.3 accessibility). */
export function useLiveRegions() {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const flip = useRef(false);
  const announce = useCallback<Announce>((message, politeness = 'polite') => {
    // Alternate a trailing no-break space so repeating a message is still announced.
    flip.current = !flip.current;
    const text = flip.current ? message : `${message} `;
    if (politeness === 'assertive') setAssertive(text);
    else setPolite(text);
  }, []);
  const regions = useMemo(
    () => (
      <>
        <div className="gpr-visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-gpr-live="polite">
          {polite}
        </div>
        <div className="gpr-visually-hidden" aria-live="assertive" aria-atomic="true" data-gpr-live="assertive">
          {assertive}
        </div>
      </>
    ),
    [polite, assertive],
  );
  return { announce, regions, Provider: AnnouncerContext.Provider };
}
