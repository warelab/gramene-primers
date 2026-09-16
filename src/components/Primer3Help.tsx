import { Fragment, type ReactNode } from 'react';
import { PRIMER3_CITATION, PRIMER3_DOCS, PRIMER3_MANUAL_URL, primer3ManualUrl, type Primer3DocTopic } from '../primer3Docs';

const NEW_TAB = <span className="gpr-visually-hidden"> (opens in a new tab)</span>;

/** A link into the Primer3 manual. It opens in a new tab, so the design and a running check stay put. */
export function Primer3ManualLink({ anchor, className, children }: { anchor?: string; className?: string; children: ReactNode }): JSX.Element {
  return (
    <a className={className ? `gpr-link ${className}` : 'gpr-link'} href={anchor ? primer3ManualUrl(anchor) : PRIMER3_MANUAL_URL} target="_blank" rel="noopener noreferrer">
      {children}
      {NEW_TAB}
    </a>
  );
}

/** "Primer3 manual:" followed by a topic's tags and sections. */
export function Primer3Links({ topic }: { topic: Primer3DocTopic }): JSX.Element {
  return (
    <span className="gpr-p3-links">
      Primer3 manual:{' '}
      {PRIMER3_DOCS[topic].links.map((l, i) => (
        <Fragment key={l.anchor}>
          {i ? ', ' : null}
          <Primer3ManualLink anchor={l.anchor} className={l.label ? undefined : 'gpr-p3-tag'}>
            {l.label ?? l.anchor}
          </Primer3ManualLink>
        </Fragment>
      ))}
    </span>
  );
}

/** A topic's explanation followed by its manual links. */
export function Primer3DocText({ topic }: { topic: Primer3DocTopic }): JSX.Element {
  return (
    <>
      {PRIMER3_DOCS[topic].text} <Primer3Links topic={topic} />
    </>
  );
}

export interface HelpButtonProps {
  /** Completes the accessible name "About …". */
  subject: string;
  expanded: boolean;
  /** Id of the help text, referenced while it is shown. */
  controls: string;
  onToggle: () => void;
}

/** The "?" button that shows or hides a help text. */
export function HelpButton({ subject, expanded, controls, onToggle }: HelpButtonProps): JSX.Element {
  return (
    <button type="button" className="gpr-help-button" aria-label={`About ${subject}`} aria-expanded={expanded} aria-controls={expanded ? controls : undefined} onClick={onToggle}>
      ?
    </button>
  );
}

/** Credit under the results: the Primer3 version, its citation and the manual. */
export function Primer3Credit({ version }: { version?: string | null }): JSX.Element {
  return (
    <p className="gpr-hint gpr-p3-credit">
      Designed with Primer3{version ? ` ${version}` : ''} (
      <a className="gpr-link" href={PRIMER3_CITATION.url} target="_blank" rel="noopener noreferrer" title={PRIMER3_CITATION.text}>
        {PRIMER3_CITATION.short}
        {NEW_TAB}
      </a>
      ). <Primer3ManualLink>Primer3 manual</Primer3ManualLink>
    </p>
  );
}
