import { useMemo, useState } from 'react';
import { capsForAmplicon, digestAmplicon, nonCutters, type ProductCaps, type TemplateSpan } from '../amplicon';
import type { RestrictionEnzyme } from '../enzymes';
import type { PrimerTemplate } from '../types';
import { fmtInt, useIdPrefix } from './util';

export interface DigestVariant {
  key: string;
  label: string;
  variant: { position: number; ref: string; alt: string };
}

export interface DigestPanelProps {
  template: Pick<PrimerTemplate, 'seq'> | null | undefined;
  span: TemplateSpan;
  /** Variants already placed on the template, for the CAPS table. */
  variants?: ReadonlyArray<DigestVariant>;
  enzymes?: ReadonlyArray<RestrictionEnzyme>;
  /** Highlights the chosen enzyme's cuts in the amplicon sequence above. */
  selected?: string | null;
  onSelect?: (enzyme: string | null) => void;
  /** Said instead of the CAPS table when no variant source is wired up. */
  variantsUnavailable?: string | null;
}

const site = (e: RestrictionEnzyme) =>
  e.cut === null ? e.site : `${e.site.slice(0, e.cut)}^${e.site.slice(e.cut)}`;

function Verdict({ caps }: { caps: ProductCaps }): JSX.Element {
  return caps.resolvable ? (
    <span className="gpr-chip gpr-chip-ok">
      <span className="gpr-chip-glyph" aria-hidden="true">
        ✓
      </span>
      <span className="gpr-chip-text">Readable</span>
    </span>
  ) : (
    <span className="gpr-chip gpr-chip-muted" title={caps.reason ?? undefined}>
      <span className="gpr-chip-glyph" aria-hidden="true">
        –
      </span>
      <span className="gpr-chip-text">Not on a gel</span>
    </span>
  );
}

/**
 * What a restriction digest of one predicted product would show.
 *
 * Two tables, because they answer different questions. The digest map says
 * which enzyme confirms this band is the product you meant, and which enzymes
 * leave it alone — the check before cloning. The CAPS table says whether a
 * variant inside the product can be genotyped from the same PCR, which turns an
 * ordinary pair into an assay.
 */
export function DigestPanel(p: DigestPanelProps): JSX.Element | null {
  const idp = useIdPrefix('gpr-digest');
  const [showAll, setShowAll] = useState(false);
  const seq = p.template?.seq;
  const spanKey = `${p.span.start}-${p.span.end}`;

  const digests = useMemo(() => digestAmplicon(seq, p.span, { enzymes: p.enzymes }), [seq, spanKey, p.enzymes]);
  const safe = useMemo(() => nonCutters(seq, p.span, p.enzymes), [seq, spanKey, p.enzymes]);
  /**
   * Only variants lying wholly inside the product are its business. The caller
   * passes every variant on the template, and most of them belong to other
   * pairs.
   */
  const inside = useMemo(
    () =>
      (p.variants ?? []).filter(
        (v) => v.variant.position >= p.span.start && v.variant.position + v.variant.ref.length - 1 <= p.span.end,
      ),
    [p.variants, spanKey],
  );
  const caps = useMemo(
    () => (inside.length ? capsForAmplicon(seq, p.span, inside, { enzymes: p.enzymes }) : []),
    [seq, spanKey, inside, p.enzymes],
  );

  if (!seq) return null;
  // Four cuts is the most a gel still reads; the rest are listed on request.
  const readable = digests.filter((d) => d.cuts.length <= 4);
  const shown = showAll ? digests : readable;
  const size = p.span.end - p.span.start + 1;

  return (
    <div className="gpr-digest">
      <div className="gpr-table-wrap">
        <table className="gpr-table gpr-digest-table">
          <caption className="gpr-caption">
            Restriction digest of the {fmtInt(size)} bp product ·{' '}
            {digests.length ? `${fmtInt(digests.length)} enzyme${digests.length === 1 ? '' : 's'} cut it` : 'no enzyme in the panel cuts it'}
          </caption>
          <thead>
            <tr>
              <th scope="col">Enzyme</th>
              <th scope="col">Site</th>
              <th scope="col" className="gpr-num">
                Cuts
              </th>
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
                    <code className="gpr-seq">{site(d.enzyme)}</code>
                  </td>
                  <td className="gpr-num">{d.cuts.length}</td>
                  <td>{d.fragments.map((f) => fmtInt(f)).join(' / ')}</td>
                </tr>
              );
            })}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={4} className="gpr-sub">
                  No enzyme cuts this product few enough times to read.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="gpr-hint" id={`${idp}-hint`}>
        Select an enzyme to mark its cuts in the sequence above. Sizes are from sequence alone: methylation, star
        activity and partial digests are not modelled.
        {digests.length > readable.length ? (
          <>
            {' '}
            <button type="button" className="gpr-btn gpr-btn-small gpr-btn-quiet" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Hide' : `Show ${fmtInt(digests.length - readable.length)} more`} that cut more than four times
            </button>
          </>
        ) : null}
      </p>
      {safe.length ? (
        <p className="gpr-hint">
          <strong>{fmtInt(safe.length)}</strong> of the panel do not cut this product at all, so they are safe to add
          to the primer ends: {safe.slice(0, 12).map((e) => e.name).join(', ')}
          {safe.length > 12 ? ` and ${fmtInt(safe.length - 12)} more` : ''}.
        </p>
      ) : null}

      {inside.length ? (
        caps.length ? (
          <div className="gpr-table-wrap">
            <table className="gpr-table gpr-digest-table">
              <caption className="gpr-caption">
                CAPS assays from this product · a variant inside it that an enzyme tells apart
              </caption>
              <thead>
                <tr>
                  <th scope="col">Variant</th>
                  <th scope="col">Enzyme</th>
                  <th scope="col">Cuts</th>
                  <th scope="col">REF fragments</th>
                  <th scope="col">ALT fragments</th>
                  <th scope="col">On a gel</th>
                </tr>
              </thead>
              <tbody>
                {caps.map((c) => (
                  <tr key={`${c.key}-${c.enzyme.name}`}>
                    <th scope="row">{c.label}</th>
                    <td>
                      <button
                        type="button"
                        className="gpr-btn gpr-btn-small gpr-btn-quiet"
                        aria-pressed={p.selected === c.enzyme.name}
                        onClick={() => p.onSelect?.(p.selected === c.enzyme.name ? null : c.enzyme.name)}
                      >
                        {c.enzyme.name}
                      </button>{' '}
                      <code className="gpr-seq">{site(c.enzyme)}</code>
                    </td>
                    <td>{c.cuts === 'ref' ? 'reference' : 'alternate'}</td>
                    <td>{c.refFragments.map((f) => fmtInt(f)).join(' / ')}</td>
                    <td>{c.altFragments.map((f) => fmtInt(f)).join(' / ')}</td>
                    <td>
                      <Verdict caps={c} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="gpr-hint">
            No enzyme in the panel tells apart any of the {fmtInt(inside.length)} variant
            {inside.length === 1 ? '' : 's'} inside this product.
          </p>
        )
      ) : p.variants?.length ? (
        <p className="gpr-hint">No known variant falls inside this product, so it types nothing by digestion.</p>
      ) : p.variantsUnavailable ? (
        <p className="gpr-hint">{p.variantsUnavailable}</p>
      ) : null}
    </div>
  );
}
