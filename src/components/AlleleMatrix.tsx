import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { alleleMatrixRows, alleleMeta, isIssueAllele, isIssuePrediction, isDisagreement, predictionMeta, type AlleleMatrixRow } from '../genotyping';
import type { GenotypeGenomeRow, GenotypePredictionRow, GenotypeResults, GenotypeSetResults } from '../types';
import { CheckboxField } from './fields';
import { AgreementMark, AlleleChip, AlleleLegend, PredictionChip, PrimerStatusChip } from './GenotypeChip';
import { GprRoot, type StyleProps } from './Root';
import { fmtInt, fmtNum, useIdPrefix } from './util';

export interface AlleleMatrixProps extends StyleProps {
  results: GenotypeResults | null | undefined;
  /** Genomes asked for but not yet called; they appear as pending rows. */
  requestedGenomes?: ReadonlyArray<string | { system_name: string; display_name?: string }> | null;
  /** The job is still running, so zero counts mean "not yet", never "nothing found". */
  running?: boolean;
  caption?: string;
}

/** Screen-reader text for one cell, since the glyphs themselves are decorative. */
function cellLabel(row: AlleleMatrixRow, setId: string, p: GenotypePredictionRow | null): string {
  if (!p) return `${row.display_name}, set ${setId}: not called yet`;
  const parts = [`${row.display_name}, set ${setId}: ${predictionMeta(p.predicted).label}`];
  if (p.strength) parts.push(p.strength);
  parts.push(p.agrees === true ? 'agrees' : p.agrees === false ? 'disagrees' : 'cannot be compared');
  if (p.off_locus_products > 0) parts.push(`${p.off_locus_products} off-locus product${p.off_locus_products === 1 ? '' : 's'}`);
  if (p.reasons.length) parts.push(p.reasons.join(', '));
  return parts.join(' · ');
}

function alleleLabel(row: AlleleMatrixRow): string {
  if (!row.genome) return `${row.display_name}: not called yet`;
  const g = row.genome;
  const parts = [`${row.display_name}: ${alleleMeta(g.allele).label}`];
  if (g.observed) parts.push(`reads ${g.observed}`);
  if (g.orthologous_copies !== 1) parts.push(`${g.orthologous_copies} orthologous copies`);
  if (g.paralog_copies) parts.push(`${g.paralog_copies} paralog${g.paralog_copies === 1 ? '' : 's'}`);
  if (g.reason) parts.push(g.reason.replace(/_/g, ' '));
  return parts.join(' · ');
}

/** The copies behind one genome's call. */
function GenomeDetail({ row, headingId, onClose }: { row: AlleleMatrixRow; headingId: string; onClose: () => void }): JSX.Element {
  const g: GenotypeGenomeRow | null = row.genome;
  return (
    <section className="gpr-cell-detail gpr-allele-detail" aria-labelledby={headingId}>
      <div className="gpr-banner-actions">
        <h4 className="gpr-h4" id={headingId}>
          {row.display_name}
        </h4>
        <button type="button" className="gpr-btn gpr-btn-small gpr-btn-quiet" onClick={onClose}>
          Close
        </button>
      </div>
      {!g ? (
        <p className="gpr-hint">This genome has not been called yet.</p>
      ) : (
        <>
          <dl className="gpr-dl">
            <div className="gpr-dl-row">
              <dt>Allele</dt>
              <dd>
                <AlleleChip allele={g.allele} /> {g.observed ? <code className="gpr-seq">{g.observed}</code> : <span className="gpr-sub">no sequence reported</span>}
              </dd>
            </div>
            <div className="gpr-dl-row">
              <dt>Copies</dt>
              <dd>
                {fmtInt(g.orthologous_copies)} orthologous{g.paralog_copies ? `, ${fmtInt(g.paralog_copies)} paralog${g.paralog_copies === 1 ? '' : 's'}` : ''}
                {g.source ? ` · found by ${g.source}` : ''}
              </dd>
            </div>
            {g.reason ? (
              <div className="gpr-dl-row">
                <dt>Reason</dt>
                <dd>{g.reason.replace(/_/g, ' ')}</dd>
              </div>
            ) : null}
          </dl>
          {g.copies.length ? (
            <div className="gpr-table-wrap">
              <table className="gpr-table gpr-detail-table">
                <caption className="gpr-caption">Orthologous copies · the ortholog test uses gap-compressed identity</caption>
                <thead>
                  <tr>
                    <th scope="col">Location</th>
                    <th scope="col">Identity</th>
                    <th scope="col">Gap-compressed</th>
                    <th scope="col">Aligned</th>
                    <th scope="col">Reads</th>
                    <th scope="col">Call</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {g.copies.map((c, i) => (
                    <tr key={`${c.region}-${c.start}-${i}`}>
                      <th scope="row">
                        {c.region}:{fmtInt(c.start)}–{fmtInt(c.end)} {c.strand === -1 ? '−' : '+'}
                      </th>
                      <td className="gpr-num">{fmtNum(c.identity, 2)} %</td>
                      <td className="gpr-num">{fmtNum(c.gap_compressed_identity, 2)} %</td>
                      <td className="gpr-num">{fmtInt(c.aligned_length)}</td>
                      <td>{c.observed ? <code className="gpr-seq">{c.observed}</code> : '–'}</td>
                      <td>{c.call ?? '–'}</td>
                      <td>{c.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * Genomes × sets: what allele each genome carries, and what each set is
 * predicted to read there (spec §3.5). Counts come from `results.summary`, never
 * from the number of rows — a partial or trimmed job reports totals for genomes
 * whose rows are not present.
 */
export function AlleleMatrix(props: AlleleMatrixProps): JSX.Element {
  const { results, requestedGenomes, running, caption } = props;
  const idp = useIdPrefix('gpr-alleles');
  const [disagreementsOnly, setDisagreementsOnly] = useState(false);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [active, setActive] = useState({ r: 0, c: 0 });
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());

  const sets: ReadonlyArray<GenotypeSetResults> = results?.sets ?? [];
  const allRows = useMemo(() => alleleMatrixRows(results, requestedGenomes), [results, requestedGenomes]);
  const rows = useMemo(
    () =>
      allRows.filter((row) => {
        if (disagreementsOnly && !row.hasDisagreement) return false;
        if (issuesOnly) {
          const badAllele = !!row.allele && isIssueAllele(row.allele);
          const badCell = row.cells.some((c) => !!c.prediction && isIssuePrediction(c.prediction.predicted));
          if (!badAllele && !badCell) return false;
        }
        return true;
      }),
    [allRows, disagreementsOnly, issuesOnly],
  );

  const summary = results?.summary ?? null;
  const maxR = Math.max(0, rows.length - 1);
  // Column 0 is the observed allele; one column per set follows.
  const maxC = sets.length;
  const { r: ar, c: ac } = active;

  const moveTo = (r: number, c: number) => {
    setActive({ r, c });
    cellRefs.current.get(`${r}:${c}`)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTableCellElement>, r: number, c: number) => {
    let nr = r;
    let nc = c;
    switch (e.key) {
      case 'ArrowRight':
        nc = Math.min(maxC, c + 1);
        break;
      case 'ArrowLeft':
        nc = Math.max(0, c - 1);
        break;
      case 'ArrowDown':
        nr = Math.min(maxR, r + 1);
        break;
      case 'ArrowUp':
        nr = Math.max(0, r - 1);
        break;
      case 'Home':
        nc = 0;
        if (e.ctrlKey) nr = 0;
        break;
      case 'End':
        nc = maxC;
        if (e.ctrlKey) nr = maxR;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        setActive({ r, c });
        setOpen(rows[r]?.system_name ?? null);
        return;
      case 'Escape':
        if (open) {
          e.preventDefault();
          setOpen(null);
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    moveTo(nr, nc);
  };

  const openRow = open ? allRows.find((x) => x.system_name === open) ?? null : null;
  const failedControls = sets.filter((s) => s.control.status !== 'pass');

  return (
    <GprRoot theme={props.theme} injectStyles={props.injectStyles} className={props.className} style={props.style}>
      <div className="gpr-allele-matrix">
        {failedControls.map((s) => (
          <p key={s.id} className="gpr-note" role="note" data-code="REFERENCE_CONTROL_FAILED" data-status={s.control.status}>
            Set {s.id}: the reference genome did not read its own allele ({s.control.status}). Its other predictions are unreliable.
            {s.control.reasons.length ? ` ${s.control.reasons.join(', ').replace(/_/g, ' ')}.` : ''}
          </p>
        ))}

        {summary ? (
          <p className="gpr-readout">
            {running && summary.genomes_total === 0 ? (
              <>Calling alleles — genomes appear as they finish.</>
            ) : (
              <>
                {fmtInt(summary.genomes_total)} genome{summary.genomes_total === 1 ? '' : 's'}: {fmtInt(summary.ref)} reference · {fmtInt(summary.alt)} alternative
                {summary.other ? ` · ${fmtInt(summary.other)} a third allele` : ''}
                {summary.ambiguous ? ` · ${fmtInt(summary.ambiguous)} ambiguous` : ''}
                {summary.missing ? ` · ${fmtInt(summary.missing)} no comparable locus` : ''}
                {summary.unavailable ? ` · ${fmtInt(summary.unavailable)} unavailable` : ''}
                {allRows.length < summary.genomes_total ? <span className="gpr-sub"> · {fmtInt(allRows.length)} shown</span> : null}
              </>
            )}
          </p>
        ) : null}

        <div className="gpr-matrix-toolbar">
          <CheckboxField id={`${idp}-disagree`} label="Disagreements only" checked={disagreementsOnly} onChange={setDisagreementsOnly} />
          <CheckboxField id={`${idp}-issues`} label="Issues only" checked={issuesOnly} onChange={setIssuesOnly} />
          <span className="gpr-sub">
            {rows.length} of {allRows.length} row{allRows.length === 1 ? '' : 's'}
          </span>
        </div>

        <AlleleLegend />

        {!rows.length ? (
          <p className="gpr-hint">{running ? 'No genomes have been called yet.' : 'No genomes match these filters.'}</p>
        ) : (
          <div className="gpr-table-wrap gpr-matrix-wrap">
            <table role="grid" className="gpr-table gpr-matrix gpr-allele-grid">
              <caption className="gpr-caption">{caption ?? 'Allele calls by genome'} · arrow keys move, Enter shows the copies</caption>
              <thead>
                <tr>
                  <th scope="col" className="gpr-matrix-corner">
                    Genome
                  </th>
                  <th scope="col" className="gpr-matrix-pair">
                    Allele
                  </th>
                  {sets.map((s) => (
                    <th scope="col" key={s.id} className="gpr-matrix-pair">
                      {s.id}
                      <span className="gpr-sub gpr-block">{s.orientation}</span>
                      <span className="gpr-sub gpr-block">
                        {fmtInt(s.summary.agree)}/{fmtInt(s.summary.agree + s.summary.disagree)} agree
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={row.system_name} data-reference={row.is_reference ? 'true' : undefined}>
                    <th scope="row" className="gpr-matrix-genome">
                      {row.display_name}
                      {row.is_reference ? <span className="gpr-sub gpr-block">reference</span> : null}
                    </th>
                    <td
                      role="gridcell"
                      ref={(el) => {
                        const key = `${r}:0`;
                        if (el) cellRefs.current.set(key, el);
                        else cellRefs.current.delete(key);
                      }}
                      className="gpr-cell gpr-allele-cell"
                      data-status={row.allele ?? 'pending'}
                      tabIndex={r === ar && ac === 0 ? 0 : -1}
                      aria-label={alleleLabel(row)}
                      onClick={() => {
                        setActive({ r, c: 0 });
                        setOpen(row.system_name);
                      }}
                      onFocus={() => {
                        if (r !== ar || ac !== 0) setActive({ r, c: 0 });
                      }}
                      onKeyDown={(e) => onKeyDown(e, r, 0)}
                    >
                      {row.allele ? <AlleleChip allele={row.allele} compact /> : <span aria-hidden="true">…</span>}
                      {row.genome && row.genome.orthologous_copies > 1 ? (
                        <sup className="gpr-copies" aria-hidden="true">
                          {row.genome.orthologous_copies}
                        </sup>
                      ) : null}
                    </td>
                    {row.cells.map((cell, i) => {
                      const c = i + 1;
                      const p = cell.prediction;
                      return (
                        <td
                          key={cell.set.id}
                          role="gridcell"
                          ref={(el) => {
                            const key = `${r}:${c}`;
                            if (el) cellRefs.current.set(key, el);
                            else cellRefs.current.delete(key);
                          }}
                          className="gpr-cell gpr-prediction-cell"
                          data-status={p?.predicted ?? 'pending'}
                          data-disagrees={isDisagreement(p) ? 'true' : undefined}
                          tabIndex={r === ar && c === ac ? 0 : -1}
                          aria-label={cellLabel(row, cell.set.id, p)}
                          onClick={() => {
                            setActive({ r, c });
                            setOpen(row.system_name);
                          }}
                          onFocus={() => {
                            if (r !== ar || c !== ac) setActive({ r, c });
                          }}
                          onKeyDown={(e) => onKeyDown(e, r, c)}
                        >
                          {p ? (
                            <>
                              <PredictionChip predicted={p.predicted} compact />
                              <AgreementMark agrees={p.agrees} />
                              {p.strength === 'weak' ? (
                                <span className="gpr-cell-flag" aria-hidden="true" title="weak signal">
                                  ~
                                </span>
                              ) : null}
                              {p.off_locus_products > 0 ? (
                                <span className="gpr-cell-flag" aria-hidden="true" title="off-locus products">
                                  ⚠
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span aria-hidden="true">…</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {openRow ? (
          <GenomeDetail
            row={openRow}
            headingId={`${idp}-detail-h`}
            onClose={() => {
              setOpen(null);
              cellRefs.current.get(`${ar}:${ac}`)?.focus();
            }}
          />
        ) : null}

        {openRow && openRow.cells.some((c) => c.prediction) ? (
          <div className="gpr-table-wrap">
            <table className="gpr-table gpr-detail-table">
              <caption className="gpr-caption">How each set behaves in {openRow.display_name}</caption>
              <thead>
                <tr>
                  <th scope="col">Set</th>
                  <th scope="col">Predicted</th>
                  <th scope="col">REF primer</th>
                  <th scope="col">ALT primer</th>
                  <th scope="col">Common primer</th>
                  <th scope="col">Reasons</th>
                </tr>
              </thead>
              <tbody>
                {openRow.cells.map((cell) => {
                  const p = cell.prediction;
                  return (
                    <tr key={cell.set.id}>
                      <th scope="row">{cell.set.id}</th>
                      <td>{p ? <PredictionChip predicted={p.predicted} detail={p.strength ?? undefined} /> : <span className="gpr-sub">not called yet</span>}</td>
                      <td>{p ? <PrimerStatusChip status={p.ref_primer.status} context="REF primer" /> : '–'}</td>
                      <td>{p ? <PrimerStatusChip status={p.alt_primer.status} context="ALT primer" /> : '–'}</td>
                      <td>{p ? <PrimerStatusChip status={p.common_primer.status} context="Common primer" /> : '–'}</td>
                      <td>{p?.reasons.length ? p.reasons.join(', ').replace(/_/g, ' ') : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </GprRoot>
  );
}
