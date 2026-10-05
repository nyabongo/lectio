import { describe, expect, it } from 'vitest';

import { FakeGitHubClient, ProviderError } from '@lectio/providers';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';

import { NEEDS_REVIEW_LABEL } from '../plan/plan.ts';
import { GATES_END, GATES_START } from '../publish/body.ts';
import { formatJson } from '../publish/format-json.ts';
import { pseudoTranslation } from './fixtures/fake-translation.ts';
import { SEED } from './fixtures/repo.ts';
import {
  TRANSLATION_LABEL,
  TRANSLATION_TRAILER,
  TranslationPublishRefusedError,
  isTranslationHead,
  publishTranslation,
  translationCommitMessage,
  translationPrBody,
  translationPrTitle,
} from './publish.ts';
import { assembleTranslation } from './translate.ts';

function translation(
  runId = 'translate-1',
  costUsd: number | null = 0.12,
  models = ['claude-opus-5-5'],
): TranslatedPassage {
  const value = assembleTranslation(SEED, pseudoTranslation(SEED), {
    locale: 'sw',
    runId,
    models,
    family: models.length === 0 ? 'fake' : 'anthropic',
    createdAt: '2026-10-05T07:50:00Z',
    costUsd: costUsd ?? 0,
  });
  if (costUsd === null) delete (value.provenance as { costUsd?: number }).costUsd;
  return value;
}

const PATH = 'passages/i18n/sw/MT.20.1-16.json';
const BRANCH = 'translate/sw/MT.20.1-16';

describe('translation PR text', () => {
  it('has a title, a commit trailer and a body that says it needs review', () => {
    const t = translation();
    expect(translationPrTitle(t)).toBe('Translate MT.20.1-16 into sw');
    expect(translationCommitMessage(t)).toBe(
      `translate(sw): MT.20.1-16\n\n${TRANSLATION_TRAILER}: key=MT.20.1-16 locale=sw source=${t.sourceSha256} run=translate-1`,
    );
    const body = translationPrBody(t, PATH, ['2026-09-20']);
    expect(body).toContain('Kiswahili (Swahili)');
    expect(body).toContain('`passages/i18n/sw/MT.20.1-16.json`');
    expect(body).toContain('2026-09-20');
    expect(body).toContain('$0.12');
    expect(body).toContain('Translations never auto-merge.');
    expect(body).toContain(GATES_START);
  });

  it('says when dates, models or cost are unknown', () => {
    const body = translationPrBody(translation('r', null, []), PATH, []);
    expect(body).toContain('not in this window');
    expect(body).toContain('| Models | none |');
    expect(body).toContain('| Cost | unknown |');
  });

  it('recognises its own commits only', () => {
    const t = translation();
    expect(isTranslationHead({ message: translationCommitMessage(t) }, t)).toBe(true);
    expect(isTranslationHead({ message: 'fix typo' }, t)).toBe(false);
  });
});

describe('publishTranslation', () => {
  it('opens a needs-review PR with the translation file', async () => {
    const github = new FakeGitHubClient();
    const t = translation();
    const result = await publishTranslation({ translation: t, dates: ['2026-09-20'] }, { github });
    expect(result).toMatchObject({ key: 'MT.20.1-16', locale: 'sw', branch: BRANCH, created: true, path: PATH });
    expect(result.commit).not.toBeNull();
    expect(result.pr.labels).toEqual([TRANSLATION_LABEL, NEEDS_REVIEW_LABEL]);
    expect(result.pr.title).toBe('Translate MT.20.1-16 into sw');
    const files = await github.getPrFiles(result.pr.number);
    expect(files.map((file) => file.path)).toEqual([PATH]);
  });

  it('updates the open PR in place, committing only a changed file and keeping the gate section', async () => {
    const github = new FakeGitHubClient();
    const first = await publishTranslation({ translation: translation() }, { github, base: 'main' });
    const gates = `${GATES_START}\nschema: flag\n${GATES_END}`;
    await github.openOrUpdatePr({
      head: BRANCH,
      title: first.pr.title,
      body: first.pr.body.replace(/<!-- lectio-gates:start -->[\s\S]*<!-- lectio-gates:end -->/, gates),
    });
    const same = await publishTranslation({ translation: translation() }, { github, base: 'main' });
    expect(same).toMatchObject({ created: false, commit: null });
    expect(same.pr.body).toContain('schema: flag');
    const next = await publishTranslation({ translation: translation('translate-2') }, { github });
    expect(next.created).toBe(false);
    expect(next.commit?.message).toContain('run=translate-2');
  });

  it('refuses after a person closed the PR', async () => {
    const github = new FakeGitHubClient();
    const first = await publishTranslation({ translation: translation() }, { github });
    await github.as('nyabongo').closePr(first.pr.number);
    await expect(publishTranslation({ translation: translation() }, { github })).rejects.toMatchObject({
      name: 'TranslationPublishRefusedError',
      reason: 'closed-pr',
      branch: BRANCH,
    });
  });

  it('refuses a leftover branch and a foreign head', async () => {
    const github = new FakeGitHubClient();
    await github.createBranch({ name: BRANCH });
    await expect(publishTranslation({ translation: translation() }, { github })).rejects.toMatchObject({
      reason: 'leftover-branch',
    });

    const other = new FakeGitHubClient();
    await publishTranslation({ translation: translation() }, { github: other });
    await other.commitFiles({
      branch: BRANCH,
      message: 'reviewer edit',
      files: [{ path: PATH, content: formatJson({}) }],
    });
    const error = await publishTranslation({ translation: translation('translate-2') }, { github: other }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TranslationPublishRefusedError);
    expect((error as TranslationPublishRefusedError).reason).toBe('foreign-head');
  });

  it('rethrows other branch errors and refuses approved translations', async () => {
    const github = new FakeGitHubClient();
    const failing = {
      ...github,
      listPrs: github.listPrs.bind(github),
      createBranch: () => Promise.reject(new ProviderError('unavailable', 'down')),
    };
    await expect(publishTranslation({ translation: translation() }, { github: failing as never })).rejects.toThrow(
      'down',
    );
    const approved = {
      ...translation(),
      review: { status: 'approved', method: 'human', reviewers: ['a'], approvedVia: 'cli' },
    } as TranslatedPassage;
    await expect(publishTranslation({ translation: approved }, { github })).rejects.toThrow('pending review only');
  });
});
