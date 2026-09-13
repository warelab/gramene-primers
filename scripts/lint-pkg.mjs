#!/usr/bin/env node
// `npm run lint:pkg`: publint, then @arethetypeswrong/cli on a tarball packed into a temporary directory.
//
// `attw --pack .` runs `npm pack` in the package root and deletes the resulting
// gramene-primers-<version>.tgz afterwards, which is the same file `npm run pack:local` makes for
// gramene-search. Packing elsewhere keeps a local tarball intact whichever script runs last.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => join(root, 'node_modules', '.bin', name);

function run(cmd, args, options = {}) {
  try {
    return execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...options });
  } catch (err) {
    process.exitCode = typeof err.status === 'number' && err.status !== 0 ? err.status : 1;
    throw err;
  }
}

const dir = mkdtempSync(join(tmpdir(), 'gramene-primers-attw-'));
try {
  run(bin('publint'), []);
  const out = run('npm', ['pack', '--pack-destination', dir, '--json', '--ignore-scripts'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const [info] = JSON.parse(out);
  if (!info || typeof info.filename !== 'string') throw new Error(`lint-pkg: unexpected npm pack output: ${out}`);
  // npm < 9.7 reports scoped names with a leading "@"; the file on disk has none.
  const tarball = join(dir, info.filename.replace(/^@/, '').replace(/\//, '-'));
  run(bin('attw'), [tarball, '--exclude-entrypoints', './style.css']);
} catch (err) {
  if (!process.exitCode) process.exitCode = 1;
  if (!(err && typeof err.status === 'number')) console.error(err instanceof Error ? err.message : err);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
