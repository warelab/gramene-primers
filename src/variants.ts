import { hashString } from './state';

/**
 * Okabe-Ito, the palette used elsewhere in the package: distinguishable with
 * the common forms of colour blindness.
 */
export const CONSEQUENCE_PALETTE: ReadonlyArray<string> = Object.freeze([
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#CC79A7',
  '#56B4E9',
  '#D55E00',
  '#8C6D1F',
  '#555555',
]);

/**
 * A stable colour for a consequence term. The assignment is arbitrary but
 * derived from the term itself, so a consequence keeps its colour as you pan,
 * refilter or come back tomorrow. Colour is never the only channel: the browser
 * pairs it with a legend, and the table names the term in full.
 */
export function consequenceColor(consequence: string | null | undefined): string {
  if (!consequence) return CONSEQUENCE_PALETTE[CONSEQUENCE_PALETTE.length - 1]!;
  const n = parseInt(hashString(consequence).slice(0, 8), 16);
  return CONSEQUENCE_PALETTE[n % CONSEQUENCE_PALETTE.length]!;
}

/** `3_prime_UTR_variant` reads as `3 prime UTR variant`. */
export function consequenceLabel(consequence: string | null | undefined): string {
  return consequence ? consequence.replace(/_/g, ' ') : 'no consequence reported';
}
