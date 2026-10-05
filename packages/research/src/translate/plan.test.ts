import { describe, expect, it } from 'vitest';

import { FakeGitHubClient } from '@lectio/providers';
import { translatableSha256 } from '@lectio/schema/translated-passage';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';

import { PASSAGES, REPO, SEED } from './fixtures/repo.ts';
import { TRANSLATE_BRANCH_PREFIX, planTranslations, translationBranch } from './plan.ts';
import type { TranslationPlanInput } from './plan.ts';

const fresh = { sourceSha256: translatableSha256(SEED) } as TranslatedPassage;
const stale = { sourceSha256: '0'.repeat(64) } as TranslatedPassage;

function input(overrides: Partial<TranslationPlanInput> = {}): TranslationPlanInput {
  return {
    locale: 'sw',
    from: '2026-09-20',
    days: 2,
    repo: REPO,
    readTranslation: (_locale, key) => (key === 'PS.145' ? fresh : key === 'PS.23' ? stale : null),
    github: new FakeGitHubClient(),
    ...overrides,
  };
}

describe('translationBranch', () => {
  it('is translate/<locale>/<key>', () => {
    expect(translationBranch('sw', 'MT.20.1-16')).toBe('translate/sw/MT.20.1-16');
    expect(TRANSLATE_BRANCH_PREFIX).toBe('translate/');
  });
});

describe('planTranslations', () => {
  it('plans new and stale translations of approved English passages, in calendar order', async () => {
    const plan = await planTranslations(input());
    expect(plan).toMatchObject({ locale: 'sw', from: '2026-09-20', to: '2026-09-21' });
    expect(plan.items.map((item) => [item.key, item.reason, item.dates])).toEqual([
      ['MT.20.1-16', 'new', ['2026-09-20', '2026-09-21']],
      ['PS.23', 'stale', ['2026-09-21']],
    ]);
    expect(plan.items[0]?.english).toBe(PASSAGES['MT.20.1-16']);
    expect(plan.skipped.map((item) => [item.key, item.reason])).toEqual([
      ['IS.55.6-9', 'english-pending'],
      ['PS.145', 'fresh'],
      ['PHIL.1.20-24_1.27', 'no-english'],
    ]);
  });

  it('includes pending English passages on request', async () => {
    const plan = await planTranslations(input({ includePending: true }));
    expect(plan.items.map((item) => item.key)).toEqual(['IS.55.6-9', 'MT.20.1-16', 'PS.23']);
  });

  it('skips passages with an open translation PR and stops at max', async () => {
    const github = new FakeGitHubClient();
    await github.createBranch({ name: 'translate/sw/MT.20.1-16' });
    await github.commitFiles({ branch: 'translate/sw/MT.20.1-16', message: 'x', files: [{ path: 'a', content: 'b' }] });
    const { pr } = await github.openOrUpdatePr({ head: 'translate/sw/MT.20.1-16', title: 't', body: 'b' });
    const plan = await planTranslations(input({ github, includePending: true, max: 1 }));
    expect(plan.items.map((item) => item.key)).toEqual(['IS.55.6-9']);
    expect(plan.skipped).toContainEqual({
      key: 'MT.20.1-16',
      reason: 'open-pr',
      dates: ['2026-09-20', '2026-09-21'],
      pr: pr.number,
    });
    expect(plan.skipped).toContainEqual({ key: 'PS.23', reason: 'max', dates: ['2026-09-21'] });
  });

  it('plans one key with --only, in the window or later', async () => {
    const inWindow = await planTranslations(input({ only: 'PS.23' }));
    expect(inWindow.items.map((item) => [item.key, item.dates])).toEqual([['PS.23', ['2026-09-21']]]);
    const later = await planTranslations(input({ only: 'JN.1.1-18' }));
    expect(later.items.map((item) => [item.key, item.dates])).toEqual([['JN.1.1-18', ['2026-12-25']]]);
  });

  it('plans nothing outside the calendar', async () => {
    const plan = await planTranslations(input({ from: '2027-01-01', days: 3 }));
    expect(plan.items).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });
});
