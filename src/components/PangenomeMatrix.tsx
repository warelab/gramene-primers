import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatRegion } from '../coords';
import {
  amplifiesFraction,
  isIssueStatus,
  PANGENOME_STATUS_META,
  PANGENOME_STATUSES,
  PANGENOME_TRANSCRIPT_MODELS_ONLY,
  pangenomeCellText,
  truncatedGenomeCount,
} from '../pangenome';
import { unlikelyReason, unlikelyText } from '../results';
import type { CheckParams, GenomeEntry, PangenomeAmplicon, PangenomeCellStatus, PangenomeGenomeResult, PangenomePairResult, PangenomeResults } from '../types';
import { CheckboxField } from './fields';
import { GeneLink } from './GeneLink';
import { GprRoot, type StyleProps } from './Root';
import { fmtInt, useIdPrefix } from './util';

export interface PangenomeMatrixProps extends StyleProps {
  results: PangenomeResults | null | undefined;
  /** Genomes the job will search; rows without a result yet show as pending. */
  requestedGenomes?: ReadonlyArray<string | { system_name: string; display_name?: string }> | null;
  /** Catalog entries for display names. */
  genomes?: ReadonlyArray<GenomeEntry> | null;
  /** Column labels by pair id, e.g. `{P2: 'P2 · pair 2'}`. */
  pairLabels?: Readonly<Record<string, string>>;
  /** Transcript-mode pan-genome (annotated transcript models only). */
  transcriptModelsOnly?: boolean;
  /** The check params (`results.params`), used to explain products that are not expected to amplify. */
  params?: Partial<CheckParams> | null;
  geneHref?: (geneId: string, systemName?: string) => string;
  onGeneClick?: (geneId: string, systemName?: string) => void;
  caption?: string;
}

export interface MatrixCell {
  status: PangenomeCellStatus;
  result: PangenomeGenomeResult | null;
}

export interface MatrixRow {
  system_name: string;
  display_name: string;
  cells: MatrixCell[];
  worst: number;
}

/** Rows (genomes) × columns (pairs), with `pending` cells for genomes not yet searched. */
export function buildMatrixRows(
  pairs: ReadonlyArray<PangenomePairResult>,
  requested?: PangenomeMatrixProps['requestedGenomes'],
  genomes?: ReadonlyArray<GenomeEntry> | null,
): MatrixRow[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const display = new Map<string, string>();
  for (const g of genomes ?? []) display.set(g.system_name, g.display_name || g.system_name);
  const add = (name: string, dn?: string) => {
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
    if (dn) display.set(name, dn);
  };
  for (const r of requested ?? []) {
    if (typeof r === 'string') add(r);
    else add(r.system_name, r.display_name);
  }
  for (const p of pairs) for (const g of p.genomes ?? []) add(g.system_name, g.display_name);
  const byPair = pairs.map((p) => new Map((p.genomes ?? []).map((g) => [g.system_name, g])));
  return names.map((name) => {
    const cells = byPair.map((m): MatrixCell => {
      const g = m.get(name) ?? null;
      return { status: g ? g.status : 'pending', result: g };
    });
    const worst = cells.reduce((acc, c) => Math.max(acc, PANGENOME_STATUS_META[c.status]?.severity ?? 0), -1);
    return { system_name: name, display_name: display.get(name) ?? name, cells, worst };
  });
}

function cellGlyph(cell: MatrixCell): { glyph: string; text: string } {
  const meta = PANGENOME_STATUS_META[cell.status];
  if (!cell.result) return { glyph: meta.glyph, text: '' };
  const text = pangenomeCellText(cell.result);
  if (cell.status === 'multiple') return { glyph: text || meta.glyph, text: '' };
  return { glyph: meta.glyph, text };
}

function cellLabel(row: MatrixRow, pairLabel: string, cell: MatrixCell): string {
  const parts = [row.display_name, pairLabel, PANGENOME_STATUS_META[cell.status].label];
  const g = cell.result;
  if (g) {
    const a = g.primary;
    if (g.status === 'single_perfect' && typeof a?.size_delta === 'number') parts.push(`size difference ${a.size_delta} bp`);
    if (g.status === 'single_mismatch' && a?.terminal_mismatch) parts.push('mismatch at the 3′ end');
    else if (g.status === 'single_mismatch' && a?.mismatch_in_3p_window) parts.push('mismatch in the 3′ window');
    if (g.status === 'multiple') parts.push(`${1 + (g.other_amplicons ?? g.others?.length ?? 1)} amplicons`);
    if (g.status === 'no_amplicon' && g.ortholog_annotated === false) parts.push('no ortholog annotated');
    if (g.status === 'no_amplicon' && g.nearest) parts.push('closest product not expected to amplify');
    if (g.truncated) parts.push('search incomplete');
  }
  return parts.join(', ');
}

/** Glyph for a result whose search hit a result cap. */
export const TRUNCATED_GLYPH = '⋯';

function ampliconText(a: PangenomeAmplicon, systemName: string): string {
  const where = a.region != null && typeof a.start === 'number' && typeof a.end === 'number' ? formatRegion(String(a.region), a.start, a.end, a.strand ?? null) : a.gene_id ?? systemName;
  const size = typeof a.size_min === 'number' && typeof a.size_max === 'number' && a.size_min !== a.size_max ? `${fmtInt(a.size_min)}–${fmtInt(a.size_max)}` : fmtInt(a.size);
  return `${where}, ${size} bp`;
}

function likelihoodLabel(a: PangenomeAmplicon, params: Partial<CheckParams> | null | undefined): string | undefined {
  if (a.likelihood === 'unlikely') return unlikelyText(unlikelyReason(a, params), params);
  return a.likelihood?.replace('_', ' ');
}

/** Status legend: glyph + colour + text (spec §C.3), plus the truncation marker. */
export function PangenomeLegend(): JSX.Element {
  const statuses: PangenomeCellStatus[] = [...PANGENOME_STATUSES, 'pending'];
  return (
    <ul className="gpr-legend" aria-label="Pan-genome status legend">
      {statuses.map((s) => (
        <li key={s} className="gpr-legend-item">
          <span className={`gpr-status gpr-status-${s}`} aria-hidden="true">
            {PANGENOME_STATUS_META[s].glyph}
          </span>{' '}
          {PANGENOME_STATUS_META[s].label}
        </li>
      ))}
      <li className="gpr-legend-item">
        <span className="gpr-cell-flag" aria-hidden="true">
          {TRUNCATED_GLYPH}
        </span>{' '}
        Search incomplete (a result cap was hit)
      </li>
    </ul>
  );
}

function CellDetail(props: {
  row: MatrixRow;
  pairLabel: string;
  cell: MatrixCell;
  headingId: string;
  onClose: () => void;
  geneHref?: PangenomeMatrixProps['geneHref'];
  onGeneClick?: PangenomeMatrixProps['onGeneClick'];
  params?: Partial<CheckParams> | null;
}): JSX.Element {
  const { row, pairLabel, cell, headingId, onClose, geneHref, onGeneClick, params } = props;
  const meta = PANGENOME_STATUS_META[cell.status];
  const g = cell.result;
  const a = g?.primary ?? null;
  const others = g?.other_amplicons ?? g?.others?.length ?? 0;
  const error = g?.error ? (typeof g.error === 'string' ? g.error : g.error.message) : null;
  return (
    <section className="gpr-cell-detail" aria-labelledby={headingId} aria-live="polite" data-status={cell.status}>
      <h4 className="gpr-h4" id={headingId}>
        {row.display_name} · {pairLabel}
      </h4>
      <p className="gpr-cell-detail-status">
        <span className={`gpr-status gpr-status-${cell.status}`} aria-hidden="true">
          {meta.glyph}
        </span>{' '}
        {meta.label}
        {row.display_name !== row.system_name ? <span className="gpr-sub"> ({row.system_name})</span> : null}
      </p>
      {a ? (
        <dl className="gpr-dl">
          <div className="gpr-dl-row">
            <dt>Product</dt>
            <dd>
              {ampliconText(a, row.system_name)}
              {typeof a.size_delta === 'number' ? ` (${a.size_delta > 0 ? '+' : ''}${a.size_delta} bp vs the reference)` : ''}
            </dd>
          </div>
          {a.gene_id ? (
            <div className="gpr-dl-row">
              <dt>Transcript model</dt>
              <dd>
                <GeneLink geneId={a.gene_id} systemName={row.system_name} geneHref={geneHref} onGeneClick={onGeneClick} />
                {a.isoforms?.length ? ` (${a.isoforms.map((i) => i.transcript_id).join(', ')})` : ''}
              </dd>
            </div>
          ) : null}
          {a.orientation || a.likelihood ? (
            <div className="gpr-dl-row">
              <dt>Orientation, likelihood</dt>
              <dd>{[a.orientation, likelihoodLabel(a, params)].filter(Boolean).join(', ')}</dd>
            </div>
          ) : null}
          <div className="gpr-dl-row">
            <dt>Mismatches</dt>
            <dd>
              left {a.left_mm ?? '–'} ({a.left_3p_mm ?? '–'} in the 3′ window), right {a.right_mm ?? '–'} ({a.right_3p_mm ?? '–'} in the 3′ window)
              {a.terminal_mismatch ? '; terminal 3′ mismatch' : a.mismatch_in_3p_window ? '; mismatch in the 3′ window' : ''}
              {a.approx ? '; approximate (from the BLAST alignment)' : ''}
            </dd>
          </div>
          {a.genes?.length ? (
            <div className="gpr-dl-row">
              <dt>Genes</dt>
              <dd className="gpr-gene-list">
                {a.genes.map((gene) => (
                  <GeneLink key={gene.id} geneId={gene.id} systemName={row.system_name} geneHref={geneHref} onGeneClick={onGeneClick} />
                ))}
              </dd>
            </div>
          ) : null}
          {a.ortholog != null ? (
            <div className="gpr-dl-row">
              <dt>Ortholog of the query gene</dt>
              <dd>{a.ortholog ? 'yes' : 'no'}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {g?.status === 'no_amplicon' ? (
        <p>
          {g.ortholog_annotated === false
            ? 'No ortholog of the query gene is annotated in this genome (possible presence/absence variation).'
            : g.ortholog_annotated
              ? 'An ortholog is annotated, but these primers do not amplify it.'
              : g.nearest
                ? 'No product is expected to amplify.'
                : 'No product was found.'}
        </p>
      ) : null}
      {g?.nearest ? (
        <p>
          Closest product ({g.nearest.likelihood === 'unlikely' || !g.nearest.likelihood ? unlikelyText(unlikelyReason({ ...g.nearest, likelihood: 'unlikely' }, params), params) : likelihoodLabel(g.nearest, params)}):{' '}
          {ampliconText(g.nearest, row.system_name)}
          {typeof g.nearest.left_mm === 'number' || typeof g.nearest.right_mm === 'number'
            ? `; mismatches left ${g.nearest.left_mm ?? '–'}, right ${g.nearest.right_mm ?? '–'}${g.nearest.approx ? ' (approximate)' : ''}`
            : ''}
          .
        </p>
      ) : null}
      {g?.truncated ? (
        <p className="gpr-note" role="note" data-code="TRUNCATED">
          <span aria-hidden="true">{TRUNCATED_GLYPH} </span>The search in this genome hit a result cap, so this result may be incomplete: products may have been missed.
        </p>
      ) : null}
      {others > 0 ? (
        <div>
          <p>
            {others} other amplicon{others === 1 ? '' : 's'}
            {g?.others?.length ? ':' : '.'}
          </p>
          {g?.others?.length ? (
            <ul className="gpr-plain-list">
              {g.others.slice(0, 20).map((o, i) => (
                <li key={i}>{ampliconText(o, row.system_name)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="gpr-field-error">{error}</p> : null}
      {cell.status === 'pending' ? <p className="gpr-hint">This genome has not been searched yet.</p> : null}
      <button type="button" className="gpr-btn gpr-btn-small" onClick={onClose}>
        Close details
      </button>
    </section>
  );
}

/** Genome × pair coverage grid with roving tabindex, sorting and an issues filter (spec §C.3 PangenomeMatrix). */
export function PangenomeMatrix(props: PangenomeMatrixProps): JSX.Element {
  const { results, requestedGenomes, genomes, pairLabels, transcriptModelsOnly, geneHref, onGeneClick, params } = props;
  const idp = useIdPrefix('gpr-pan');
  const pairs = results?.pairs ?? [];
  const [sortBy, setSortBy] = useState<'name' | 'worst'>('name');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [active, setActive] = useState({ r: 0, c: 0 });
  const [open, setOpen] = useState<{ system_name: string; c: number } | null>(null);
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());

  const allRows = useMemo(() => buildMatrixRows(pairs, requestedGenomes, genomes), [pairs, requestedGenomes, genomes]);
  const rows = useMemo(() => {
    let list = allRows;
    if (issuesOnly) list = list.filter((row) => row.cells.some((c) => isIssueStatus(c.status)));
    const byName = (a: MatrixRow, b: MatrixRow) => a.display_name.localeCompare(b.display_name) || a.system_name.localeCompare(b.system_name);
    return [...list].sort(sortBy === 'worst' ? (a, b) => b.worst - a.worst || byName(a, b) : byName);
  }, [allRows, issuesOnly, sortBy]);

  const label = (id: string) => pairLabels?.[id] ?? id;
  const maxR = rows.length - 1;
  const maxC = pairs.length - 1;
  const ar = Math.max(0, Math.min(active.r, maxR));
  const ac = Math.max(0, Math.min(active.c, maxC));

  const moveTo = (r: number, c: number) => {
    setActive({ r, c });
    cellRefs.current.get(`${r}:${c}`)?.focus();
    const row = rows[r];
    if (open && row) setOpen({ system_name: row.system_name, c });
  };
  const openCell = (r: number, c: number) => {
    const row = rows[r];
    if (!row) return;
    setActive({ r, c });
    setOpen({ system_name: row.system_name, c });
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
      case 'PageDown':
        nr = Math.min(maxR, r + 10);
        break;
      case 'PageUp':
        nr = Math.max(0, r - 10);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        openCell(r, c);
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

  const openRow = open ? allRows.find((r) => r.system_name === open.system_name) ?? null : null;
  const openCellData = openRow && open ? openRow.cells[open.c] ?? null : null;
  const openPair = open ? pairs[open.c] : undefined;
  const incompleteResults = pairs.reduce((n, p) => n + truncatedGenomeCount(p), 0);
  const searchedResults = pairs.reduce((n, p) => n + (p.genomes?.length ?? 0), 0);

  return (
    <GprRoot theme={props.theme} injectStyles={props.injectStyles} className={props.className} style={props.style}>
      <div className="gpr-pangenome">
        {transcriptModelsOnly ? (
          <p className="gpr-note" role="note" data-code={PANGENOME_TRANSCRIPT_MODELS_ONLY}>
            Annotated transcripts only: in transcript mode the pan-genome check searches each genome&apos;s annotated transcript models, so copies that are not
            annotated are not found.
          </p>
        ) : null}
        {incompleteResults ? (
          <p className="gpr-note" role="note" data-code="TRUNCATED">
            {TRUNCATED_GLYPH} marks {incompleteResults} of {searchedResults} result{searchedResults === 1 ? '' : 's'} where the search hit a result cap: products may have been missed, so
            those statuses and the amplifies counts are not definitive.
          </p>
        ) : null}
        <div className="gpr-matrix-toolbar">
          <label className="gpr-label gpr-label-inline" htmlFor={`${idp}-sort`}>
            Sort
          </label>
          <select id={`${idp}-sort`} className="gpr-select gpr-select-small" value={sortBy} onChange={(e) => setSortBy(e.target.value === 'worst' ? 'worst' : 'name')}>
            <option value="name">by genome name</option>
            <option value="worst">worst status first</option>
          </select>
          <CheckboxField id={`${idp}-issues`} label="Issues only" checked={issuesOnly} onChange={setIssuesOnly} />
          <span className="gpr-sub">
            {rows.length} of {allRows.length} genomes
          </span>
        </div>
        <PangenomeLegend />
        {pairs.length === 0 ? (
          <p className="gpr-hint">No pan-genome results yet.</p>
        ) : (
          <div className="gpr-table-wrap gpr-matrix-wrap">
            <table role="grid" className="gpr-table gpr-matrix">
              <caption className="gpr-caption">
                {props.caption ?? (transcriptModelsOnly ? 'Pan-genome coverage (annotated transcripts)' : 'Pan-genome coverage')} · arrow keys move, Enter shows details
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="gpr-matrix-corner">
                    Genome
                  </th>
                  {pairs.map((p) => {
                    const f = amplifiesFraction(p.summary);
                    const incomplete = truncatedGenomeCount(p);
                    return (
                      <th scope="col" key={p.id} className="gpr-matrix-pair">
                        {label(p.id)}
                        <span className="gpr-sub gpr-block">
                          amplifies {f.amplifies}/{f.total}
                        </span>
                        {incomplete ? (
                          <span className="gpr-sub gpr-block">
                            <span aria-hidden="true">{TRUNCATED_GLYPH} </span>
                            {incomplete} incomplete
                          </span>
                        ) : null}
                        {p.reference_size != null ? <span className="gpr-sub gpr-block">ref. {fmtInt(p.reference_size)} bp</span> : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={row.system_name}>
                    <th scope="row" className="gpr-matrix-genome">
                      {row.display_name}
                    </th>
                    {row.cells.map((cell, c) => {
                      const { glyph, text } = cellGlyph(cell);
                      const pairId = pairs[c]?.id ?? '';
                      const isOpen = !!open && open.system_name === row.system_name && open.c === c;
                      return (
                        <td
                          key={pairId}
                          role="gridcell"
                          ref={(el) => {
                            const key = `${r}:${c}`;
                            if (el) cellRefs.current.set(key, el);
                            else cellRefs.current.delete(key);
                          }}
                          className={`gpr-cell gpr-status-${cell.status}`}
                          data-status={cell.status}
                          data-truncated={cell.result?.truncated ? 'true' : undefined}
                          data-state={isOpen ? 'open' : undefined}
                          tabIndex={r === ar && c === ac ? 0 : -1}
                          aria-label={cellLabel(row, label(pairId), cell)}
                          aria-selected={isOpen}
                          onClick={() => openCell(r, c)}
                          onFocus={() => {
                            if (r !== active.r || c !== active.c) setActive({ r, c });
                          }}
                          onKeyDown={(e) => onKeyDown(e, r, c)}
                        >
                          <span className="gpr-cell-glyph" aria-hidden="true">
                            {glyph}
                          </span>
                          {text ? (
                            <span className="gpr-cell-text" aria-hidden="true">
                              {text}
                            </span>
                          ) : null}
                          {cell.result?.truncated ? (
                            <span className="gpr-cell-flag" aria-hidden="true">
                              {TRUNCATED_GLYPH}
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {openRow && openCellData && openPair ? (
          <CellDetail
            row={openRow}
            pairLabel={label(openPair.id)}
            cell={openCellData}
            headingId={`${idp}-detail-h`}
            onClose={() => {
              setOpen(null);
              cellRefs.current.get(`${ar}:${ac}`)?.focus();
            }}
            geneHref={geneHref}
            onGeneClick={onGeneClick}
            params={params}
          />
        ) : null}
      </div>
    </GprRoot>
  );
}
