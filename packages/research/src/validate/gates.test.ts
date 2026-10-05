import { join } from 'node:path';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { openRepo } from '@lectio/content';
import type { Gate } from '@lectio/gates';
import { describe, expect, it } from 'vitest';

import { assemblePassage } from '../agent/assemble.ts';
import { REPO_ROOT, VALID_OUTPUT, fixtureProviders } from './fixtures/draft.ts';
import { PRE_VALIDATION_GATE_IDS, contentPrefix, draftPath, preValidationGates, runDraftGates } from './gates.ts';

const passage = assemblePassage(VALID_OUTPUT, {
  key: 'MT.20.1-16',
  ref: 'Mt 20:1-16a',
  locale: 'en',
  runId: 'run',
  models: ['claude-opus-5-5'],
  family: 'anthropic',
  promptVersion: 'research-v1',
  createdAt: '2026-10-05T07:50:00.000Z',
  costUsd: 0.5,
});
const text = JSON.stringify(passage);
const deps = { config: DEFAULT_CONFIG, providers: fixtureProviders(), root: REPO_ROOT };

describe('pre-validation gates', () => {
  it('are gates 1–3 of the registry', () => {
    expect(PRE_VALIDATION_GATE_IDS).toEqual(['schema', 'evidence', 'licence']);
    expect(preValidationGates().map((gate) => gate.id)).toEqual(['schema', 'evidence', 'licence']);
  });

  it('put the draft under the content root', () => {
    expect(contentPrefix('.')).toBe('');
    expect(contentPrefix('./')).toBe('');
    expect(contentPrefix('./content/')).toBe('content/');
    expect(contentPrefix('content')).toBe('content/');
    const config = { ...DEFAULT_CONFIG, content: { root: './content' } } as LectioConfig;
    expect(draftPath(config, 'MT.20.1-16')).toBe('content/passages/MT.20.1-16.json');
    expect(draftPath(DEFAULT_CONFIG, 'MT.20.1-16')).toBe('passages/MT.20.1-16.json');
  });
});

describe('runDraftGates', () => {
  it('runs the gates on the in-memory draft as the one added file', async () => {
    const run = await runDraftGates('passages/MT.20.1-16.json', text, deps);
    expect(run.passed).toBe(true);
    expect(run.errors).toEqual([]);
    expect(run.problems).toEqual([]);
    expect(run.report.changedFiles).toEqual(['passages/MT.20.1-16.json']);
    expect(run.report.results.map((result) => result.status)).not.toContain('skipped');
  });

  it('hands the gates the given content repository and reads other files through readText', async () => {
    const repo = openRepo(join(REPO_ROOT, '.'));
    const seen: { repo?: unknown; draft?: string | null; other?: string | null } = {};
    const probe: Gate = {
      id: 'schema',
      title: 'probe',
      rules: [],
      run(context) {
        seen.repo = context.repo;
        seen.draft = context.readFile('passages/MT.20.1-16.json');
        seen.other = context.readFile('calendar/2026.json');
        return { gate: 'schema', status: 'pass', items: [], meta: {} };
      },
    };
    const read: string[] = [];
    const run = await runDraftGates('passages/MT.20.1-16.json', text, {
      ...deps,
      repo,
      gates: [probe],
      readText: (absolute) => {
        read.push(absolute);
        return 'other text';
      },
    });
    expect(run.passed).toBe(true);
    expect(seen).toEqual({ repo, draft: text, other: 'other text' });
    expect(read).toEqual([join(REPO_ROOT, 'calendar/2026.json')]);
  });

  it('compares with the base version when there is one', async () => {
    const base = JSON.stringify({
      ...passage,
      translationNotes: [...passage.translationNotes, { ...passage.translationNotes[0], id: 'gone' }],
    });
    const run = await runDraftGates('passages/MT.20.1-16.json', text, {
      ...deps,
      repo: openRepo(join(REPO_ROOT, '.')),
      readBase: (path) => (path === 'passages/MT.20.1-16.json' ? base : null),
      readText: () => null,
      gates: preValidationGates().slice(0, 1),
    });
    expect(run.passed).toBe(false);
    expect(run.errors.map((item) => item.ruleId)).toEqual(['schema/note-ids-stable']);
    expect(run.problems[0]).toContain('Rule: ');
    expect(run.report.results).toHaveLength(1);
  });
});
