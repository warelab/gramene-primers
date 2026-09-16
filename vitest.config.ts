import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  // The playground imports the package by name (as in vite.config.ts).
  resolve: { alias: { 'gramene-primers': resolve(__dirname, 'src/index.ts') } },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude: ['test/it/**', 'node_modules/**', 'dist/**'],
    environment: 'jsdom',
    setupFiles: ['test/setup.ts'],
    restoreMocks: true,
    // axe-core on a rendered designer takes ~1.5 s here and several times that on CI runners.
    testTimeout: 30_000,
    env: { GRAMENE_PRIMERS_ROOT: __dirname },
  },
});
