import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Runs axe-core (WCAG 2.x A/AA plus best practices) on a container.
 * `color-contrast` is off because jsdom does not compute layout or cascaded
 * colours; `region` is off because components are not whole pages.
 */
export async function expectNoAxeViolations(container: Element, label = 'axe'): Promise<void> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    // Only violations are asserted; aggregating the other result types is the slow part.
    resultTypes: ['violations'],
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
    },
  });
  const summary = results.violations.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).slice(0, 5).join(' | ')}`);
  expect(summary, label).toEqual([]);
}
