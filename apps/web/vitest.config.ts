/**
 * Minimal project config so the apps/web placeholder test runs under the root
 * `apps/*\/vitest.config.ts` project glob. L-050 replaces it (Astro Container
 * API tests etc.); keep `setupFiles` pointing at the root offline guard.
 */
import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@lectio/web',
    include: ['src/**/*.test.{ts,tsx,mts}'],
    setupFiles: ['../../vitest.setup.ts'],
  },
});
