import { useId } from 'react';
import { canonicalTranscriptId, geneLength, geneTemplateExtent, templateToGenomic } from '../coords';
import type {
  DesignerMode,
  GrameneGene,
  GrameneTranscript,
  PrimerDesignerState,
  PrimerTemplate,
  Strand,
} from '../types';
import { DESIGN_LIMITS } from '../validate';

/** Joins class names, skipping falsy parts. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** `12,345`; en dash for missing values. */
export function fmtInt(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '–';
}

/** Fixed decimals; en dash for missing values. */
export function fmtNum(n: number | null | undefined, digits = 1): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '–';
}

export function fmtPercent(fraction: number | null | undefined, digits = 1): string {
  return typeof fraction === 'number' && Number.isFinite(fraction) ? `${(fraction * 100).toFixed(digits)}%` : '–';
}

export function strandSign(strand: Strand | null | undefined): string {
  return strand === -1 ? '−' : '+';
}

export function pairLabel(rank: number): string {
  return `P${rank + 1}`;
}

/** A DOM-safe id prefix from React's `useId` (no colons, so it also works inside `url(#…)`). */
export function useIdPrefix(prefix = 'gpr'): string {
  const raw = useId();
  return `${prefix}-${raw.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

export const MODE_LABELS: Readonly<Record<DesignerMode, string>> = Object.freeze({
  gene: 'Gene',
  transcript: 'Transcript (qPCR)',
  region: 'Region',
  sequence: 'Sequence',
  genotyping: 'Genotyping (KASP)',
});

export function geneTranscripts(gene: GrameneGene | null | undefined): GrameneTranscript[] {
  return gene?.gene_structure?.transcripts ?? [];
}

/** The transcript shown for `state.transcriptId` (default: canonical). */
export function selectedTranscript(gene: GrameneGene | null | undefined, transcriptId: string | null | undefined): GrameneTranscript | null {
  const list = geneTranscripts(gene);
  if (!list.length) return null;
  const id = transcriptId ?? canonicalTranscriptId(gene ?? null);
  return list.find((t) => t.id === id) ?? null;
}

/** Genes longer than the template limit cannot be designed in gene mode. */
export function geneTooLong(gene: GrameneGene | null | undefined): boolean {
  return !!gene?.location && geneLength(gene) > DESIGN_LIMITS.maxTemplateLength;
}

/** Client-side template length estimate for validation and readouts. */
export function estimateTemplateLength(
  state: Pick<PrimerDesignerState, 'mode' | 'flankUp' | 'flankDown' | 'transcriptId' | 'region'>,
  gene: GrameneGene | null | undefined,
  sequenceLength: number | null,
): number | null {
  switch (state.mode) {
    case 'gene':
      return gene?.location ? geneTemplateExtent(gene, state.flankUp ?? 0, state.flankDown ?? 0).length : null;
    case 'transcript':
      return selectedTranscript(gene, state.transcriptId)?.length ?? null;
    case 'region':
      return state.region ? state.region.end - state.region.start + 1 : null;
    case 'sequence':
      return sequenceLength;
    default:
      return null;
  }
}

/** Genomic coordinate of template base `t`, or null (sequence mode, unmapped positions). */
export function templateGenomicPosition(template: PrimerTemplate, t: number): { region: string; pos: number } | null {
  const region = template.region;
  if (!region || template.mode === 'sequence') return null;
  const strand: Strand = template.strand === -1 ? -1 : 1;
  if (template.mode === 'transcript') {
    for (const e of template.features?.exons ?? []) {
      if (t >= e.start && t <= e.end && e.genomic) {
        const offset = t - e.start;
        return { region, pos: strand === 1 ? e.genomic.start + offset : e.genomic.end - offset };
      }
    }
    return null;
  }
  if (typeof template.start !== 'number' || typeof template.end !== 'number') return null;
  return { region, pos: templateToGenomic(t, { start: template.start, end: template.end, strand }) };
}

/** Clamps `n` into `[lo, hi]`. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
