/**
 * Content gate suites: `tests/gates/NN-<gate>.gate.test.ts` (L-024 to L-028) run the gates over
 * the real repository content, one named test per rule (`gateTest` in ./helpers). Picked up by
 * the root `tests/*` project glob; not part of unit coverage (coverage counts packages/*\/src).
 */
import { fileURLToPath } from 'node:url';

import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'gates-content',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['**/*.test.ts'],
    setupFiles: ['../../vitest.setup.ts'],
    testTimeout: 60_000,
  },
});
