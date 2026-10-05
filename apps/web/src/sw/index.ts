/**
 * The service worker entry point, bundled by `build.ts` into `<dist>/sw.js`. `__LECTIO_SW__` (the build version and
 * the precache list) is replaced at bundle time; the behaviour is in `worker.ts`.
 */
import type { ServiceWorkerConfig } from '../lib/sw-policy.ts';
import { installWorker } from './worker.ts';
import type { WorkerScope } from './worker.ts';

declare const __LECTIO_SW__: ServiceWorkerConfig;

installWorker(globalThis as unknown as WorkerScope, __LECTIO_SW__, {
  caches: globalThis.caches,
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => Date.now(),
});
