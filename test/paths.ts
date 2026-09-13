import { resolve } from 'node:path';

/**
 * Package root for tests. vitest.config.ts sets GRAMENE_PRIMERS_ROOT because
 * `import.meta.url` is not a file: URL under the jsdom environment.
 */
export const PKG_ROOT = process.env.GRAMENE_PRIMERS_ROOT ?? process.cwd();

export function pkgPath(...parts: string[]): string {
  return resolve(PKG_ROOT, ...parts);
}

export function fixturePath(...parts: string[]): string {
  return resolve(PKG_ROOT, 'test', 'fixtures', ...parts);
}
