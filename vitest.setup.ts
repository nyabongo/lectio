/**
 * Global test setup for every vitest project.
 *
 * Unit tests are offline. An msw server intercepts every HTTP request made through
 * `fetch` (and the SDKs built on it); a request without a matching handler fails
 * the test. Tests register handlers with `server.use(...)` from `@lectio/shared/test-server`
 * or their own msw setup.
 *
 * `LECTIO_LIVE=1` (set only by `npm run test:live`, L-212) disables the guard so the
 * provider contract suites can reach real services.
 */
import { afterAll, afterEach, beforeAll } from 'vitest';

import { server } from './packages/shared/src/test-server.ts';

const live = process.env['LECTIO_LIVE'] === '1';

if (!live) {
  beforeAll(() => {
    // msw 3 renamed v2's `onUnhandledRequest` to `onUnhandledFrame`; 'error' fails the request.
    server.listen({ onUnhandledFrame: 'error' });
  });
  afterEach(() => {
    server.resetHandlers();
  });
  afterAll(() => {
    server.close();
  });
}
