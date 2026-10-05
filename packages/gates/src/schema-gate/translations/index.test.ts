import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { createProviders } from '@lectio/providers';

import type { GateContext } from '../../core/gate.ts';
import { createContext } from '../../core/gate.ts';
import { formatFinding } from '../../core/result.ts';
import type { GateResultItem } from '../../core/result.ts';
import { runGates } from '../../core/runner.ts';
import { ruleBookFor } from '../../registry.ts';
import { PASSAGE_PATH, validPassage } from '../fixtures/negative.ts';
import type { PullRequestFixture } from '../fixtures/negative.ts';
import { schemaGate } from '../index.ts';
import {
  REVIEWER,
  TRANSLATION_NEGATIVE_FIXTURES,
  TRANSLATION_PATH,
  englishChanged,
  validTranslation,
  withTranslation,
} from './fixtures/negative.ts';
import { TRANSLATION_RULES, checkTranslations, englishKeyOf, fsListLocales } from './index.ts';

const ROOT = '/repo';

function contextFor(pr: PullRequestFixture, config: LectioConfig = DEFAULT_CONFIG, root = ROOT): GateContext {
  return createContext({
    root,
    base: 'origin/main',
    head: 'HEAD',
    config,
    providers: createProviders(config),
    git: { changedFiles: () => [...pr.changed], show: (_ref, path) => pr.base?.[path] ?? null },
    readText: (absolute) => pr.head[absolute.slice(root.length + 1)] ?? null,
  });
}

const sw = (): readonly string[] => ['sw'];

function check(pr: PullRequestFixture, config?: LectioConfig, prefix = ''): GateResultItem[] {
  return checkTranslations(contextFor(pr, config), prefix, { listLocales: sw }).items;
}

const rules = ruleBookFor([schemaGate]);
const ruleIds = (items: readonly GateResultItem[]): string[] => items.map((item) => item.ruleId);

describe('translation rules', () => {
  it('are schema rules, each with a negative fixture', () => {
    const ids = Object.values(TRANSLATION_RULES).map((rule) => rule.id);
    expect(ids.sort()).toEqual(Object.keys(TRANSLATION_NEGATIVE_FIXTURES).sort());
    for (const id of ids) expect(id.startsWith('schema/')).toBe(true);
  });

  it('pass a valid, approved translation', () => {
    expect(checkTranslations(contextFor(withTranslation()), '', { listLocales: sw })).toEqual({ items: [], files: 1 });
  });

  describe.each(Object.entries(TRANSLATION_NEGATIVE_FIXTURES))('negative fixture for %s', (ruleId, pr) => {
    it('reports that rule only, with a message stating the rule and the fix', () => {
      const items = check(pr);
      expect(items.length).toBeGreaterThan(0);
      expect(new Set(ruleIds(items))).toEqual(new Set([ruleId]));
      const rule = rules.get(ruleId);
      for (const item of items) {
        const text = formatFinding(item, rules);
        expect(text).toContain(`Rule: ${String(rule?.statement)}`);
        expect(text).toContain(`Fix: ${String(rule?.fix)}`);
      }
    });
  });

  it('flags staleness and pending review as warnings, everything else as errors', () => {
    const severity = (ruleId: string): string[] =>
      check(TRANSLATION_NEGATIVE_FIXTURES[ruleId] as PullRequestFixture).map((item) => item.severity);
    expect(severity('schema/translation-not-stale')).toEqual(['warning']);
    expect(severity('schema/translation-needs-review')).toEqual(['warning']);
    expect(severity('schema/translation-matches-source')).toEqual(['error']);
  });
});

describe('checkTranslations', () => {
  it('reports invalid JSON under schema/valid-translation', () => {
    const pr = withTranslation();
    const items = check({ ...pr, head: { ...pr.head, [TRANSLATION_PATH]: '{ nope' } });
    expect(ruleIds(items)).toEqual(['schema/valid-translation']);
  });

  it('reports a stale translation in the PR', () => {
    const items = check(
      withTranslation((t) => {
        t['sourceSha256'] = '0'.repeat(64);
      }),
    );
    expect(items).toEqual([
      expect.objectContaining({
        ruleId: 'schema/translation-not-stale',
        file: TRANSLATION_PATH,
        pointer: '/sourceSha256',
        message: 'the English passage MT.20.1-16 changed since this sw translation was made',
      }),
    ]);
  });

  it('reports a translation whose locale does not match its directory', () => {
    const items = check(withTranslation((t) => (t['locale'] = 'pt-BR')));
    expect(items).toEqual([
      expect.objectContaining({
        ruleId: 'schema/translation-of-exists',
        pointer: '/locale',
        message: 'a pt-BR translation of MT.20.1-16 belongs at passages/i18n/pt-BR/MT.20.1-16.json',
      }),
    ]);
  });

  it('reports a translation whose key does not match its file name', () => {
    const items = check(withTranslation((t) => (t['translationOf'] = 'MT.20.1-15')));
    expect(items.map((item) => [item.ruleId, item.pointer])).toEqual([
      ['schema/translation-of-exists', '/translationOf'],
      ['schema/translation-of-exists', '/translationOf'],
    ]);
  });

  it('reports an invalid English passage', () => {
    const pr = withTranslation();
    const items = check({ ...pr, head: { ...pr.head, [PASSAGE_PATH]: '{}' } });
    expect(items).toEqual([
      expect.objectContaining({
        ruleId: 'schema/translation-of-exists',
        message:
          'the English passage passages/MT.20.1-16.json is not a valid passage, so the translation cannot be checked against it',
      }),
    ]);
  });

  it('names every mismatch with the English passage', () => {
    const items = check(
      withTranslation((t) => {
        t['translationNotes'][0]['body'] = 'Mwili. [c1]';
      }),
    );
    expect(items).toEqual([
      expect.objectContaining({
        ruleId: 'schema/translation-matches-source',
        pointer: '/translationNotes/0/body',
        message: 'cites claims c1, but the English text cites c2',
      }),
    ]);
  });

  it('requires a claim marker after every sentence', () => {
    const items = check(
      withTranslation((t) => {
        t['context']['paragraphs'][0] = 'Sentensi bila alama. Mathayo peke yake anaandika mfano huu. [c1][c2]';
      }),
    );
    expect(ruleIds(items)).toEqual(['schema/sentence-cites-claim']);
  });

  it('rejects fake provenance', () => {
    const items = check(
      withTranslation((t) => {
        t['provenance'] = { ...t['provenance'], generator: 'fake', models: ['fake'] };
      }),
    );
    expect(items.map((item) => [item.ruleId, item.pointer])).toEqual([
      ['schema/no-fake-provenance', '/provenance/generator'],
      ['schema/no-fake-provenance', '/provenance/models/0'],
    ]);
  });

  it('requires an approval by configured reviewers', () => {
    const items = check(withTranslation((t) => (t['review']['reviewers'] = ['someone', REVIEWER.toUpperCase()])));
    expect(items).toEqual([
      expect.objectContaining({
        ruleId: 'schema/approved-has-reviewer',
        pointer: '/review/reviewers/0',
        message: '"someone" is not in config.reviewer.githubHandles (nyabongo)',
      }),
    ]);
    const none = { ...DEFAULT_CONFIG, reviewer: { ...DEFAULT_CONFIG.reviewer, githubHandles: [] } };
    expect(check(withTranslation(), none).map((item) => item.message)).toEqual([
      `"${REVIEWER}" is not in config.reviewer.githubHandles (none)`,
    ]);
  });

  it('ignores deleted translations, missing files and other paths', () => {
    const pr: PullRequestFixture = {
      head: {},
      changed: [
        { path: TRANSLATION_PATH, status: 'deleted' },
        { path: 'passages/i18n/pt-BR/MT.20.1-16.json', status: 'added' },
        { path: 'passages/i18n/en/MT.20.1-16.json', status: 'added' },
        { path: 'docs/x.md', status: 'modified' },
      ],
    };
    expect(checkTranslations(contextFor(pr), '', { listLocales: sw })).toEqual({ items: [], files: 0 });
  });

  it('checks translations under a nested content root and skips files outside it', () => {
    const pr = withTranslation((t) => (t['review'] = { status: 'pending', reviewers: [] }));
    const nested: PullRequestFixture = {
      head: Object.fromEntries(Object.entries(pr.head).map(([path, text]) => [`content/${path}`, text])),
      changed: [...pr.changed.map((change) => ({ ...change, path: `content/${change.path}` })), ...pr.changed],
    };
    const items = check(nested, DEFAULT_CONFIG, 'content/');
    expect(items.map((item) => [item.ruleId, item.file])).toEqual([
      ['schema/translation-needs-review', `content/${TRANSLATION_PATH}`],
    ]);
  });
});

describe('translations of a changed English passage', () => {
  it('are left alone while they are fresh', () => {
    expect(check(englishChanged((p) => (p['sources'][0]['citation'] = 'Deut 15:9')))).toEqual([]);
  });

  it('stay fresh after a whitespace-only English edit', () => {
    const items = check(
      englishChanged((p) => {
        // Leading and trailing spaces are schema errors in a passage, so only inner whitespace changes.
        p['claims'][0]['text'] = String(p['claims'][0]['text']).replace(' ', '  ');
        p['summary'] = String(p['summary']).replace(' ', '  ');
      }),
    );
    expect(items).toEqual([]);
  });

  it('are flagged stale when a translatable field changed', () => {
    const items = check(englishChanged((p) => (p['claims'][0]['text'] = 'Only Matthew has this parable.')));
    expect(items).toEqual([
      expect.objectContaining({ ruleId: 'schema/translation-not-stale', file: TRANSLATION_PATH, severity: 'warning' }),
    ]);
  });

  it('are reported as orphaned when the English passage is deleted', () => {
    const pr: PullRequestFixture = {
      head: { [TRANSLATION_PATH]: JSON.stringify(validTranslation()) },
      changed: [{ path: PASSAGE_PATH, status: 'deleted' }],
    };
    expect(check(pr)).toEqual([
      expect.objectContaining({
        ruleId: 'schema/translation-of-exists',
        file: TRANSLATION_PATH,
        message: 'the English passage passages/MT.20.1-16.json does not exist',
      }),
    ]);
  });

  it('are checked once when the PR also changes them, and skipped when missing or unreadable', () => {
    const pr = englishChanged((p) => (p['claims'][0]['text'] = 'Changed.'));
    const both: PullRequestFixture = {
      ...pr,
      changed: [...pr.changed, { path: TRANSLATION_PATH, status: 'modified' }],
    };
    expect(ruleIds(check(both))).toEqual(['schema/translation-not-stale']);
    const broken = { ...pr, head: { ...pr.head, [TRANSLATION_PATH]: '{}' } };
    expect(check(broken)).toEqual([]);
    const locales = (): readonly string[] => ['sw', 'pt-BR'];
    expect(checkTranslations(contextFor(pr), '', { listLocales: locales }).items).toHaveLength(1);
  });
});

describe('the schema gate', () => {
  it('runs the translation checks and counts translation files', async () => {
    const pr = withTranslation((t) => (t['review'] = { status: 'pending', reviewers: [] }));
    const report = await runGates([schemaGate], contextFor(pr));
    const result = report.results[0];
    expect(result?.status).toBe('flag');
    expect(result?.meta).toEqual({ files: 1 });
    expect(result?.items.map((item) => item.ruleId)).toEqual(['schema/translation-needs-review']);
  });
});

describe('fsListLocales', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('lists the locale directories under passages/i18n, and nothing when it is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'lectio-i18n-'));
    dirs.push(root);
    const context = contextFor({ head: {}, changed: [] }, DEFAULT_CONFIG, root);
    expect(fsListLocales(context, '')).toEqual([]);
    mkdirSync(join(root, 'passages/i18n/sw'), { recursive: true });
    mkdirSync(join(root, 'passages/i18n/pt-BR'), { recursive: true });
    writeFileSync(join(root, 'passages/i18n/README.md'), 'x');
    expect(fsListLocales(context, '')).toEqual(['pt-BR', 'sw']);
  });

  it('is the default lister of checkTranslations', () => {
    const root = mkdtempSync(join(tmpdir(), 'lectio-i18n-'));
    dirs.push(root);
    mkdirSync(join(root, 'passages/i18n/sw'), { recursive: true });
    const pr = englishChanged((p) => (p['claims'][0]['text'] = 'Changed.'));
    expect(ruleIds(checkTranslations(contextFor(pr, DEFAULT_CONFIG, root), '').items)).toEqual([
      'schema/translation-not-stale',
    ]);
  });
});

describe('englishKeyOf', () => {
  it('reads the key of a passage path only', () => {
    expect(englishKeyOf('passages/MT.20.1-16.json')).toBe('MT.20.1-16');
    expect(englishKeyOf(TRANSLATION_PATH)).toBeNull();
    expect(englishKeyOf('calendar/2026.json')).toBeNull();
  });

  it('matches the fixture passage key', () => {
    expect(englishKeyOf(PASSAGE_PATH)).toBe(validPassage()['key']);
  });
});
