import { DEFAULT_CONFIG } from '@lectio/config';
import { ContentError } from '@lectio/content';
import { FakeGitHubClient, ProviderError } from '@lectio/providers';
import type { GitHubClient } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';
import { describe, expect, it } from 'vitest';

import { RESEARCH_TRAILER, bodyMarker } from './body.ts';
import { researchPassage } from './fixtures/passage.ts';
import { formatJson } from './format-json.ts';
import {
  RESEARCH_LABEL,
  filesHash,
  groupItems,
  passageFiles,
  passagePath,
  publishAll,
  publishPassage,
} from './publish.ts';
import type { PublishOptions } from './publish.ts';

const KEY = 'MT.20.1-16';
const BRANCH = `research/${KEY}`;
const PATH = `passages/${KEY}.json`;

function setup(): { github: FakeGitHubClient; options: PublishOptions } {
  const github = new FakeGitHubClient();
  return { github, options: { github, config: DEFAULT_CONFIG } };
}

async function closedEvents(github: FakeGitHubClient, number: number): Promise<number> {
  return (await github.listIssueEvents(number)).filter((event) => event.event === 'closed').length;
}

describe('passage files', () => {
  it('commits only the passage file, formatted for Prettier', () => {
    const passage = researchPassage();
    expect(passagePath(KEY)).toBe(PATH);
    expect(passageFiles(passage)).toEqual([{ path: PATH, content: formatJson(passage) }]);
    expect(filesHash(passageFiles(passage))).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('groupItems', () => {
  it('puts each passage in its own group', () => {
    const a = { passage: researchPassage() };
    const b = { passage: researchPassage({ key: 'IS.55.6-9', ref: 'Is 55:6-9' }) };
    expect(groupItems([a, b], 'passage')).toEqual([[a], [b]]);
  });

  it('rejects an unknown grouping and a passage listed twice', () => {
    const item = { passage: researchPassage() };
    expect(() => groupItems([item], 'day' as 'passage')).toThrow('unsupported research.prGrouping: "day"');
    expect(() => groupItems([item, item], 'passage')).toThrow(`passage ${KEY} is listed more than once`);
  });
});

describe('publishPassage', () => {
  it('opens a new PR on research/<key> with one signed commit carrying the passage file', async () => {
    const { github, options } = setup();
    const passage = researchPassage();
    const result = await publishPassage({ passage, dates: ['2026-09-20'] }, options);

    expect(result.created).toBe(true);
    expect(result.key).toBe(KEY);
    expect(result.branch).toBe(BRANCH);
    expect(result.files).toEqual([PATH]);
    expect(result.pr).toMatchObject({
      head: BRANCH,
      base: 'main',
      state: 'open',
      draft: false,
      fork: false,
      title: 'Research: Mt 20:1-16a (MT.20.1-16)',
      labels: [RESEARCH_LABEL],
      author: 'lectio-bot',
    });
    expect(result.pr.body).toContain('| Dates | 2026-09-20 |');
    expect(result.pr.body).toContain(bodyMarker(KEY, filesHash(passageFiles(passage))));

    expect(result.commit).not.toBeNull();
    expect(result.commit?.verified).toBe(true);
    expect(result.commit?.message).toContain(`\n\n${RESEARCH_TRAILER}: key=${KEY} run=`);
    expect(github.headOf(BRANCH)).toBe(result.commit?.sha);
    expect(github.fileAt(BRANCH, PATH)).toBe(formatJson(passage));
    expect(await github.getPrFiles(result.pr.number)).toEqual([{ path: PATH, status: 'added' }]);
    expect(github.repoLabels).toContain(RESEARCH_LABEL);
  });

  it('is idempotent: re-running with the same passage updates the PR without a new commit', async () => {
    const { github, options } = setup();
    const first = await publishPassage({ passage: researchPassage(), dates: ['2026-09-20'] }, options);
    const head = github.headOf(BRANCH);

    const again = await publishPassage({ passage: researchPassage(), dates: ['2026-09-20', '2029-09-23'] }, options);
    expect(again.created).toBe(false);
    expect(again.commit).toBeNull();
    expect(again.pr.number).toBe(first.pr.number);
    expect(again.pr.body).toContain('| Dates | 2026-09-20, 2029-09-23 |');
    expect(github.headOf(BRANCH)).toBe(head);
    expect(await github.listPrs({ state: 'all' })).toHaveLength(1);
  });

  it('updates the existing PR with a new commit when the passage changed, and never closes it', async () => {
    const { github, options } = setup();
    const first = await publishPassage({ passage: researchPassage() }, options);
    // A reviewer and the merge rule labelled the PR meanwhile; publishing keeps their labels.
    await github.as('nyabongo').addLabels(first.pr.number, ['needs-review']);
    const firstHead = github.headOf(BRANCH);

    const changed = researchPassage({ summary: 'A revised summary after a fix-up.' });
    const second = await publishPassage({ passage: changed, costUsd: 0.5 }, options);
    expect(second.created).toBe(false);
    expect(second.pr.number).toBe(first.pr.number);
    expect(second.commit?.parents).toEqual([firstHead]);
    expect(github.fileAt(BRANCH, PATH)).toBe(formatJson(changed));
    expect(second.pr.state).toBe('open');
    expect(second.pr.labels).toEqual(['research', 'needs-review']);
    expect(second.pr.body).toContain('| Cost | $0.50 |');
    expect(second.pr.body).toContain(bodyMarker(KEY, filesHash(passageFiles(changed))));
    expect(await closedEvents(github, first.pr.number)).toBe(0);
    expect(await github.listPrs({ state: 'all' })).toHaveLength(1);
  });

  it('commits again when the PR body lost its marker', async () => {
    const { github, options } = setup();
    const first = await publishPassage({ passage: researchPassage() }, options);
    await github.openOrUpdatePr({ head: BRANCH, title: first.pr.title, body: 'edited by hand' });
    const again = await publishPassage({ passage: researchPassage() }, options);
    expect(again.commit).not.toBeNull();
    expect(again.pr.number).toBe(first.pr.number);
  });

  it('opens a new PR on the existing branch when the earlier PR was closed, without reopening it', async () => {
    const { github, options } = setup();
    const first = await publishPassage({ passage: researchPassage() }, options);
    await github.as('nyabongo').closePr(first.pr.number);
    const oldHead = github.headOf(BRANCH);

    const second = await publishPassage({ passage: researchPassage() }, options);
    expect(second.created).toBe(true);
    expect(second.pr.number).not.toBe(first.pr.number);
    expect(second.commit?.parents).toEqual([oldHead]);
    expect((await github.getPr(first.pr.number)).state).toBe('closed');
  });

  it('ignores a fork PR that uses the same branch name', async () => {
    const { github, options } = setup();
    await github.createBranch({ name: BRANCH });
    await github.commitFiles({ branch: BRANCH, message: 'fork work', files: [{ path: 'x.txt', content: 'x' }] });
    const fork = await github.openForkPr({ head: BRANCH, headRepo: 'someone/lectio', title: 'fork', body: 'mine' });

    const result = await publishPassage({ passage: researchPassage() }, options);
    expect(result.created).toBe(true);
    expect(result.pr.number).not.toBe(fork.number);
    expect(result.pr.fork).toBe(false);
    const untouched = await github.getPr(fork.number);
    expect(untouched).toMatchObject({ title: 'fork', body: 'mine', state: 'open', labels: [] });
  });

  it('branches from and targets the given base', async () => {
    const { github, options } = setup();
    await github.createBranch({ name: 'staging' });
    await github.commitFiles({ branch: 'staging', message: 'staging', files: [{ path: 'a.txt', content: 'a' }] });
    const result = await publishPassage({ passage: researchPassage() }, { ...options, base: 'staging' });
    expect(result.pr.base).toBe('staging');
    expect(result.commit?.parents).toEqual([github.headOf('staging')]);
  });

  it('refuses an invalid passage, a mismatched key and an approved passage before touching GitHub', async () => {
    const { github, options } = setup();
    const broken = { ...researchPassage(), text: 'reading text' } as unknown as Passage;
    await expect(publishPassage({ passage: broken }, options)).rejects.toBeInstanceOf(ContentError);
    const approved = researchPassage({
      review: { status: 'approved', method: 'human', reviewers: ['nyabongo'], approvedVia: 'label' },
    });
    await expect(publishPassage({ passage: approved }, options)).rejects.toThrow(
      'research publishes pending passages only',
    );
    expect(await github.listPrs({ state: 'all' })).toHaveLength(0);
    expect(() => github.headOf(BRANCH)).toThrow(ProviderError);
  });

  it('passes on GitHub errors other than an existing branch', async () => {
    const failing: PublishOptions['github'] = {
      listPrs: async () => [],
      createBranch: async () => {
        throw new ProviderError('unavailable', 'GitHub is down');
      },
      commitFiles: async () => {
        throw new Error('not reached');
      },
      openOrUpdatePr: async () => {
        throw new Error('not reached');
      },
    };
    await expect(
      publishPassage({ passage: researchPassage() }, { github: failing, config: DEFAULT_CONFIG }),
    ).rejects.toThrow('GitHub is down');
  });
});

describe('publishAll', () => {
  it('opens one PR per passage and records failures without stopping', async () => {
    const { github, options } = setup();
    const other = researchPassage({
      key: 'IS.55.6-9',
      ref: 'Is 55:6-9',
      context: { title: 'Seek the Lord', paragraphs: ['Addressed to the exiles. [c1]'] },
      translationNotes: [],
      claims: [{ id: 'c1', text: 'Isaiah 40-55 addresses the exiles.', sourceIds: ['dt-15-9'], sensitive: false }],
    });
    const broken = { ...researchPassage({ key: 'MK.1.1', ref: 'Mk 1:1' }), verses: [] } as unknown as Passage;

    const outcomes = await publishAll(
      [{ passage: researchPassage() }, { passage: broken }, { passage: other }],
      options,
    );
    expect(outcomes.map((outcome) => [outcome.key, outcome.ok])).toEqual([
      [KEY, true],
      ['MK.1.1', false],
      ['IS.55.6-9', true],
    ]);
    const prs = await github.listPrs();
    expect(prs.map((pr) => pr.head)).toEqual([BRANCH, 'research/IS.55.6-9']);
    expect(prs.every((pr) => pr.labels.includes(RESEARCH_LABEL))).toBe(true);
    const failed = outcomes[1];
    expect(failed?.ok === false && failed.error).toBeInstanceOf(ContentError);
  });

  it('wraps a non-Error failure', async () => {
    const github = {
      listPrs: async () => {
        throw 'boom';
      },
    } as unknown as GitHubClient;
    const [outcome] = await publishAll([{ passage: researchPassage() }], { github, config: DEFAULT_CONFIG });
    expect(outcome).toMatchObject({ ok: false, key: KEY });
    expect(outcome?.ok === false && outcome.error.message).toBe('boom');
  });

  it('checks the grouping before publishing anything', async () => {
    const { github, options } = setup();
    const item = { passage: researchPassage() };
    await expect(publishAll([item, item], options)).rejects.toThrow('listed more than once');
    expect(await github.listPrs({ state: 'all' })).toHaveLength(0);
  });
});
