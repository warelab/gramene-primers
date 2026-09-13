// Copies the rolled-up ESM declaration file to dist/index.d.cts so that
// `require` consumers get CJS-flavoured types (checked by `attw --pack`).
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'dist/index.d.ts');
const to = resolve(root, 'dist/index.d.cts');

if (!existsSync(from)) {
  console.error(`copy-dts: ${from} not found (did vite build emit declarations?)`);
  process.exit(1);
}
copyFileSync(from, to);
console.log('copy-dts: dist/index.d.ts -> dist/index.d.cts');
