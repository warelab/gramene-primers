import { useMemo, useState } from 'react';
import { digestAmplicon, nonCutters, type TemplateSpan } from '../amplicon';
import type { RestrictionEnzyme } from '../enzymes';
import type { PrimerTemplate } from '../types';
import { fmtInt, useIdPrefix } from './util';

export interface DigestPanelProps {
  template: Pick<PrimerTemplate, 'seq'> | null | undefined;
  span: TemplateSpan;
  enzymes?: ReadonlyArray<RestrictionEnzyme>;
  /** Highlights the chosen enzyme's sites and cuts in the sequence above. */
  selected?: string | null;
  onSelect?: (enzyme: string | null) => void;
  /** Shows every enzyme rather than only those cutting few enough times to read. */
  maxCuts?: number;
}

/** `GT^AC` — the recognition sequence with the cut marked where the enzyme makes it. */
export function siteWithCut(e: RestrictionEnzyme): string {
  return e.cut === null ? e.site : `${e.site.slice(0, e.cut)}^${e.site.slice(e.cut)}`;
}

/**
 * What a restriction digest of one predicted product would show: which enzymes
 * recognise a site inside it, where, and what fragments they give.
 *
 * Two questions, both everyday ones. Which enzyme confirms this band is the
 * product you meant — a single cutter splitting it into two identifiable sizes.
 * And which enzymes leave it alone, which is the check before adding a site to
 * a primer end for cloning.
 */
export function DigestPanel(p: DigestPanelProps): JSX.Element | null {
  const idp = useIdPrefix('gpr-digest');
  const [showAll, setShowAll] = useState(false);
  const seq = p.template?.seq;
  const spanKey = `${p.span.start}-${p.span.end}`;
  const maxCuts = p.maxCuts ?? 4;

  const digests = useMemo(() => digestAmplicon(seq, p.span, { enzymes: p.enzymes }), [seq, spanKey, p.enzymes]);
  const safe = useMemo(() => nonCutters(seq, p.span, p.enzymes), [seq, spanKey, p.enzymes]);

  if (!seq) return null;
  // Beyond a handful of cuts the ladder is not one anybody scores, so the rest
  // are kept behind a control rather than padding the table.
  const readable = digests.filter((d) => d.cuts.length <= maxCuts);
  const shown = showAll ? digests : readable;
  const size = p.span.end - p.span.start + 1;

  return (
    <div className="gpr-digest">
      <div className="gpr-table-wrap">
        <table className="gpr-table gpr-digest-table">
          <caption className="gpr-caption">
            Restriction sites in the {fmtInt(size)} bp product ·{' '}
            {digests.length
              ? `${fmtInt(digests.length)} enzyme${digests.length === 1 ? '' : 's'} cut it`
              : 'no enzyme in the panel cuts it'}
          </caption>
          <thead>
            <tr>
              <th scope="col">Enzyme</th>
              <th scope="col">Site</th>
              <th scope="col" className="gpr-num">
                Sites
              </th>
              <th scope="col">Positions (template)</th>
              <th scope="col">Fragments (bp)</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => {
              const on = p.selected === d.enzyme.name;
              return (
                <tr key={d.enzyme.name} data-state={on ? 'selected' : undefined}>
                  <th scope="row">
                    <button
                      type="button"
                      className="gpr-btn gpr-btn-small gpr-btn-quiet"
                      aria-pressed={on}
                      onClick={() => p.onSelect?.(on ? null : d.enzyme.name)}
                    >
                      {d.enzyme.name}
                    </button>
                  </th>
                  <td>
                    <code className="gpr-seq">{siteWithCut(d.enzyme)}</code>
                  </td>
                  <td className="gpr-num">{d.sites.length}</td>
                  <td className="gpr-digest-positions">
                    {d.sites.map((x) => `${fmtInt(x.start)}–${fmtInt(x.end)}`).join(', ')}
                  </td>
                  <td>{d.fragments.map((f) => fmtInt(f)).join(' / ')}</td>
                </tr>
              );
            })}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5} className="gpr-sub">
                  {digests.length
                    ? 'No enzyme cuts this product few enough times to read.'
                    : 'No enzyme in the panel has a site inside this product.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="gpr-hint" id={`${idp}-hint`}>
        Select an enzyme to mark its sites and cuts in the sequence above. Sizes are from sequence alone: methylation,
        star activity and partial digests are not modelled.
        {digests.length > readable.length ? (
          <>
            {' '}
            <button type="button" className="gpr-btn gpr-btn-small gpr-btn-quiet" onClick={() => setShowAll((v) => !v)}>
              {showAll
                ? `Hide the ${fmtInt(digests.length - readable.length)} that cut more than ${maxCuts} times`
                : `Show ${fmtInt(digests.length - readable.length)} more that cut more than ${maxCuts} times`}
            </button>
          </>
        ) : null}
      </p>
      {safe.length ? (
        <p className="gpr-hint">
          <strong>{fmtInt(safe.length)}</strong> of the panel have no site in this product, so they are safe to add to
          the primer ends: {safe.slice(0, 12).map((e) => e.name).join(', ')}
          {safe.length > 12 ? ` and ${fmtInt(safe.length - 12)} more` : ''}.
        </p>
      ) : null}
    </div>
  );
}
