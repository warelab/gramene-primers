import css from './primers.css?inline';

/** `id` of the `<style>` element that holds the injected stylesheet. */
export const STYLE_ELEMENT_ID = 'gramene-primers-styles';

/** The stylesheet text (also shipped as `gramene-primers/style.css`). */
export const PRIMERS_CSS: string = typeof css === 'string' ? css : '';

type StyleHost = Document | ShadowRoot;

function isShadowRoot(node: StyleHost): node is ShadowRoot {
  return typeof (node as ShadowRoot).host !== 'undefined' && !(node as Document).createElement;
}

/**
 * Injects the gramene-primers stylesheet once, as
 * `<style id="gramene-primers-styles">`, at the start of `<head>` (so host
 * stylesheets of equal specificity win) or into a shadow root. Returns true
 * when a new element was added. Safe to call repeatedly and outside browsers.
 */
export function ensureStylesInjected(target?: StyleHost | null): boolean {
  const host: StyleHost | null = target ?? (typeof document !== 'undefined' ? document : null);
  if (!host) return false;
  if (host.getElementById(STYLE_ELEMENT_ID)) return false;
  const doc = isShadowRoot(host) ? host.ownerDocument : host;
  if (!doc) return false;
  const el = doc.createElement('style');
  el.id = STYLE_ELEMENT_ID;
  el.setAttribute('data-gramene-primers', '');
  el.textContent = PRIMERS_CSS;
  if (isShadowRoot(host)) {
    host.insertBefore(el, host.firstChild);
  } else {
    const head = host.head ?? host.documentElement;
    head.insertBefore(el, head.firstChild);
  }
  return true;
}
