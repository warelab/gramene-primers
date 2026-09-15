import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = __dirname;
const STYLE_SOURCE = resolve(root, 'src/styles/primers.css');

/**
 * Ships the stylesheet for CSP-strict hosts (`gramene-primers/style.css`).
 * The same file is imported with `?inline` for runtime injection, which does
 * not emit a CSS asset on its own.
 */
function emitStylesheet(): Plugin {
  return {
    name: 'gramene-primers-emit-css',
    apply: 'build',
    generateBundle() {
      const source = existsSync(STYLE_SOURCE) ? readFileSync(STYLE_SOURCE, 'utf8') : '';
      this.emitFile({ type: 'asset', fileName: 'gramene-primers.css', source });
    },
  };
}

/**
 * - `npm run build` -> library build into ./dist (ESM + CJS + rolled-up d.ts + css).
 * - `npm run dev`   -> playground (examples/playground) on :5174; `gramene-primers`
 *                      resolves to src/. `?api=live` calls `PRIMERS_API` when set,
 *                      else `/sorghum_v11`, which is proxied to the dev API.
 */
export default defineConfig(({ command }) => {
  if (command === 'build') {
    return {
      plugins: [
        react(),
        dts({
          tsconfigPath: resolve(root, 'tsconfig.build.json'),
          include: ['src'],
          exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          rollupTypes: true,
        }),
        emitStylesheet(),
      ],
      build: {
        target: 'es2020',
        sourcemap: true,
        emptyOutDir: true,
        lib: {
          entry: resolve(root, 'src/index.ts'),
          name: 'GramenePrimers',
          formats: ['es', 'cjs'],
          fileName: (format) => `gramene-primers.${format === 'es' ? 'js' : 'cjs'}`,
        },
        rollupOptions: {
          // React is a peer dependency; never bundle it.
          external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', /^react(-dom)?\//],
          output: { exports: 'named' },
        },
      },
    };
  }

  return {
    plugins: [react()],
    root: resolve(root, 'examples/playground'),
    define: {
      'import.meta.env.PRIMERS_API': JSON.stringify(process.env.PRIMERS_API ?? ''),
    },
    resolve: {
      alias: { 'gramene-primers': resolve(root, 'src/index.ts') },
    },
    server: {
      port: 5174,
      strictPort: true,
      proxy: {
        '/sorghum_v11': {
          target: process.env.PRIMERS_PROXY_TARGET || 'http://localhost:50111',
          changeOrigin: true,
        },
      },
    },
  };
});
