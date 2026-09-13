import { CHECK_DEFAULTS } from '../presets';
import { estimateCheckCpu } from '../cost';
import {
  buildCheckRequest,
  CHECK_LIMITS,
  CHECK_PARAM_LIMITS,
  checkMaxProductSize,
  CheckRequestError,
  defaultPangenomeGenomes,
  effectiveMaxAmplifyingMismatches,
  uniquePrimers,
  validateCheckParams,
} from '../request';
import type { CheckParams, CheckRequest, DesignMode, GenomesResponse, PrimerDesignerCheckState, PrimerPair } from '../types';
import { ErrorBanner } from './ErrorBanner';
import { CheckboxField, NumberField } from './fields';
import { GenomePicker } from './GenomePicker';
import { isCheckActive, type CheckRunState } from './hooks/useCheckJob';
import { Warnings } from './Warnings';
import { fmtInt } from './util';

type NumericCheckKey = Exclude<keyof CheckParams, 'include_unlikely'>;

const CHECK_FIELDS: ReadonlyArray<{ key: NumericCheckKey; label: string }> = [
  { key: 'max_product_size', label: 'Max product size (bp)' },
  { key: 'ignore_mismatches', label: 'Ignore sites with at least this many mismatches' },
  { key: 'max_amplifying_mismatches', label: 'Max mismatches per primer for a product' },
  { key: 'min_total_mismatches', label: 'Unlikely product: at least this many mismatches' },
  { key: 'min_3p_mismatches', label: '…of which in the 3′ window' },
  { key: 'three_prime_window', label: '3′ window (nt)' },
  { key: 'repeat_site_threshold', label: 'Repetitive primer: more near-perfect sites than' },
];

export interface CheckPanelProps {
  idPrefix: string;
  mode: DesignMode;
  systemName: string | null;
  geneId: string | null;
  transcriptId: string | null;
  pairs: ReadonlyArray<PrimerPair>;
  checkedRanks: ReadonlyArray<number>;
  checkState: PrimerDesignerCheckState;
  genomes: GenomesResponse | null;
  pangenomeFeature: boolean;
  run: CheckRunState;
  /** FEATURE_DISABLED from the check endpoint. */
  disabled: boolean;
  onPangenome: (enabled: boolean) => void;
  onGenomes: (genomes: string[] | undefined) => void;
  onParam: (key: keyof CheckParams, value: number | boolean | undefined) => void;
  onSubmit: (request: CheckRequest) => void;
  onDetach: () => void;
  onResume: () => void;
  onRerun: () => void;
}

/** Shows `queue_position` while queued and `done of total · stage · running` while running. */
export function progressText(job: CheckRunState['job']): string {
  if (!job) return '';
  if (job.status === 'queued') {
    const q = job.queue_position;
    return typeof q === 'number' ? `Queued · ${q} job${q === 1 ? '' : 's'} ahead` : 'Queued';
  }
  const p = job.progress;
  const done = p?.done ?? 0;
  const total = Math.max(p?.total ?? 0, done);
  const running = p?.running?.length ? ` · running: ${p.running.join(', ')}` : '';
  return `${fmtInt(done)} of ${fmtInt(total)} · ${p?.stage ?? job.status}${running}`;
}

function CheckStatus({ run, onDetach, onResume, onRerun, onRetry }: { run: CheckRunState; onDetach: () => void; onResume: () => void; onRerun: () => void; onRetry: () => void }): JSX.Element | null {
  const job = run.job;
  switch (run.status) {
    case 'idle':
      return null;
    case 'submitting':
      return <p className="gpr-status-line">Submitting the check…</p>;
    case 'restoring':
      return <p className="gpr-status-line">Loading the saved check…</p>;
    case 'watching': {
      const p = job?.progress;
      const done = p?.done ?? 0;
      const total = Math.max(p?.total ?? 0, done);
      const queued = job?.status === 'queued';
      const text = progressText(job);
      return (
        <div className="gpr-progress-block" data-status={job?.status}>
          <div
            className="gpr-progress"
            role="progressbar"
            aria-label="Check progress"
            aria-valuemin={0}
            aria-valuemax={total || 1}
            aria-valuenow={queued ? 0 : done}
            aria-valuetext={text}
            data-state={queued ? 'queued' : 'running'}
          >
            <div className="gpr-progress-bar" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
          </div>
          <p className="gpr-status-line">
            {text}
            {job?.partial ? ' · partial results shown' : ''}
          </p>
          <div className="gpr-button-row">
            <button type="button" className="gpr-btn gpr-btn-small" onClick={onDetach}>
              Stop watching
            </button>
          </div>
        </div>
      );
    }
    case 'detached':
      return (
        <div className="gpr-status-block">
          <p className="gpr-status-line">Stopped watching. The check keeps running on the server.</p>
          <div className="gpr-button-row">
            <button type="button" className="gpr-btn gpr-btn-small" onClick={onResume}>
              Resume watching
            </button>
          </div>
        </div>
      );
    case 'done':
      return (
        <p className="gpr-status-line gpr-status-done">
          <span aria-hidden="true">✓ </span>Check finished{job?.attempts && job.attempts > 1 ? ` (after ${job.attempts} attempts)` : ''}.
        </p>
      );
    case 'failed':
      return (
        <div className="gpr-banner gpr-banner-error" role="alert" data-code={job?.error?.code ?? 'JOB_ERROR'}>
          <p className="gpr-banner-title">The check failed{job?.error?.message ? `: ${job.error.message}` : '.'}</p>
          {job?.error?.code ? (
            <p className="gpr-banner-text">
              <code className="gpr-code">{job.error.code}</code>
            </p>
          ) : null}
          <div className="gpr-banner-actions">
            <button type="button" className="gpr-btn" onClick={onRerun}>
              Re-run check
            </button>
          </div>
        </div>
      );
    case 'expired':
      return (
        <div className="gpr-banner gpr-banner-warn" role="status" data-code="UNKNOWN_JOB">
          <p className="gpr-banner-title">Results expired — Re-run check</p>
          <p className="gpr-banner-text">Check results are kept on the server for a limited time.</p>
          <div className="gpr-banner-actions">
            <button type="button" className="gpr-btn gpr-btn-primary" onClick={onRerun}>
              Re-run check
            </button>
          </div>
        </div>
      );
    case 'error':
      return <ErrorBanner error={run.error} context="check" onRetry={onRetry} />;
    default:
      return null;
  }
}

/** Specificity (always), pan-genome toggle + GenomePicker, CPU estimate, progress (spec §C.3 CheckPanel). */
export function CheckPanel(p: CheckPanelProps): JSX.Element {
  const checked = p.pairs.filter((pair) => p.checkedRanks.includes(pair.rank));
  const showPangenome = p.pangenomeFeature && (p.genomes?.counts?.total ?? 0) > 1;
  const pangenomeOn = showPangenome && p.checkState.checks.includes('pangenome');
  const paramIssues = validateCheckParams(p.checkState.params);
  const active = isCheckActive(p.run.status);

  let request: CheckRequest | null = null;
  let buildError: CheckRequestError | null = null;
  if (checked.length) {
    try {
      request = buildCheckRequest({
        mode: p.mode,
        systemName: p.systemName,
        geneId: p.geneId,
        transcriptId: p.transcriptId,
        pairs: checked,
        checks: pangenomeOn ? ['specificity', 'pangenome'] : ['specificity'],
        genomes: pangenomeOn ? p.checkState.genomes ?? null : null,
        allGenomes: p.genomes,
        params: p.checkState.params,
      });
    } catch (e) {
      if (e instanceof CheckRequestError) buildError = e;
      else throw e;
    }
  }
  const noGenomes = pangenomeOn && Array.isArray(p.checkState.genomes) && p.checkState.genomes.length === 0;

  const reference = p.genomes?.genomes.find((g) => g.system_name === p.systemName) ?? null;
  // Only genomes this mode can search are priced (a saved list may name others; the request drops them too).
  const searchable = pangenomeOn && p.genomes ? defaultPangenomeGenomes(p.genomes, p.mode, p.systemName ?? undefined) : null;
  const panEntries = searchable ? (p.checkState.genomes ? searchable.filter((g) => p.checkState.genomes!.includes(g.system_name)) : searchable) : null;
  const estimate =
    checked.length && p.genomes
      ? estimateCheckCpu({
          primers: checked.map((pair) => ({ left: pair.left.seq, right: pair.right.seq })),
          mode: p.mode,
          referenceTotalBases: reference?.total_bases ?? null,
          pangenome: panEntries,
        })
      : null;
  const maxSize = request ? checkMaxProductSize(request) : null;
  const unique = uniquePrimers(checked).length;

  const canSubmit = !!request && !buildError && !paramIssues.length && !estimate?.over_limit && !active && !p.disabled && !noGenomes;
  const headingId = `${p.idPrefix}-check-h`;
  const submit = () => {
    if (request && canSubmit) p.onSubmit(request);
  };

  return (
    <section className="gpr-check-panel" aria-labelledby={headingId}>
      <h3 className="gpr-h3" id={headingId}>
        Check primers
      </h3>
      <p className="gpr-readout">
        {checked.length
          ? `${checked.length} pair${checked.length === 1 ? '' : 's'} selected · ${unique} distinct primer${unique === 1 ? '' : 's'} (limits: ${CHECK_LIMITS.maxPairs} pairs, ${CHECK_LIMITS.maxUniquePrimers} primers)`
          : `Tick pairs in the table to check them (up to ${CHECK_LIMITS.maxPairs}).`}
      </p>
      <fieldset className="gpr-fieldset" disabled={p.disabled}>
        <legend className="gpr-legend">Checks</legend>
        <CheckboxField
          id={`${p.idPrefix}-check-specificity`}
          label={p.mode === 'transcript' ? 'Genome and transcriptome specificity' : 'Genome specificity'}
          checked
          disabled
          onChange={() => {}}
          hint="Always run."
        />
        {showPangenome ? (
          <CheckboxField
            id={`${p.idPrefix}-check-pangenome`}
            label={p.mode === 'transcript' ? 'Pan-genome coverage (annotated transcripts)' : 'Pan-genome coverage'}
            checked={pangenomeOn}
            onChange={p.onPangenome}
            hint={
              p.mode === 'transcript'
                ? 'Transcript mode searches the annotated transcript models of each genome (PANGENOME_TRANSCRIPT_MODELS_ONLY); unannotated copies are missed.'
                : `Searches up to ${fmtInt((p.genomes?.counts?.total ?? 1) - 1)} other genomes of ${p.genomes?.species?.name ?? 'this species'}.`
            }
          />
        ) : null}
      </fieldset>
      {pangenomeOn && p.genomes ? (
        <GenomePicker genomes={p.genomes} mode={p.mode} systemName={p.systemName} selected={p.checkState.genomes ?? null} onChange={p.onGenomes} disabled={p.disabled} />
      ) : null}
      <details className="gpr-details">
        <summary className="gpr-summary">Advanced check settings</summary>
        <div className="gpr-field-grid">
          {CHECK_FIELDS.map((f) => {
            const v = p.checkState.params?.[f.key];
            return (
              <NumberField
                key={f.key}
                id={`${p.idPrefix}-check-${f.key}`}
                label={f.label}
                value={typeof v === 'number' ? v : undefined}
                placeholder={String(
                  f.key === 'max_amplifying_mismatches'
                    ? effectiveMaxAmplifyingMismatches({ ignore_mismatches: p.checkState.params?.ignore_mismatches }) ?? CHECK_DEFAULTS[f.key]
                    : CHECK_DEFAULTS[f.key],
                )}
                min={CHECK_PARAM_LIMITS[f.key].min}
                max={CHECK_PARAM_LIMITS[f.key].max}
                step={1}
                issues={paramIssues.filter((i) => i.field === f.key)}
                changed={typeof v === 'number'}
                disabled={p.disabled}
                onChange={(value) => p.onParam(f.key, value)}
              />
            );
          })}
        </div>
        <CheckboxField
          id={`${p.idPrefix}-check-include-unlikely`}
          label="List unlikely products too"
          checked={p.checkState.params?.include_unlikely ?? CHECK_DEFAULTS.include_unlikely}
          disabled={p.disabled}
          onChange={(v) => p.onParam('include_unlikely', v === CHECK_DEFAULTS.include_unlikely ? undefined : v)}
        />
      </details>
      {maxSize?.raised ? (
        <p className="gpr-hint">
          The maximum product size will be raised to {fmtInt(maxSize.effective)} bp to cover the expected products.
        </p>
      ) : null}
      {estimate ? (
        <p className="gpr-estimate" data-state={estimate.over_limit ? 'over' : undefined}>
          Estimated cost ≈ {fmtInt(estimate.cpu_s)} CPU-s
          {estimate.over_limit ? ` — over the ${fmtInt(estimate.limit)} CPU-s limit; select fewer pairs or genomes.` : '.'}
        </p>
      ) : null}
      {buildError ? <p className="gpr-field-error">{buildError.message}</p> : null}
      {noGenomes ? <p className="gpr-field-error">Select at least one genome for the pan-genome check.</p> : null}
      <div className="gpr-button-row">
        <button type="button" className="gpr-btn gpr-btn-primary" disabled={!canSubmit} onClick={submit}>
          {pangenomeOn ? 'Run checks' : 'Check specificity'}
        </button>
      </div>
      <div className="gpr-check-status">
        <CheckStatus run={p.run} onDetach={p.onDetach} onResume={p.onResume} onRerun={p.onRerun} onRetry={p.onRerun} />
      </div>
      {p.run.job?.warnings?.length ? <Warnings warnings={p.run.job.warnings} title="Check warnings" /> : null}
    </section>
  );
}
