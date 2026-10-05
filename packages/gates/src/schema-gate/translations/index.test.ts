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
import { TRANSLATION_RULES, checkTranslations, englishKeyOf, fsListLocales, misplacedContentFile } from './index.ts';

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

describe('misplacedContentFile', () => {
  it('accepts canonical translation paths, passage-level files and everything outside passages/', () => {
    for (const path of [
      TRANSLATION_PATH,
      'passages/i18n/pt-BR/MT.20.1-16.json',
      'passages/i18n/zh-Hant/MT.20.1-16.json',
      PASSAGE_PATH,
      'passages/PS.119.1_119.27_119.30_119.34_119.35_119.44.json',
      'calendar/2026.json',
      'docs/passages/i18n/x.md',
      'passage/i18n/sw/MT.20.1-16.json',
    ]) {
      expect(misplacedContentFile(path, ''), path).toBeNull();
    }
  });

  it.each([
    ['Passages/i18n/sw/MT.20.1-16.json', 'the directory must be spelled passages/ exactly, in lower case'],
    ['PASSAGES/MT.20.1-16.json', 'the directory must be spelled passages/ exactly, in lower case'],
    ['passages/MT.20.1-16.JSON', 'only passage files (<key>.json, lower-case extension) may sit directly in passages/'],
    ['passages/MT.20.1-16.Json', 'only passage files (<key>.json, lower-case extension) may sit directly in passages/'],
    [
      'passages/MT.20.1-16.json.',
      'only passage files (<key>.json, lower-case extension) may sit directly in passages/',
    ],
    [
      'passages/MT.20.1-16.json ',
      'only passage files (<key>.json, lower-case extension) may sit directly in passages/',
    ],
    [
      'passages/MT.20.1-16.json\t',
      'only passage files (<key>.json, lower-case extension) may sit directly in passages/',
    ],
    ['passages/x.json.bak', 'only passage files (<key>.json, lower-case extension) may sit directly in passages/'],
    [
      'passages/MT.20.1-16.json.txt',
      'only passage files (<key>.json, lower-case extension) may sit directly in passages/',
    ],
    ['passages/notes.txt', 'only passage files (<key>.json, lower-case extension) may sit directly in passages/'],
    ['passages/notes.md', 'only passage files (<key>.json, lower-case extension) may sit directly in passages/'],
    ['passages/README', 'only passage files (<key>.json, lower-case extension) may sit directly in passages/'],
    ['passages/README.md', 'only passage files (<key>.json, lower-case extension) may sit directly in passages/'],
    ['passages/.hidden', 'only passage files (<key>.json, lower-case extension) may sit directly in passages/'],
    ['passages/.gitattributes', 'only passage files (<key>.json, lower-case extension) may sit directly in passages/'],
    ['passages/MT.20.1-16', 'only passage files (<key>.json, lower-case extension) may sit directly in passages/'],
    ['passages/x.json', '"x" is not a passage key'],
    ['passages/.json', '"" is not a passage key'],
    ['passages/MT.20.1-16 .json', '"MT.20.1-16 " is not a passage key'],
    ['passages/mt.20.1-16.json', '"mt.20.1-16" is not a passage key'],
    ['passages/MT.20.1-16.json.json', '"MT.20.1-16.json" is not a passage key'],
    [
      'passages/I18N/sw/MT.20.1-16.json',
      'the translation directory must be spelled passages/i18n/ exactly, in lower case',
    ],
    [
      'passages/I18n/sw/MT.20.1-16.json',
      'the translation directory must be spelled passages/i18n/ exactly, in lower case',
    ],
    [
      'passages/i18N/sw/MT.20.1-16.json',
      'the translation directory must be spelled passages/i18n/ exactly, in lower case',
    ],
    [
      'passages/translations/sw/MT.20.1-16.json',
      'passages/translations/ is not a content directory: only passages/i18n/ may hold files',
    ],
    ['passages/sw/MT.20.1-16.json', 'passages/sw/ is not a content directory: only passages/i18n/ may hold files'],
    [
      'passages/i18n.bak/sw/MT.20.1-16.json',
      'passages/i18n.bak/ is not a content directory: only passages/i18n/ may hold files',
    ],
    [
      'passages/ i18n/sw/MT.20.1-16.json',
      'passages/ i18n/ is not a content directory: only passages/i18n/ may hold files',
    ],
    ['passages//i18n/sw/MT.20.1-16.json', 'passages// is not a content directory: only passages/i18n/ may hold files'],
    ['passages/i18n/MT.20.1-16.json', 'a translation sits exactly one locale directory below passages/i18n/'],
    ['passages/i18n/README.md', 'a translation sits exactly one locale directory below passages/i18n/'],
    ['passages/i18n/sw/nested/MT.20.1-16.json', 'a translation sits exactly one locale directory below passages/i18n/'],
    ['passages/i18n/sw/MT.20.1-16.JSON', 'a translation is a .json file (lower-case extension)'],
    ['passages/i18n/sw/MT.20.1-16.json.txt', 'a translation is a .json file (lower-case extension)'],
    ['passages/i18n/sw/notes.md', 'a translation is a .json file (lower-case extension)'],
    [
      'passages/i18n/en/MT.20.1-16.json',
      '"en" is not a translation locale (a BCP 47 tag such as sw or pt-BR, never English)',
    ],
    [
      'passages/i18n/en-KE/MT.20.1-16.json',
      '"en-KE" is not a translation locale (a BCP 47 tag such as sw or pt-BR, never English)',
    ],
    [
      'passages/i18n/SW/MT.20.1-16.json',
      '"SW" is not a translation locale (a BCP 47 tag such as sw or pt-BR, never English)',
    ],
    [
      'passages/i18n/pt-br/MT.20.1-16.json',
      '"pt-br" is not a translation locale (a BCP 47 tag such as sw or pt-BR, never English)',
    ],
    [
      'passages/i18n/../MT.20.1-16.json',
      '".." is not a translation locale (a BCP 47 tag such as sw or pt-BR, never English)',
    ],
    ['passages/i18n/sw/mt.20.1-16.json', '"mt.20.1-16" is not a passage key'],
    ['passages/i18n/sw/.json', '"" is not a passage key'],
    ['passages/i18n/sw/MT.20.1-16 copy.json', '"MT.20.1-16 copy" is not a passage key'],
  ])('rejects %s', (path, reason) => {
    expect(misplacedContentFile(path, '')).toBe(reason);
  });

  it('reads paths under a nested content root, in any letter case', () => {
    expect(misplacedContentFile(`content/${TRANSLATION_PATH}`, 'content/')).toBeNull();
    expect(misplacedContentFile(TRANSLATION_PATH, 'content/')).toBeNull();
    expect(misplacedContentFile('content/passages/I18N/sw/MT.20.1-16.json', 'content/')).toBe(
      'the translation directory must be spelled content/passages/i18n/ exactly, in lower case',
    );
    expect(misplacedContentFile('Content/passages/i18n/sw/MT.20.1-16.json', 'content/')).toBe(
      'the directory must be spelled content/passages/ exactly, in lower case',
    );
    expect(misplacedContentFile('content/passages/x/y.json', 'content/')).toBe(
      'content/passages/x/ is not a content directory: only content/passages/i18n/ may hold files',
    );
  });
});

describe('schema/translation-path', () => {
  const path = 'passages/I18N/sw/MT.20.1-16.json';

  it('rejects a case-variant translation directory instead of ignoring the file', () => {
    expect(check(withTranslation(() => undefined, path))).toEqual([
      {
        ruleId: 'schema/translation-path',
        severity: 'error',
        file: path,
        pointer: '',
        message: `${path} is not a passage or translation path: the translation directory must be spelled passages/i18n/ exactly, in lower case. Translations live at passages/i18n/<locale>/<key>.json`,
      },
    ]);
  });

  it('reports every misplaced file the PR adds, modifies, renames or copies, and none it deletes', () => {
    const pr: PullRequestFixture = {
      head: {},
      changed: [
        { path: 'passages/i18n/en/MT.20.1-16.json', status: 'added' },
        { path: 'passages/i18n/sw/deep/MT.20.1-16.json', status: 'modified' },
        { path: 'passages/I18N/sw/MT.20.1-16.json', status: 'renamed', previousPath: TRANSLATION_PATH },
        { path: 'passages/other/MT.20.1-16.json', status: 'copied', previousPath: PASSAGE_PATH },
        { path: 'passages/i18n/sw/MT.20.1-16.JSON', status: 'type-changed' },
        { path: 'passages/I18N/sw/LK.9.1-6.json', status: 'deleted' },
      ],
    };
    const result = checkTranslations(contextFor(pr), '', { listLocales: sw });
    expect(result.files).toBe(0);
    expect(result.items.map((item) => [item.ruleId, item.file])).toEqual([
      ['schema/translation-path', 'passages/i18n/en/MT.20.1-16.json'],
      ['schema/translation-path', 'passages/i18n/sw/deep/MT.20.1-16.json'],
      ['schema/translation-path', 'passages/I18N/sw/MT.20.1-16.json'],
      ['schema/translation-path', 'passages/other/MT.20.1-16.json'],
      ['schema/translation-path', 'passages/i18n/sw/MT.20.1-16.JSON'],
    ]);
  });

  it('checks case variants of a nested content root too', () => {
    const pr: PullRequestFixture = {
      head: {},
      changed: [
        { path: 'Content/passages/i18n/sw/MT.20.1-16.json', status: 'added' },
        { path: 'content/passages/I18N/sw/MT.20.1-16.json', status: 'added' },
        { path: 'passages/I18N/sw/MT.20.1-16.json', status: 'added' },
      ],
    };
    expect(check(pr, DEFAULT_CONFIG, 'content/').map((item) => item.file)).toEqual([
      'Content/passages/i18n/sw/MT.20.1-16.json',
      'content/passages/I18N/sw/MT.20.1-16.json',
    ]);
  });

  it('fails the schema gate for a stray file next to a valid passage, which no other gate reads', async () => {
    for (const stray of [
      'passages/MT.20.1-16.json.',
      'passages/MT.20.1-16.json ',
      'passages/x.json.bak',
      'passages/notes.txt',
      'passages/.hidden',
    ]) {
      const pr: PullRequestFixture = {
        head: { [PASSAGE_PATH]: JSON.stringify(validPassage()), [stray]: JSON.stringify(validPassage()) },
        changed: [
          { path: PASSAGE_PATH, status: 'added' },
          { path: stray, status: 'added' },
        ],
      };
      const result = (await runGates([schemaGate], contextFor(pr))).results[0];
      expect(result?.status, stray).toBe('fail');
      expect(result?.items.map((item) => [item.ruleId, item.file])).toEqual([['schema/translation-path', stray]]);
    }
  });

  it('fails the schema gate', async () => {
    const report = await runGates([schemaGate], contextFor(withTranslation(() => undefined, path)));
    expect(report.results[0]?.status).toBe('fail');
  });
});

describe('translations of a renamed English passage', () => {
  const NEW_KEY = 'MT.20.1-15';
  const NEW_PATH = `passages/${NEW_KEY}.json`;

  /** A PR that renames the English passage to `to`, leaving its translation at the old key. */
  function renamed(to = NEW_PATH, head: Record<string, string> = {}): PullRequestFixture {
    return {
      head: { [to]: JSON.stringify(validPassage()), [TRANSLATION_PATH]: JSON.stringify(validTranslation()), ...head },
      changed: [{ path: to, status: 'renamed', previousPath: PASSAGE_PATH }],
    };
  }

  it('are reported as orphaned, with where to move them', () => {
    expect(check(renamed())).toEqual([
      {
        ruleId: 'schema/translation-of-exists',
        severity: 'error',
        file: TRANSLATION_PATH,
        pointer: '/translationOf',
        message: `the English passage ${PASSAGE_PATH} was renamed to ${NEW_PATH}: move this translation to passages/i18n/sw/${NEW_KEY}.json and set translationOf to "${NEW_KEY}"`,
      },
    ]);
  });

  it('are reported in every locale, valid or not', () => {
    const pt = 'passages/i18n/pt-BR/MT.20.1-16.json';
    const pr = renamed(NEW_PATH, { [pt]: '{ not json' });
    const items = checkTranslations(contextFor(pr), '', { listLocales: () => ['pt-BR', 'sw'] }).items;
    expect(items.map((item) => [item.file, item.message])).toEqual([
      [pt, expect.stringContaining(`move this translation to passages/i18n/pt-BR/${NEW_KEY}.json`)],
      [TRANSLATION_PATH, expect.stringContaining(`move this translation to passages/i18n/sw/${NEW_KEY}.json`)],
    ]);
  });

  it('pass once the PR moves them along', () => {
    const moved = `passages/i18n/sw/${NEW_KEY}.json`;
    const translation = { ...validTranslation(), translationOf: NEW_KEY };
    const pr: PullRequestFixture = {
      head: { [NEW_PATH]: JSON.stringify({ ...validPassage(), key: NEW_KEY }), [moved]: JSON.stringify(translation) },
      changed: [
        { path: NEW_PATH, status: 'renamed', previousPath: PASSAGE_PATH },
        { path: moved, status: 'renamed', previousPath: TRANSLATION_PATH },
      ],
    };
    expect(check(pr)).toEqual([]);
  });

  it('are orphaned when the English passage leaves passages/', () => {
    for (const to of ['archive/MT.20.1-16.json', 'passages/old/MT.20.1-16.json', 'passages/MT.20.1-16.md']) {
      const items = check(renamed(to)).filter((item) => item.ruleId === 'schema/translation-of-exists');
      expect(items).toEqual([
        expect.objectContaining({
          file: TRANSLATION_PATH,
          message: `the English passage ${PASSAGE_PATH} was renamed to ${to}, which is not a passage, so this translation is orphaned: restore the English passage or delete the translation`,
        }),
      ]);
    }
  });

  it('are orphaned when the English passage leaves a nested content root', () => {
    const pr: PullRequestFixture = {
      head: { [`content/${TRANSLATION_PATH}`]: JSON.stringify(validTranslation()) },
      changed: [{ path: 'elsewhere/MT.20.1-16.json', status: 'renamed', previousPath: `content/${PASSAGE_PATH}` }],
    };
    expect(check(pr, DEFAULT_CONFIG, 'content/').map((item) => item.message)).toEqual([
      expect.stringContaining('was renamed to elsewhere/MT.20.1-16.json, which is not a passage'),
    ]);
  });

  it('are checked as usual when a new English passage takes the old key', () => {
    const pr = renamed(NEW_PATH, { [PASSAGE_PATH]: JSON.stringify(validPassage()) });
    expect(check(pr)).toEqual([]);
    const changed = { ...validPassage(), summary: 'A landowner pays every labourer the same wage, whenever hired.' };
    expect(ruleIds(check(renamed(NEW_PATH, { [PASSAGE_PATH]: JSON.stringify(changed) })))).toEqual([
      'schema/translation-not-stale',
    ]);
    const invalid = check(renamed(NEW_PATH, { [PASSAGE_PATH]: '{}' }));
    expect(invalid.map((item) => item.message)).toEqual([
      'the English passage passages/MT.20.1-16.json is not a valid passage, so the translation cannot be checked against it',
    ]);
  });

  it('are left alone by a copy, which keeps the English passage', () => {
    const pr: PullRequestFixture = {
      head: {
        [PASSAGE_PATH]: JSON.stringify(validPassage()),
        [NEW_PATH]: JSON.stringify(validPassage()),
        [TRANSLATION_PATH]: JSON.stringify(validTranslation()),
      },
      changed: [{ path: NEW_PATH, status: 'copied', previousPath: PASSAGE_PATH }],
    };
    expect(check(pr)).toEqual([]);
  });

  it('are not involved when the renamed file was not an English passage', () => {
    for (const previousPath of ['drafts/MT.20.1-16.json', 'passages/i18n/sw/MT.20.1-16.json', 'calendar/2026.json']) {
      const pr: PullRequestFixture = {
        head: {
          [PASSAGE_PATH]: JSON.stringify(validPassage()),
          [TRANSLATION_PATH]: JSON.stringify(validTranslation()),
        },
        changed: [{ path: NEW_PATH, status: 'renamed', previousPath }],
      };
      expect(check({ ...pr, head: { ...pr.head, [NEW_PATH]: JSON.stringify(validPassage()) } })).toEqual([]);
    }
  });

  it('ignore a rename onto the same key and a rename from outside the content root', () => {
    const same: PullRequestFixture = {
      head: { [PASSAGE_PATH]: JSON.stringify(validPassage()), [TRANSLATION_PATH]: JSON.stringify(validTranslation()) },
      changed: [{ path: PASSAGE_PATH, status: 'renamed', previousPath: PASSAGE_PATH }],
    };
    expect(check(same)).toEqual([]);
    const outside: PullRequestFixture = {
      head: { [`content/${TRANSLATION_PATH}`]: JSON.stringify(validTranslation()) },
      changed: [{ path: `content/${NEW_PATH}`, status: 'renamed', previousPath: PASSAGE_PATH }],
    };
    expect(check(outside, DEFAULT_CONFIG, 'content/')).toEqual([]);
  });

  it('report a translation that is invalid too when the English passage is deleted', () => {
    const pr: PullRequestFixture = {
      head: { [TRANSLATION_PATH]: '{ not json' },
      changed: [{ path: PASSAGE_PATH, status: 'deleted' }],
    };
    expect(check(pr).map((item) => item.message)).toEqual([
      'the English passage passages/MT.20.1-16.json does not exist',
    ]);
  });
});

describe('the schema gate over a renamed English passage', () => {
  it('fails while its translation is left at the old key', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lectio-rename-'));
    mkdirSync(join(root, 'passages/i18n/sw'), { recursive: true });
    const pr: PullRequestFixture = {
      head: {
        'passages/MT.20.1-15.json': JSON.stringify({ ...validPassage(), key: 'MT.20.1-15' }),
        [TRANSLATION_PATH]: JSON.stringify(validTranslation()),
      },
      changed: [{ path: 'passages/MT.20.1-15.json', status: 'renamed', previousPath: PASSAGE_PATH }],
      base: { [PASSAGE_PATH]: JSON.stringify(validPassage()) },
    };
    const report = await runGates([schemaGate], contextFor(pr, DEFAULT_CONFIG, root));
    rmSync(root, { recursive: true, force: true });
    const items = report.results[0]?.items ?? [];
    expect(items.filter((item) => item.file === TRANSLATION_PATH).map((item) => item.ruleId)).toEqual([
      'schema/translation-of-exists',
    ]);
    expect(report.results[0]?.status).toBe('fail');
  });
});
