import { useState } from 'react';
import type { GenotypingAttempt, GenotypingOrientation, GenotypingOrientationReport, GenotypingParams } from '../types';
import { ExplainPanel } from './ExplainPanel';
import { cx, fmtInt, useIdPrefix } from './util';

const STATUS_META: Readonly<Record<string, { glyph: string; label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }>> = Object.freeze({
  ok: { glyph: '✓', label: 'Sets found', tone: 'ok' },
  blocked: { glyph: '✗', label: 'Blocked', tone: 'bad' },
  skipped: { glyph: '–', label: 'Skipped', tone: 'muted' },
  no_sets: { glyph: '!', label: 'No sets', tone: 'warn' },
});

const REASON_TEXT: Readonly<Record<string, string>> = Object.freeze({
  not_requested: 'You asked for the other orientation only.',
  too_close_to_end: 'The variant is too close to the end of the sequence for a product.',
  n_in_window: 'The allele-specific window contains an N.',
  budget_exhausted: 'The design ran out of budget before scoring this orientation.',
  neighbour_at_3p: 'A known variant sits in the last few bases of the allele-specific primer.',
  no_candidates: 'Primer3 returned no usable candidate in this orientation.',
});

function statusMeta(status: string) {
  return STATUS_META[status] ?? { glyph: '?', label: status, tone: 'muted' as const };
}

/** "min_tm 55 · max_size 32 · product 65–150" for one ladder step. */
function changeSummary(changes: Partial<GenotypingParams>): string {
  return Object.entries(changes)
    .map(([k, v]) => {
      if (k === 'product_size_ranges' && Array.isArray(v)) return `product ${v.map((r) => (Array.isArray(r) ? `${r[0]}–${r[1]}` : String(r))).join(', ')}`;
      return `${k} ${String(v)}`;
    })
    .join(' · ');
}

function Attempt({ attempt, orientation, idPrefix }: { attempt: GenotypingAttempt; orientation: GenotypingOrientation; idPrefix: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const rejected = Object.entries(attempt.rejected).filter(([, n]) => n > 0);
  // The server guarantees this identity; showing the parts makes a zero explainable.
  const accounted = rejected.reduce((n, [, v]) => n + v, 0) + attempt.not_scored + attempt.sets;
  return (
    <div className="gpr-orientation-attempt">
      <p className="gpr-orientation-attempt-head">
        <strong>Level {attempt.level}</strong>
        {Object.keys(attempt.changes).length ? <span className="gpr-orientation-changes"> — {changeSummary(attempt.changes)}</span> : <span className="gpr-sub"> — no relaxation</span>}
      </p>
      <p className="gpr-sub">
        {fmtInt(attempt.pairs_returned)} candidate{attempt.pairs_returned === 1 ? '' : 's'} from Primer3 · {fmtInt(attempt.sets)} usable set
        {attempt.sets === 1 ? '' : 's'}
        {attempt.not_scored ? ` · ${fmtInt(attempt.not_scored)} not scored` : ''}
        {accounted !== attempt.pairs_returned ? ` · ${fmtInt(attempt.pairs_returned - accounted)} unaccounted` : ''}
      </p>
      {rejected.length ? (
        <ul className="gpr-plain-list gpr-orientation-rejected">
          {rejected.map(([reason, n]) => (
            <li key={reason}>
              <span className="gpr-orientation-reason">{reason.replace(/_/g, ' ')}</span> <span className="gpr-explain-count">{fmtInt(n)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {attempt.explain ? (
        <ExplainPanel
          explain={attempt.explain}
          open={open}
          onToggle={setOpen}
          noPairs={attempt.sets === 0}
          idPrefix={`${idPrefix}-l${attempt.level}`}
          title={`Primer3 explain — ${orientation}, level ${attempt.level}`}
        />
      ) : null}
    </div>
  );
}

function Card({ orientation, report, idPrefix }: { orientation: GenotypingOrientation; report: GenotypingOrientationReport; idPrefix: string }): JSX.Element {
  const meta = statusMeta(report.status);
  const headingId = `${idPrefix}-${orientation}-h`;
  return (
    <section className="gpr-orientation-card" data-status={report.status} aria-labelledby={headingId}>
      <div className="gpr-orientation-head">
        <h4 className="gpr-h4" id={headingId}>
          {orientation === 'forward' ? 'Forward' : 'Reverse'}
        </h4>
        <span className={cx('gpr-chip', `gpr-chip-${meta.tone}`)} data-status={report.status}>
          <span className="gpr-chip-glyph" aria-hidden="true">
            {meta.glyph}
          </span>
          <span className="gpr-chip-text">{meta.label}</span>
        </span>
      </div>

      {report.reason ? <p className="gpr-orientation-why">{REASON_TEXT[report.reason] ?? report.reason.replace(/_/g, ' ')}</p> : null}

      <p className="gpr-sub">
        Discriminating base at {fmtInt(report.discriminating_position)}
        {report.relaxation_level != null ? ` · relaxation level ${report.relaxation_level}` : ''} · {fmtInt(report.sets_found)} set{report.sets_found === 1 ? '' : 's'} found
      </p>

      {report.blockers.length ? (
        <ul className="gpr-plain-list gpr-orientation-blockers">
          {report.blockers.map((b) => (
            <li key={b.key}>
              blocked by {b.ids[0] ?? b.label} ({b.alleles}), {b.distance_from_3p} nt from the 3′ end
              {b.ems ? <span className="gpr-sub"> · EMS</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {report.attempts.length ? (
        <div className="gpr-orientation-attempts">
          {report.attempts.map((a) => (
            <Attempt key={a.level} attempt={a} orientation={orientation} idPrefix={`${idPrefix}-${orientation}`} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export interface OrientationExplainProps {
  orientations: { forward: GenotypingOrientationReport; reverse: GenotypingOrientationReport } | null | undefined;
}

/**
 * Why each orientation did or did not yield sets (spec §3.3). This is where a
 * design with no sets explains itself, so it is shown rather than hidden — an
 * empty result is a `200`, not an error.
 */
export function OrientationExplain({ orientations }: OrientationExplainProps): JSX.Element | null {
  const idp = useIdPrefix('gpr-orient');
  if (!orientations) return null;
  return (
    <div className="gpr-orientation-explain">
      <Card orientation="forward" report={orientations.forward} idPrefix={idp} />
      <Card orientation="reverse" report={orientations.reverse} idPrefix={idp} />
    </div>
  );
}
