import { summarizeExplain } from '../explain';
import type { DesignExplain } from '../types';
import { Primer3DocText } from './Primer3Help';
import { fmtInt } from './util';

const SIDE_LABEL = { left: 'Left primers', right: 'Right primers', pair: 'Primer pairs' } as const;

export interface ExplainPanelProps {
  explain: DesignExplain | null | undefined;
  open: boolean;
  onToggle: (open: boolean) => void;
  /** Design returned no pairs (`NO_PAIRS`); the panel opens automatically. */
  noPairs: boolean;
  idPrefix: string;
}

/** Primer3 explain counts with plain-language hints (spec §C.3 ExplainPanel). */
export function ExplainPanel({ explain, open, onToggle, noPairs, idPrefix }: ExplainPanelProps): JSX.Element | null {
  const summary = summarizeExplain(explain, 50);
  if (!summary.length && !noPairs) return null;
  const headingId = `${idPrefix}-explain-h`;
  const bodyId = `${idPrefix}-explain-body`;
  return (
    <section className="gpr-explain" data-state={open ? 'open' : 'closed'} aria-labelledby={headingId}>
      <h3 className="gpr-h3" id={headingId}>
        <button type="button" className="gpr-disclosure" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(!open)}>
          {noPairs ? 'Why no primer pairs?' : 'Primer3 explain'}
        </button>
      </h3>
      <div id={bodyId} className="gpr-explain-body" hidden={!open}>
        {noPairs ? (
          <p className="gpr-explain-lead">
            Primer3 found no acceptable primer pair. The filters that rejected the most candidates are listed first, with suggestions.
          </p>
        ) : null}
        {summary.length === 0 ? <p className="gpr-hint">No explain counts were returned.</p> : null}
        <div className="gpr-explain-grid">
          {summary.map((item) => (
            <div key={item.side} className="gpr-explain-side" data-state={item.ok === 0 ? 'blocked' : undefined}>
              <h4 className="gpr-h4">{SIDE_LABEL[item.side]}</h4>
              <p className="gpr-explain-counts">
                {fmtInt(item.considered)} considered · {fmtInt(item.ok)} ok
              </p>
              {item.reasons.length ? (
                <ul className="gpr-explain-reasons">
                  {item.reasons.map((r) => (
                    <li key={r.label} className="gpr-explain-reason">
                      <span className="gpr-explain-label">{r.label}</span> <span className="gpr-explain-count">{fmtInt(r.count)}</span>
                      {r.hint ? <span className="gpr-explain-hint"> — {r.hint}</span> : null}
                      {r.suggestion ? <span className="gpr-explain-suggestion"> Try: {r.suggestion}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="gpr-hint">No candidates were rejected.</p>
              )}
            </div>
          ))}
        </div>
        <p className="gpr-hint gpr-explain-docs">
          <Primer3DocText topic="explain" />
        </p>
      </div>
    </section>
  );
}
