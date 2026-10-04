/**
 * The one msw server shared by every vitest project (started in the root `vitest.setup.ts`).
 *
 * It starts with no handlers, so any HTTP request a unit test makes fails with an
 * "unhandled request" error unless the test registers a handler first:
 *
 * ```ts
 * import { http, HttpResponse } from 'msw';
 * import { server } from '@lectio/shared/test-server';
 *
 * server.use(http.get('https://example.org/page', () => HttpResponse.text('hello')));
 * ```
 */
import { setupServer } from 'msw/node';

export const server = setupServer();
