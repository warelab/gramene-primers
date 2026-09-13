import { useMemo, type ReactNode } from 'react';
import { flattenValidationErrors, isPrimersApiError } from '../errors';
import { MAX_JOB_CPU_S } from '../cost';
import type { BusyRetry } from './hooks/useDesign';
import { MAX_BUSY_RETRIES } from './hooks/useDesign';
import { useCountdown } from './hooks/useCountdown';
import { fmtInt } from './util';

export type ErrorContext = 'design' | 'check' | 'genomes';

export interface ErrorBannerProps {
  error: unknown;
  context: ErrorContext;
  /** An automatic BUSY retry in progress (design). */
  busy?: BusyRetry | null;
  onRetry?: () => void;
  onCancel?: () => void;
  onDismiss?: () => void;
}

/** Codes that disable the form (design) or the check panel (check). */
export function isDisablingError(error: unknown): boolean {
  return isPrimersApiError(error) && (error.code === 'PRIMER3_UNAVAILABLE' || error.code === 'FEATURE_DISABLED');
}

function numberDetail(details: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = details?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Error display by code (spec §C.3 ErrorBanner). */
export function ErrorBanner({ error, context, busy, onRetry, onCancel, onDismiss }: ErrorBannerProps): JSX.Element | null {
  const queueFull = isPrimersApiError(error) && error.code === 'QUEUE_FULL';
  const target = useMemo(() => {
    if (busy) return busy.retryAt;
    if (queueFull && isPrimersApiError(error)) return Date.now() + (error.retryAfterMs ?? 60_000);
    return null;
  }, [busy, error, queueFull]);
  const seconds = useCountdown(target);

  if (busy) {
    return (
      <div className="gpr-banner gpr-banner-warn" role="status" data-code="BUSY">
        <p className="gpr-banner-title">
          The server is busy. Retrying in {seconds} s (attempt {busy.attempt} of {busy.max})…
        </p>
        {onCancel ? (
          <div className="gpr-banner-actions">
            <button type="button" className="gpr-btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    );
  }
  if (!error) return null;

  const api = isPrimersApiError(error) ? error : null;
  const code = api?.code ?? (error instanceof Error && error.name ? error.name : 'ERROR');
  const message = error instanceof Error ? error.message : String(error);
  const what = context === 'check' ? 'check' : context === 'genomes' ? 'genome list' : 'design';
  let title: string;
  let body: ReactNode = null;
  let retry = false;
  let retryDisabled = false;
  let showMessage = true;

  switch (code) {
    case 'BUSY':
      title = 'The server is still busy.';
      body = <p className="gpr-banner-text">Gave up after {MAX_BUSY_RETRIES} automatic retries. Try again in a moment.</p>;
      retry = true;
      break;
    case 'QUEUE_FULL':
      title = 'The check queue is full.';
      body = <p className="gpr-banner-text">{seconds > 0 ? `You can retry in ${seconds} s.` : 'You can retry now.'}</p>;
      retry = true;
      retryDisabled = seconds > 0;
      break;
    case 'JOB_TOO_LARGE': {
      const estimate = numberDetail(api?.details, 'estimate_cpu_s');
      const limit = numberDetail(api?.details, 'limit') ?? MAX_JOB_CPU_S;
      title = 'This check is too large.';
      body = (
        <p className="gpr-banner-text">
          Estimated {fmtInt(estimate)} CPU-s; the limit is {fmtInt(limit)} CPU-s. Select fewer pairs or genomes.
        </p>
      );
      break;
    }
    case 'PRIMER3_UNAVAILABLE':
      title = 'Primer design is temporarily unavailable.';
      body = <p className="gpr-banner-text">Primer3 is not available on this server, so the form is disabled.</p>;
      retry = true;
      break;
    case 'FEATURE_DISABLED':
      title = context === 'check' ? 'Primer checks are disabled on this server.' : 'Primer design is disabled on this server.';
      body = <p className="gpr-banner-text">{context === 'check' ? 'The check panel is disabled.' : 'The form is disabled.'}</p>;
      break;
    case 'VALIDATION':
      title = 'The server rejected the request.';
      showMessage = false;
      body = (
        <ul className="gpr-banner-list">
          {flattenValidationErrors(api?.errors).map((v, i) => (
            <li key={i}>
              {v.message || v.code}
              {Array.isArray(v.path) && v.path.length ? ` (${v.path.join('.')})` : ''} <code className="gpr-code">{v.code}</code>
            </li>
          ))}
        </ul>
      );
      break;
    case 'NETWORK':
      title = `The ${what} request could not reach the server.`;
      retry = true;
      break;
    case 'TIMEOUT':
      title = `The ${what} request timed out.`;
      retry = true;
      break;
    default:
      if (api && api.status >= 500) {
        title = `The server could not complete the ${what}.`;
        retry = true;
      } else {
        title = message || `The ${what} request failed.`;
        showMessage = false;
      }
  }

  return (
    <div className="gpr-banner gpr-banner-error" role="alert" data-code={code}>
      <p className="gpr-banner-title">{title}</p>
      {showMessage && message ? (
        <p className="gpr-banner-text">
          {message} <code className="gpr-code">{code}</code>
        </p>
      ) : !showMessage && code !== 'VALIDATION' ? (
        <p className="gpr-banner-text">
          <code className="gpr-code">{code}</code>
        </p>
      ) : null}
      {body}
      {(retry && onRetry) || onDismiss ? (
        <div className="gpr-banner-actions">
          {retry && onRetry ? (
            <button type="button" className="gpr-btn" disabled={retryDisabled} onClick={onRetry}>
              Retry
            </button>
          ) : null}
          {onDismiss ? (
            <button type="button" className="gpr-btn gpr-btn-quiet" onClick={onDismiss}>
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
