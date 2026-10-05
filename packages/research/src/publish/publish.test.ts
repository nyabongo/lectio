import { DEFAULT_CONFIG } from '@lectio/config';
import { ContentError } from '@lectio/content';
import { FakeGitHubClient, ProviderError } from '@lectio/providers';
import type { GitHubClient } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';
import { describe, expect, it } from 'vitest';

import { GATES_END, GATES_START, RESEARCH_TRAILER, bodyMarker } from './body.ts';
import { researchPassage } from './fixtures/passage.ts';
import { formatJson } from './format-json.ts';
import {
  APPROVAL_AUTHOR,
  APPROVAL_TRAILER,
  PublishRefusedError,
  RESEARCH_LABEL,
  filesHash,
  groupItems,
  isReplaceableHead,
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

describe('isReplaceableHead', () => {
  it('accepts research commits for the key and the bot approval commit only', () => {
    const research = `Research\n\n${RESEARCH_TRAILER}: key=${KEY} run=r prompt=p models=m`;
    const approval = `Approve\n\n${APPROVAL_TRAILER}: auto run=1 head=abc`;
    expect(isReplaceableHead({ message: research, author: 'nyabongo' }, KEY)).toBe(true);
    expect(isReplaceableHead({ message: research, author: 'nyabongo' }, 'MT.20.1')).toBe(false);
    expect(isReplaceableHead({ message: approval, author: APPROVAL_AUTHOR }, KEY)).toBe(true);
    expect(isReplaceableHead({ message: approval, author: 'nyabongo' }, KEY)).toBe(false);
    expect(isReplaceableHead({ message: 'Approve', author: APPROVAL_AUTHOR }, KEY)).toBe(false);
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

  it('never re-opens or replaces a PR a person closed', async () => {
    const { github, options } = setup();
    const first = await publishPassage({ passage: researchPassage() }, options);
    // The closed PR's branch also holds a human commit outside passages/.
    await github.as('nyabongo').pushCommit({
      branch: BRANCH,
      message: 'tweak config',
      files: [{ path: 'config/lectio.config.json', content: '{}' }],
    });
    await github.as('nyabongo').closePr(first.pr.number);
    const head = github.headOf(BRANCH);

    const refusal = publishPassage({ passage: researchPassage() }, options);
    await expect(refusal).rejects.toBeInstanceOf(PublishRefusedError);
    await expect(refusal).rejects.toMatchObject({ reason: 'closed-pr', branch: BRANCH, pr: first.pr.number });
    await expect(refusal).rejects.toThrow(`PR #${String(first.pr.number)} on ${BRANCH} was closed without merging`);
    expect(github.headOf(BRANCH)).toBe(head);
    expect(await github.listPrs({ state: 'all' })).toHaveLength(1);
    expect((await github.getPr(first.pr.number)).state).toBe('closed');
  });

  it('refuses a leftover research branch that has no PR', async () => {
    const { github, options } = setup();
    await github.createBranch({ name: BRANCH });
    await github
      .as('nyabongo')
      .pushCommit({ branch: BRANCH, message: 'wip', files: [{ path: 'x.txt', content: 'x' }] });
    const head = github.headOf(BRANCH);

    const refusal = publishPassage({ passage: researchPassage() }, options);
    await expect(refusal).rejects.toMatchObject({ reason: 'leftover-branch', branch: BRANCH, pr: undefined });
    await expect(refusal).rejects.toThrow(`branch ${BRANCH} exists without an open PR; delete it to re-research`);
    expect(github.headOf(BRANCH)).toBe(head);
    expect(await github.listPrs({ state: 'all' })).toHaveLength(0);
  });

  it('ignores a fork PR on the same branch name and refuses rather than carrying its files', async () => {
    const { github, options } = setup();
    await github.createBranch({ name: BRANCH });
    await github.commitFiles({ branch: BRANCH, message: 'fork work', files: [{ path: 'x.txt', content: 'x' }] });
    const fork = await github.openForkPr({ head: BRANCH, headRepo: 'someone/lectio', title: 'fork', body: 'mine' });
    const head = github.headOf(BRANCH);

    await expect(publishPassage({ passage: researchPassage() }, options)).rejects.toMatchObject({
      reason: 'leftover-branch',
      branch: BRANCH,
    });
    expect(github.headOf(BRANCH)).toBe(head);
    expect(await github.listPrs({ state: 'all' })).toHaveLength(1);
    const untouched = await github.getPr(fork.number);
    expect(untouched).toMatchObject({ title: 'fork', body: 'mine', state: 'open', labels: [], fork: true });
  });

  it('refuses to commit over a human commit at the head of the open PR', async () => {
    const { github, options } = setup();
    const first = await publishPassage({ passage: researchPassage() }, options);
    const human = await github.as('nyabongo').pushCommit({
      branch: BRANCH,
      message: 'Fix a claim',
      files: [{ path: PATH, content: 'HUMAN EDIT' }],
    });

    const refusal = publishPassage({ passage: researchPassage({ summary: 'A different summary.' }) }, options);
    await expect(refusal).rejects.toMatchObject({ reason: 'foreign-head', branch: BRANCH, pr: first.pr.number });
    await expect(refusal).rejects.toThrow(`PR #${String(first.pr.number)} head ${human.sha.slice(0, 12)}`);
    expect(github.headOf(BRANCH)).toBe(human.sha);
    expect(github.fileAt(BRANCH, PATH)).toBe('HUMAN EDIT');
    expect((await github.getPr(first.pr.number)).body).toBe(first.pr.body);
  });

  it('refuses a research commit for another passage at the head', async () => {
    const { github, options } = setup();
    const first = await publishPassage({ passage: researchPassage() }, options);
    await github.commitFiles({
      branch: BRANCH,
      message: `Other\n\n${RESEARCH_TRAILER}: key=${KEY}X run=r prompt=p models=m`,
      files: [{ path: 'passages/other.json', content: '{}' }],
    });
    await expect(publishPassage({ passage: researchPassage({ summary: 'Changed.' }) }, options)).rejects.toMatchObject({
      reason: 'foreign-head',
      pr: first.pr.number,
    });
  });

  it('commits over the approval commit, resetting the passage to pending', async () => {
    const { github, options } = setup();
    const first = await publishPassage({ passage: researchPassage() }, options);
    const approved = researchPassage({
      review: { status: 'approved', method: 'human', reviewers: ['nyabongo'], approvedVia: 'label' },
    });
    const approval = await github.as(APPROVAL_AUTHOR).commitFiles({
      branch: BRANCH,
      message: `Approve ${KEY}\n\n${APPROVAL_TRAILER}: human run=7 head=${github.headOf(BRANCH)}`,
      files: passageFiles(approved),
    });

    const changed = researchPassage({ summary: 'A fix-up after review.' });
    const result = await publishPassage({ passage: changed }, options);
    expect(result.pr.number).toBe(first.pr.number);
    expect(result.commit?.parents).toEqual([approval.sha]);
    expect(github.fileAt(BRANCH, PATH)).toBe(formatJson(changed));
    expect(JSON.parse(github.fileAt(BRANCH, PATH) ?? '{}').review).toEqual({ status: 'pending', reviewers: [] });
  });

  it('keeps the gate section the content-gates workflow wrote', async () => {
    const { github, options } = setup();
    const first = await publishPassage({ passage: researchPassage() }, options);
    const gates = `${GATES_START}\n- [x] Schema: pass\n${GATES_END}`;
    const edited = first.pr.body.replace(/<!-- lectio-gates:start -->[\s\S]*<!-- lectio-gates:end -->/u, gates);
    await github.openOrUpdatePr({ head: BRANCH, title: first.pr.title, body: edited });

    const again = await publishPassage({ passage: researchPassage({ summary: 'Changed again.' }) }, options);
    expect(again.pr.body).toContain(gates);
    expect(again.pr.body).not.toContain('Placeholder');
    expect(again.pr.body).toContain('> Changed again.');
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
      'research publishes pending passages only, got review.status "approved"',
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
      getCommit: async () => {
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

  it('reports a passage whose PR a person closed as skipped, and other refusals as failures', async () => {
    const { github, options } = setup();
    const first = await publishPassage({ passage: researchPassage() }, options);
    await github.as('nyabongo').closePr(first.pr.number);
    await github.createBranch({ name: 'research/IS.55.6-9' });
    const other = researchPassage({ key: 'IS.55.6-9', ref: 'Is 55:6-9' });

    const outcomes = await publishAll([{ passage: researchPassage() }, { passage: other }], options);
    expect(outcomes).toMatchObject([
      { ok: false, key: KEY, skipped: true, error: { reason: 'closed-pr' } },
      { ok: false, key: 'IS.55.6-9', skipped: false, error: { reason: 'leftover-branch' } },
    ]);
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
