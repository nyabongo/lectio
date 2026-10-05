/**
 * The SourceFetcher contract against the real web. Skipped unless `LECTIO_LIVE=1` (`npm run test:live`, L-212),
 * which also disables the offline msw guard. No key is needed: the fetcher reads public pages only.
 */
import { describeSourceFetcherContract } from '@lectio/providers/contracts';
import { describe } from 'vitest';

import { LiveSourceFetcher } from './fetcher.ts';

const live = process.env['LECTIO_LIVE'] === '1';

describe.skipIf(!live)('LiveSourceFetcher (live)', () => {
  describeSourceFetcherContract(
    () => ({
      fetcher: new LiveSourceFetcher({ cacheDir: false }),
      knownUrl: 'https://www.iana.org/help/example-domains',
      missingUrl: 'https://www.iana.org/lectio-contract-missing-page',
    }),
    { name: 'live', timeoutMs: 60_000 },
  );
});
