// Docs link check (L-091): every relative link and heading anchor in README.md and docs/**/*.md resolves.
// Offline (nothing is fetched). Picked up by the root `tests/*` project glob; not part of unit coverage.
import { fileURLToPath } from 'node:url';

import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'docs',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['**/*.test.ts'],
    setupFiles: ['../../vitest.setup.ts'],
  },
});
