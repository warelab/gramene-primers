import { useMemo, useRef, useState } from 'react';
import { annotateVariants, enzymeCounts, type CapsAnnotation } from '../caps';
import { alleleShare, minorAlleleFrequency, populationCounts, variantAllele, type AlleleShare } from '../frequency';
import { isAbortError, isPrimersApiError } from '../errors';
import type { AlleleFrequencies, GenesInRegion, GenotypingState, PrimerWarning, PrimersClient, RestrictionEnzyme, SequenceForRegion, VariantEntry, VariantKind, VariantListQuery, VariantSource } from '../types';
import { GENOTYPING_LIMITS, validateVariantInput } from '../validate';
import { CheckboxField, NumberField, TextField } from './fields';
import { useCountdown } from './hooks/useCountdown';
import { MAX_ANNOTATED, useAlleleFrequencies } from './hooks/useAlleleFrequencies';
import { useRegionSequence } from './hooks/useRegionSequence';
import { useVariantList } from './hooks/useVariants';
import { ManualVariantInputs, type ManualVariant } from './ManualVariantInputs';
import { VariantBrowser } from './VariantBrowser';
import { Warnings } from './Warnings';
import { fmtInt, useIdPrefix } from './util';

const KINDS: ReadonlyArray<VariantKind> = ['snv', 'mnv', 'insertion', 'deletion', 'complex'];

/**
 * Below this the minor allele is too rare to screen for: at 5% of a 200-line
 * panel only ten lines carry it, and the rarest variants here sit at one line
 * in a hundred and eighty.
 */
const POLYMORPHIC_MAF = 0.05;

/**
 * What each kind means, on hover and to a screen reader. The server assigns
 * the kind; these say what it stands for, in the terms the table then uses to
 * display the change.
 */
const KIND_HELP: Readonly<Record<VariantKind, string>> = Object.freeze({
  snv: 'Single nucleotide variant: one base changed, such as C/T. The most straightforward kind to tell apart by allele-specific PCR.',
  mnv: 'Multi-nucleotide variant: several adjacent bases changed together, the same number of them in each allele.',
  insertion: 'Bases added between two positions, listed at the gap between them: 1:513^514 -/AA.',
  deletion: 'Bases removed, listed over the bases that go: 1:259-262 CAAA/-.',
  complex: 'A change that is not a plain substitution, insertion or deletion — usually bases altered and the length changed at once.',
});

type VariantSortKey = 'position' | 'label' | 'kind' | 'ids' | 'consequence' | 'frequency' | 'caps' | 'designable';

const VARIANT_COLUMNS: ReadonlyArray<{ key: VariantSortKey; label: string }> = [
  { key: 'position', label: 'Position' },
  { key: 'label', label: 'Change' },
  { key: 'kind', label: 'Kind' },
  { key: 'ids', label: 'Ids' },
  { key: 'consequence', label: 'Consequence' },
  { key: 'frequency', label: 'Frequency' },
  { key: 'caps', label: 'CAPS' },
  { key: 'designable', label: 'Designable' },
];

/** Usable assays first, then ones needing a modified primer, then the rest. */
function capsRank(a: CapsAnnotation | undefined): number {
  if (!a || a.unknown) return 0;
  if (a.verdict === 'caps') return 3;
  if (a.verdict === 'dcaps') return 2;
  return 1;
}

/** Every comparator falls back to position, so equal keys stay in genome order. */
function compareVariants(
  key: VariantSortKey,
  caps: ReadonlyMap<string, CapsAnnotation>,
  frequencyOf: (v: VariantEntry) => number | null,
): (a: VariantEntry, b: VariantEntry) => number {
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
    case 'frequency':
      return (a, b) => (frequencyOf(b) ?? -1) - (frequencyOf(a) ?? -1) || byPos(a, b);
    case 'caps':
      return (a, b) => capsRank(caps.get(b.key)) - capsRank(caps.get(a.key)) || byPos(a, b);
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

/** A value picked from the listing itself, with how many rows carry it. */
function FacetSelect(p: {
  id: string;
  label: string;
  anyLabel: string;
  value: string;
  options: ReadonlyArray<readonly [string, number]>;
  disabled?: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="gpr-field gpr-variant-facet">
      <label className="gpr-label" htmlFor={p.id}>
        {p.label}
      </label>
      <select
        id={p.id}
        className="gpr-select gpr-select-small"
        value={p.value}
        disabled={p.disabled || p.options.length < 2}
        onChange={(e) => p.onChange(e.target.value)}
      >
        <option value="">{p.anyLabel}</option>
        {p.options.map(([value, n]) => (
          <option key={value} value={value}>
            {value.replace(/_/g, ' ')} ({n})
          </option>
        ))}
      </select>
    </div>
  );
}

/** Why a variant carries no verdict, in words a user can act on. */
const CAPS_UNKNOWN_TITLE: Readonly<Record<string, string>> = {
  'no-sequence': 'No reference sequence is available here, so restriction sites cannot be checked.',
  'window-mismatch': 'The reference sequence disagrees with the reported alleles, so no site can be trusted.',
  'out-of-window': 'This variant lies outside the fetched sequence.',
  'ref-mismatch': 'The reference allele does not match the sequence at this position.',
};

/**
 * The CAPS verdict for one variant: glyph, colour and words together, so the
 * column reads the same to someone who cannot tell the colours apart.
 */
function CapsCell({ annotation }: { annotation: CapsAnnotation | undefined }): JSX.Element {
  if (!annotation || annotation.unknown) {
    return (
      <span className="gpr-chip gpr-chip-muted" title={CAPS_UNKNOWN_TITLE[annotation?.unknown ?? 'no-sequence']}>
        <span className="gpr-chip-glyph" aria-hidden="true">
          ·
        </span>
        <span className="gpr-chip-text">Unknown</span>
      </span>
    );
  }
  if (annotation.verdict === 'caps') {
    const best = annotation.sites[0]!;
    const more = annotation.sites.length - 1;
    return (
      <span
        className="gpr-chip gpr-chip-ok"
        title={`${best.enzyme.name} (${best.enzyme.site}) cuts the ${best.cuts === 'ref' ? 'reference' : 'alternate'} allele and not the other. Fragment sizes depend on the amplicon.`}
      >
        <span className="gpr-chip-glyph" aria-hidden="true">
          ✂
        </span>
        <span className="gpr-chip-text">{best.enzyme.name}</span>
        {more > 0 ? <span className="gpr-caps-more"> +{more}</span> : null}
      </span>
    );
  }
  if (annotation.verdict === 'dcaps') {
    const best = annotation.dcaps[0]!;
    return (
      <span
        className="gpr-chip gpr-chip-warn"
        title={`No natural site. A primer carrying ${best.from}→${best.to} ${best.offset} bp ${best.side} of the variant would create a ${best.enzyme.name} (${best.enzyme.site}) site in the ${best.cuts === 'ref' ? 'reference' : 'alternate'} allele. The primer is not designed here.`}
      >
        <span className="gpr-chip-glyph" aria-hidden="true">
          ~
        </span>
        <span className="gpr-chip-text">dCAPS</span>
        <span className="gpr-caps-more"> {best.enzyme.name}</span>
      </span>
    );
  }
  return (
    <span className="gpr-chip gpr-chip-muted" title="No enzyme in the panel tells the alleles apart, with or without a modified primer.">
      <span className="gpr-chip-glyph" aria-hidden="true">
        –
      </span>
      <span className="gpr-chip-text">None</span>
    </span>
  );
}

/**
 * The alternate allele's share of one panel. Shown with the count behind it,
 * because a frequency from a handful of lines and one from two thousand read
 * the same otherwise.
 */
function FrequencyCell(p: {
  share: (AlleleShare & { population: string }) | null;
  pending: boolean;
  /** True when no single panel was chosen, so the row names the one it used. */
  named: boolean;
}): JSX.Element {
  if (!p.share) {
    return p.pending ? (
      <span className="gpr-sub" title="Still being looked up.">
        …
      </span>
    ) : (
      <span className="gpr-sub" title="This panel reports no frequency for this variant.">
        –
      </span>
    );
  }
  const pct = p.share.frequency * 100;
  return (
    <span
      className="gpr-freq"
      title={`${(p.share.frequency * 100).toFixed(2)}% in ${p.share.population}${p.share.count !== null ? `, from ${fmtInt(p.share.count)} chromosomes` : ''}`}
    >
      <span className="gpr-freq-value">{pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%</span>
      {p.share.count !== null ? <span className="gpr-sub"> n={fmtInt(p.share.count)}</span> : null}
      {p.named ? <span className="gpr-sub gpr-block">{p.share.population}</span> : null}
    </span>
  );
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
  /** Host-supplied gene search for the region browser; without it the gene track is hidden. */
  genesInRegion?: GenesInRegion;
  sequenceForRegion?: SequenceForRegion;
  /** Supplies allele frequencies; omitted, there is no frequency column. */
  alleleFrequencies?: AlleleFrequencies;
  /** Restriction enzymes to consider. Defaults to the bundled panel. */
  enzymes?: ReadonlyArray<RestrictionEnzyme>;
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
  const [consequence, setConsequence] = useState('');
  const [source, setSource] = useState('');
  const [multiallelicOnly, setMultiallelicOnly] = useState(false);
  const [shiftableOnly, setShiftableOnly] = useState(false);
  const [capsOnly, setCapsOnly] = useState(false);
  const [enzyme, setEnzyme] = useState('');
  const [population, setPopulation] = useState('');
  const [polymorphicOnly, setPolymorphicOnly] = useState(false);
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

  // Sequence is keyed on the listing window, so panning the browser never refetches.
  const sequence = useRegionSequence(p.sequenceForRegion, query);

  const search = (filters.query ?? '').trim().toLowerCase();
  const listed = list.data?.variants ?? [];
  const allRows = lookup ? lookup.variants : listed;
  /**
   * CAPS for every listed row at once. The natural-site scan is the cheap half
   * and the near-miss scan costs little more, so both run eagerly rather than
   * splitting the column into two states the user has to learn.
   */
  const caps = useMemo(
    () => annotateVariants(allRows, sequence.seq, sequence.start, { enzymes: p.enzymes }),
    [allRows, sequence.seq, sequence.start, p.enzymes],
  );
  const capsUnknown = sequence.unsupported || !sequence.seq;
  const capsNote =
    sequence.unsupported
      ? 'Restriction sites are not available here: this site supplies no reference sequence.'
      : sequence.loading
        ? 'Checking restriction sites…'
        : sequence.error
          ? 'Reference sequence could not be fetched, so restriction sites are unknown.'
          : [...caps.values()].some((c) => c.unknown === 'window-mismatch')
            ? 'The reference sequence disagrees with the reported alleles, so restriction sites are not shown. The sequence source and the variant source are probably different releases.'
            : null;
  const enzymes = useMemo(() => [...enzymeCounts(caps.values())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), [caps]);

  /**
   * Frequencies for the listed variants, filled in as the batches land. A
   * variant is looked up by its first id; one entered by hand has none and
   * simply carries no figure.
   */
  const frequencyIds = useMemo(() => allRows.map((v) => v.ids[0]).filter((id): id is string => !!id), [allRows]);
  const frequencies = useAlleleFrequencies(p.alleleFrequencies, p.systemName, frequencyIds);
  const populations = useMemo(() => populationCounts(frequencies.byId), [frequencies.byId]);
  const activePopulation = populations.some(([name]) => name === population) ? population : '';
  const rowsOf = (v: VariantEntry) => (v.ids[0] ? frequencies.byId.get(v.ids[0]) : undefined);
  /**
   * The alternate allele's share, and which panel reported it.
   *
   * The panels barely overlap — EVA variants are called in SAP, BAP and
   * Lozano, EMS ones only in the mutant panels — so with no panel chosen each
   * row falls back to the widest panel that has anything to say about it
   * rather than showing a blank that looks like missing data.
   */
  const shareOf = (v: VariantEntry): (AlleleShare & { population: string }) | null => {
    const rows = rowsOf(v);
    if (!rows) return null;
    const allele = variantAllele(v);
    const wanted = activePopulation ? [activePopulation] : populations.map(([name]) => name);
    for (const name of wanted) {
      const share = alleleShare(rows, name, allele);
      if (share) return { ...share, population: name };
    }
    return null;
  };
  const mafOf = (v: VariantEntry): number | null => {
    const rows = rowsOf(v);
    if (!rows) return null;
    const wanted = activePopulation ? [activePopulation] : populations.map(([name]) => name);
    for (const name of wanted) {
      const maf = minorAlleleFrequency(rows, name);
      if (maf !== null) return maf;
    }
    return null;
  };
  const showFrequency = !frequencies.unsupported && populations.length > 0;
  const activeEnzyme = enzymes.some(([e]) => e === enzyme) ? enzyme : '';

  /** Facet values come from the listing, so only choices that match something are offered. */
  const facet = (pick: (v: VariantEntry) => string[]): Array<readonly [string, number]> => {
    const counts = new Map<string, number>();
    for (const v of allRows) for (const key of pick(v)) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const consequences = useMemo(() => facet((v) => (v.consequence ? [v.consequence] : [])), [allRows]);
  const sources = useMemo(() => facet((v) => [...new Set(v.records.map((r) => r.source))]), [allRows]);
  // A new window can retire the chosen value; fall back to "any" rather than showing nothing.
  const activeConsequence = consequences.some(([c]) => c === consequence) ? consequence : '';
  const activeSource = sources.some(([c]) => c === source) ? source : '';
  const anyFilter = !!(search || activeConsequence || activeSource || activeEnzyme || designableOnly || multiallelicOnly || shiftableOnly || capsOnly || polymorphicOnly);

  /**
   * A control earns its place only if it would change what the table shows.
   *
   * Two rules keep this from trapping anyone. A filter that is *currently* on
   * always stays, or there would be no way to turn it back off. And when the
   * listing cannot be trusted to hold everything in the region — truncated, or
   * replaced by an id lookup — nothing is hidden, since absence from the rows
   * would not mean absence from the region.
   */
  const partial = !!list.data?.truncated || !!lookup;
  /** True when a property is on some rows and off others, so filtering by it sorts them. */
  const splits = (pred: (v: VariantEntry) => boolean): boolean => {
    if (!allRows.length) return false;
    let n = 0;
    for (const v of allRows) if (pred(v)) n++;
    return n > 0 && n < allRows.length;
  };

  const kindChecked = (kind: VariantKind) => !filters.types || filters.types.includes(kind);
  /**
   * The kinds are filtered by the server, so unticking one takes its rows out
   * of the listing. Such a kind is kept visible by `!kindChecked` — it is the
   * one the user just switched off, and hiding it would strand them.
   */
  const kindsPresent = useMemo(() => new Set(allRows.map((v) => v.kind)), [allRows]);
  const shownKinds = KINDS.filter((kind) => partial || kindsPresent.has(kind) || !kindChecked(kind));
  const showEms = partial || filters.includeEms === false || allRows.some((v) => v.ems);
  const showDesignable = designableOnly || splits((v) => v.designable);
  const showMultiallelic = multiallelicOnly || splits((v) => !!v.multiallelic);
  const showShiftable = shiftableOnly || splits((v) => typeof v.shift === 'number' && v.shift > 0);
  const showCaps = capsOnly || (!capsUnknown && splits((v) => caps.get(v.key)?.verdict === 'caps'));
  const showPolymorphic =
    polymorphicOnly || (showFrequency && splits((v) => (mafOf(v) ?? -1) >= POLYMORPHIC_MAF));

  const rows = useMemo(() => {
    const kept = allRows.filter((v) => {
      if (designableOnly && !v.designable) return false;
      if (multiallelicOnly && !v.multiallelic) return false;
      if (shiftableOnly && !(typeof v.shift === 'number' && v.shift > 0)) return false;
      if (activeConsequence && v.consequence !== activeConsequence) return false;
      if (activeSource && !v.records.some((r) => r.source === activeSource)) return false;
      if (capsOnly && caps.get(v.key)?.verdict !== 'caps') return false;
      if (polymorphicOnly) {
        const maf = mafOf(v);
        if (maf === null || maf < POLYMORPHIC_MAF) return false;
      }
      if (activeEnzyme) {
        const a = caps.get(v.key);
        const named = (n: string) => n === activeEnzyme;
        if (!a || (!a.sites.some((x) => named(x.enzyme.name)) && !a.dcaps.some((x) => named(x.enzyme.name)))) return false;
      }
      if (!search) return true;
      return v.label.toLowerCase().includes(search) || v.ids.some((i) => i.toLowerCase().includes(search));
    });
    const cmp = compareVariants(sort.key, caps, (v) => shareOf(v)?.frequency ?? null);
    return [...kept].sort((a, b) => {
      // A row with no figure has nothing to compare, so it goes last whichever
      // way the column is sorted rather than leading the ascending view.
      if (sort.key === 'frequency') {
        const fa = shareOf(a)?.frequency ?? null;
        const fb = shareOf(b)?.frequency ?? null;
        if (fa === null && fb !== null) return 1;
        if (fb === null && fa !== null) return -1;
      }
      return sort.dir * cmp(a, b);
    });
  }, [allRows, search, designableOnly, multiallelicOnly, shiftableOnly, capsOnly, polymorphicOnly, activeConsequence, activeSource, activeEnzyme, caps, frequencies.byId, activePopulation, sort]);

  const clearFilters = () => {
    setConsequence('');
    setSource('');
    setDesignableOnly(false);
    setMultiallelicOnly(false);
    setShiftableOnly(false);
    setCapsOnly(false);
    setEnzyme('');
    setPolymorphicOnly(false);
    setPopulation('');
    p.onFilters({ ...filters, query: undefined });
  };

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

          {shownKinds.length || showEms ? (
            <fieldset className="gpr-fieldset gpr-variant-filters" disabled={p.disabled}>
              <legend className="gpr-legend gpr-legend-small">Filters</legend>
              {shownKinds.length ? (
                <div className="gpr-variant-kinds">
                  {shownKinds.map((kind) => (
                    <CheckboxField
                      key={kind}
                      id={`${idp}-kind-${kind}`}
                      label={kind}
                      description={KIND_HELP[kind]}
                      checked={kindChecked(kind)}
                      onChange={(on) => toggleKind(kind, on)}
                    />
                  ))}
                </div>
              ) : null}
              {showEms ? (
                <CheckboxField
                  id={`${idp}-ems`}
                  label="Include EMS mutations"
                  checked={filters.includeEms !== false}
                  hint="EMS mutations are private to one mutant line."
                  onChange={(on) => p.onFilters({ ...filters, includeEms: on ? undefined : false })}
                />
              ) : null}
            </fieldset>
          ) : null}

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

          {windowValid && window && !lookup ? (
            <VariantBrowser
              region={window.region}
              window={{ start: window.start, end: window.end }}
              systemName={p.systemName}
              genesInRegion={p.genesInRegion}
              caps={caps}
              variants={rows}
              selectedKey={p.state.variantKey ?? null}
              disabled={p.disabled}
              maxWindow={GENOTYPING_LIMITS.maxWindow}
              onSelect={(v) => p.onSelect({ variantKey: v.key, variantId: v.ids[0], alt: v.vcf.alt })}
              onUseRegion={(start, end) => p.onWindow({ region: window.region, start, end })}
            />
          ) : null}

          {list.loading ? <p className="gpr-hint">Looking for variants…</p> : null}

          {!list.loading && !allRows.length ? (
            <p className="gpr-hint">{windowValid ? 'No variants in this window.' : 'Choose a window to list variants.'}</p>
          ) : null}

          {allRows.length ? (
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
                {/* One option is no choice at all, so the menu only appears
                    once there is something to pick between. */}
                {consequences.length > 1 || activeConsequence ? (
                  <FacetSelect
                    id={`${idp}-consequence`}
                    label="Consequence"
                    anyLabel="Any consequence"
                    value={activeConsequence}
                    options={consequences}
                    disabled={p.disabled}
                    onChange={setConsequence}
                  />
                ) : null}
                {sources.length > 1 || activeSource ? (
                  <FacetSelect
                    id={`${idp}-source`}
                    label="Source"
                    anyLabel="Any source"
                    value={activeSource}
                    options={sources}
                    disabled={p.disabled}
                    onChange={setSource}
                  />
                ) : null}
                {populations.length > 1 || activePopulation ? (
                  <FacetSelect
                    id={`${idp}-population`}
                    label="Panel"
                    anyLabel="Any panel"
                    value={activePopulation}
                    options={populations}
                    disabled={p.disabled}
                    onChange={setPopulation}
                  />
                ) : null}
                {enzymes.length > 1 || activeEnzyme ? (
                  <FacetSelect
                    id={`${idp}-enzyme`}
                    label="Enzyme"
                    anyLabel="Any enzyme"
                    value={activeEnzyme}
                    options={enzymes}
                    disabled={p.disabled || capsUnknown}
                    onChange={setEnzyme}
                  />
                ) : null}
              </div>
              <div className="gpr-variant-toolbar">
                {showDesignable ? (
                  <CheckboxField id={`${idp}-designable`} label="Designable only" checked={designableOnly} onChange={setDesignableOnly} />
                ) : null}
                {showMultiallelic ? (
                  <CheckboxField id={`${idp}-multiallelic`} label="Multi-allelic only" checked={multiallelicOnly} onChange={setMultiallelicOnly} />
                ) : null}
                {showShiftable ? (
                  <CheckboxField id={`${idp}-shiftable`} label="Can slide" checked={shiftableOnly} onChange={setShiftableOnly} />
                ) : null}
                {showPolymorphic ? (
                  <CheckboxField
                    id={`${idp}-polymorphic`}
                    label="Polymorphic only"
                    description={`Hides variants whose minor allele is carried by fewer than ${Math.round(POLYMORPHIC_MAF * 100)}% of the chosen panel, which are too rare to screen for.`}
                    checked={polymorphicOnly}
                    onChange={setPolymorphicOnly}
                  />
                ) : null}
                {showCaps ? (
                  <CheckboxField
                    id={`${idp}-caps`}
                    label="CAPS-able only"
                    checked={capsOnly}
                    disabled={p.disabled || capsUnknown}
                    onChange={setCapsOnly}
                  />
                ) : null}
                <span className="gpr-sub">
                  {fmtInt(rows.length)} of {fmtInt(allRows.length)} variant{allRows.length === 1 ? '' : 's'}
                </span>
                {anyFilter ? (
                  <button type="button" className="gpr-btn gpr-btn-small gpr-btn-quiet" onClick={clearFilters}>
                    Clear filters
                  </button>
                ) : null}
              </div>
              {capsNote ? <p className="gpr-sub gpr-caps-note">{capsNote}</p> : null}
              {showFrequency && frequencies.capped ? (
                <p className="gpr-sub gpr-caps-note">
                  Frequencies were looked up for the first {fmtInt(MAX_ANNOTATED)} variants; narrow the window to cover
                  the rest.
                </p>
              ) : null}
              {rows.length ? (
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
                      {VARIANT_COLUMNS.filter((c) => c.key !== 'frequency' || showFrequency).map((c) => (
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
                          {showFrequency ? (
                            <td className="gpr-num">
                              <FrequencyCell share={shareOf(v)} pending={frequencies.loading && !rowsOf(v)} named={!activePopulation} />
                            </td>
                          ) : null}
                          <td>
                            <CapsCell annotation={caps.get(v.key)} />
                          </td>
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
              ) : (
                <p className="gpr-hint">No variants match these filters.</p>
              )}
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
