import { mismatchIndexes } from '../coords';
import type { SpecificityVerdict } from '../types';
import { cx } from './util';

export type VerdictChipValue = SpecificityVerdict | 'pending' | 'not_checked';
export type ChipTone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

/** Icon + colour + text (colour is never the only channel). */
export const VERDICT_META: Readonly<Record<VerdictChipValue, { glyph: string; label: string; tone: ChipTone }>> = Object.freeze({
  specific: { glyph: '✓', label: 'Specific', tone: 'ok' },
  off_targets: { glyph: '!', label: 'Off-targets', tone: 'warn' },
  on_target_missing: { glyph: '✗', label: 'On-target missing', tone: 'bad' },
  unverified_target: { glyph: '?', label: 'Target unverified', tone: 'info' },
  truncated: { glyph: '⋯', label: 'Truncated', tone: 'warn' },
  error: { glyph: '!', label: 'Check error', tone: 'bad' },
  pending: { glyph: '…', label: 'Checking', tone: 'muted' },
  not_checked: { glyph: '–', label: 'Not checked', tone: 'muted' },
});

export interface VerdictChipProps {
  verdict: VerdictChipValue | string;
  /** Off-target count shown as "Off-targets (2)". */
  count?: number | null;
  inferred?: boolean;
  /** Screen-reader prefix, e.g. "Genome". */
  context?: string;
  className?: string;
}

export function VerdictChip({ verdict, count, inferred, context, className }: VerdictChipProps): JSX.Element {
  const meta = VERDICT_META[verdict as VerdictChipValue] ?? { glyph: '?', label: String(verdict), tone: 'muted' as ChipTone };
  const text = `${meta.label}${verdict === 'off_targets' && typeof count === 'number' ? ` (${count})` : ''}${inferred ? ' · inferred' : ''}`;
  return (
    <span className={cx('gpr-chip', `gpr-chip-${meta.tone}`, className)} data-verdict={verdict}>
      <span className="gpr-chip-glyph" aria-hidden="true">
        {meta.glyph}
      </span>
      <span className="gpr-chip-text">
        {context ? <span className="gpr-visually-hidden">{context}: </span> : null}
        {text}
      </span>
    </span>
  );
}

export interface MismatchGlyphProps {
  /** Primer 5′→3′. */
  seq: string;
  /** Mismatch distances from the 3′ end (1 = terminal base). */
  positions: ReadonlyArray<number> | null | undefined;
  /** e.g. "Left primer". */
  label: string;
}

/**
 * Primer alignment glyph: `·` for matching bases, the primer base for a
 * mismatch (index `len − pos` from the 5′ end).
 */
export function MismatchGlyph({ seq, positions, label }: MismatchGlyphProps): JSX.Element {
  const list = [...(positions ?? [])];
  const hits = new Set(mismatchIndexes(seq.length, list));
  const description = list.length
    ? `${label}: ${list.length} mismatch${list.length === 1 ? '' : 'es'} at ${[...list].sort((a, b) => a - b).join(', ')} nt from the 3′ end`
    : `${label}: no mismatches`;
  return (
    <span className="gpr-mm" role="img" aria-label={description} title={description}>
      {Array.from(seq).map((ch, i) => (
        <span key={i} className={hits.has(i) ? 'gpr-mm-base gpr-mm-hit' : 'gpr-mm-base'} aria-hidden="true">
          {hits.has(i) ? ch : '·'}
        </span>
      ))}
    </span>
  );
}
