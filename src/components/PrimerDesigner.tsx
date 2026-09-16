import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPrimersClient } from '../client';
import { isPrimersApiError } from '../errors';
import { ampliconsToFasta, offTargetsToTSV, pairsToTSV, pangenomeToTSV, primersToFasta } from '../exporters';
import { isTranscriptModelsOnly } from '../pangenome';
import { availableGenomeNames, buildCheckRequest, buildDesignRequest, defaultPangenomeGenomes, isCheckablePair } from '../request';
import { pairKey, submittedPairs } from '../results';
import { availableModes, designerIdentity, designModeOf, initialDesignerState, type DesignerContext } from '../state';
import type {
  CheckJob,
  CheckRequest,
  DesignerMode,
  DesignMode,
  DesignRequest,
  DesignResponse,
  PrimerDesignerProps,
  PrimerDesignerState,
  ResultsTab,
} from '../types';
import { cleanSequenceInput, GENOTYPING_LIMITS, type ValidationIssue } from '../validate';
import { CheckPanel } from './CheckPanel';
import { analyzeDesignInputs, PREVIEW_IGNORED_PARAM_CODES, restoreBlockers } from './designChecks';
import { ErrorBanner, isDisablingError } from './ErrorBanner';
import { ExplainPanel } from './ExplainPanel';
import { ExportMenu, type ExportItem } from './ExportMenu';
import { TabList, tabDomId, type TabItem } from './fields';
import { GenotypingPanel } from './GenotypingPanel';
import { useLiveRegions } from './hooks/announcer';
import { useCheckJob } from './hooks/useCheckJob';
import { useDesign, type DesignMeta } from './hooks/useDesign';
import { useDesignerState } from './hooks/useDesignerState';
import { useGeneDoc, useGenomes } from './hooks/useResources';
import { templateVariantsNote, useTemplateVariants } from './hooks/useTemplateVariants';
import { GeneInputs } from './inputs/GeneInputs';
import { RegionInputs } from './inputs/RegionInputs';
import { SequenceInputs } from './inputs/SequenceInputs';
import { isSingleExon, TranscriptInputs } from './inputs/TranscriptInputs';
import { IntervalsEditor } from './IntervalsEditor';
import { ModeTabs } from './ModeTabs';
import { PairsTable } from './PairsTable';
import { PangenomeMatrix } from './PangenomeMatrix';
import { ParamsPanel } from './ParamsPanel';
import { Primer3Credit } from './Primer3Help';
import { MASK_SOURCE_LABELS, RepeatOptions } from './RepeatOptions';
import { RootMarker, themeClass, useStyleInjection } from './Root';
import { SpecificityResults } from './SpecificityResults';
import { Splitter } from './Splitter';
import { TemplateMap } from './TemplateMap';
import { cx, fmtInt, fmtPercent, sameJson, useIdPrefix } from './util';
import { Warnings } from './Warnings';

/** The design request for a state (single-exon transcripts never ask for junction spanning). */
export function designRequestFor(state: PrimerDesignerState, ctx: DesignerContext, templateOnly: boolean): DesignRequest {
  const eff = state.mode === 'transcript' && isSingleExon(ctx.gene ?? null, state.transcriptId) ? { ...state, junctionSpanning: false } : state;
  return buildDesignRequest(eff, {
    gene: ctx.gene,
    geneId: ctx.geneId,
    systemName: ctx.systemName,
    region: ctx.region,
    sequence: ctx.sequence,
    templateOnly,
  });
}

function requestKey(req: DesignRequest | null | undefined): string {
  if (!req) return '';
  const { template_only: _ignored, ...rest } = req;
  return JSON.stringify(rest);
}

/**
 * Embeddable primer designer (spec §C.2–C.5): mode tabs and inputs on the
 * left; warnings, errors, template map, result tabs, checks and exports on
 * the right. Controlled with `state`/`onStateChange`, uncontrolled otherwise.
 */
export function PrimerDesigner(props: PrimerDesignerProps): JSX.Element {
  const persistSequence = props.persistSequence !== false;
  const features = {
    check: props.features?.check !== false,
    pangenome: props.features?.pangenome !== false,
    export: props.features?.export !== false,
    map: props.features?.map !== false,
    genotyping: props.features?.genotyping !== false,
  };
  useStyleInjection(props.injectStyles !== false);
  const idp = useIdPrefix('gpr');
  const client = useMemo(() => props.client ?? createPrimersClient({ apiBase: props.apiBase }), [props.client, props.apiBase]);

  const geneDoc = useGeneDoc(client, props.gene ?? null, props.geneId ?? null);
  const geneId = props.gene?._id ?? props.geneId ?? null;
  const ctx: DesignerContext = {
    gene: geneDoc,
    geneId,
    systemName: props.systemName ?? null,
    region: props.region ?? null,
    sequence: props.sequence ?? null,
    modes: props.modes ?? null,
    defaultMode: props.defaultMode ?? null,
    defaultParams: props.defaultParams ?? null,
    persistSequence,
  };
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const identity = designerIdentity({ gene: props.gene ?? null, geneId, systemName: props.systemName, region: props.region, sequence: props.sequence });
  const { state, dispatch, replace, getState } = useDesignerState({ stateProp: props.state, onStateChange: props.onStateChange, persistSequence, ctx, identity });
  const { announce, regions, Provider: AnnounceProvider } = useLiveRegions();
  const propsRef = useRef(props);
  propsRef.current = props;

  // ---- design ---------------------------------------------------------------
  const design = useDesign(client, {
    onError: (e) => propsRef.current.onError?.(e),
    onSuccess: (res, req, meta, previous) => onDesignSuccess(res, req, meta, previous),
  });
  const lastMeta = useRef<DesignMeta>({ templateOnly: false, userInitiated: true });
  const runDesign = useCallback(
    (s: PrimerDesignerState, meta: DesignMeta) => {
      lastMeta.current = meta;
      void design.run(designRequestFor(s, ctxRef.current, meta.templateOnly), meta);
    },
    [design.run],
  );

  const onDesignSuccess = (res: DesignResponse, req: DesignRequest, meta: DesignMeta, previous: DesignResponse | null) => {
    if (meta.templateOnly) {
      announce(`Template ready: ${fmtInt(res.template.length)} bp.`);
      propsRef.current.onDesign?.(res, req);
      return;
    }
    const s = getState();
    const pairs = res.pairs ?? [];
    const noPairs = pairs.length === 0 || (res.warnings ?? []).some((w) => w.code === 'NO_PAIRS');
    const byRank = new Map(pairs.map((p) => [p.rank, p]));
    let checkedRanks = s.checkedRanks ?? [];
    let selectedRank = s.selectedRank;
    if (meta.userInitiated && previous) {
      // Keep selections that still point at the same primer sequences.
      const prev = new Map(previous.pairs.map((p) => [p.rank, pairKey(p.left.seq, p.right.seq)]));
      const rankByKey = new Map(pairs.map((p) => [pairKey(p.left.seq, p.right.seq), p.rank]));
      const remap = (r: number) => {
        const key = prev.get(r);
        return key ? rankByKey.get(key) : undefined;
      };
      checkedRanks = checkedRanks.map(remap).filter((r): r is number => r !== undefined);
      selectedRank = selectedRank !== undefined ? remap(selectedRank) : undefined;
    }
    checkedRanks = checkedRanks.filter((r) => {
      const p = byRank.get(r);
      return !!p && isCheckablePair(p);
    });
    if (selectedRank !== undefined && !byRank.has(selectedRank)) selectedRank = undefined;
    dispatch({ type: 'designDone', templateOnly: false, noPairs, checkedRanks, selectedRank });
    announce(noPairs ? 'No primer pairs were found; see “Why no primer pairs?”.' : `Designed ${pairs.length} primer pair${pairs.length === 1 ? '' : 's'}.`);
    propsRef.current.onDesign?.(res, req);
  };

  // ---- check ----------------------------------------------------------------
  const lastJobStatus = useRef<string | null>(null);
  const check = useCheckJob(client, {
    poll: props.poll,
    onError: (e) => propsRef.current.onError?.(e),
    onJobId: (jobId, request) => dispatch({ type: 'checkJob', jobId, submitted: request ? submittedPairs(request) : undefined }),
    onUpdate: (job: CheckJob) => {
      propsRef.current.onCheckUpdate?.(job);
      if (job.status === lastJobStatus.current) return;
      lastJobStatus.current = job.status;
      if (job.status === 'queued') announce('Check queued.');
      else if (job.status === 'running') announce('Check running.');
      else if (job.status === 'done') announce('Check finished.');
      else if (job.status === 'error') announce(`Check failed${job.error?.message ? `: ${job.error.message}` : ''}.`, 'assertive');
    },
  });
  useEffect(() => {
    if (check.state.status === 'expired') announce('The saved check results have expired.', 'assertive');
  }, [check.state.status, announce]);

  // ---- identity change and restore (spec §C.4) --------------------------------
  const [inputIssues, setInputIssues] = useState<Record<string, ValidationIssue[]>>({});
  const lastIdentity = useRef<string | null>(null);
  const lastStateProp = useRef(props.state);
  useEffect(() => {
    const prev = lastIdentity.current;
    lastIdentity.current = identity;
    const changed = prev !== null && prev !== identity;
    let source: PrimerDesignerState | null = getState();
    if (changed) {
      design.reset();
      check.reset();
      lastJobStatus.current = null;
      const hostSentNewState = props.state !== undefined && props.state !== lastStateProp.current;
      if (!hostSentNewState) {
        replace(initialDesignerState({ ...ctxRef.current, persistSequence: true }), true);
        source = null;
      }
    }
    // Re-run a saved design only when the Design button would allow it: e.g. with persistSequence={false}
    // a restored sequence-mode state has no sequence, and sending it would only produce an error banner.
    if (source?.designed) {
      const c = ctxRef.current;
      const blockers = restoreBlockers(source, { gene: c.gene ?? null, geneId: c.geneId ?? null, systemName: c.systemName, sequence: c.sequence });
      if (blockers.length === 0) runDesign(source, { templateOnly: false, userInitiated: false });
    }
    if (source?.check?.jobId) void check.restore(source.check.jobId);
    return () => {
      design.abort();
      check.stop();
    };
    // Only identity changes (and mount/unmount) reset and restore.
  }, [identity]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    lastStateProp.current = props.state;
  });

  // ---- genomes --------------------------------------------------------------
  const response = design.state.response;
  const template = response?.template ?? null;
  const homeSystem = props.systemName ?? geneDoc?.system_name ?? template?.system_name ?? null;
  const genomes = useGenomes(client, homeSystem);
  const genomeList = genomes.data?.genomes ?? null;

  // ---- validation -------------------------------------------------------------
  const cleaned = useMemo(() => cleanSequenceInput(state.sequence ?? ''), [state.sequence]);
  const analysis = analyzeDesignInputs(state, { gene: geneDoc, geneId, systemName: props.systemName ?? null, sequence: props.sequence ?? null }, cleaned);
  const { templateLength, preset, effective, paramIssues, tooLong } = analysis;
  const reportRegion = useCallback((list: ValidationIssue[]) => setInputIssues((prev) => (sameJson(prev.region ?? [], list) ? prev : { ...prev, region: list })), []);
  const reportIntervals = useCallback((list: ValidationIssue[]) => setInputIssues((prev) => (sameJson(prev.intervals ?? [], list) ? prev : { ...prev, intervals: list })), []);

  const inputBlocking = [...(state.mode === 'region' ? inputIssues.region ?? [] : []).map((i) => i.message), ...(inputIssues.intervals ?? []).map((i) => i.message)];
  const uniqueBlocking = [...new Set([...analysis.modeIssues, ...inputBlocking, ...paramIssues.map((i) => i.message)])];
  // Preview template (template_only) is not checked against the product size ranges on the server.
  const previewBlocking = [...new Set([...analysis.modeIssues, ...inputBlocking, ...paramIssues.filter((i) => !PREVIEW_IGNORED_PARAM_CODES.has(i.code)).map((i) => i.message)])];

  const running = design.state.status === 'running';
  const designError = design.state.status === 'error' ? design.state.error : null;
  const formDisabled = isDisablingError(designError);
  const canDesign = !running && !formDisabled && uniqueBlocking.length === 0;
  const canPreview = !running && !formDisabled && previewBlocking.length === 0;

  const currentKey = useMemo(() => {
    try {
      return requestKey(designRequestFor(state, ctx, false));
    } catch {
      return '';
    }
    // ctx is summarized by the state, the gene doc and identity
  }, [state, geneDoc, identity]); // eslint-disable-line react-hooks/exhaustive-deps
  const stale = !!design.state.responseRequest && requestKey(design.state.responseRequest) !== currentKey;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canDesign) return;
    runDesign(getState(), { templateOnly: false, userInitiated: true });
  };

  // ---- results ----------------------------------------------------------------
  const pairs = response?.pairs ?? [];
  /**
   * Variants inside the designed template, so an ordinary pair can be checked
   * for a CAPS assay. Degrades quietly: a pasted sequence has no coordinates,
   * and a genome without variation data simply has none to find.
   */
  const templateVariants = useTemplateVariants(client, template, pairs, {
    variationAvailable: !!genomes.data?.variation?.available && genomeList?.find((g) => g.system_name === template?.system_name)?.has_variation !== false,
    enzymes: props.enzymes,
  });
  const variantsNote = templateVariantsNote(templateVariants.reason);
  const templateOnlyResponse = !!design.state.responseMeta?.templateOnly;
  const noPairs = !!response && !templateOnlyResponse && (pairs.length === 0 || (response.warnings ?? []).some((w) => w.code === 'NO_PAIRS'));
  const job = check.state.job;
  const results = job?.results ?? null;
  const checkRequest: CheckRequest | null = job?.request ?? check.state.request ?? null;
  const submitted = state.check?.submitted ?? null;
  // A check never runs in genotyping mode from here; the genotyping panel builds its own request.
  const checkMode: DesignMode = template?.mode ?? designModeOf(state.mode);
  const checkSystem = checkMode === 'sequence' ? state.systemName ?? template?.system_name ?? null : template?.system_name ?? geneDoc?.system_name ?? state.systemName ?? null;
  const checkGeneId = template?.gene_id ?? geneId;
  const checkTranscriptId = template?.transcript_id ?? null;
  const pangenomeAllowed = features.pangenome && (genomes.data?.counts?.total ?? 0) > 1;
  const checkForMatching = job ? { request: job.request ?? (submitted && checkSystem ? { system_name: checkSystem, pairs: submitted } : undefined), results: job.results, status: job.status } : null;
  const transcriptModelsOnly = !!job && (isTranscriptModelsOnly(job) || (checkRequest?.mode === 'transcript' && !!checkRequest.checks?.includes('pangenome')));

  const tabs: TabItem<ResultsTab>[] = [{ id: 'pairs', label: `Pairs (${pairs.length})` }];
  if (job) {
    tabs.push({ id: 'specificity', label: 'Specificity' });
    if (results?.transcriptome || checkRequest?.mode === 'transcript') tabs.push({ id: 'transcriptome', label: 'Transcriptome' });
    if (results?.pangenome || job.kind === 'pangenome' || checkRequest?.checks?.includes('pangenome')) {
      tabs.push({ id: 'pangenome', label: transcriptModelsOnly ? 'Pan-genome (annotated transcripts)' : 'Pan-genome' });
    }
  }
  const savedTab = state.view?.resultsTab ?? 'pairs';
  const activeTab: ResultsTab = tabs.some((t) => t.id === savedTab) ? savedTab : 'pairs';
  const requestedGenomes =
    checkRequest?.genomes ??
    (checkRequest?.checks?.includes('pangenome') && genomes.data ? defaultPangenomeGenomes(genomes.data, checkRequest.mode ?? checkMode, checkRequest.system_name) : null);

  const rerunRequest = (): CheckRequest | null => {
    if (check.state.request) return check.state.request;
    const s = getState();
    const checked = pairs.filter((p) => (s.checkedRanks ?? []).includes(p.rank));
    const wantPangenome = pangenomeAllowed && !!s.check?.checks?.includes('pangenome');
    if (checked.length) {
      try {
        return buildCheckRequest({
          mode: checkMode,
          systemName: checkSystem,
          geneId: checkGeneId,
          transcriptId: checkTranscriptId,
          pairs: checked,
          checks: wantPangenome ? ['specificity', 'pangenome'] : ['specificity'],
          genomes: wantPangenome ? s.check?.genomes ?? null : null,
          allGenomes: genomes.data,
          params: s.check?.params,
        });
      } catch {
        // fall back to the submitted list
      }
    }
    const sent = s.check?.submitted;
    if (!sent?.length || !checkSystem) return null;
    const req: CheckRequest = { system_name: checkSystem, mode: checkMode, checks: wantPangenome ? ['specificity', 'pangenome'] : ['specificity'], pairs: sent };
    if (checkGeneId && (checkMode === 'gene' || checkMode === 'transcript')) req.gene_id = checkGeneId;
    if (checkMode === 'transcript' && checkTranscriptId) req.transcript_id = checkTranscriptId;
    if (wantPangenome && s.check?.genomes) {
      // Never resend genomes this mode cannot search (the server would reject the whole request).
      const avail = availableGenomeNames(genomes.data, checkMode, checkSystem);
      const list = avail ? s.check.genomes.filter((g) => avail.includes(g)) : s.check.genomes;
      if (!list.length) return null;
      req.genomes = list;
    }
    return req;
  };
  const submitCheck = (req: CheckRequest) => {
    lastJobStatus.current = null;
    void check.submit(req);
  };

  const exportLabel = props.geneLabel ?? geneDoc?.name ?? geneId ?? template?.gene_id ?? template?.system_name ?? 'primers';
  const fileBase = String(exportLabel).replace(/[^A-Za-z0-9_.-]+/g, '_') || 'primers';
  const exportItems: ExportItem[] = pairs.length
    ? [
        { id: 'pairs-tsv', label: 'Primer pairs (TSV)', filename: `${fileBase}_primer_pairs.tsv`, mime: 'text/tab-separated-values;charset=utf-8', build: () => pairsToTSV(pairs, { check: checkForMatching }) },
        { id: 'primers-fasta', label: 'Primers (FASTA)', filename: `${fileBase}_primers.fasta`, build: () => primersToFasta(pairs, { label: exportLabel }) },
        { id: 'amplicons-fasta', label: 'Amplicons (FASTA)', filename: `${fileBase}_amplicons.fasta`, build: () => ampliconsToFasta(pairs, template, { label: exportLabel }) },
        ...(results?.specificity || results?.transcriptome
          ? [{ id: 'offtargets-tsv', label: 'Off-target products (TSV)', filename: `${fileBase}_off_targets.tsv`, mime: 'text/tab-separated-values;charset=utf-8', build: () => offTargetsToTSV(results) }]
          : []),
        ...(results?.pangenome
          ? [{ id: 'pangenome-tsv', label: 'Pan-genome coverage (TSV)', filename: `${fileBase}_pangenome.tsv`, mime: 'text/tab-separated-values;charset=utf-8', build: () => pangenomeToTSV(results) }]
          : []),
      ]
    : [];

  const templateSystem = state.mode === 'region' ? state.systemName ?? null : state.mode === 'sequence' ? null : geneDoc?.system_name ?? props.systemName ?? null;
  const templateGenome = genomeList?.find((g) => g.system_name === templateSystem) ?? null;
  const modeDisabled: Partial<Record<DesignerMode, string>> = tooLong ? { gene: 'the gene is longer than 50,000 bp — use Transcript or Region.' } : {};
  // A host can turn the mode off even when the inputs would allow it.
  const modes = availableModes(ctx).filter((m) => m !== 'genotyping' || features.genotyping);
  const inputsPanelId = `${idp}-inputs`;
  const issuesId = `${idp}-issues`;
  const mapIntervals = template && template.mode === state.mode ? { target: state.target, included: state.included, excluded: state.excluded } : {};
  // The variant listing defaults to the gene span ± 2 kb, clamped to the window the server will list.
  // The padding is symmetric, so strand does not come into it.
  const genotypingWindow = geneDoc?.location
    ? (() => {
        const pad = 2000;
        const start = Math.max(1, geneDoc.location.start - pad);
        return { region: geneDoc.location.region, start, end: Math.min(geneDoc.location.end + pad, start + GENOTYPING_LIMITS.maxWindow - 1) };
      })()
    : undefined;

  let tabContent: JSX.Element | null = null;
  if (activeTab === 'pairs') {
    tabContent = (
      <PairsTable
        pairs={pairs}
        template={template}
        checkedRanks={state.checkedRanks ?? []}
        onCheckedChange={features.check ? (ranks) => dispatch({ type: 'setCheckedRanks', ranks }) : undefined}
        selectedRank={state.selectedRank ?? null}
        onSelect={(rank) => dispatch({ type: 'select', rank: state.selectedRank === rank ? undefined : rank })}
        check={checkForMatching}
        submitted={submitted}
        label={exportLabel}
        variants={templateVariants.variants}
        enzymes={props.enzymes}
        variantsUnavailable={variantsNote}
      />
    );
  } else if (activeTab === 'specificity' || activeTab === 'transcriptome') {
    tabContent = (
      <SpecificityResults
        results={results}
        block={activeTab === 'specificity' ? 'genome' : 'transcriptome'}
        pairs={pairs}
        job={job ? { request: checkRequest ?? undefined, status: job.status, partial: job.partial } : null}
        submitted={submitted}
        systemName={checkSystem}
        geneHref={props.geneHref}
        onGeneClick={props.onGeneClick}
      />
    );
  } else if (activeTab === 'pangenome') {
    tabContent = (
      <PangenomeMatrix
        results={results?.pangenome}
        requestedGenomes={requestedGenomes}
        genomes={genomeList}
        transcriptModelsOnly={transcriptModelsOnly}
        params={results?.params ?? null}
        geneHref={props.geneHref}
        onGeneClick={props.onGeneClick}
      />
    );
  }

  let designBanner: JSX.Element | null = null;
  if (design.state.busy) {
    designBanner = <ErrorBanner error={null} busy={design.state.busy} context="design" onCancel={design.cancel} />;
  } else if (designError) {
    designBanner = (
      <ErrorBanner
        error={designError}
        context="design"
        onRetry={design.state.request ? () => void design.run(design.state.request!, lastMeta.current) : undefined}
        onDismiss={formDisabled ? undefined : design.clearError}
      />
    );
  }

  return (
    <AnnounceProvider value={announce}>
      <RootMarker>
        <div className={cx('gpr-root', themeClass(props.theme), props.className)} style={props.style} data-mode={state.mode}>
          {regions}
          <div className="gpr-designer">
            <div className="gpr-header">
              <ModeTabs modes={modes} value={state.mode} onChange={(mode) => dispatch({ type: 'setMode', mode })} disabled={modeDisabled} idPrefix={idp} panelId={inputsPanelId} />
            </div>
            {state.mode === 'genotyping' ? (
              <div
                className="gpr-layout gpr-layout-genotyping"
                role="tabpanel"
                id={inputsPanelId}
                aria-labelledby={tabDomId(`${idp}-mode`, state.mode)}
              >
                <GenotypingPanel
                  client={client}
                  state={state}
                  dispatch={dispatch}
                  systemName={homeSystem}
                  genomes={genomes.data}
                  defaultWindow={genotypingWindow}
                  geneId={geneId}
                  genesInRegion={props.genesInRegion}
                  sequenceForRegion={props.sequenceForRegion}
                  enzymes={props.enzymes}
                  pangenomeFeature={features.pangenome}
                  exportFeature={features.export}
                  disabled={formDisabled}
                  idPrefix={idp}
                />
              </div>
            ) : (
            <div className="gpr-layout">
              <div className="gpr-inputs" role="tabpanel" id={inputsPanelId} aria-labelledby={tabDomId(`${idp}-mode`, state.mode)}>
                <form className="gpr-form" onSubmit={onSubmit} noValidate>
                  <fieldset className="gpr-form-fieldset" disabled={formDisabled}>
                    <legend className="gpr-visually-hidden">Design inputs</legend>
                    {state.mode === 'gene' ? (
                      <GeneInputs
                        idPrefix={idp}
                        gene={geneDoc}
                        geneId={geneId}
                        geneLabel={props.geneLabel}
                        transcriptId={state.transcriptId}
                        flankUp={state.flankUp ?? 0}
                        flankDown={state.flankDown ?? 0}
                        onTranscript={(transcriptId) => dispatch({ type: 'setTranscript', transcriptId })}
                        onFlanks={(f) => dispatch({ type: 'setFlanks', ...f })}
                      />
                    ) : null}
                    {state.mode === 'transcript' ? (
                      <TranscriptInputs
                        idPrefix={idp}
                        gene={geneDoc}
                        transcriptId={state.transcriptId}
                        junctionSpanning={state.junctionSpanning !== false}
                        included={state.included}
                        overlaps={{ min5: effective.min_5_prime_overlap_of_junction ?? 7, min3: effective.min_3_prime_overlap_of_junction ?? 4 }}
                        onTranscript={(transcriptId) => dispatch({ type: 'setTranscript', transcriptId })}
                        onJunctionSpanning={(value) => dispatch({ type: 'setJunctionSpanning', value })}
                        onIncluded={(included) => dispatch({ type: 'setIncluded', included })}
                      />
                    ) : null}
                    {state.mode === 'region' ? (
                      <RegionInputs
                        idPrefix={idp}
                        region={state.region}
                        systemName={state.systemName}
                        genomes={genomeList}
                        gene={geneDoc}
                        onRegion={(region) => dispatch({ type: 'setRegion', region })}
                        onSystemName={(systemName) => dispatch({ type: 'setSystemName', systemName })}
                        onIssues={reportRegion}
                      />
                    ) : null}
                    {state.mode === 'sequence' ? (
                      <SequenceInputs
                        idPrefix={idp}
                        sequence={state.sequence ?? ''}
                        cleaned={cleaned}
                        systemName={state.systemName}
                        genomes={genomeList}
                        onSequence={(sequence) => dispatch({ type: 'setSequence', sequence })}
                        onSystemName={(systemName) => dispatch({ type: 'setSystemName', systemName })}
                      />
                    ) : null}
                    <RepeatOptions
                      idPrefix={idp}
                      mode={designModeOf(state.mode)}
                      avoidRepeats={!!state.avoidRepeats}
                      repeatMaskMode={state.repeatMaskMode ?? 'n_mask'}
                      onChange={(c) => dispatch({ type: 'setRepeats', ...c })}
                      genome={templateGenome}
                      template={template}
                      hasLowercase={state.mode === 'sequence' && cleaned.hasLowercase}
                    />
                    <IntervalsEditor
                      idPrefix={idp}
                      target={state.target}
                      included={state.included}
                      excluded={state.excluded}
                      templateLength={templateLength}
                      onIssues={reportIntervals}
                      onChange={(v) => dispatch({ type: 'setIntervals', target: v.target, included: v.included, excluded: v.excluded })}
                    />
                    <ParamsPanel
                      idPrefix={idp}
                      mode={designModeOf(state.mode)}
                      preset={preset}
                      params={state.params}
                      onPreset={(p) => dispatch({ type: 'setPreset', preset: p })}
                      onParam={(key, value) => dispatch({ type: 'setParam', key, value })}
                      onReset={() => dispatch({ type: 'resetParams' })}
                      settings={response?.settings ?? null}
                      lastRequest={design.state.responseRequest}
                      issues={paramIssues}
                    />
                    <div className="gpr-actions">
                      <button
                        type={running ? 'button' : 'submit'}
                        className="gpr-btn gpr-btn-primary"
                        disabled={!running && !canDesign}
                        aria-describedby={!running && uniqueBlocking.length ? issuesId : undefined}
                        onClick={running ? () => design.cancel() : undefined}
                      >
                        {running ? 'Cancel' : 'Design primers'}
                      </button>
                      <button
                        type="button"
                        className="gpr-btn"
                        disabled={running || !canPreview}
                        onClick={() => runDesign(getState(), { templateOnly: true, userInitiated: true })}
                      >
                        Preview template
                      </button>
                    </div>
                    {uniqueBlocking.length ? (
                      <ul id={issuesId} className="gpr-issues">
                        {uniqueBlocking.slice(0, 6).map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    ) : null}
                  </fieldset>
                </form>
              </div>
              <Splitter controls={inputsPanelId} width={state.view?.formWidth} onChange={(width) => dispatch({ type: 'setFormWidth', width })} />
              <section className="gpr-results" aria-labelledby={`${idp}-results-h`} aria-busy={running ? true : undefined}>
                <h3 className="gpr-visually-hidden" id={`${idp}-results-h`}>
                  Results
                </h3>
                {response ? <Warnings warnings={response.warnings} /> : null}
                {designBanner}
                {!response && !running && !designError ? (
                  <p className="gpr-empty">
                    Choose the inputs and press <strong>Design primers</strong>.
                  </p>
                ) : null}
                {running ? <p className="gpr-status-line">{design.state.request?.template_only ? 'Building the template…' : 'Designing primers…'}</p> : null}
                {response && template ? (
                  <>
                    {stale && !running ? (
                      <p className="gpr-note" role="note">
                        The inputs have changed since these results were designed.
                      </p>
                    ) : null}
                    {features.map ? (
                      <TemplateMap
                        template={template}
                        pairs={pairs}
                        selectedRank={state.selectedRank ?? null}
                        onSelect={(rank) => dispatch({ type: 'select', rank: state.selectedRank === rank ? undefined : rank })}
                        target={mapIntervals.target}
                        included={mapIntervals.included}
                        excluded={mapIntervals.excluded}
                        variants={templateVariants.variants.map((v) => ({
                          key: v.key,
                          label: v.label,
                          position: v.variant.position,
                          consequence: v.consequence,
                          caps: v.caps,
                          capsEnzyme: v.capsEnzyme,
                        }))}
                      />
                    ) : null}
                    {templateOnlyResponse ? (
                      <p className="gpr-readout">
                        Template preview: {fmtInt(template.length)} bp
                        {template.mask_source ? `, ${fmtPercent(template.masked_fraction ?? 0)} masked (${MASK_SOURCE_LABELS[template.mask_source]})` : ''}. Press Design primers to pick primers.
                      </p>
                    ) : (
                      <ExplainPanel
                        explain={response.explain}
                        open={!!state.view?.explainOpen}
                        onToggle={(open) => dispatch({ type: 'setExplainOpen', open })}
                        noPairs={noPairs}
                        idPrefix={idp}
                      />
                    )}
                    {pairs.length ? (
                      <div className="gpr-result-tabs">
                        <TabList items={tabs} value={activeTab} onChange={(tab) => dispatch({ type: 'setTab', tab })} label="Results" idPrefix={`${idp}-results`} panelId={`${idp}-results-panel`} />
                        <div className="gpr-tabpanel" role="tabpanel" id={`${idp}-results-panel`} aria-labelledby={tabDomId(`${idp}-results`, activeTab)}>
                          {tabContent}
                        </div>
                      </div>
                    ) : null}
                    {!templateOnlyResponse ? <Primer3Credit version={response.engine?.primer3} /> : null}
                  </>
                ) : null}
                {features.check && (pairs.length > 0 || check.state.status !== 'idle') ? (
                  <CheckPanel
                    idPrefix={idp}
                    mode={checkMode}
                    systemName={checkSystem}
                    geneId={checkGeneId}
                    transcriptId={checkTranscriptId}
                    pairs={pairs}
                    checkedRanks={state.checkedRanks ?? []}
                    checkState={state.check ?? { checks: ['specificity'] }}
                    genomes={genomes.data}
                    pangenomeFeature={features.pangenome}
                    run={check.state}
                    disabled={check.state.status === 'error' && isPrimersApiError(check.state.error) && check.state.error.code === 'FEATURE_DISABLED'}
                    onPangenome={(enabled) => dispatch({ type: 'setPangenome', enabled })}
                    onGenomes={(list) => dispatch({ type: 'setGenomes', genomes: list })}
                    onParam={(key, value) => dispatch({ type: 'setCheckParam', key, value })}
                    onSubmit={submitCheck}
                    onDetach={check.detach}
                    onResume={() => {
                      const id = job?.job_id ?? state.check?.jobId;
                      if (id) void check.restore(id, check.state.request, check.state.startedHere);
                    }}
                    onRerun={() => {
                      const req = rerunRequest();
                      if (req) submitCheck(req);
                    }}
                  />
                ) : null}
                {features.export && pairs.length ? <ExportMenu items={exportItems} idPrefix={idp} /> : null}
              </section>
            </div>
            )}
          </div>
        </div>
      </RootMarker>
    </AnnounceProvider>
  );
}
