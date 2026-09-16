import { useMemo, useRef, useState } from 'react';
import { isAbortError, isPrimersApiError } from '../errors';
import type { GenotypingState, PrimerWarning, PrimersClient, VariantEntry, VariantKind, VariantListQuery, VariantSource } from '../types';
import { GENOTYPING_LIMITS, validateVariantInput } from '../validate';
import { CheckboxField, NumberField, TextField } from './fields';
import { useCountdown } from './hooks/useCountdown';
import { useVariantList } from './hooks/useVariants';
import { ManualVariantInputs, type ManualVariant } from './ManualVariantInputs';
import { Warnings } from './Warnings';
import { fmtInt, useIdPrefix } from './util';

const KINDS: ReadonlyArray<VariantKind> = ['snv', 'mnv', 'insertion', 'deletion', 'complex'];

type VariantSortKey = 'position' | 'label' | 'kind' | 'ids' | 'consequence' | 'designable';

const VARIANT_COLUMNS: ReadonlyArray<{ key: VariantSortKey; label: string }> = [
  { key: 'position', label: 'Position' },
  { key: 'label', label: 'Change' },
  { key: 'kind', label: 'Kind' },
  { key: 'ids', label: 'Ids' },
  { key: 'consequence', label: 'Consequence' },
  { key: 'designable', label: 'Designable' },
];

/** Every comparator falls back to position, so equal keys stay in genome order. */
function compareVariants(key: VariantSortKey): (a: VariantEntry, b: VariantEntry) => number {
  const byPos = (a: VariantEntry, b: VariantEntry) => a.vcf.position - b.vcf.position || a.key.localeCompare(b.key);
  switch (key) {
    case 'label':
      return (a, b) => a.label.localeCompare(b.label) || byPos(a, b);
    case 'kind':
      return (a, b) => a.kind.localeCompare(b.kind) || byPos(a, b);
    case 'ids':
      return (a, b) => (a.ids[0] ?? '').localeCompare(b.ids[0] ?? '') || byPos(a, b);
    case 'consequence':
      return (a, b) => (a.consequence ?? '~').localeCompare(b.consequence ?? '~') || byPos(a, b);
    case 'designable':
      // Rows you can act on first.
      return (a, b) => Number(b.designable) - Number(a.designable) || byPos(a, b);
    default:
      return byPos;
  }
}

/** Codes that mean "variant lookups are unavailable", never "this design failed". */
function degradedCode(error: unknown): string | null {
  if (!isPrimersApiError(error)) return null;
  return error.code === 'FEATURE_DISABLED' || error.code === 'VARIATION_SOURCE_UNAVAILABLE' || error.code === 'NO_VARIATION_DATA' ? error.code : null;
}

/** All four fields present, so the draft can be committed as a variant. */
function isCompleteManual(v: Partial<ManualVariant>): v is ManualVariant {
  return !!v.region && Number.isInteger(v.position) && !!v.ref && !!v.alt;
}

function sourceLabel(source: VariantSource | null | undefined): string {
  if (!source?.name) return 'manual entry only';
  return source.release ? `${source.name} ${source.release} variants` : `${source.name} variants`;
}

export interface VariantPickerProps {
  client: PrimersClient;
  systemName: string;
  /** `genomes[].has_variation` for this genome, and `variation.available` for the server. */
  variationAvailable?: boolean;
  source?: VariantSource | null;
  state: GenotypingState;
  /** Used when the state carries no window yet (the gene span ± 2 kb, clamped by the caller). */
  defaultWindow?: GenotypingState['window'];
  onWindow: (window: GenotypingState['window']) => void;
  onFilters: (filters: GenotypingState['filters']) => void;
  onSelect: (choice: { variantId?: string; alt?: string; variantKey?: string; manual?: ManualVariant }) => void;
  onCheckReference?: () => void;
  checkingReference?: boolean;
  refMismatch?: { given: string; genome: string } | null;
  disabled?: boolean;
}

/**
 * Choosing the variant to design against (spec §3.1): a window of known
 * variants, a lookup by id, or manual entry. Manual entry is always offered —
 * when Ensembl is switched off or unreachable the picker degrades to it rather
 * than failing, because a manual design still works without neighbour screening.
 */
export function VariantPicker(p: VariantPickerProps): JSX.Element {
  const idp = useIdPrefix('gpr-variant');
  const [lookupId, setLookupId] = useState('');
  const [lookup, setLookup] = useState<{ id: string; variants: VariantEntry[]; warnings: PrimerWarning[] } | null>(null);
  // The half-typed variant lives here, not in the designer state: only a complete,
  // valid one is committed, so a reload never restores a partial entry.
  const [manualDraft, setManualDraft] = useState<Partial<ManualVariant>>(() => p.state.manual ?? {});
  const [lookupError, setLookupError] = useState<unknown>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [designableOnly, setDesignableOnly] = useState(false);
  const [sort, setSort] = useState<{ key: VariantSortKey; dir: 1 | -1 }>({ key: 'position', dir: 1 });
  const lookupCtrl = useRef<AbortController | null>(null);

  const window = p.state.window ?? p.defaultWindow ?? null;
  const filters = p.state.filters ?? {};
  const length = window ? window.end - window.start + 1 : 0;
  const tooLong = length > GENOTYPING_LIMITS.maxWindow;
  const windowValid = !!window && window.region.length > 0 && window.start >= 1 && window.end >= window.start && !tooLong;

  const query: VariantListQuery | null = useMemo(() => {
    if (!p.variationAvailable || !windowValid || !window) return null;
    const q: VariantListQuery = { system_name: p.systemName, region: window.region, start: window.start, end: window.end };
    if (filters.types?.length && filters.types.length < KINDS.length) q.types = [...filters.types];
    // Only `false` is meaningful; the default already includes EMS entries.
    if (filters.includeEms === false) q.include_ems = false;
    return q;
  }, [p.variationAvailable, p.systemName, windowValid, window?.region, window?.start, window?.end, filters.types, filters.includeEms]);

  const list = useVariantList(p.client, query);
  const degraded = degradedCode(list.error) ?? degradedCode(lookupError);
  const retryTarget = useMemo(() => {
    const e = isPrimersApiError(list.error) ? list.error : isPrimersApiError(lookupError) ? lookupError : null;
    return e?.retryAfterMs ? Date.now() + e.retryAfterMs : null;
  }, [list.error, lookupError]);
  const retryIn = useCountdown(retryTarget);

  const search = (filters.query ?? '').trim().toLowerCase();
  const listed = list.data?.variants ?? [];
  const allRows = lookup ? lookup.variants : listed;
  const rows = useMemo(() => {
    const kept = allRows.filter((v) => {
      if (designableOnly && !v.designable) return false;
      if (!search) return true;
      return v.label.toLowerCase().includes(search) || v.ids.some((i) => i.toLowerCase().includes(search));
    });
    const cmp = compareVariants(sort.key);
    return [...kept].sort((a, b) => sort.dir * cmp(a, b));
  }, [allRows, search, designableOnly, sort]);

  const canLookUp = typeof p.client.getVariant === 'function';
  const runLookup = async () => {
    const id = lookupId.trim();
    if (!id || !canLookUp) return;
    lookupCtrl.current?.abort();
    const ctrl = new AbortController();
    lookupCtrl.current = ctrl;
    setLookingUp(true);
    setLookupError(null);
    try {
      const res = await p.client.getVariant!(id, { system_name: p.systemName }, { signal: ctrl.signal });
      if (!ctrl.signal.aborted) setLookup({ id: res.requested_id, variants: res.variants, warnings: res.warnings ?? [] });
    } catch (e) {
      if (!ctrl.signal.aborted && !isAbortError(e)) {
        setLookup(null);
        setLookupError(e);
      }
    } finally {
      if (!ctrl.signal.aborted) setLookingUp(false);
    }
  };

  const setWindow = (patch: Partial<NonNullable<GenotypingState['window']>>) => {
    const base = window ?? { region: '', start: 1, end: 1 };
    p.onWindow({ ...base, ...patch });
  };
  const toggleKind = (kind: VariantKind, on: boolean) => {
    const current = new Set(filters.types ?? KINDS);
    if (on) current.add(kind);
    else current.delete(kind);
    p.onFilters({ ...filters, types: KINDS.filter((k) => current.has(k)) });
  };

  const manualTouched = Object.values(manualDraft).some((v) => v !== undefined && v !== '');
  const manualIssues = useMemo(() => validateVariantInput(manualDraft), [manualDraft]);

  const showBrowser = !!p.variationAvailable && !degraded;
  const manualVisible = manualOpen || !showBrowser;

  return (
    <div className="gpr-variant-picker">
      <p className="gpr-readout">
        <span className="gpr-badge gpr-variant-source">{p.variationAvailable ? sourceLabel(p.source) : 'manual entry only'}</span>
      </p>

      {degraded ? (
        <p className="gpr-note" role="note" data-code={degraded}>
          {degraded === 'FEATURE_DISABLED'
            ? 'Variant lookups are switched off on this server.'
            : degraded === 'NO_VARIATION_DATA'
              ? 'This genome has no known variants.'
              : 'Variant lookups are temporarily unavailable.'}{' '}
          {retryIn > 0 ? `Try again in ${retryIn} s. ` : ''}You can still enter a variant by hand; neighbouring variants will not be screened.
        </p>
      ) : null}

      {showBrowser ? (
        <>
          <fieldset className="gpr-fieldset gpr-variant-window" disabled={p.disabled}>
            <legend className="gpr-legend gpr-legend-small">Where to look</legend>
            <div className="gpr-field-grid">
              <TextField id={`${idp}-region`} label="Sequence" value={window?.region ?? ''} short onChange={(region) => setWindow({ region })} />
              <NumberField id={`${idp}-start`} label="From" value={window?.start} min={1} step={1} onChange={(start) => setWindow({ start: start ?? 1 })} />
              <NumberField id={`${idp}-end`} label="To" value={window?.end} min={1} step={1} onChange={(end) => setWindow({ end: end ?? 1 })} />
            </div>
            <p className={tooLong ? 'gpr-field-error' : 'gpr-hint'}>
              {tooLong
                ? `That window is ${fmtInt(length)} bp; at most ${fmtInt(GENOTYPING_LIMITS.maxWindow)} bp can be listed at once.`
                : `${fmtInt(length)} bp of at most ${fmtInt(GENOTYPING_LIMITS.maxWindow)} bp.`}
            </p>
          </fieldset>

          <fieldset className="gpr-fieldset gpr-variant-filters" disabled={p.disabled}>
            <legend className="gpr-legend gpr-legend-small">Filters</legend>
            <div className="gpr-variant-kinds">
              {KINDS.map((kind) => (
                <CheckboxField
                  key={kind}
                  id={`${idp}-kind-${kind}`}
                  label={kind}
                  checked={!filters.types || filters.types.includes(kind)}
                  onChange={(on) => toggleKind(kind, on)}
                />
              ))}
            </div>
            <CheckboxField
              id={`${idp}-ems`}
              label="Include EMS mutations"
              checked={filters.includeEms !== false}
              hint="EMS mutations are private to one mutant line."
              onChange={(on) => p.onFilters({ ...filters, includeEms: on ? undefined : false })}
            />
          </fieldset>

          <div className="gpr-variant-lookup">
            <TextField
              id={`${idp}-lookup`}
              label="Or look up a variant id"
              value={lookupId}
              placeholder="rs871475760"
              disabled={p.disabled || !canLookUp}
              hint={canLookUp ? 'Returns one row per alternative allele at that position.' : 'This server cannot look variants up by id.'}
              onChange={setLookupId}
            />
            <div className="gpr-button-row">
              <button type="button" className="gpr-btn gpr-btn-small" disabled={p.disabled || !canLookUp || !lookupId.trim() || lookingUp} onClick={runLookup}>
                {lookingUp ? 'Looking up…' : 'Look up'}
              </button>
              {lookup ? (
                <button type="button" className="gpr-btn gpr-btn-small gpr-btn-quiet" onClick={() => setLookup(null)}>
                  Back to the list
                </button>
              ) : null}
            </div>
            {lookupError && !degraded ? (
              <p className="gpr-field-error" role="alert" data-code={isPrimersApiError(lookupError) ? lookupError.code : 'ERROR'}>
                {isPrimersApiError(lookupError) && lookupError.code === 'UNKNOWN_VARIANT'
                  ? 'That id is not known here.'
                  : lookupError instanceof Error
                    ? lookupError.message
                    : String(lookupError)}
              </p>
            ) : null}
          </div>

          <Warnings warnings={lookup ? lookup.warnings : list.data?.warnings} title={lookup ? 'About this id' : 'About this list'} />

          {list.loading ? <p className="gpr-hint">Looking for variants…</p> : null}

          {!list.loading && !rows.length ? (
            <p className="gpr-hint">{windowValid ? 'No variants in this window.' : 'Choose a window to list variants.'}</p>
          ) : null}

          {rows.length ? (
            <>
              {list.data?.truncated && !lookup ? (
                <p className="gpr-note" role="note" data-code="VARIANTS_TRUNCATED">
                  Showing {fmtInt(list.data.returned)} of {fmtInt(list.data.total)} variants; narrow the window to see the rest.
                </p>
              ) : null}
              <div className="gpr-variant-toolbar">
                <TextField
                  id={`${idp}-search`}
                  label="Search"
                  type="search"
                  value={filters.query ?? ''}
                  placeholder="id or position"
                  disabled={p.disabled}
                  className="gpr-variant-search"
                  onChange={(q) => p.onFilters({ ...filters, query: q || undefined })}
                />
                <CheckboxField id={`${idp}-designable`} label="Designable only" checked={designableOnly} onChange={setDesignableOnly} />
                <span className="gpr-sub">
                  {fmtInt(rows.length)} of {fmtInt(allRows.length)} variant{allRows.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="gpr-table-wrap gpr-variant-scroll">
                <table className="gpr-table gpr-variant-table">
                  <caption className="gpr-caption">
                    {lookup ? `Alternative alleles of ${lookup.id}` : `${fmtInt(rows.length)} variant${rows.length === 1 ? '' : 's'}`} · rows that cannot be designed are
                    listed with the reason
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="gpr-col-check">
                        <span className="gpr-visually-hidden">Select</span>
                      </th>
                      {VARIANT_COLUMNS.map((c) => (
                        <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                          <button
                            type="button"
                            className="gpr-sort"
                            onClick={() => setSort((v) => ({ key: c.key, dir: v.key === c.key ? (v.dir === 1 ? -1 : 1) : 1 }))}
                          >
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
                    {rows.map((v) => {
                      const selected = p.state.variantKey === v.key;
                      const issue = v.issues[0] ?? null;
                      return (
                        <tr key={v.key} className="gpr-variant-row" data-state={selected ? 'selected' : undefined} data-designable={v.designable ? 'true' : 'false'}>
                          <td className="gpr-col-check">
                            <input
                              type="radio"
                              className="gpr-radio"
                              name={`${idp}-variant`}
                              id={`${idp}-v-${v.key}`}
                              checked={selected}
                              disabled={p.disabled || !v.designable}
                              aria-label={`Use ${v.label}`}
                              onChange={() => p.onSelect({ variantKey: v.key, variantId: v.ids[0], alt: v.vcf.alt })}
                            />
                          </td>
                          <th scope="row" className="gpr-num">
                            {fmtInt(v.vcf.position)}
                          </th>
                          <td>
                            <code className="gpr-seq">{v.label}</code>
                            {v.shift ? <span className="gpr-sub gpr-block">can slide {fmtInt(v.shift)} bp</span> : null}
                            {v.multiallelic ? <span className="gpr-sub gpr-block">other alleles here: {v.multiallelic.other_alts.join(', ')}</span> : null}
                          </td>
                          <td>{v.kind}</td>
                          <td className="gpr-variant-ids">
                            {v.ids[0] ?? <span className="gpr-sub">none</span>}
                            {v.ids.length > 1 ? <span className="gpr-sub"> +{v.ids.length - 1}</span> : null}
                            <span className="gpr-sub gpr-block">
                              {v.records.map((r) => (
                                <span key={`${r.id}-${r.source}`} className="gpr-variant-record" title={r.ems ? 'EMS mutation' : r.source}>
                                  <span aria-hidden="true">{r.ems ? '○' : '●'}</span> {r.source}
                                </span>
                              ))}
                              {v.ems ? <span className="gpr-badge"> EMS only</span> : null}
                            </span>
                          </td>
                          <td>{v.consequence ?? <span className="gpr-sub">–</span>}</td>
                          <td>
                            {v.designable ? (
                              <span className="gpr-chip gpr-chip-ok">
                                <span className="gpr-chip-glyph" aria-hidden="true">
                                  ✓
                                </span>
                                <span className="gpr-chip-text">Yes</span>
                              </span>
                            ) : (
                              <span className="gpr-chip gpr-chip-bad" data-code={issue?.code} title={issue?.message}>
                                <span className="gpr-chip-glyph" aria-hidden="true">
                                  ✗
                                </span>
                                <span className="gpr-chip-text">{issue?.code ? issue.code.replace(/_/g, ' ').toLowerCase() : 'no'}</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      <div className="gpr-variant-manual">
        {showBrowser ? (
          <button type="button" className="gpr-btn gpr-btn-small gpr-btn-quiet" aria-expanded={manualVisible} aria-controls={`${idp}-manual`} onClick={() => setManualOpen((o) => !o)}>
            {manualVisible ? 'Hide manual entry' : 'Enter a variant by hand'}
          </button>
        ) : null}
        <div id={`${idp}-manual`} hidden={!manualVisible}>
          <ManualVariantInputs
            idPrefix={idp}
            value={manualDraft}
            issues={manualTouched ? manualIssues : []}
            refMismatch={p.refMismatch}
            disabled={p.disabled}
            checking={p.checkingReference}
            onCheckReference={p.onCheckReference}
            onChange={(manual) => {
              setManualDraft(manual);
              // The guard establishes exactly what the cast claims.
              if (isCompleteManual(manual) && validateVariantInput(manual).length === 0) p.onSelect({ manual });
            }}
          />
        </div>
      </div>
    </div>
  );
}
