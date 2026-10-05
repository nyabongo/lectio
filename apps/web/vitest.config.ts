/// <reference types="vitest/config" />
/**
 * Vitest project for apps/web, picked up by the root `apps/*\/vitest.config.ts` project glob.
 *
 * `getViteConfig` runs the tests through Astro's Vite pipeline, so `.astro` components can be rendered with the
 * Container API (see src/layouts/*.test.ts). Coverage is configured at the root (src/lib and src/sw count);
 * `setupFiles` keeps the root offline msw guard.
 */
import { getViteConfig } from 'astro/config';

export default getViteConfig(
  {
    test: {
      name: '@lectio/web',
      include: ['src/**/*.test.{ts,tsx,mts}'],
      setupFiles: ['../../vitest.setup.ts'],
    },
  },
  { logLevel: 'error' },
);
