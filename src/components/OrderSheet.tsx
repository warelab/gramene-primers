import { genotypeCallsToTSV, orderRowsToFasta, orderSheetToTSV } from '../exporters';
import type { GenotypeResults, GenotypingOrderRow, GenotypingSet, KaspMix } from '../types';
import { CopyButton } from './CopyButton';
import { ExportMenu, type ExportItem } from './ExportMenu';
import { GprRoot, type StyleProps } from './Root';
import { fmtInt, fmtNum, useIdPrefix } from './util';

const ROLE_LABEL = { as_ref: 'REF', as_alt: 'ALT', common: 'Common' } as const;

export interface OrderSheetProps extends StyleProps {
  sets: ReadonlyArray<GenotypingSet>;
  /** `assay.kasp_mix`; null for AS-PCR, which needs no mix. */
  kaspMix?: KaspMix | null;
  /** `variant.submission_sequence`, for ordering from a vendor by sequence. */
  submissionSequence?: string | null;
  /** Allele-call results, which add the genotype-calls export. */
  results?: GenotypeResults | null;
  /** Base name for downloads. */
  label?: string;
}

/**
 * The oligos to order (spec §3.6). Two sequences are shown for every primer and
 * they are not interchangeable: `order_seq` is what the vendor synthesizes
 * (tail included), while `target_seq` is what anneals and the only sequence a
 * check ever accepts — a tailed oligo fails the check endpoint's primer pattern.
 */
export function OrderSheet(props: OrderSheetProps): JSX.Element {
  const { sets, kaspMix, submissionSequence, results, label } = props;
  const idp = useIdPrefix('gpr-order');
  const rows: GenotypingOrderRow[] = sets.flatMap((s) => s.order ?? []);
  const base = label || rows[0]?.variant_key?.replace(/[^A-Za-z0-9_.-]+/g, '_') || 'primers';

  const items: ExportItem[] = [];
  if (rows.length) {
    items.push({
      id: 'order-tsv',
      label: 'Order sheet (TSV)',
      filename: `${base}-order.tsv`,
      mime: 'text/tab-separated-values',
      build: () => orderSheetToTSV(sets, { kaspMix, submissionSequence }),
    });
    items.push({ id: 'order-fasta', label: 'Primers (FASTA)', filename: `${base}-primers.fa`, mime: 'text/plain', build: () => orderRowsToFasta(sets) });
  }
  if (results) {
    items.push({
      id: 'genotype-calls',
      label: 'Genotype calls (TSV)',
      filename: `${base}-genotypes.tsv`,
      mime: 'text/tab-separated-values',
      build: () => genotypeCallsToTSV(results),
    });
  }

  return (
    <GprRoot theme={props.theme} injectStyles={props.injectStyles} className={props.className} style={props.style}>
      <div className="gpr-order-sheet">
        {kaspMix ? (
          <p className="gpr-order-note">
            <strong>KASP mix:</strong> {fmtNum(kaspMix.as_ref_uL, 0)} µL REF + {fmtNum(kaspMix.as_alt_uL, 0)} µL ALT + {fmtNum(kaspMix.common_uL, 0)} µL common at{' '}
            {fmtNum(kaspMix.stock_uM, 0)} µM + {fmtNum(kaspMix.water_uL, 0)} µL water = {fmtNum(kaspMix.total_uL, 0)} µL{' '}
            <span className="gpr-sub">({kaspMix.source})</span>
          </p>
        ) : null}

        {submissionSequence ? (
          <p className="gpr-order-note gpr-submission">
            <strong>Submission sequence:</strong> <code className="gpr-seq">{submissionSequence}</code>
            <CopyButton text={submissionSequence} label="Copy the submission sequence" />
          </p>
        ) : null}

        {!rows.length ? (
          <p className="gpr-hint">Design a set to see the oligos to order.</p>
        ) : (
          <div className="gpr-table-wrap">
            <table className="gpr-table gpr-order-table">
              <caption className="gpr-caption">
                {fmtInt(rows.length)} oligo{rows.length === 1 ? '' : 's'} · order the <strong>order sequence</strong>; the target sequence is what anneals
              </caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Set</th>
                  <th scope="col">Role</th>
                  <th scope="col">Dye</th>
                  <th scope="col">Order sequence 5′→3′</th>
                  <th scope="col">Target sequence 5′→3′</th>
                  <th scope="col">nt</th>
                  <th scope="col">Tm °C</th>
                  <th scope="col">GC %</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="gpr-order-row" data-role={r.role}>
                    <th scope="row">
                      <code className="gpr-code">{r.name}</code>
                    </th>
                    <td>{r.set_id}</td>
                    <td>
                      {ROLE_LABEL[r.role]}
                      {r.allele ? <span className="gpr-sub gpr-block">{r.allele}</span> : null}
                    </td>
                    <td>{r.dye ?? <span className="gpr-sub">–</span>}</td>
                    <td className="gpr-order-seq">
                      <code className="gpr-seq">{r.order_seq}</code>
                      <CopyButton text={r.order_seq} label={`Copy the order sequence of ${r.name}`} />
                    </td>
                    <td className="gpr-order-seq">
                      {r.order_seq === r.target_seq ? (
                        <span className="gpr-sub">same</span>
                      ) : (
                        <>
                          <code className="gpr-seq">{r.target_seq}</code>
                          <CopyButton text={r.target_seq} label={`Copy the target sequence of ${r.name}`} />
                        </>
                      )}
                    </td>
                    <td className="gpr-num">{fmtInt(r.length)}</td>
                    <td className="gpr-num">{fmtNum(r.tm, 1)}</td>
                    <td className="gpr-num">{fmtNum(r.gc, 0)}</td>
                    <td className="gpr-order-notes">{r.notes || <span className="gpr-sub">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ExportMenu items={items} idPrefix={idp} />
      </div>
    </GprRoot>
  );
}
