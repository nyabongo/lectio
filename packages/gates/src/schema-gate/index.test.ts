import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { createProviders } from '@lectio/providers';

import type { GateContext } from '../core/gate.ts';
import { createContext } from '../core/gate.ts';
import type { ChangedFile } from '../core/git.ts';
import { formatFinding } from '../core/result.ts';
import type { GateResult } from '../core/result.ts';
import { runGates } from '../core/runner.ts';
import { ruleBookFor } from '../registry.ts';
import {
  CALENDAR_PATH,
  NEGATIVE_FIXTURES,
  PASSAGE_PATH,
  added,
  validCalendar,
  validPassage,
} from './fixtures/negative.ts';
import type { PullRequestFixture } from './fixtures/negative.ts';
import { SCHEMA_RULES, checkSchema, contentKindAt, contentPrefix, schemaGate } from './index.ts';

const ROOT = '/repo';

function contextFor(pr: PullRequestFixture, config: LectioConfig = DEFAULT_CONFIG): GateContext {
  return createContext({
    root: ROOT,
    base: 'origin/main',
    head: 'HEAD',
    config,
    providers: createProviders(config),
    git: { changedFiles: () => [...pr.changed], show: (_ref, path) => pr.base?.[path] ?? null },
    readText: (absolute) => pr.head[absolute.slice(ROOT.length + 1)] ?? null,
  });
}

async function run(pr: PullRequestFixture, config?: LectioConfig): Promise<GateResult> {
  const report = await runGates([schemaGate], contextFor(pr, config));
  return report.results[0] as GateResult;
}

const rules = ruleBookFor([schemaGate]);
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function passage(edit: (p: Json) => void, path = PASSAGE_PATH): PullRequestFixture {
  const value: Json = validPassage();
  edit(value);
  return added(path, value);
}

function calendar(edit: (c: Json) => void, path = CALENDAR_PATH): PullRequestFixture {
  const value: Json = validCalendar();
  edit(value);
  return added(path, value);
}

const ruleIds = (result: GateResult): string[] => result.items.map((item) => item.ruleId);

describe('schemaGate', () => {
  it('declares every rule under the schema gate, each with a negative fixture', () => {
    expect(schemaGate.id).toBe('schema');
    expect(schemaGate.rules.map((rule) => rule.id).sort()).toEqual(Object.keys(NEGATIVE_FIXTURES).sort());
    for (const rule of schemaGate.rules) expect(rule.id.startsWith('schema/')).toBe(true);
  });

  it('passes the valid fixtures and the real seed passage', async () => {
    const seed = readFileSync(new URL('../../../../passages/MT.20.1-16.json', import.meta.url), 'utf8');
    const pr: PullRequestFixture = {
      head: { [PASSAGE_PATH]: JSON.stringify(validPassage()), [CALENDAR_PATH]: JSON.stringify(validCalendar()) },
      changed: [
        { path: CALENDAR_PATH, status: 'added' },
        { path: PASSAGE_PATH, status: 'added' },
      ],
    };
    expect(await run(pr)).toEqual({ gate: 'schema', status: 'pass', items: [], meta: { files: 2 } });
    const seeded = await run({
      head: { [PASSAGE_PATH]: seed },
      changed: [{ path: PASSAGE_PATH, status: 'modified' }],
      base: { [PASSAGE_PATH]: seed },
    });
    expect(seeded.items).toEqual([]);
  });

  describe.each(Object.entries(NEGATIVE_FIXTURES))('negative fixture for %s', (ruleId, pr) => {
    it('fails that rule only, with a message stating the rule and the fix', async () => {
      const result = await run(pr);
      expect(result.status).toBe('fail');
      expect(result.items.length).toBeGreaterThan(0);
      expect(new Set(ruleIds(result))).toEqual(new Set([ruleId]));
      const rule = rules.get(ruleId);
      for (const item of result.items) {
        const text = formatFinding(item, rules);
        expect(text).toContain(ruleId);
        expect(text).toContain(`Rule: ${String(rule?.statement)}`);
        expect(text).toContain(`Fix: ${String(rule?.fix)}`);
      }
    });
  });

  it('reports nothing when no content file changed, and ignores deleted and non-content files', async () => {
    const result = await run({
      head: { 'docs/notes.md': 'x', 'calendar/lectionary/sundays/a.json': '{}' },
      changed: [
        { path: 'calendar/lectionary/sundays/a.json', status: 'added' },
        { path: 'docs/notes.md', status: 'modified' },
        { path: 'passages/README.md', status: 'added' },
        { path: 'calendar/2025.json', status: 'deleted' },
        { path: 'passages/IS.55.6-9.json', status: 'added' },
      ],
    });
    expect(result).toEqual({ gate: 'schema', status: 'pass', items: [], meta: { files: 0 } });
  });

  it('reports invalid JSON and every schema problem with its pointer', async () => {
    const broken = await run(added(PASSAGE_PATH, '{ not json'));
    expect(broken.items).toHaveLength(1);
    expect(broken.items[0]).toMatchObject({ ruleId: 'schema/valid-passage', pointer: '', file: PASSAGE_PATH });
    expect(broken.items[0]?.message).toMatch(/^not valid JSON/);

    const result = await run(
      passage((p) => {
        delete p.summary;
        p.locale = 'english';
      }),
    );
    expect(result.items.map((item) => [item.ruleId, item.pointer, item.message])).toEqual([
      ['schema/valid-passage', '/summary', 'is required'],
      ['schema/valid-passage', '/locale', expect.any(String) as string],
    ]);

    const year = await run(added(CALENDAR_PATH, { year: 2026 }));
    expect(new Set(ruleIds(year))).toEqual(new Set(['schema/valid-calendar']));
  });

  describe('references', () => {
    it('reports a key that is not canonical, without checking verses', async () => {
      const result = await run(passage((p) => (p.key = 'XX.20.1-16'), 'passages/XX.20.1-16.json'));
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ ruleId: 'schema/ref-parses', pointer: '/key' });
    });

    it('reports a key that names verses that do not exist', async () => {
      const result = await run(
        passage((p) => {
          p.key = 'MT.29.1';
          p.ref = 'Mt 29:1';
        }, 'passages/MT.29.1.json'),
      );
      expect(result.items.map((item) => [item.ruleId, item.pointer])).toEqual([['schema/ref-is-real-verse', '/key']]);
    });

    it('reports a ref or source ref that does not parse', async () => {
      const result = await run(
        passage((p) => {
          p.ref = 'Zz 20:1';
          p.sources[0].ref = 'Deuteronomy';
        }),
      );
      expect(result.items.map((item) => [item.ruleId, item.pointer])).toEqual([
        ['schema/ref-parses', '/ref'],
        ['schema/ref-parses', '/sources/0/ref'],
      ]);
    });

    it('accepts a note verse anywhere in a multi-chapter passage', async () => {
      const result = await run(
        passage((p) => {
          p.key = 'MT.19.30-20.16';
          p.ref = 'Mt 19:30—20:16';
          p.translationNotes[0].verse = '19:30';
        }, 'passages/MT.19.30-20.16.json'),
      );
      expect(result.items).toEqual([]);
    });
  });

  describe('citations', () => {
    it('reports a marker that names no claim, and the sentence it leaves uncited', async () => {
      const result = await run(
        passage((p) => (p.translationNotes[0].body = 'An image for stinginess. [c9] Also. [c2]')),
      );
      expect(result.items.map((item) => [item.ruleId, item.pointer, item.claimId, item.message])).toEqual([
        ['schema/sentence-cites-claim', '/translationNotes/0/body', 'c9', 'marker [c9] names no claim in claims[]'],
        [
          'schema/sentence-cites-claim',
          '/translationNotes/0/body',
          undefined,
          'sentence “An image for stinginess.” carries no valid [cN] marker',
        ],
      ]);
    });

    it('reports a claim no marker cites', async () => {
      const result = await run(
        passage((p) => {
          p.claims.push({ id: 'c3', text: 'An extra claim.', sourceIds: ['dt-15-9'], sensitive: false });
        }),
      );
      expect(result.items).toEqual([
        expect.objectContaining({ ruleId: 'schema/source-is-cited', pointer: '/claims/2', claimId: 'c3' }),
      ]);
    });

    it('reports duplicate claim and note ids', async () => {
      const result = await run(
        passage((p) => {
          p.claims.push({ ...p.claims[0] });
          p.translationNotes.push({ ...p.translationNotes[0] });
        }),
      );
      expect(result.items.map((item) => [item.ruleId, item.pointer])).toEqual([
        ['schema/unique-ids', '/claims/2/id'],
        ['schema/unique-ids', '/translationNotes/1/id'],
      ]);
    });
  });

  it('accepts research-cli provenance with real models', async () => {
    const result = await run(
      passage((p) => {
        p.provenance = { ...p.provenance, generator: 'research-cli', models: ['claude-opus-5-5', 'gpt-5'] };
      }),
    );
    expect(result.items).toEqual([]);
  });

  describe('schema/approved-has-reviewer', () => {
    const human = { status: 'approved', method: 'human', reviewers: ['NyaBongo'], approvedVia: 'comment' };
    const summary = {
      confirmer: { model: 'claude-sonnet-5-5', minSupport: 0.95 },
      refuter: { model: 'gpt-5', minSupport: 0.92 },
      minSupport: 0.92,
      refutations: 0,
      sensitive: 0,
    };
    const auto = { status: 'approved', method: 'auto', reviewers: [], approvedVia: 'auto', verifierSummary: summary };

    it('accepts a configured reviewer (any case) and an auto approval that meets the thresholds', async () => {
      expect((await run(passage((p) => (p.review = human)))).items).toEqual([]);
      expect((await run(passage((p) => (p.review = auto)))).items).toEqual([]);
    });

    it('names the configured handles, or none', async () => {
      const config = { ...DEFAULT_CONFIG, reviewer: { ...DEFAULT_CONFIG.reviewer, githubHandles: [] } };
      const result = await run(
        passage((p) => (p.review = human)),
        config,
      );
      expect(result.items[0]?.message).toBe('"NyaBongo" is not in config.reviewer.githubHandles (none)');
    });

    it('rejects an auto approval below the support threshold or with refutations', async () => {
      const weak = { ...summary, refuter: { model: 'gpt-5', minSupport: 0.8 }, minSupport: 0.8, refutations: 1 };
      const result = await run(passage((p) => (p.review = { ...auto, verifierSummary: weak })));
      expect(result.items.map((item) => [item.ruleId, item.pointer, item.message])).toEqual([
        [
          'schema/approved-has-reviewer',
          '/review/verifierSummary/minSupport',
          'lowest verifier support 0.8 is below config.autoMerge.minSupport 0.9',
        ],
        [
          'schema/approved-has-reviewer',
          '/review/verifierSummary/refutations',
          '1 refutations exceed config.autoMerge.maxRefutations 0',
        ],
      ]);
    });
  });

  describe('calendar years', () => {
    it('reports a file name that is not <year>.json, or names another year', async () => {
      const named = await run(added('calendar/kenya.json', validCalendar()));
      expect(named.items.map((item) => [item.ruleId, item.pointer])).toEqual([['schema/key-matches-filename', '']]);
      const other = await run(added('calendar/2027.json', validCalendar()));
      expect(other.items.map((item) => [item.ruleId, item.pointer])).toEqual([
        ['schema/key-matches-filename', '/year'],
      ]);
    });

    it('reports days out of order, duplicate dates and duplicate ids within a day', async () => {
      const result = await run(
        calendar((c) => {
          const day = c.days[0];
          day.celebrations.push({ ...day.celebrations[0] });
          day.masses.push({ ...day.masses[0] });
          c.days.push({
            ...day,
            date: '2026-09-19',
            celebrations: day.celebrations.slice(0, 1),
            masses: [],
            lectionaryMissing: true,
          });
          c.days.push({
            ...day,
            date: '2026-09-19',
            celebrations: day.celebrations.slice(0, 1),
            masses: [],
            lectionaryMissing: true,
          });
        }),
      );
      expect(result.items.map((item) => [item.ruleId, item.pointer])).toEqual([
        ['schema/unique-ids', '/days/0/celebrations/1/id'],
        ['schema/unique-ids', '/days/0/masses/1/id'],
        ['schema/valid-calendar', '/days/1/date'],
        ['schema/unique-ids', '/days/2/date'],
      ]);
    });

    it('checks every reading key and ref', async () => {
      const result = await run(
        calendar((c) => {
          const readings = c.days[0].masses[0].readings;
          readings[0] = { ...readings[0], key: 'XX.1.1' };
          readings[1] = { ...readings[1], ref: 'Mt 29:1', key: 'MT.29.1' };
          readings.push({ ...readings[0], ref: 'Zz 1:1', key: 'IS.55.6-9' });
        }),
      );
      expect(result.items.map((item) => [item.ruleId, item.pointer])).toEqual([
        ['schema/calendar-keys-wellformed', '/days/0/masses/0/readings/0/key'],
        ['schema/calendar-keys-wellformed', '/days/0/masses/0/readings/0/key'],
        ['schema/ref-is-real-verse', '/days/0/masses/0/readings/1/key'],
        ['schema/ref-parses', '/days/0/masses/0/readings/2/ref'],
      ]);
      expect(result.items[0]?.message).toBe('2026-09-20 day first-reading: "XX.1.1" is not a canonical passage key');
    });
  });

  describe('schema/note-ids-stable', () => {
    const base = JSON.stringify(validPassage());

    it('exempts a new file even when the base has one at the same path', async () => {
      const head = NEGATIVE_FIXTURES['schema/note-ids-stable']?.head ?? {};
      const result = await run({
        head,
        changed: [{ path: PASSAGE_PATH, status: 'added' }],
        base: { [PASSAGE_PATH]: base },
      });
      expect(result.items).toEqual([]);
    });

    it('fails a renamed note id against the fixture base', async () => {
      const result = await run(NEGATIVE_FIXTURES['schema/note-ids-stable'] as PullRequestFixture);
      expect(result.items).toEqual([
        expect.objectContaining({
          ruleId: 'schema/note-ids-stable',
          severity: 'error',
          pointer: '/translationNotes',
          message: 'translation-note id "evil-eye" exists on the base branch but not in this change',
        }),
      ]);
    });

    it('compares a renamed file with its previous path and names a dropped claim', async () => {
      const value: Json = validPassage();
      value.claims[1].id = 'c3';
      value.context.paragraphs[0] = String(value.context.paragraphs[0]).replace('[c2]', '[c3]');
      value.translationNotes[0].body = String(value.translationNotes[0].body).replaceAll('[c2]', '[c3]');
      const change: ChangedFile = { path: PASSAGE_PATH, status: 'renamed', previousPath: 'passages/MT.20.1-15.json' };
      const result = await run({
        head: { [PASSAGE_PATH]: JSON.stringify(value) },
        changed: [change],
        base: { 'passages/MT.20.1-15.json': base },
      });
      expect(result.items).toEqual([
        expect.objectContaining({
          ruleId: 'schema/note-ids-stable',
          claimId: 'c2',
          pointer: '/claims',
          message: 'claim id "c2" exists on the base branch (was passages/MT.20.1-15.json) but not in this change',
        }),
      ]);
    });

    it('flags deleting a published passage for review', async () => {
      const result = await run({
        head: {},
        changed: [{ path: PASSAGE_PATH, status: 'deleted' }],
        base: { [PASSAGE_PATH]: base },
      });
      expect(result.status).toBe('flag');
      expect(result.items).toEqual([
        expect.objectContaining({
          ruleId: 'schema/note-ids-stable',
          severity: 'warning',
          pointer: '',
          message:
            'deleting this passage removes 3 published note and claim ids; a person must confirm their permalinks may break',
        }),
      ]);
    });

    it('ignores base files without ids or that do not parse, and head files that do not parse', async () => {
      const deleted = (text: string): PullRequestFixture => ({
        head: {},
        changed: [{ path: PASSAGE_PATH, status: 'deleted' }],
        base: { [PASSAGE_PATH]: text },
      });
      for (const text of ['{}', '[1]', 'null', '{ broken', '{"claims": [{"id": 1}, null], "translationNotes": 3}']) {
        expect((await run(deleted(text))).items).toEqual([]);
      }
      const unparsable = await run({
        head: { [PASSAGE_PATH]: '{ broken' },
        changed: [{ path: PASSAGE_PATH, status: 'modified' }],
        base: { [PASSAGE_PATH]: base },
      });
      expect(ruleIds(unparsable)).toEqual(['schema/valid-passage']);
    });

    it('treats a copy as a new file', async () => {
      const result = await run({
        head: { [PASSAGE_PATH]: '{}' },
        changed: [{ path: PASSAGE_PATH, status: 'copied', previousPath: 'passages/MT.20.1-15.json' }],
        base: { 'passages/MT.20.1-15.json': base },
      });
      expect(new Set(ruleIds(result))).toEqual(new Set(['schema/valid-passage']));
    });
  });
});

describe('content paths', () => {
  it('derives the content prefix from config.content.root', () => {
    expect(contentPrefix('.')).toBe('');
    expect(contentPrefix('./')).toBe('');
    expect(contentPrefix('content')).toBe('content/');
    expect(contentPrefix('./content/')).toBe('content/');
  });

  it('accepts only JSON files directly in passages/ or calendar/', () => {
    expect(contentKindAt('passages/MT.20.1-16.json', '')).toBe('passage');
    expect(contentKindAt('calendar/2026.json', '')).toBe('calendar');
    expect(contentKindAt('content/passages/MT.20.1-16.json', 'content/')).toBe('passage');
    expect(contentKindAt('passages/MT.20.1-16.json', 'content/')).toBeNull();
    expect(contentKindAt('calendar/lectionary/a.json', '')).toBeNull();
    expect(contentKindAt('passages/a.md', '')).toBeNull();
    expect(contentKindAt('top.json', '')).toBeNull();
    expect(contentKindAt('corpus/a.json', '')).toBeNull();
  });

  it('checks files under a nested content root', () => {
    const config = { ...DEFAULT_CONFIG, content: { root: 'content' } };
    const pr = added(`content/${PASSAGE_PATH}`, validPassage());
    expect(checkSchema(contextFor(pr, config))).toEqual({ items: [], files: 1 });
  });
});

describe('SCHEMA_RULES', () => {
  it('is the rule list the gate declares', () => {
    expect(schemaGate.rules).toEqual(Object.values(SCHEMA_RULES));
  });
});
