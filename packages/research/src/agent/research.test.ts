import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { openRepo } from '@lectio/content';
import { openCorpus } from '@lectio/corpus';
import { FakeClock, FakeLlmClient, createCostMeter } from '@lectio/providers';
import type { CostMeter, LlmClient } from '@lectio/providers';
import type { CalendarYear } from '@lectio/schema/calendar';
import { validatePassage } from '@lectio/schema/passage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkItem } from '../plan/plan.ts';
import { MT_20_OUTPUT, MT_20_USAGE, fakeResearchLlm } from './fixtures/fake-research.ts';
import { GREEK_NT } from './original.ts';
import { loadPromptTemplate } from './prompt.ts';
import {
  DEFAULT_RESEARCH_MAX_TOKENS,
  DEFAULT_RESEARCH_TOOLS,
  createRunId,
  prettierJson,
  researchPassage,
  researchRun,
} from './research.ts';
import type { ResearchDeps, WrittenResult } from './research.ts';
import { RESEARCH_RESPONSE_SCHEMA } from './schema.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CORPUS = openCorpus(join(REPO_ROOT, 'corpus'));

const MT20: WorkItem = { key: 'MT.20.1-16', ref: 'Mt 20:1-16a', firstDate: '2026-09-20', dates: ['2026-09-20'] };
const IS55: WorkItem = { key: 'IS.55.6-9', ref: 'Is 55:6-9', firstDate: '2026-09-20', dates: ['2026-09-20'] };
const PHIL: WorkItem = {
  key: 'PHIL.1.20-24_1.27',
  ref: 'Phil 1:20c-24, 27a',
  firstDate: '2026-09-20',
  dates: ['2026-09-20'],
};

/** 25th Sunday in Ordinary Time, Year A (references and link-outs only). */
const CALENDAR = {
  year: 2026,
  region: 'kenya',
  generatedBy: 'research agent test',
  days: [
    {
      date: '2026-09-20',
      season: 'ordinary-time',
      seasonWeek: 25,
      sundayCycle: 'A',
      weekdayCycle: 'II',
      celebrations: [{ id: 'ot-25', name: '25th Sunday in Ordinary Time', rank: 'sunday', colour: 'green' }],
      masses: [
        {
          id: 'day',
          label: 'Mass of the day',
          readings: [
            {
              slot: 'first-reading',
              ref: 'Is 55:6-9',
              key: 'IS.55.6-9',
              linkout: 'https://www.drbo.org/chapter/23055.htm',
            },
            {
              slot: 'gospel',
              ref: 'Mt 20:1-16a',
              key: 'MT.20.1-16',
              linkout: 'https://www.drbo.org/chapter/47020.htm',
            },
          ],
        },
      ],
      lectionaryMissing: false,
    },
  ],
} as unknown as CalendarYear;

function config(perPassageUsd = 1.5): Pick<LectioConfig, 'research' | 'site'> {
  return {
    site: DEFAULT_CONFIG.site,
    research: { ...DEFAULT_CONFIG.research, budget: { ...DEFAULT_CONFIG.research.budget, perPassageUsd } },
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lectio-research-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function deps(overrides: Partial<ResearchDeps> & { runUsd?: number; perPassageUsd?: number } = {}): ResearchDeps & {
  meter: CostMeter;
} {
  const { runUsd, perPassageUsd, ...rest } = overrides;
  return {
    llm: fakeResearchLlm(),
    meter: createCostMeter({ pricing: DEFAULT_CONFIG.pricing, ceilingUsd: runUsd ?? 25 }),
    corpus: CORPUS,
    repo: { calendarYear: (year) => (year === 2026 ? CALENDAR : null) },
    config: config(perPassageUsd),
    clock: new FakeClock({ start: '2026-10-05T07:50:00Z' }),
    contentRoot: dir,
    runId: 'research-20261005T075000Z',
    ...rest,
  };
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

describe('researchPassage with the fake LLM', () => {
  it('writes a schema-valid passages/<key>.json', async () => {
    const llm = fakeResearchLlm();
    const result = (await researchPassage(MT20, deps({ llm }))) as WrittenResult;
    expect(result).toMatchObject({
      status: 'written',
      key: 'MT.20.1-16',
      path: 'passages/MT.20.1-16.json',
      costUsd: 0.5,
    });

    const text = await readFile(join(dir, 'passages/MT.20.1-16.json'), 'utf8');
    expect(JSON.parse(text)).toEqual(result.passage);
    expect(validatePassage(JSON.parse(text))).toBe(true);
    // The content loader (gate 1's reader) accepts it too.
    expect(openRepo(dir).passage('MT.20.1-16')).toEqual(result.passage);

    const { version } = await loadPromptTemplate();
    expect(result.passage.provenance).toEqual({
      generator: 'fake',
      runId: 'research-20261005T075000Z',
      models: ['claude-opus-5-5'],
      promptVersion: version,
      createdAt: '2026-10-05T07:50:00.000Z',
      costUsd: 0.5,
    });
    expect(result.passage.review).toEqual({ status: 'pending', reviewers: [] });
    expect(llm.clients).toHaveLength(1);
  });

  it('makes one generate call with web tools, the response schema and the passage inputs', async () => {
    const llm = fakeResearchLlm();
    await researchPassage(MT20, deps({ llm }));
    const calls = llm.clients.flatMap((client) => client.calls);
    expect(calls).toHaveLength(1);
    const [request] = calls;
    expect(request).toMatchObject({
      role: 'generator',
      model: 'claude-opus-5-5',
      tools: DEFAULT_RESEARCH_TOOLS,
      responseSchema: RESEARCH_RESPONSE_SCHEMA,
      maxTokens: DEFAULT_RESEARCH_MAX_TOKENS,
    });
    expect(request?.system).toContain('Never reproduce Bible translation text');
    expect(request?.system).toContain('12 words or fewer');
    const user = request?.messages[0]?.content ?? '';
    expect(request?.messages).toHaveLength(1);
    expect(user).toContain('Passage key: `MT.20.1-16`');
    expect(user).toContain('Lectionary reference: Mt 20:1-16a');
    expect(user).toContain('Slot in the Mass: gospel');
    expect(user).toContain('locale `en`');
    expect(user).toContain('25th Sunday in Ordinary Time (sunday, green)');
    expect(user).toContain('first-reading Is 55:6-9; gospel Mt 20:1-16a');
    expect(user).toContain('Edition `grc-sblgnt`');
    expect(user).toContain('- 20:15 (grc-sblgnt): ');
    expect(user).toContain('ὀφθαλμός σου πονηρός');
    expect(`${request?.system ?? ''}${user}`).not.toMatch(/\{\{/);
  });

  it('passes the locale, tools, token cap and editions through', async () => {
    const llm = fakeResearchLlm();
    const result = await researchPassage(
      PHIL,
      deps({
        llm,
        locale: 'en-KE',
        tools: [{ kind: 'web_search', maxUses: 1 }],
        maxTokens: 2000,
        editionsFor: () => [GREEK_NT],
      }),
    );
    const [request] = llm.clients[0]?.calls ?? [];
    expect(request).toMatchObject({ tools: [{ kind: 'web_search', maxUses: 1 }], maxTokens: 2000 });
    expect(request?.messages[0]?.content).toContain('Slot in the Mass: unknown');
    expect(request?.messages[0]?.content).toContain('No calendar context is available');
    expect(request?.messages[0]?.content).toContain('- 1:27 (grc-sblgnt): ');
    expect(result).toMatchObject({ status: 'written', passage: { key: 'PHIL.1.20-24_1.27', locale: 'en-KE' } });
  });

  it('assembles the fake’s schema-generated default answer too', async () => {
    const llm = (meter: CostMeter): LlmClient => new FakeLlmClient({ costMeter: meter });
    const result = await researchPassage(IS55, deps({ llm }));
    expect(result.status).toBe('written');
  });

  it('uses an injected formatter and writer', async () => {
    const writes: [string, string][] = [];
    const result = await researchPassage(
      MT20,
      deps({
        format: async (json, path) => `${path}\n${json}`,
        writeFile: async (path, text) => {
          writes.push([path, text]);
        },
      }),
    );
    expect(result.status).toBe('written');
    const path = join(dir, 'passages/MT.20.1-16.json');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe(path);
    expect(writes[0]?.[1].startsWith(`${path}\n{`)).toBe(true);
    expect(await exists(path)).toBe(false);
  });
});

describe('budget', () => {
  it('aborts the passage cleanly when it overruns perPassageUsd', async () => {
    const d = deps({ perPassageUsd: 0.25 });
    const result = await researchPassage(MT20, d);
    expect(result).toEqual({
      status: 'over-budget',
      key: 'MT.20.1-16',
      costUsd: 0.5,
      meter: 'passage:MT.20.1-16',
      runExhausted: false,
    });
    expect(await exists(join(dir, 'passages'))).toBe(false);
    // The money is spent either way and counts against the run.
    expect(d.meter.spentUsd()).toBe(0.5);
  });

  it('does not start a passage once the run budget is spent', async () => {
    const llm = fakeResearchLlm();
    const result = await researchPassage(MT20, deps({ llm, runUsd: 0 }));
    expect(result).toEqual({ status: 'over-budget', key: 'MT.20.1-16', costUsd: 0, meter: 'run', runExhausted: true });
    expect(llm.clients).toHaveLength(0);
  });

  it('stops the run when the run budget runs out, keeping what was written', async () => {
    const llm = fakeResearchLlm();
    const d = deps({ llm, runUsd: 0.75 });
    const run = await researchRun([MT20, IS55, PHIL], d);
    expect(run.results.map((r) => [r.key, r.status])).toEqual([
      ['MT.20.1-16', 'written'],
      ['IS.55.6-9', 'over-budget'],
    ]);
    expect(run.results[1]).toMatchObject({ meter: 'run', runExhausted: true, costUsd: 0.5 });
    expect(run.notStarted).toEqual(['PHIL.1.20-24_1.27']);
    expect(run.spentUsd).toBe(1);
    expect(await exists(join(dir, 'passages/MT.20.1-16.json'))).toBe(true);
    expect(await exists(join(dir, 'passages/IS.55.6-9.json'))).toBe(false);
  });

  it('goes on with the next passage after a per-passage overrun', async () => {
    const usage = { ...MT_20_USAGE, outputTokens: 80_000 };
    let calls = 0;
    const llm = (meter: CostMeter): LlmClient =>
      new FakeLlmClient({
        costMeter: meter,
        roles: { generator: { output: MT_20_OUTPUT, usage: calls++ === 0 ? usage : MT_20_USAGE } },
      });
    const run = await researchRun([MT20, PHIL], deps({ llm }));
    expect(run.results.map((r) => r.status)).toEqual(['over-budget', 'written']);
    expect(run.notStarted).toEqual([]);
  });
});

describe('failures', () => {
  it('reports malformed model output without writing', async () => {
    const result = await researchPassage(MT20, deps({ llm: fakeResearchLlm({ text: '{"oops' }) }));
    expect(result).toMatchObject({ status: 'failed', issues: [], error: expect.stringContaining('not valid JSON') });
    expect(result).not.toHaveProperty('output');
    expect(await exists(join(dir, 'passages'))).toBe(false);
  });

  it('reports a provider outage', async () => {
    const result = await researchPassage(MT20, deps({ llm: fakeResearchLlm({ fail: 'unavailable' }) }));
    expect(result).toMatchObject({ status: 'failed', error: 'scripted unavailable failure for generator' });
  });

  it('re-checks the output against the research schema', async () => {
    const llm = (): LlmClient => ({
      family: 'anthropic',
      generate: async () => ({
        output: { summary: 'x' },
        citations: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'claude-opus-5-5',
        family: 'anthropic',
      }),
    });
    const result = await researchPassage(MT20, deps({ llm }));
    expect(result).toMatchObject({
      status: 'failed',
      error: 'the model output does not match the research schema',
      output: { summary: 'x' },
    });
    expect(result.status === 'failed' && result.issues.length).toBeGreaterThan(0);
  });

  it('reports an assembled passage that fails the passage schema', async () => {
    const result = await researchPassage(MT20, deps({ locale: 'English' }));
    expect(result).toMatchObject({ status: 'failed', error: 'the assembled passage is invalid', output: MT_20_OUTPUT });
    expect(result.status === 'failed' && result.issues).toEqual([
      expect.stringMatching(/^passages\/MT\.20\.1-16\.json#\/locale: /),
    ]);
  });

  it('rethrows programming errors', async () => {
    const llm = (): LlmClient => {
      throw new TypeError('boom');
    };
    await expect(researchPassage(MT20, deps({ llm }))).rejects.toThrow('boom');
  });
});

describe('researchRun', () => {
  it('loads the prompt once and researches every item', async () => {
    const llm = fakeResearchLlm();
    const run = await researchRun([MT20, PHIL], deps({ llm }));
    expect(run.results.map((r) => r.status)).toEqual(['written', 'written']);
    expect(run.spentUsd).toBe(1);
    const [a, b] = llm.clients.map((c) => c.calls[0]?.system);
    expect(a).toBe(b);
  });

  it('uses a given prompt', async () => {
    const llm = fakeResearchLlm();
    const prompt = { name: 'p', version: 'p@000000000000', system: 'S {{key}}', user: 'U {{ref}}' };
    const run = await researchRun([MT20], deps({ llm, prompt }));
    expect(llm.clients[0]?.calls[0]).toMatchObject({
      system: 'S MT.20.1-16',
      messages: [{ content: 'U Mt 20:1-16a' }],
    });
    expect(run.results[0]).toMatchObject({ passage: { provenance: { promptVersion: 'p@000000000000' } } });
  });
});

describe('createRunId', () => {
  it('stamps the run start in UTC', () => {
    expect(createRunId(new Date('2026-10-05T07:50:00.123Z'))).toBe('research-20261005T075000Z');
  });
});

describe('prettierJson', () => {
  it('formats a passage exactly as the repository stores it', async () => {
    const path = join(REPO_ROOT, 'passages/MT.20.1-16.json');
    const stored = await readFile(path, 'utf8');
    expect(await prettierJson(`${JSON.stringify(JSON.parse(stored), null, 2)}\n`, path)).toBe(stored);
  });
});
