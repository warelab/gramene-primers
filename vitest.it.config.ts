import { defineConfig } from 'vitest/config';

// Opt-in integration tests (skipped unless the env vars are set):
//   PRIMERS_IT_BASE=http://localhost:50111/sorghum_v11 npm run test:it     live API: design, genomes, errors, contract fixtures
//   PRIMERS_IT_CHECKS=1 (with PRIMERS_IT_BASE)                             also run a BLAST check job on the server
//   PRIMERS_FASTAIDX=http://localhost:8888 npm run test:it                 coordinate helpers against real genome sequence
export default defineConfig({
  test: {
    include: ['test/it/**/*.it.test.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: { GRAMENE_PRIMERS_ROOT: __dirname },
  },
});
