import { useEffect, useMemo, useRef, useState } from 'react';
import { estimateCheckCpu } from '../cost';
import { designModeOf } from '../modes';
import { buildGenotypingCheckRequest, buildGenotypingRequest, CheckRequestError, defaultPangenomeGenomes, GENOTYPING_CHECK_LIMITS } from '../request';
import { submittedGenotypingSets } from '../results';
import type { CheckName, GenesInRegion, GenomesResponse, GenotypingSet, GenotypingState, GenotypingTab, PrimerDesignerState, PrimersClient, RestrictionEnzyme, SequenceForRegion } from '../types';
import { AlleleMatrix } from './AlleleMatrix';
import { AssayOptions } from './AssayOptions';
import { ErrorBanner } from './ErrorBanner';
import { CheckboxField, TabList, tabDomId } from './fields';
import { GenomePicker } from './GenomePicker';
import { isCheckActive, useCheckJob } from './hooks/useCheckJob';
import { useGenotypingDesign } from './hooks/useGenotypingDesign';
import { OrderSheet } from './OrderSheet';
import { OrientationExplain } from './OrientationExplain';
import { PangenomeMatrix } from './PangenomeMatrix';
import type { DesignerAction } from './reducer';
import { SetsTable } from './SetsTable';
import { SpecificityResults } from './SpecificityResults';
import { VariantPicker } from './VariantPicker';
import { Warnings } from './Warnings';
import { fmtInt, useIdPrefix } from './util';

export interface GenotypingPanelProps {
  client: PrimersClient;
  state: PrimerDesignerState;
  dispatch: (action: DesignerAction) => void;
  systemName: string | null;
  genomes: GenomesResponse | null;
  /** The default listing window (the gene span ± 2 kb, clamped by the caller). */
  defaultWindow?: GenotypingState['window'];
  geneId?: string | null;
  /** Host-supplied gene search for the variant browser. */
  genesInRegion?: GenesInRegion;
  sequenceForRegion?: SequenceForRegion;
  enzymes?: ReadonlyArray<RestrictionEnzyme>;
  pangenomeFeature?: boolean;
  exportFeature?: boolean;
  disabled?: boolean;
  idPrefix?: string;
}

const TAB_LABELS: Readonly<Record<GenotypingTab, string>> = Object.freeze({
  sets: 'Sets',
  alleles: 'Alleles',
  specificity: 'Specificity',
  pangenome: 'Pan-genome',
  order: 'Order sheet',
});

/**
 * The genotyping mode end to end (spec §3): choose a variant, design KASP or
 * AS-PCR sets, check the chosen ones against the pan-genome, and read the
 * allele calls. `genotyping` never reaches a design or check in another mode,
 * so the request builders here are the genotyping-specific ones.
 */
export function GenotypingPanel(p: GenotypingPanelProps): JSX.Element {
  const auto = useIdPrefix('gpr-gt');
  const idp = p.idPrefix ?? auto;
  const gt = p.state.genotyping ?? {};
  const [checkError, setCheckError] = useState<unknown>(null);

  const design = useGenotypingDesign(p.client, {
    onSuccess: (res, _req, meta) => {
      if (meta.templateOnly) return;
      // Default the selection to the sets the server itself packed into `check.request`.
      const byId = new Map(res.sets.map((s) => [s.id, s.key]));
      const packed = (res.check?.set_ids ?? res.sets.slice(0, GENOTYPING_CHECK_LIMITS.maxSets).map((s) => s.id))
        .map((id) => byId.get(id))
        .filter((k): k is string => !!k)
        .slice(0, GENOTYPING_CHECK_LIMITS.maxSets);
      p.dispatch({ type: 'genotypingDesignDone', templateOnly: false, noSets: res.sets.length === 0, checkedSetKeys: packed, selectedSetKey: res.sets[0]?.key });
    },
  });
  const check = useCheckJob(p.client, {
    onJobId: (jobId) => p.dispatch({ type: 'genotypingCheckJob', jobId }),
  });

  const response = design.state.response;
  const sets: ReadonlyArray<GenotypingSet> = response?.sets ?? [];
  const checkedKeys = gt.checkedSetKeys ?? [];
  const checkedSets = useMemo(() => sets.filter((s) => checkedKeys.includes(s.key)), [sets, checkedKeys]);
  const job = check.state.job;
  const genotypeResults = job?.results?.genotyping ?? null;

  // Restore a saved job once per job id.
  const restored = useRef<string | null>(null);
  // `check` is a fresh object each render; the callback is stable, so depend on that.
  const restoreJob = check.restore;
  useEffect(() => {
    const jobId = gt.check?.jobId;
    if (!jobId || restored.current === jobId) return;
    restored.current = jobId;
    void restoreJob(jobId, null, false);
  }, [gt.check?.jobId, restoreJob]);

  const designRequest = useMemo(() => buildGenotypingRequest(p.state, { systemName: p.systemName }), [p.state, p.systemName]);
  const checks: CheckName[] = gt.check?.checks?.includes('pangenome') ? ['specificity', 'pangenome'] : ['specificity'];

  let checkRequest = null;
  let buildError: CheckRequestError | null = null;
  if (checkedSets.length && response) {
    try {
      checkRequest = buildGenotypingCheckRequest({
        sets: checkedSets,
        variant: response.variant,
        systemName: p.systemName,
        mode: designModeOf(p.state.mode) === 'gene' ? 'gene' : 'region',
        geneId: p.geneId ?? null,
        checks,
        genomes: gt.check?.genomes,
        allGenomes: p.genomes,
        params: gt.check?.params,
      });
    } catch (e) {
      if (e instanceof CheckRequestError) buildError = e;
      else throw e;
    }
  }

  // The same mirror the builder's guard uses, so the readout and the block agree.
  const reference = p.genomes?.genomes.find((g) => g.system_name === p.systemName) ?? null;
  const searchable = checks.includes('pangenome') && p.genomes ? defaultPangenomeGenomes(p.genomes.genomes, 'region', p.systemName ?? undefined) : null;
  const panEntries = searchable ? (gt.check?.genomes ? searchable.filter((g) => gt.check!.genomes!.includes(g.system_name)) : searchable) : null;
  const estimate =
    checkedSets.length && p.genomes
      ? estimateCheckCpu({
          primers: checkedSets.flatMap((s) => (s.check?.pairs ?? []).map((pair) => ({ left: pair.left, right: pair.right }))),
          mode: 'region',
          referenceTotalBases: reference?.total_bases ?? null,
          pangenome: panEntries,
          genotyping: true,
        })
      : null;

  const tab: GenotypingTab = gt.view?.tab ?? 'sets';
  const hasResults = !!job?.results;
  const tabDisabled = (id: GenotypingTab): string | null => {
    if (id === 'sets') return null;
    if (id === 'order') return sets.length ? null : 'Design a set first';
    if (id === 'alleles') return genotypeResults ? null : 'Run a check to see allele calls';
    if (id === 'pangenome') return job?.results?.pangenome ? null : 'Run a pan-genome check first';
    return hasResults ? null : 'Run a check first';
  };
  const activeTab: GenotypingTab = tabDisabled(tab) ? 'sets' : tab;
  const panelId = `${idp}-gt-panel`;
  const running = design.state.status === 'running';
  const checking = isCheckActive(check.state.status);

  const submit = () => {
    if (!checkRequest) return;
    setCheckError(null);
    // Remember the submission now; the job id arrives from `onJobId`.
    p.dispatch({ type: 'setGenotypingSubmitted', submitted: submittedGenotypingSets(checkRequest) });
    void check.submit(checkRequest);
  };

  return (
    <div className="gpr-genotyping">
      <VariantPicker
        client={p.client}
        systemName={p.systemName ?? ''}
        variationAvailable={!!p.genomes?.variation?.available && p.genomes.genomes.find((g) => g.system_name === p.systemName)?.has_variation !== false}
        source={p.genomes?.variation ? { name: p.genomes.variation.source ?? 'Ensembl', release: p.genomes.variation.release } : null}
        state={gt}
        genesInRegion={p.genesInRegion}
        sequenceForRegion={p.sequenceForRegion}
        enzymes={p.enzymes}
        defaultWindow={p.defaultWindow}
        disabled={p.disabled}
        onWindow={(window) => p.dispatch({ type: 'setGenotypingWindow', window })}
        onFilters={(filters) => p.dispatch({ type: 'setGenotypingFilters', filters })}
        onSelect={(choice) => p.dispatch({ type: 'setGenotypingVariant', ...choice })}
      />

      <AssayOptions
        idPrefix={idp}
        assay={gt.assay}
        params={gt.params}
        settings={response?.settings ?? null}
        emsTarget={response?.assay.ems_target}
        genome={reference}
        avoidRepeats={gt.avoidRepeats}
        repeatMaskMode={gt.repeatMaskMode}
        issues={[]}
        disabled={p.disabled}
        onAssay={(assay) => p.dispatch({ type: 'setGenotypingAssay', assay })}
        onParam={(key, value) => p.dispatch({ type: 'setGenotypingParam', key, value })}
        onResetParams={() => p.dispatch({ type: 'resetGenotypingParams' })}
        onRepeats={(change) => p.dispatch({ type: 'setGenotypingRepeats', ...change })}
      />

      <div className="gpr-genotyping-actions">
        <button
          type="button"
          className="gpr-btn gpr-btn-primary"
          disabled={p.disabled || !designRequest || running || !design.supported}
          onClick={() => designRequest && design.run(designRequest, { templateOnly: false, userInitiated: true })}
        >
          {running ? 'Designing…' : 'Design assay'}
        </button>
        {running ? (
          <button type="button" className="gpr-btn gpr-btn-small" onClick={design.cancel}>
            Cancel
          </button>
        ) : null}
        {!design.supported ? <span className="gpr-hint">This server cannot design genotyping assays.</span> : null}
        {!designRequest && !p.disabled ? <span className="gpr-hint">Choose a variant to design against.</span> : null}
      </div>

      <ErrorBanner error={design.state.error} context="design" busy={design.state.busy} onRetry={() => designRequest && design.run(designRequest, { templateOnly: false, userInitiated: true })} onDismiss={design.clearError} />

      {response ? <Warnings warnings={response.warnings} title="About this design" /> : null}

      {response ? (
        <>
          <TabList
            items={(['sets', 'alleles', 'specificity', 'pangenome', 'order'] as const).map((id) => ({
              id,
              label: TAB_LABELS[id],
              disabledReason: tabDisabled(id),
            }))}
            value={activeTab}
            onChange={(t) => p.dispatch({ type: 'setGenotypingTab', tab: t })}
            label="Genotyping results"
            idPrefix={idp}
            panelId={panelId}
          />

          <div id={panelId} role="tabpanel" className="gpr-tabpanel" aria-labelledby={tabDomId(idp, activeTab)} tabIndex={-1}>
            {activeTab === 'sets' ? (
              <>
                {sets.length ? (
                  <div className="gpr-genotyping-check">
                    {p.pangenomeFeature !== false ? (
                      <CheckboxField
                        id={`${idp}-gt-pangenome`}
                        label="Pan-genome allele calls"
                        checked={checks.includes('pangenome')}
                        disabled={p.disabled || checking}
                        hint="Reads the allele every other assembly carries."
                        onChange={(on) => p.dispatch({ type: 'setGenotypingPangenome', enabled: on })}
                      />
                    ) : null}
                    {checks.includes('pangenome') && p.genomes ? (
                      <GenomePicker
                        genomes={p.genomes}
                        mode="region"
                        systemName={p.systemName}
                        selected={gt.check?.genomes}
                        disabled={p.disabled || checking}
                        onChange={(genomes) => p.dispatch({ type: 'setGenotypingGenomes', genomes })}
                      />
                    ) : null}
                    <p className="gpr-readout gpr-genotyping-cost">
                      {checkedSets.length} set{checkedSets.length === 1 ? '' : 's'} selected
                      {estimate ? ` · estimated ${fmtInt(estimate.cpu_s)} CPU-seconds` : ''}
                      {estimate?.over_limit ? ` — over the ${fmtInt(estimate.limit)} limit` : ''}
                    </p>
                    {buildError ? (
                      <p className="gpr-field-error" role="alert" data-code={buildError.code}>
                        {buildError.message}
                      </p>
                    ) : null}
                    <div className="gpr-button-row">
                      <button type="button" className="gpr-btn gpr-btn-primary" disabled={p.disabled || !checkRequest || !!buildError || checking || !!estimate?.over_limit} onClick={submit}>
                        {checking ? 'Checking…' : 'Check selected sets'}
                      </button>
                      {checking ? (
                        <button type="button" className="gpr-btn gpr-btn-small" onClick={check.detach}>
                          Stop watching
                        </button>
                      ) : null}
                      {check.state.status === 'expired' ? (
                        <button type="button" className="gpr-btn gpr-btn-small" onClick={submit}>
                          Results expired — Re-run check
                        </button>
                      ) : null}
                    </div>
                    <ErrorBanner error={check.state.status === 'error' ? check.state.error : checkError} context="check" onDismiss={() => setCheckError(null)} />
                  </div>
                ) : null}

                <SetsTable
                  sets={sets}
                  checkedKeys={checkedKeys}
                  selectedKey={gt.selectedSetKey ?? null}
                  check={job}
                  submitted={gt.check?.submitted}
                  onCheckedChange={(keys) => p.dispatch({ type: 'setGenotypingCheckedKeys', keys })}
                  onSelect={(key) => p.dispatch({ type: 'selectGenotypingSet', key })}
                />

                <OrientationExplain orientations={response.orientations} />
              </>
            ) : null}

            {activeTab === 'alleles' ? (
              <AlleleMatrix results={genotypeResults} requestedGenomes={gt.check?.genomes} running={checking} />
            ) : null}

            {activeTab === 'specificity' && job?.results ? <SpecificityResults results={job.results} job={job} systemName={p.systemName ?? undefined} /> : null}

            {activeTab === 'pangenome' && job?.results?.pangenome ? (
              <PangenomeMatrix results={job.results.pangenome} requestedGenomes={gt.check?.genomes} params={gt.check?.params} />
            ) : null}

            {activeTab === 'order' ? (
              <OrderSheet
                sets={sets}
                kaspMix={response.assay.kasp_mix}
                submissionSequence={response.variant.submission_sequence}
                results={genotypeResults}
                label={response.variant.ids[0] ?? response.variant.key}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
