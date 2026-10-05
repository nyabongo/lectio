import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  describeClockContract,
  describeGitHubContract,
  describeLlmContract,
  describeObjectStorageContract,
  describeSourceFetcherContract,
  describeTtsContract,
  describeWebSearchContract,
} from '@lectio/providers/contracts';
import { afterAll } from 'vitest';

import {
  FakeClock,
  FakeGitHubClient,
  FakeLlmClient,
  FakeTtsProvider,
  FakeWebSearch,
  FixtureSourceFetcher,
  FsObjectStorage,
  MemoryObjectStorage,
  MemorySourceFetcher,
  systemClock,
} from './index.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sources');
const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// Fakes pass their own contract suites, with determinism asserted where it applies.

describeLlmContract((costMeter) => new FakeLlmClient({ costMeter }), {
  name: 'fake',
  model: 'fake',
  deterministic: true,
});
describeLlmContract(
  (costMeter) =>
    new FakeLlmClient({
      costMeter,
      roles: { generator: { citations: [{ url: 'https://example.org/source', citedText: 'cited passage' }] } },
    }),
  { model: 'claude-sonnet-5-5', pricing: { 'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10 } } },
);

describeClockContract(() => new FakeClock({ stepMs: 1 }), { name: 'fake' });
describeClockContract(() => systemClock);

describeWebSearchContract(() => new FakeWebSearch(), { name: 'fake', deterministic: true });
describeWebSearchContract(
  () =>
    new FakeWebSearch({
      results: { 'history of the codex format': [{ url: 'https://example.org/a', title: 'A', snippet: 'a' }] },
    }),
);

describeSourceFetcherContract(
  () => ({
    fetcher: new MemorySourceFetcher({ 'https://example.org/page': { text: 'Some commentary.' } }),
    knownUrl: 'https://example.org/page',
    missingUrl: 'https://example.org/missing',
  }),
  { name: 'memory', deterministic: true },
);
describeSourceFetcherContract(() => ({
  fetcher: new FixtureSourceFetcher(fixtures),
  knownUrl: 'https://example.org/codex-history',
  missingUrl: 'https://example.org/missing',
}));

describeTtsContract(() => new FakeTtsProvider(), { name: 'fake', voice: 'en-KE-AsiliaNeural', deterministic: true });
describeTtsContract(() => new FakeTtsProvider(), { voice: 'sw-KE-ZuriNeural', format: 'wav' });

describeObjectStorageContract(() => new MemoryObjectStorage(), { name: 'memory' });
describeObjectStorageContract(
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'lectio-storage-'));
    tempDirs.push(dir);
    return new FsObjectStorage(dir);
  },
  { prefix: 'run-1/' },
);

/** A fake repository with one recorded `pull_request` run, as the contract subject needs. */
function githubSubject(options: ConstructorParameters<typeof FakeGitHubClient>[0], prefix: string) {
  const client = new FakeGitHubClient(options);
  const defaultBranch = client.defaultBranch;
  const knownRun = client.addWorkflowRun({
    workflowFile: 'content-gates.yml',
    event: 'pull_request',
    headSha: client.headOf(defaultBranch),
    headBranch: defaultBranch,
    prNumbers: [],
    status: 'completed',
    conclusion: 'success',
    actor: 'angello',
  });
  return { client, defaultBranch, prefix, knownRun };
}

let run = 0;
describeGitHubContract(
  () => ({
    ...githubSubject({ workflows: { 'ci.yml': { jobs: ['lint'] } } }, `contract-${++run}/`),
    workflowFile: 'ci.yml',
  }),
  { name: 'fake' },
);
describeGitHubContract(() => ({
  // Required checks that never report: waitForRequiredChecks times out.
  ...githubSubject(
    {
      defaultBranch: 'trunk',
      requiredChecks: ['lint', 'merge-rule'],
      workflows: { 'deploy.yml': {} },
      clock: new FakeClock({ start: '2026-10-05T00:00:00Z' }),
    },
    'x/',
  ),
  workflowFile: 'deploy.yml',
}));
