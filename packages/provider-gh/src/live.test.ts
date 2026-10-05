/**
 * The GitHubClient contract against a real, throwaway repository (L-212). Skipped unless
 * `LECTIO_LIVE=1` (`npm run test:live`), `GH_TOKEN`, `LECTIO_GH_REPO` (`owner/name`) and
 * `LECTIO_GH_RUN_ID` (any workflow run in that repo) are set. It creates branches, PRs,
 * labels and an issue there, so never point it at nyabongo/lectio.
 */
import { describeGitHubContract } from '@lectio/providers/contracts';
import { describe } from 'vitest';

import { GhGitHubClient } from './client.ts';

const env = process.env;
const enabled = env['LECTIO_LIVE'] === '1' && !!env['GH_TOKEN'] && !!env['LECTIO_GH_REPO'] && !!env['LECTIO_GH_RUN_ID'];

describe.runIf(enabled)('GhGitHubClient (live)', () => {
  const prefix = `contract-${Date.now()}/`;
  let run = 0;
  describeGitHubContract(
    async () => {
      const client = new GhGitHubClient({ repo: env['LECTIO_GH_REPO'] as string });
      const known = await client.getWorkflowRun(Number(env['LECTIO_GH_RUN_ID']));
      return {
        client,
        defaultBranch: env['LECTIO_GH_DEFAULT_BRANCH'] ?? 'main',
        workflowFile: env['LECTIO_GH_WORKFLOW'] ?? 'ci.yml',
        prefix: `${prefix}${++run}-`,
        knownRun: {
          id: known.id,
          workflowFile: known.workflowFile,
          event: known.event,
          headSha: known.headSha,
          headBranch: known.headBranch,
        },
      };
    },
    { name: 'gh (live)', timeoutMs: 120_000 },
  );
});
