import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { createContext, runGates, selectGates } from '@lectio/gates';
import type { GateResult } from '@lectio/gates';
import { FakeClock, ProviderError, createCostMeter, createProviders } from '@lectio/providers';
import type { CostMeter } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';
import {
  translatableSha256,
  translationMismatches,
  validateTranslatedPassage,
} from '@lectio/schema/translated-passage';

import {
  TRANSLATE_USAGE_FIXTURE,
  fakeTranslateLlm,
  pseudoCited,
  pseudoTranslation,
} from './fixtures/fake-translation.ts';
import {
  DEFAULT_TRANSLATE_MAX_TOKENS,
  TRANSLATE_PROMPT_VERSION,
  TRANSLATE_RESPONSE_SCHEMA,
  TranslationInvalidError,
  assembleTranslation,
  buildTranslateRequest,
  languageName,
  translatePassage,
  translateSystemPrompt,
  translateUserPrompt,
} from './translate.ts';
import type { TranslateDeps, TranslationFailed, TranslationWritten } from './translate.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SEED_PATH = 'passages/MT.20.1-16.json';
const SEED = JSON.parse(await readFile(join(REPO_ROOT, SEED_PATH), 'utf8')) as Passage;

function config(perPassageUsd = 1.5): Pick<LectioConfig, 'research'> {
  return { research: { ...DEFAULT_CONFIG.research, budget: { ...DEFAULT_CONFIG.research.budget, perPassageUsd } } };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lectio-translate-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function deps(overrides: Partial<TranslateDeps> & { runUsd?: number; perPassageUsd?: number } = {}): TranslateDeps & {
  meter: CostMeter;
} {
  const { runUsd, perPassageUsd, ...rest } = overrides;
  return {
    llm: fakeTranslateLlm({ passages: [SEED] }),
    meter: createCostMeter({ pricing: DEFAULT_CONFIG.pricing, ceilingUsd: runUsd ?? 25 }),
    config: config(perPassageUsd),
    clock: new FakeClock({ start: '2026-10-05T07:50:00Z' }),
    runId: 'translate-20261005T075000Z',
    locale: 'sw',
    contentRoot: dir,
    ...rest,
  };
}

/** Runs gate 1 over the seed passage and `files` (repository-relative) under `dir`, as one PR. */
async function schemaGateOver(files: readonly string[]): Promise<GateResult> {
  const context = createContext({
    root: dir,
    base: 'origin/main',
    head: 'HEAD',
    config: DEFAULT_CONFIG,
    providers: createProviders(DEFAULT_CONFIG),
    git: { changedFiles: () => files.map((path) => ({ path, status: 'added' as const })), show: () => null },
  });
  const report = await runGates(selectGates(['schema']), context);
  return report.results[0] as GateResult;
}

async function writeSeed(passage: Passage = SEED): Promise<void> {
  await mkdir(join(dir, 'passages'), { recursive: true });
  await writeFile(join(dir, SEED_PATH), JSON.stringify(passage));
}

describe('fake translation of the Mt 20 seed', () => {
  it('writes passages/i18n/sw/MT.20.1-16.json, which validates and lines up with the seed', async () => {
    const result = (await translatePassage(SEED, deps())) as TranslationWritten;
    expect(result).toMatchObject({ status: 'written', key: 'MT.20.1-16', path: 'passages/i18n/sw/MT.20.1-16.json' });
    const text = await readFile(join(dir, result.path), 'utf8');
    const written = JSON.parse(text) as unknown;
    expect(written).toEqual(result.translation);
    expect(validateTranslatedPassage(written)).toBe(true);
    expect(translationMismatches(SEED, result.translation)).toEqual([]);
    expect(result.translation).toMatchObject({
      translationOf: 'MT.20.1-16',
      locale: 'sw',
      sourceSha256: translatableSha256(SEED),
      review: { status: 'pending', reviewers: [] },
      schemaVersion: 1,
    });
    expect(result.translation.translationNotes.map((note) => note.id)).toEqual(SEED.translationNotes.map((n) => n.id));
    expect(result.translation.claims.map((claim) => claim.id)).toEqual(SEED.claims.map((c) => c.id));
    expect(result.translation.provenance).toEqual({
      generator: 'fake',
      runId: 'translate-20261005T075000Z',
      models: ['claude-opus-5-5'],
      promptVersion: TRANSLATE_PROMPT_VERSION,
      createdAt: '2026-10-05T07:50:00.000Z',
      costUsd: result.costUsd,
    });
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('passes gate 1 except for the fake provenance and the review it always needs', async () => {
    await writeSeed();
    const result = (await translatePassage(SEED, deps())) as TranslationWritten;
    const gate = await schemaGateOver([SEED_PATH, result.path]);
    const findings = gate.items.filter((item) => item.file === result.path).map((item) => item.ruleId);
    expect(findings.sort()).toEqual(['schema/no-fake-provenance', 'schema/translation-needs-review']);
  });

  it('is detected as stale by gate 1 once the English text changes', async () => {
    const result = (await translatePassage(SEED, deps())) as TranslationWritten;
    const changed = structuredClone(SEED);
    (changed.claims[0] as { text: string }).text = 'The parable of the labourers is found only in Matthew.';
    await writeSeed(changed);
    await mkdir(join(dir, 'passages/i18n/sw'), { recursive: true });
    // The PR changes only the English passage; gate 1 finds its Swahili translation on disk.
    const gate = await schemaGateOver([SEED_PATH]);
    expect(gate.status).toBe('flag');
    expect(gate.items).toEqual([
      expect.objectContaining({
        ruleId: 'schema/translation-not-stale',
        file: result.path,
        severity: 'warning',
        message: 'the English passage MT.20.1-16 changed since this sw translation was made',
      }),
    ]);
    expect(translatableSha256(changed)).not.toBe(result.translation.sourceSha256);
  });
});

describe('the translation request', () => {
  it('sends only the translatable fields, with the response schema and no tools', () => {
    const request = buildTranslateRequest(SEED, { config: DEFAULT_CONFIG, locale: 'sw' });
    expect(request).toMatchObject({
      role: 'generator',
      model: DEFAULT_CONFIG.research.models.generator.model,
      responseSchema: TRANSLATE_RESPONSE_SCHEMA,
      maxTokens: DEFAULT_TRANSLATE_MAX_TOKENS,
    });
    expect(request.tools).toBeUndefined();
    expect(request.system).toBe(translateSystemPrompt('sw'));
    expect(request.messages).toEqual([{ role: 'user', content: translateUserPrompt(SEED) }]);
    const user = translateUserPrompt(SEED);
    expect(user).toContain('Mt 20:1-16a (MT.20.1-16)');
    expect(user).not.toContain('sourceIds');
    expect(user).not.toContain(SEED.sources[0]?.citation ?? 'unreachable');
    expect(buildTranslateRequest(SEED, { config: DEFAULT_CONFIG, locale: 'sw', maxTokens: 10 }).maxTokens).toBe(10);
  });

  it('tells the model to keep ids and markers and never quote a Bible translation', () => {
    const system = translateSystemPrompt('sw');
    expect(system).toContain('Kiswahili (Swahili) (sw)');
    expect(system).toContain('Keep every id exactly as given');
    expect(system).toContain('Keep every claim marker');
    expect(system).toContain('Never quote a Bible translation');
  });

  it('names languages it knows, and others by tag', () => {
    expect(languageName('sw')).toBe('Kiswahili (Swahili)');
    expect(languageName('pt-BR')).toBe('pt-BR');
  });
});

describe('assembleTranslation', () => {
  const meta = {
    locale: 'sw',
    runId: 'r',
    models: ['m', 'm'],
    family: 'anthropic',
    createdAt: '2026-10-05T07:50:00Z',
    costUsd: 0.1,
  };

  it('marks real output research-cli and dedupes models', () => {
    const translation = assembleTranslation(SEED, pseudoTranslation(SEED), meta);
    expect(translation.provenance.generator).toBe('research-cli');
    expect(translation.provenance.models).toEqual(['m']);
  });

  it('throws on schema problems', () => {
    const output = { ...pseudoTranslation(SEED), summary: '' };
    expect(() => assembleTranslation(SEED, output, meta)).toThrow(TranslationInvalidError);
  });

  it('throws when ids or markers do not line up', () => {
    const output = pseudoTranslation(SEED);
    const short = { ...output, claims: output.claims.slice(1) };
    try {
      assembleTranslation(SEED, short, meta);
      expect.unreachable();
    } catch (error) {
      expect((error as TranslationInvalidError).issues).toEqual(['/claims claims missing from the translation: c1']);
    }
  });
});

describe('translatePassage failures', () => {
  it('fails cleanly when the output does not match the response schema', async () => {
    const llm = fakeTranslateLlm({ fallback: { output: { summary: 'x' }, usage: TRANSLATE_USAGE_FIXTURE } });
    // Unscripted prompt (another locale), so the fallback answers; the fake rejects schema-invalid output.
    const result = (await translatePassage(SEED, deps({ llm, locale: 'pt-BR' }))) as TranslationFailed;
    expect(result.status).toBe('failed');
    expect(result.issues[0]).toMatch(/^malformed-output: /);
  });

  it('fails cleanly when the output lines up badly', async () => {
    const output = { ...pseudoTranslation(SEED), claims: [{ id: 'c1', text: 'Dai.' }] };
    const llm = fakeTranslateLlm({ fallback: { output, usage: TRANSLATE_USAGE_FIXTURE } });
    const result = (await translatePassage(SEED, deps({ llm, locale: 'pt-BR' }))) as TranslationFailed;
    expect(result).toMatchObject({ status: 'failed', error: 'the assembled translation is invalid', output });
    expect(result.issues[0]).toMatch(/^\/claims claims missing from the translation: c2/);
  });

  it('reports a schema mismatch the client let through', async () => {
    const output = { summary: 'x' };
    const llm = (): never =>
      ({
        family: 'anthropic',
        generate: () =>
          Promise.resolve({ output, model: 'm', family: 'anthropic', citations: [], usage: TRANSLATE_USAGE_FIXTURE }),
      }) as never;
    const result = (await translatePassage(SEED, deps({ llm }))) as TranslationFailed;
    expect(result).toMatchObject({
      status: 'failed',
      error: 'the model output does not match the translation schema',
      output,
    });
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('reports provider failures', async () => {
    const llm = fakeTranslateLlm({ fallback: { fail: 'unavailable' } });
    const result = (await translatePassage(SEED, deps({ llm, locale: 'pt-BR' }))) as TranslationFailed;
    expect(result.status).toBe('failed');
    expect(result.issues[0]).toMatch(/^unavailable: /);
    expect(result.output).toBeUndefined();
  });

  it('keeps the raw text of malformed output', async () => {
    const llm = fakeTranslateLlm({ fallback: { text: '{"oops' } });
    const result = (await translatePassage(SEED, deps({ llm, locale: 'pt-BR' }))) as TranslationFailed;
    expect(result.output).toBe('{"oops');
  });

  it('stops at the per-passage budget', async () => {
    const result = await translatePassage(SEED, deps({ perPassageUsd: 0.001 }));
    expect(result).toMatchObject({ status: 'over-budget', key: 'MT.20.1-16', runExhausted: false });
  });

  it('reports an exhausted run budget', async () => {
    const result = await translatePassage(SEED, deps({ runUsd: 0 }));
    expect(result).toMatchObject({ status: 'over-budget', runExhausted: true });
  });

  it('rethrows unexpected errors', async () => {
    const writeFile = (): Promise<void> => Promise.reject(new TypeError('disk on fire'));
    await expect(translatePassage(SEED, deps({ writeFile }))).rejects.toThrow('disk on fire');
    await expect(
      translatePassage(
        SEED,
        deps({
          llm: () =>
            ({ family: 'fake', generate: () => Promise.reject(new ProviderError('timeout', 'slow')) }) as never,
        }),
      ),
    ).resolves.toMatchObject({ status: 'failed', issues: ['timeout: slow'] });
  });

  it('uses the injected formatter', async () => {
    const format = (json: string): Promise<string> => Promise.resolve(json.replace(/\n\s*/g, ''));
    const result = (await translatePassage(SEED, deps({ format }))) as TranslationWritten;
    expect(await readFile(join(dir, result.path), 'utf8')).not.toContain('\n');
  });
});

describe('pseudoCited', () => {
  it('keeps the markers of every sentence', () => {
    expect(pseudoCited('One. [c1] Two. [c2][c3]')).toBe(
      'Sentensi iliyotafsiriwa. [c1] Sentensi iliyotafsiriwa. [c2][c3]',
    );
  });
});
