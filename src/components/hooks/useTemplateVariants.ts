import { useMemo } from 'react';
import { capsForAmplicon, variantOnTemplate, type TemplateVariant } from '../../amplicon';
import type { RestrictionEnzyme } from '../../enzymes';
import type { PrimerPair, PrimerTemplate, PrimersClient, VariantListQuery } from '../../types';
import { GENOTYPING_LIMITS } from '../../validate';
import { useVariantList } from './useVariants';

export interface PlacedVariant {
  key: string;
  label: string;
  variant: TemplateVariant;
  consequence: string | null;
  /** An enzyme yields a readable digest for this variant in some designed product. */
  caps: boolean;
  capsEnzyme: string | null;
}

export interface TemplateVariantsState {
  variants: PlacedVariant[];
  loading: boolean;
  /**
   * Why there is nothing to show, when that is worth saying: `no-coordinates`
   * for a pasted sequence, `unsupported` for a host that cannot list variants,
   * `too-wide` for a template larger than the listing allows, `unavailable`
   * when the genome has no variation data. Null once variants were looked for.
   */
  reason: 'no-coordinates' | 'unsupported' | 'too-wide' | 'unavailable' | null;
}

const NOTES: Readonly<Record<string, string>> = {
  'no-coordinates': 'A pasted sequence has no genomic coordinates, so variants cannot be looked up for it.',
  unsupported: 'Variant lookups are not available here.',
  'too-wide': 'This template is too large to list variants for.',
  unavailable: 'This genome has no variation data.',
};

/** The sentence to show in place of a CAPS table, or null when there is nothing to explain. */
export function templateVariantsNote(reason: TemplateVariantsState['reason']): string | null {
  return reason ? (NOTES[reason] ?? null) : null;
}

/**
 * Variants inside a designed template, placed in its coordinates and marked
 * with whether any designed product can genotype them by digestion.
 *
 * One listing for the whole template rather than one per pair: the pairs
 * overlap, the template is already bounded by the listing limit, and a request
 * per pair would be five requests for the same window.
 */
export function useTemplateVariants(
  client: PrimersClient,
  template: PrimerTemplate | null | undefined,
  pairs: ReadonlyArray<PrimerPair>,
  options: { variationAvailable?: boolean; enzymes?: ReadonlyArray<RestrictionEnzyme> } = {},
): TemplateVariantsState {
  const hasCoords =
    !!template &&
    template.mode !== 'sequence' &&
    !!template.region &&
    typeof template.start === 'number' &&
    typeof template.end === 'number';
  const span = hasCoords ? (template.end as number) - (template.start as number) + 1 : 0;
  const tooWide = span > GENOTYPING_LIMITS.maxWindow;
  const supported = typeof client.listVariants === 'function';
  const available = options.variationAvailable !== false;

  const query: VariantListQuery | null = useMemo(() => {
    if (!hasCoords || tooWide || !available || !template?.system_name) return null;
    return {
      system_name: template.system_name,
      region: template.region as string,
      start: template.start as number,
      end: template.end as number,
    };
  }, [hasCoords, tooWide, available, template?.system_name, template?.region, template?.start, template?.end]);

  const list = useVariantList(client, query);
  const listed = list.data?.variants ?? [];
  const pairKey = pairs.map((p) => `${p.left.start}-${p.right.end}`).join(',');

  const variants = useMemo(() => {
    if (!template || !listed.length) return [];
    const placed = listed
      .map((v) => {
        const on = variantOnTemplate(template, v.vcf);
        return on ? { key: v.key, label: v.label, variant: on, consequence: v.consequence ?? null } : null;
      })
      .filter((x): x is Omit<PlacedVariant, 'caps' | 'capsEnzyme'> => x !== null);
    if (!placed.length) return [];

    // A variant is marked on the map when some designed product actually reads
    // it on a gel — not merely when an enzyme's site changes.
    const best = new Map<string, string>();
    for (const pair of pairs) {
      const span = { start: pair.left.start, end: pair.right.end };
      for (const c of capsForAmplicon(template.seq, span, placed, { enzymes: options.enzymes })) {
        if (c.resolvable && !best.has(c.key)) best.set(c.key, c.enzyme.name);
      }
    }
    return placed.map((v) => ({ ...v, caps: best.has(v.key), capsEnzyme: best.get(v.key) ?? null }));
  }, [template, listed, pairKey, options.enzymes]);

  const reason: TemplateVariantsState['reason'] = !template
    ? null
    : !hasCoords
      ? 'no-coordinates'
      : !available
        ? 'unavailable'
        : tooWide
          ? 'too-wide'
          : !supported || list.unsupported
            ? 'unsupported'
            : null;

  return { variants, loading: list.loading, reason };
}
