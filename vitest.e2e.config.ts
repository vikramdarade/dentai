import { defineConfig } from 'vitest/config';

/**
 * Config for the browser smoke test only (`npm run test:e2e`).
 *
 * Separate from vitest.config.ts on purpose: this suite boots a dev server and a
 * Chromium instance, so it must not be part of `npm test`, which has to stay
 * fast and browser-free (CI installs no Playwright browsers for the unit suite).
 *
 * The e2e file is named `*.e2e.ts` rather than `*.test.ts` so the default vitest
 * include pattern in vitest.config.ts never collects it.
 */
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
