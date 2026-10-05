import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { createCostMeter } from '@lectio/providers';
import type { CostMeter } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';
import { describe, expect, it } from 'vitest';

import type { FailedResult, WrittenResult } from '../agent/research.ts';
import {
  LAST_URL,
  REPO_ROOT,
  RepairLlm,
  VALID_OUTPUT,
  draftOf,
  fixtureProviders,
  validOutput,
} from './fixtures/draft.ts';
import type { EditableOutput } from './fixtures/draft.ts';
import { REPAIR_PROMPT_VERSION } from './prompt.ts';
import { draftFromResult, formatValidationReport, outputOfPassage, preValidate, preValidateRun } from './validate.ts';
import type {
  AbandonedValidation,
  Draft,
  ReadyValidation,
  ReadyWithDropsValidation,
  ValidateDeps,
  ValidationResult,
} from './validate.ts';

const identity = (json: string): Promise<string> => Promise.resolve(json);
const REPAIR_MODEL = DEFAULT_CONFIG.research.models.repair.model;

function deps(llm: RepairLlm, extra: Partial<ValidateDeps> = {}): ValidateDeps {
  return { llm, config: DEFAULT_CONFIG, providers: fixtureProviders(), root: REPO_ROOT, format: identity, ...extra };
}

function meter(ceilingUsd = Infinity): CostMeter {
  return createCostMeter({ pricing: DEFAULT_CONFIG.pricing, ceilingUsd, label: 'repair:test' });
}

function ready(result: ValidationResult): ReadyValidation {
  expect(result.outcome, JSON.stringify(result.attempts, null, 2)).toBe('ready');
  return result as ReadyValidation;
}

function withDrops(result: ValidationResult): ReadyWithDropsValidation {
  expect(result.outcome, JSON.stringify(result.attempts, null, 2)).toBe('ready-with-drops');
  return result as ReadyWithDropsValidation;
}

function abandoned(result: ValidationResult): AbandonedValidation {
  expect(result.outcome, JSON.stringify(result.attempts, null, 2)).toBe('abandoned');
  return result as AbandonedValidation;
}

/** The commentary excerpt for the evil eye no longer appears on its page. */
function wrongEyeExcerpt(): EditableOutput {
  const output = validOutput();
  output['sources'][3].excerpt = 'an evil eye meant a stingy and miserly heart';
  return output;
}

/** A third claim (c3) on its own sentence, resting on a web source whose excerpt is not on the page. */
function unsupportedThirdClaim(): EditableOutput {
  const output = validOutput();
  output['context'].paragraphs.push('The parable closes on the saying that the last will be first. [c3]');
  output['claims'].push({
    id: 'c3',
    text: 'The parable ends with a reversal.',
    sourceIds: ['commentary-last'],
    sensitive: false,
  });
  output['sources'].push({
    id: 'commentary-last',
    type: 'web',
    citation: 'Fixture commentary on Matthew 20:16',
    url: LAST_URL,
    excerpt: 'the first shall be last and the last first',
    excerptLang: 'en',
  });
  return output;
}

/** A third note whose Greek is not in the verse it names. */
function misspeltThirdNote(): EditableOutput {
  const output = validOutput();
  output['translationNotes'].push({
    verse: '20:13',
    anchor: 'Friend',
    original: { text: 'Ἑταῖροςς', lang: 'grc', translit: 'hetaiross', gloss: 'comrade' },
    summary: 'A neutral address.',
    body: 'The address recalls the daily wage. [c1]',
  });
  return output;
}

const stages = (result: ValidationResult): string[] => result.attempts.map((attempt) => attempt.stage);

describe('preValidate', () => {
  it('passes a draft that passes the gates first time, without a repair call', async () => {
    const llm = new RepairLlm({});
    const result = ready(await preValidate(draftOf(validOutput()), deps(llm)));
    expect(llm.calls).toHaveLength(0);
    expect(result.repairs).toBe(0);
    expect(result.repairCostUsd).toBe(0);
    expect(stages(result)).toEqual(['passed']);
    expect(result.path).toBe('passages/MT.20.1-16.json');
    expect(JSON.parse(result.text)).toEqual(result.passage);
    expect(result.passage.provenance).toMatchObject({
      generator: 'research-cli',
      costUsd: 0.5,
      models: ['claude-opus-5-5'],
    });
    expect(result.report.results.map((gate) => gate.gate)).toEqual(['schema', 'evidence', 'licence']);
    expect(result.report.status).not.toBe('fail');
  });

  it('formats the passage with Prettier by default', async () => {
    const result = ready(await preValidate(draftOf(validOutput()), { ...deps(new RepairLlm({})), format: undefined }));
    expect(result.text).toContain('"sourceIds": ["mt-20-2", "commentary-denarius"]');
  });

  it('feeds the gate failures to the repair model and passes the draft it fixes after one repair', async () => {
    const repairMeter = meter();
    const llm = new RepairLlm({ output: VALID_OUTPUT }, { meter: repairMeter });
    const result = ready(await preValidate(draftOf(wrongEyeExcerpt()), deps(llm, { meter: repairMeter })));
    expect(result.repairs).toBe(1);
    expect(stages(result)).toEqual(['gates-failed', 'passed']);
    expect(result.attempts[0]?.problems.join('\n')).toContain('evidence/');
    expect(llm.calls).toHaveLength(1);
    const request = llm.calls[0];
    expect(request?.role).toBe('repair');
    expect(request?.model).toBe(REPAIR_MODEL);
    expect(request?.messages[0]?.content).toContain('a stingy and miserly heart');
    expect(request?.messages[0]?.content).toContain('Fix:');
    expect(result.repairCostUsd).toBeGreaterThan(0);
    expect(result.passage.provenance.costUsd).toBeCloseTo(0.5 + result.repairCostUsd, 10);
    expect(result.passage.provenance.models).toEqual(['claude-opus-5-5']);
  });

  it('accepts the output as raw JSON text', async () => {
    ready(await preValidate(draftOf(JSON.stringify(VALID_OUTPUT)), deps(new RepairLlm({}))));
  });

  it('repairs output that is not JSON', async () => {
    const llm = new RepairLlm({ output: VALID_OUTPUT });
    const result = ready(await preValidate(draftOf('{"summary": '), deps(llm)));
    expect(stages(result)).toEqual(['invalid-json', 'passed']);
    expect(result.attempts[0]?.problems[0]).toMatch(/^the output is not valid JSON/);
    expect(llm.calls[0]?.messages[0]?.content).toContain('{"summary": ');
  });

  it('counts a repair whose answer is malformed and shows the model its own text next time', async () => {
    const llm = new RepairLlm([{ text: '{"oops' }, { output: VALID_OUTPUT }]);
    const result = ready(await preValidate(draftOf(wrongEyeExcerpt()), deps(llm)));
    expect(result.repairs).toBe(2);
    expect(stages(result)).toEqual(['gates-failed', 'invalid-json', 'passed']);
    expect(llm.calls[1]?.messages[0]?.content).toContain('{"oops');
  });

  it('drops a failing claim, its sentence and its source when repairs run out', async () => {
    const broken = unsupportedThirdClaim();
    const llm = new RepairLlm({ output: broken });
    const result = withDrops(await preValidate(draftOf(broken), deps(llm)));
    expect(result.repairs).toBe(DEFAULT_CONFIG.research.maxRepairs);
    expect(stages(result)).toEqual(['gates-failed', 'gates-failed', 'gates-failed']);
    expect(result.dropped.map((item) => `${item.kind} ${item.id}`)).toEqual(['claim c3', 'source commentary-last']);
    expect(result.dropped[0]?.reason).toMatch(/^evidence\//);
    expect(result.dropped[1]?.reason).toBe('only dropped claims cited it');
    expect(result.passage.claims.map((claim) => claim.id)).toEqual(['c1', 'c2']);
    expect(result.passage.context.paragraphs).toEqual(VALID_OUTPUT.context.paragraphs);
    expect(JSON.parse(result.text)).toEqual(result.passage);
    expect(result.report.status).not.toBe('fail');
  });

  it('drops a failing translation note', async () => {
    const result = withDrops(
      await preValidate(draftOf(misspeltThirdNote()), deps(new RepairLlm({}), { maxRepairs: 0 })),
    );
    expect(result.repairs).toBe(0);
    expect(result.dropped.map((item) => `${item.kind} ${item.id}`)).toEqual(['note hetaiross']);
    expect(result.passage.translationNotes).toHaveLength(2);
    expect(result.passage.claims).toHaveLength(2);
  });

  it('abandons a draft whose failures are not about a claim or a note', async () => {
    const draft = { ...draftOf(validOutput()), meta: { ...draftOf(null).meta, family: 'fake' as const } };
    const result = abandoned(await preValidate(draft, deps(new RepairLlm({}), { maxRepairs: 0 })));
    expect(result.reason).toMatch(/not about a claim or a note/);
    expect(result.problems.join('\n')).toContain('schema/no-fake-provenance');
    expect(result.report?.status).toBe('fail');
  });

  it('keeps a repair by the fake provider marked fake, so it never passes', async () => {
    const llm = new RepairLlm({ output: VALID_OUTPUT }, { family: 'fake' });
    const result = abandoned(await preValidate(draftOf(wrongEyeExcerpt()), deps(llm, { maxRepairs: 1 })));
    expect(result.problems.join('\n')).toContain('schema/no-fake-provenance');
  });

  it('abandons a draft when dropping what fails leaves an invalid file', async () => {
    const output = wrongEyeExcerpt();
    output['sources'][2].excerpt = 'the Greek silver drachma paid as a bonus';
    const result = abandoned(await preValidate(draftOf(output), deps(new RepairLlm({}), { maxRepairs: 0 })));
    expect(result.reason).toMatch(/^dropping note .*, claim c1, claim c2, .* leaves a file that fails the gates$/);
    expect(result.problems.join('\n')).toContain('schema/');
    expect(result.report?.status).toBe('fail');
  });

  it('abandons a draft that never assembles into a passage', async () => {
    const { summary: _summary, ...output } = validOutput();
    const llm = new RepairLlm({ text: JSON.stringify(output) });
    const result = abandoned(await preValidate(draftOf(output), deps(llm, { maxRepairs: 1 })));
    expect(result.repairs).toBe(1);
    expect(stages(result)).toEqual(['invalid-output', 'invalid-output']);
    expect(result.reason).toMatch(/no draft could be assembled/);
    expect(result.report).toBeUndefined();
  });

  it('reports a passage the assembler rejects', async () => {
    const draft = { ...draftOf(validOutput()), meta: { ...draftOf(null).meta, models: [] } };
    const result = abandoned(await preValidate(draft, deps(new RepairLlm({}), { maxRepairs: 0 })));
    expect(stages(result)).toEqual(['invalid-passage']);
    expect(result.problems[0]).toMatch(/^passages\/MT\.20\.1-16\.json#\/provenance/);
  });

  it('stops repairing at the budget ceiling and still drops what fails', async () => {
    const repairMeter = meter(0.000001);
    const broken = unsupportedThirdClaim();
    const llm = new RepairLlm({ output: VALID_OUTPUT }, { meter: repairMeter });
    const result = withDrops(await preValidate(draftOf(broken), deps(llm, { meter: repairMeter })));
    expect(result.repairs).toBe(1);
    expect(result.repairStopped).toMatch(/^budget: /);
    expect(result.repairCostUsd).toBeGreaterThan(0);
    expect(result.passage.provenance.costUsd).toBeCloseTo(0.5 + result.repairCostUsd, 10);
  });

  it('stops repairing when the provider fails', async () => {
    const result = withDrops(
      await preValidate(draftOf(unsupportedThirdClaim()), deps(new RepairLlm({ fail: 'unavailable' }))),
    );
    expect(result.repairs).toBe(0);
    expect(result.repairStopped).toMatch(/^unavailable: /);
  });

  it('passes repair tools and token cap through', async () => {
    const llm = new RepairLlm({ output: VALID_OUTPUT });
    await preValidate(draftOf(wrongEyeExcerpt()), deps(llm, { tools: [], maxTokens: 123 }));
    expect(llm.calls[0]).toMatchObject({ tools: [], maxTokens: 123 });
  });

  it('rethrows unexpected errors', async () => {
    await expect(
      preValidate(draftOf(wrongEyeExcerpt()), deps(new RepairLlm({ fail: new TypeError('bug') }))),
    ).rejects.toThrow('bug');
    const meta = Object.defineProperty({ ...draftOf(null).meta }, 'locale', {
      enumerable: true,
      get: () => {
        throw new TypeError('assembler bug');
      },
    });
    await expect(preValidate({ ...draftOf(validOutput()), meta }, deps(new RepairLlm({})))).rejects.toThrow(
      'assembler bug',
    );
  });
});

describe('preValidateRun', () => {
  it('validates each draft on its own repair budget and records the outcomes', async () => {
    const runMeter = createCostMeter({ pricing: DEFAULT_CONFIG.pricing, label: 'research-run' });
    const meters: CostMeter[] = [];
    const config: LectioConfig = DEFAULT_CONFIG;
    const drafts: Draft[] = [
      draftOf(validOutput()),
      draftOf(wrongEyeExcerpt()),
      // Research already spent the whole passage budget: no repair, and the drop cannot save it.
      { ...draftOf(validOutput(), config.research.budget.perPassageUsd + 1), key: 'MT.20.1-16', output: {} },
    ];
    const report = await preValidateRun(drafts, {
      config,
      providers: fixtureProviders(),
      root: REPO_ROOT,
      format: identity,
      meter: runMeter,
      llm: (m) => {
        meters.push(m);
        return new RepairLlm({ output: VALID_OUTPUT }, { meter: m });
      },
    });
    expect(report.results.map((result) => result.outcome)).toEqual(['ready', 'ready', 'abandoned']);
    expect(report.ready).toEqual(['MT.20.1-16', 'MT.20.1-16']);
    expect(report.readyWithDrops).toEqual([]);
    expect(report.abandoned).toEqual(['MT.20.1-16']);
    expect(report.repairPromptVersion).toBe(REPAIR_PROMPT_VERSION);
    expect(meters.map((m) => m.label)).toEqual(['repair:MT.20.1-16', 'repair:MT.20.1-16', 'repair:MT.20.1-16']);
    expect(meters[0]?.ceilingUsd).toBeCloseTo(config.research.budget.perPassageUsd - 0.5, 10);
    expect(meters[2]?.ceilingUsd).toBe(0);
    expect(report.results[2]?.repairStopped).toMatch(/^budget: /);
    expect(runMeter.spentUsd()).toBeGreaterThan(0);
  });
});

describe('formatValidationReport', () => {
  it('lists each outcome with its repairs, drops and remaining problems', async () => {
    const results: ValidationResult[] = [
      await preValidate(draftOf(validOutput()), deps(new RepairLlm({}))),
      await preValidate(draftOf(unsupportedThirdClaim()), deps(new RepairLlm({ fail: 'timeout' }), { maxRepairs: 1 })),
      await preValidate(
        draftOf({}),
        deps(new RepairLlm({ output: VALID_OUTPUT }, { family: 'fake' }), { maxRepairs: 1 }),
      ),
    ];
    const text = formatValidationReport({
      results,
      ready: ['MT.20.1-16'],
      readyWithDrops: ['MT.20.1-16'],
      abandoned: ['MT.20.1-16'],
      repairPromptVersion: REPAIR_PROMPT_VERSION,
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Pre-validation (gates 1–3, repair-v1): 1 ready, 1 ready with drops, 1 abandoned');
    expect(lines[1]).toBe('- MT.20.1-16: ready (0 repairs, $0.00)');
    expect(lines[2]).toBe('- MT.20.1-16: ready-with-drops (0 repairs, $0.00)');
    expect(lines[3]).toMatch(/^ {4}repairs stopped: timeout: /);
    expect(lines[4]).toMatch(/^ {4}dropped claim c3: evidence\//);
    expect(lines[5]).toBe('    dropped source commentary-last: only dropped claims cited it');
    expect(lines[6]).toBe('- MT.20.1-16: abandoned (1 repair, $0.00)');
    expect(lines[7]).toMatch(/^ {4}\d failure\(s\) are not about a claim or a note/);
    expect(text).toContain('    passages/MT.20.1-16.json#/provenance/generator');
    expect(text).toContain('\n      Rule: ');
  });
});

const PASSAGE = {
  key: 'MT.20.1-16',
  ref: 'Mt 20:1-16a',
  locale: 'en',
  ...VALID_OUTPUT,
  translationNotes: VALID_OUTPUT.translationNotes.map((note, index) => ({ id: `note-${String(index)}`, ...note })),
  provenance: {
    generator: 'research-cli',
    runId: 'research-1',
    models: ['claude-opus-5-5'],
    promptVersion: 'research-v1',
    createdAt: '2026-10-05T07:50:00.000Z',
    costUsd: 0.4,
  },
  review: { status: 'pending', reviewers: [] },
  schemaVersion: 1,
} as unknown as Passage;

const META = {
  locale: 'en',
  runId: 'run',
  models: ['m'],
  family: 'anthropic',
  promptVersion: 'p',
  createdAt: '2026-10-05T00:00:00.000Z',
} as const;

describe('draftFromResult', () => {
  it('rebuilds the draft of a written passage from its output and provenance', () => {
    const written: WrittenResult = { status: 'written', key: 'MT.20.1-16', costUsd: 0.4, path: 'x', passage: PASSAGE };
    const draft = draftFromResult(written, { ref: 'ignored' }, META);
    expect(draft).toEqual({
      key: 'MT.20.1-16',
      ref: 'Mt 20:1-16a',
      output: outputOfPassage(PASSAGE),
      meta: {
        locale: 'en',
        runId: 'research-1',
        models: ['claude-opus-5-5'],
        family: 'anthropic',
        promptVersion: 'research-v1',
        createdAt: '2026-10-05T07:50:00.000Z',
        costUsd: 0.4,
      },
    });
    expect(draft?.output).toEqual(VALID_OUTPUT);
    const fake = { ...written, passage: { ...PASSAGE, provenance: { ...PASSAGE.provenance, generator: 'fake' } } };
    expect(draftFromResult(fake as WrittenResult, { ref: 'x' }, META)?.meta.family).toBe('fake');
  });

  it('keeps the output of a failed result and skips one with nothing to repair', () => {
    const failed: FailedResult = { status: 'failed', key: 'K', costUsd: 0.2, error: 'e', issues: [], output: '{"x' };
    expect(draftFromResult(failed, { ref: 'R' }, META)).toEqual({
      key: 'K',
      ref: 'R',
      output: '{"x',
      meta: { ...META, costUsd: 0.2 },
    });
    const { output: _output, ...bare } = failed;
    expect(draftFromResult(bare, { ref: 'R' }, META)).toBeUndefined();
  });
});
