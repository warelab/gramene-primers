import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index';
import { pkgPath } from './paths';

describe('public headless API', () => {
  it('exports every headless name from spec §C.2', () => {
    for (const name of [
      'createPrimersClient',
      'PrimersApiError',
      'isAbortError',
      'buildDesignRequest',
      'buildCheckRequest',
      'isCheckablePrimer',
      'CHECK_LIMITS',
      'PRESETS',
      'EXPLAIN_HINTS',
      'revcomp',
      'pairsToTSV',
      'primersToFasta',
      'ampliconsToFasta',
      'offTargetsToTSV',
      'pangenomeToTSV',
      'estimateCheckCpu',
      'initialDesignerState',
      'normalizeDesignerState',
      'VERSION',
    ]) {
      expect(api, name).toHaveProperty(name);
      expect((api as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it('VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8')) as { version: string; dependencies?: Record<string, string> };
    expect(api.VERSION).toBe(pkg.version);
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
