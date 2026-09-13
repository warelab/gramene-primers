import { useMemo, useState } from 'react';
import { formatRegion } from '../coords';
import { pairKey, unlikelyReason, unlikelyText } from '../results';
import type {
  CheckJob,
  CheckParams,
  CheckResults,
  DesignMode,
  GenomeAmplicon,
  Likelihood,
  PrimerPair,
  SpecificityPairResult,
  SubmittedPair,
  TranscriptAmpliconGroup,
  TranscriptomePairResult,
} from '../types';
import { GeneLink } from './GeneLink';
import { GprRoot, type StyleProps } from './Root';
import { MismatchGlyph, VerdictChip } from './VerdictChip';
import { Warnings } from './Warnings';
import { fmtInt, useIdPrefix } from './util';

export interface SpecificityResultsProps extends StyleProps {
  results: CheckResults | null | undefined;
  /** `genome` (default) or `transcriptome`. */
  block?: 'genome' | 'transcriptome';
  /** Designed pairs, to label results with their rank. */
  pairs?: ReadonlyArray<PrimerPair> | null;
  job?: Pick<CheckJob, 'request' | 'status' | 'partial'> | null;
  submitted?: ReadonlyArray<SubmittedPair> | null;
  /** Reference genome, passed to gene links. */
  systemName?: string | null;
  geneHref?: (geneId: string, systemName?: string) => string;
  onGeneClick?: (geneId: string, systemName?: string) => void;
  /** Off-target rows shown per table (default 100). */
  maxRows?: number;
}

interface PairInfo {
  left?: string;
  right?: string;
  rank?: number;
}

const LIKELIHOOD_TEXT: Readonly<Record<Likelihood, string>> = Object.freeze({
  likely: 'likely',
  likely_weak: 'likely, weak (3′ mismatch)',
  unlikely: 'unlikely',
});
const LIKELIHOOD_ORDER: Readonly<Record<Likelihood, number>> = Object.freeze({ likely: 0, likely_weak: 1, unlikely: 2 });

/** Likelihood text; `unlikely` says why (too many mismatches in a primer, or mismatches near the 3′ end). */
function likelihoodText(
  a: { likelihood: Likelihood; left_mm?: number | null; right_mm?: number | null; left_3p_mm?: number | null; right_3p_mm?: number | null },
  params: Partial<CheckParams> | null | undefined,
): string {
  if (a.likelihood === 'unlikely') return unlikelyText(unlikelyReason(a, params), params);
  return LIKELIHOOD_TEXT[a.likelihood] ?? String(a.likelihood);
}

function pairInfoMap(job: SpecificityResultsProps['job'], submitted: SpecificityResultsProps['submitted'], pairs: SpecificityResultsProps['pairs']): Map<string, PairInfo> {
  const sent: ReadonlyArray<SubmittedPair> = job?.request?.pairs?.length ? job.request.pairs : submitted ?? [];
  const rankByKey = new Map((pairs ?? []).map((p) => [pairKey(p.left.seq, p.right.seq), p.rank]));
  return new Map(sent.map((s) => [s.id, { left: s.left.toUpperCase(), right: s.right.toUpperCase(), rank: rankByKey.get(pairKey(s.left, s.right)) }]));
}

function naturalRegion(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

type SortKey = 'location' | 'size' | 'orientation' | 'likelihood' | 'left' | 'right' | 'genes';

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'location', label: 'Location' },
  { key: 'size', label: 'Size (bp)' },
  { key: 'orientation', label: 'Orientation' },
  { key: 'likelihood', label: 'Likelihood' },
  { key: 'left', label: 'Left primer mismatches' },
  { key: 'right', label: 'Right primer mismatches' },
  { key: 'genes', label: 'Genes' },
];

function compareAmplicons(key: SortKey): (a: GenomeAmplicon, b: GenomeAmplicon) => number {
  const loc = (a: GenomeAmplicon, b: GenomeAmplicon) => naturalRegion(String(a.region), String(b.region)) || a.start - b.start;
  switch (key) {
    case 'size':
      return (a, b) => a.size - b.size || loc(a, b);
    case 'orientation':
      return (a, b) => a.orientation.localeCompare(b.orientation) || loc(a, b);
    case 'likelihood':
      return (a, b) => (LIKELIHOOD_ORDER[a.likelihood] ?? 9) - (LIKELIHOOD_ORDER[b.likelihood] ?? 9) || loc(a, b);
    case 'left':
      return (a, b) => a.left_mm - b.left_mm || a.left_3p_mm - b.left_3p_mm || loc(a, b);
    case 'right':
      return (a, b) => a.right_mm - b.right_mm || a.right_3p_mm - b.right_3p_mm || loc(a, b);
    case 'genes':
      return (a, b) => (a.genes?.[0]?.id ?? '~').localeCompare(b.genes?.[0]?.id ?? '~') || loc(a, b);
    default:
      return loc;
  }
}

interface TableCommon {
  info: PairInfo | undefined;
  systemName?: string | null;
  geneHref?: SpecificityResultsProps['geneHref'];
  onGeneClick?: SpecificityResultsProps['onGeneClick'];
  /** `results.params`, to explain unlikely products. */
  params?: Partial<CheckParams> | null;
}

function AmpliconTable({ rows, caption, maxRows, info, systemName, geneHref, onGeneClick, params }: TableCommon & { rows: ReadonlyArray<GenomeAmplicon>; caption: string; maxRows: number }): JSX.Element {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'location', dir: 1 });
  const sorted = useMemo(() => {
    const cmp = compareAmplicons(sort.key);
    return [...rows].sort((a, b) => sort.dir * cmp(a, b));
  }, [rows, sort]);
  const shown = sorted.slice(0, maxRows);
  return (
    <>
      <div className="gpr-table-wrap">
        <table className="gpr-table gpr-amplicon-table">
          <caption className="gpr-caption">
            {caption} ({fmtInt(rows.length)})
          </caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="gpr-sort" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
                    {c.label}
                    <span className="gpr-sort-glyph" aria-hidden="true">
                      {sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((a, i) => (
              <tr key={`${a.region}:${a.start}-${a.end}:${a.orientation}:${i}`}>
                <td className="gpr-loc">
                  {formatRegion(String(a.region), a.start, a.end)}
                  {a.approx ? <span className="gpr-sub"> (approx.)</span> : null}
                </td>
                <td className="gpr-num">{fmtInt(a.size)}</td>
                <td>{a.orientation}</td>
                <td>{likelihoodText(a, params)}</td>
                <td className="gpr-col-mm">
                  {info?.left ? <MismatchGlyph seq={info.left} positions={a.left_mm_pos} label="Left primer" /> : null}
                  <span className="gpr-sub gpr-block">
                    {a.left_mm} total, {a.left_3p_mm} in 3′ window{a.approx ? ' (approx.)' : ''}
                  </span>
                </td>
                <td className="gpr-col-mm">
                  {info?.right ? <MismatchGlyph seq={info.right} positions={a.right_mm_pos} label="Right primer" /> : null}
                  <span className="gpr-sub gpr-block">
                    {a.right_mm} total, {a.right_3p_mm} in 3′ window{a.approx ? ' (approx.)' : ''}
                  </span>
                </td>
                <td>
                  {a.genes?.length ? (
                    <span className="gpr-gene-list">
                      {a.genes.map((g) => (
                        <GeneLink key={g.id} geneId={g.id} systemName={systemName} geneHref={geneHref} onGeneClick={onGeneClick} />
                      ))}
                    </span>
                  ) : (
                    <span className="gpr-sub">intergenic</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > maxRows ? (
        <p className="gpr-hint">
          Showing {fmtInt(maxRows)} of {fmtInt(rows.length)}; export the off-target TSV for the full list.
        </p>
      ) : null}
    </>
  );
}

function OnTargetLine({ r, mode, systemName, geneHref, onGeneClick }: { r: SpecificityPairResult; mode?: DesignMode | null } & Omit<TableCommon, 'info' | 'params'>): JSX.Element {
  const ot = r.on_target;
  if (ot) {
    return (
      <p className="gpr-on-target">
        On target: <span className="gpr-loc">{formatRegion(String(ot.region), ot.start, ot.end)}</span>, {fmtInt(ot.size)} bp, {ot.orientation}
        {ot.likelihood !== 'likely' ? `, ${LIKELIHOOD_TEXT[ot.likelihood] ?? ot.likelihood}` : ''}
        {ot.genes?.length ? (
          <>
            {' '}
            in{' '}
            {ot.genes.map((g) => (
              <GeneLink key={g.id} geneId={g.id} systemName={systemName} geneHref={geneHref} onGeneClick={onGeneClick} />
            ))}
          </>
        ) : null}
        {r.on_target_inferred ? ' (inferred: the only perfect product)' : ''}
      </p>
    );
  }
  // Transcript mode has no genome on-target: products inside the gene are gdna_products, the rest off-targets.
  const gdna = r.gdna_products?.length ?? 0;
  const transcript = mode === 'transcript' || gdna > 0;
  const hasOffTargets = (r.off_target_count ?? 0) > 0 || (r.off_targets?.length ?? 0) > 0;
  let text = 'No on-target product was reported.';
  if (r.verdict === 'on_target_missing') text = 'The expected product was not found in the genome.';
  else if (r.verdict === 'unverified_target') text = 'No expected location was given and the target could not be inferred.';
  else if (transcript && hasOffTargets) {
    text = `Transcript check: the genome has no expected product, so products outside the gene are listed as off-targets${gdna ? ' and products inside it as genomic DNA products' : ''}.`;
  } else if (r.verdict === 'specific' && !hasOffTargets) {
    text = gdna ? 'No off-target products in the genome outside the gene.' : 'No off-target products in the genome.';
  }
  return <p className="gpr-on-target">{text}</p>;
}

function GenomePairResult({
  r,
  info,
  results,
  maxRows,
  systemName,
  geneHref,
  onGeneClick,
  headingId,
  mode,
}: TableCommon & { r: SpecificityPairResult; results: CheckResults; maxRows: number; headingId: string; mode?: DesignMode | null }): JSX.Element {
  const params = results.params ?? null;
  const primers = results.primers ?? {};
  const flags = (
    [
      ['Left', info?.left],
      ['Right', info?.right],
    ] as const
  )
    .map(([side, seq]) => (seq && primers[seq]?.repetitive ? { side, sites: primers[seq]!.near_perfect_sites } : null))
    .filter((f): f is { side: 'Left' | 'Right'; sites: number } => !!f);
  const gdna = r.gdna_products ?? [];
  return (
    <section className="gpr-result-pair" aria-labelledby={headingId} data-pair={r.id}>
      <h4 className="gpr-h4" id={headingId}>
        {r.id}
        {info?.rank != null ? <span className="gpr-sub"> · designed pair {info.rank + 1}</span> : null}{' '}
        <VerdictChip verdict={r.verdict} count={r.off_target_count} inferred={r.on_target_inferred} />
      </h4>
      {flags.map((f) => (
        <p key={f.side} className="gpr-note gpr-repetitive">
          <span className="gpr-badge gpr-badge-warn">repetitive</span> {f.side} primer: {fmtInt(f.sites)} near-perfect genome sites.
        </p>
      ))}
      <OnTargetLine r={r} mode={mode} systemName={systemName} geneHref={geneHref} onGeneClick={onGeneClick} />
      {r.truncated ? (
        <p className="gpr-note" role="note">
          The search hit a candidate cap, so this list may be incomplete.
        </p>
      ) : null}
      {r.error ? <p className="gpr-field-error">{r.error.message}</p> : null}
      {r.off_targets?.length ? (
        <AmpliconTable rows={r.off_targets} caption={`Off-target products of ${r.id}`} maxRows={maxRows} info={info} systemName={systemName} geneHref={geneHref} onGeneClick={onGeneClick} params={params} />
      ) : null}
      {r.unlikely?.length ? (
        <AmpliconTable rows={r.unlikely} caption={`Unlikely products of ${r.id}`} maxRows={maxRows} info={info} systemName={systemName} geneHref={geneHref} onGeneClick={onGeneClick} params={params} />
      ) : r.unlikely_count ? (
        <p className="gpr-hint">
          {fmtInt(r.unlikely_count)} unlikely product{r.unlikely_count === 1 ? '' : 's'} not listed (include them in the advanced check settings).
        </p>
      ) : null}
      {gdna.length ? (
        <div className="gpr-note gpr-gdna" role="note">
          <p>
            {gdna.length} genomic DNA product{gdna.length === 1 ? '' : 's'} inside the gene ({gdna.map((a) => `${fmtInt(a.size)} bp`).join(', ')}): DNase-treat RNA before
            reverse transcription.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function groupSize(g: TranscriptAmpliconGroup): string {
  return g.size_min === g.size_max ? fmtInt(g.size_min) : `${fmtInt(g.size_min)}–${fmtInt(g.size_max)}`;
}

function TranscriptPairResult({ r, info, systemName, geneHref, onGeneClick, headingId, params }: TableCommon & { r: TranscriptomePairResult; headingId: string }): JSX.Element {
  const groups: Array<{ g: TranscriptAmpliconGroup; kind: string }> = [
    ...(r.on_target ? [{ g: r.on_target, kind: 'on target' }] : []),
    ...(r.off_targets ?? []).map((g) => ({ g, kind: 'off target' })),
  ];
  return (
    <section className="gpr-result-pair" aria-labelledby={headingId} data-pair={r.id}>
      <h4 className="gpr-h4" id={headingId}>
        {r.id}
        {info?.rank != null ? <span className="gpr-sub"> · designed pair {info.rank + 1}</span> : null}{' '}
        <VerdictChip verdict={r.verdict} count={r.off_target_count} context="Transcriptome" />
      </h4>
      {r.truncated ? (
        <p className="gpr-note" role="note">
          The search hit a candidate cap, so this list may be incomplete.
        </p>
      ) : null}
      {groups.length ? (
        <div className="gpr-table-wrap">
          <table className="gpr-table gpr-transcript-table">
            <caption className="gpr-caption">Transcript products of {r.id}, one row per gene</caption>
            <thead>
              <tr>
                <th scope="col">Gene</th>
                <th scope="col">Kind</th>
                <th scope="col">Isoforms</th>
                <th scope="col">Size (bp)</th>
                <th scope="col">Likelihood</th>
                <th scope="col">Mismatches L/R</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(({ g, kind }, i) => (
                <tr key={`${g.gene_id}-${i}`} data-kind={kind}>
                  <td>
                    <GeneLink geneId={g.gene_id} systemName={systemName} geneHref={geneHref} onGeneClick={onGeneClick} />
                  </td>
                  <td>{kind}</td>
                  <td>
                    <ul className="gpr-isoforms">
                      {(g.isoforms ?? []).map((iso) => (
                        <li key={iso.transcript_id}>
                          {iso.transcript_id}{' '}
                          <span className="gpr-sub">
                            {fmtInt(iso.start)}–{fmtInt(iso.end)}, {fmtInt(iso.size)} bp
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="gpr-num">{groupSize(g)}</td>
                  <td>
                    {likelihoodText(g, params)}
                    {g.approx ? ' (approx.)' : ''}
                  </td>
                  <td className="gpr-num">
                    {g.left_mm ?? '–'} / {g.right_mm ?? '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="gpr-hint">No transcript products.</p>
      )}
    </section>
  );
}

function SensitivityTable({ results }: { results: CheckResults }): JSX.Element | null {
  const entries = Object.entries(results.primers ?? {});
  if (!entries.length) return null;
  return (
    <div className="gpr-table-wrap">
      <table className="gpr-table gpr-sensitivity-table">
        <caption className="gpr-caption">Per-primer search sensitivity</caption>
        <thead>
          <tr>
            <th scope="col">Primer</th>
            <th scope="col">Near-perfect sites</th>
            <th scope="col">Reference: always found up to</th>
            <th scope="col">Pan-genome: always found up to</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([seq, p]) => (
            <tr key={seq}>
              <td>
                <code className="gpr-seq">{seq}</code>
                {p.repetitive ? <span className="gpr-badge gpr-badge-warn">repetitive</span> : null}
              </td>
              <td className="gpr-num">{fmtInt(p.near_perfect_sites)}</td>
              <td>{p.sensitivity?.reference ? `${p.sensitivity.reference.guaranteed_max_mismatches} mismatches (word size ${p.sensitivity.reference.word_size})` : '–'}</td>
              <td>{p.sensitivity?.pangenome ? `${p.sensitivity.pangenome.guaranteed_max_mismatches} mismatches (word size ${p.sensitivity.pangenome.word_size})` : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Genome specificity or transcriptome results (spec §C.3 SpecificityResults). */
export function SpecificityResults(props: SpecificityResultsProps): JSX.Element {
  const { results, block = 'genome', job, maxRows = 100, systemName, geneHref, onGeneClick } = props;
  const idp = useIdPrefix('gpr-spec');
  const info = useMemo(() => pairInfoMap(job, props.submitted, props.pairs), [job, props.submitted, props.pairs]);
  const running = job?.status === 'queued' || job?.status === 'running';
  const genomePairs = results?.specificity?.pairs ?? [];
  const transcriptPairs = results?.transcriptome?.pairs ?? [];
  const count = block === 'genome' ? genomePairs.length : transcriptPairs.length;
  return (
    <GprRoot theme={props.theme} injectStyles={props.injectStyles} className={props.className} style={props.style}>
      <div className="gpr-specificity" data-block={block}>
        {count === 0 ? (
          <p className="gpr-hint">{running ? (block === 'genome' ? 'Searching the reference genome…' : 'Searching the transcriptome…') : 'No results.'}</p>
        ) : running ? (
          <p className="gpr-hint" role="note">
            Partial results: the check is still running.
          </p>
        ) : null}
        {results && block === 'genome'
          ? genomePairs.map((r, i) => (
              <GenomePairResult
                key={r.id}
                r={r}
                info={info.get(r.id)}
                results={results}
                maxRows={maxRows}
                systemName={systemName}
                geneHref={geneHref}
                onGeneClick={onGeneClick}
                headingId={`${idp}-g-${i}`}
                mode={job?.request?.mode ?? null}
              />
            ))
          : null}
        {results && block === 'transcriptome'
          ? transcriptPairs.map((r, i) => (
              <TranscriptPairResult
                key={r.id}
                r={r}
                info={info.get(r.id)}
                systemName={systemName}
                geneHref={geneHref}
                onGeneClick={onGeneClick}
                headingId={`${idp}-t-${i}`}
                params={results.params ?? null}
              />
            ))
          : null}
        {results && block === 'genome' && (results.sensitivity_note || Object.keys(results.primers ?? {}).length) ? (
          <details className="gpr-details gpr-sensitivity">
            <summary className="gpr-summary">Search sensitivity</summary>
            {results.sensitivity_note ? <p className="gpr-hint">{results.sensitivity_note}</p> : null}
            <SensitivityTable results={results} />
          </details>
        ) : null}
        {block === 'genome' ? <Warnings warnings={results?.warnings} title="Check warnings" /> : null}
      </div>
    </GprRoot>
  );
}
