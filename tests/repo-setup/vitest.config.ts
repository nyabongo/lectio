/**
 * scripts/repo/setup.sh (L-032) run against a fake `gh` (fixtures/fake-gh.mjs): dry-run output,
 * registry-driven required checks, the writes a real run makes, and shellcheck. Picked up by the
 * root `tests/*` project glob; not part of unit coverage (the script is bash).
 */
import { fileURLToPath } from 'node:url';

import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'repo-setup',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['**/*.test.ts'],
    setupFiles: ['../../vitest.setup.ts'],
    testTimeout: 30_000,
  },
});
