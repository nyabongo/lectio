import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkWorkflow, parseRegistryFile, validateRequiredChecks } from './required-checks.ts';

const GOOD_WORKFLOW = `
name: CI
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
jobs:
  lint:
    runs-on: ubuntu-latest
    steps: [{ run: echo }]
  test:
    runs-on: ubuntu-latest
    steps: [{ run: echo }]
`;

const registry = (jobs: string[], file = 'ci.json', workflow = 'ci.yml') => ({
  file,
  source: JSON.stringify({ workflow, jobs }),
});

describe('validateRequiredChecks', () => {
  it('accepts a registry whose workflow defines every job', () => {
    expect(validateRequiredChecks([registry(['lint', 'test'])], () => GOOD_WORKFLOW)).toEqual([]);
  });

  it('fails when a listed job is missing from its workflow', () => {
    expect(validateRequiredChecks([registry(['lint', 'e2e'])], () => GOOD_WORKFLOW)).toEqual([
      "ci.yml: job 'e2e' is listed as a required check but not defined",
    ]);
  });

  it('fails when the workflow lacks workflow_dispatch', () => {
    const source = GOOD_WORKFLOW.replace('  workflow_dispatch:\n', '');
    expect(validateRequiredChecks([registry(['lint'])], () => source)).toEqual([
      'ci.yml: required-check workflows must accept workflow_dispatch',
    ]);
  });

  it('fails when the workflow has a trigger-level paths: or paths-ignore:', () => {
    const source = GOOD_WORKFLOW.replace('  pull_request:\n', "  pull_request:\n    paths: ['src/**']\n").replace(
      '    branches: [main]\n',
      "    branches: [main]\n    paths-ignore: ['docs/**']\n",
    );
    expect(validateRequiredChecks([registry(['lint'])], () => source)).toEqual([
      'ci.yml: on.push uses trigger-level paths-ignore:, which required checks must never use',
      'ci.yml: on.pull_request uses trigger-level paths:, which required checks must never use',
    ]);
  });

  it('fails when the workflow file does not exist', () => {
    expect(validateRequiredChecks([registry(['lint'])], () => undefined)).toEqual([
      'ci.json: workflow .github/workflows/ci.yml does not exist',
    ]);
  });

  it('fails on an empty registry', () => {
    expect(validateRequiredChecks([], () => GOOD_WORKFLOW)).toEqual([
      '.github/required-checks/ has no <workflow>.json files',
    ]);
  });

  it('reports malformed registry files and keeps checking the others', () => {
    const files = [{ file: 'web.json', source: '{' }, registry(['lint'])];
    const problems = validateRequiredChecks(files, () => GOOD_WORKFLOW);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^web\.json: not valid JSON/);
  });
});

describe('check names', () => {
  const workflow = (jobs: string) => `on: workflow_dispatch\njobs:\n${jobs}`;

  it('matches a job by its display name', () => {
    expect(checkWorkflow('a.yml', workflow('  lint:\n    name: Lint\n'), ['Lint'])).toEqual([]);
  });

  it('rejects a listed id whose job reports under another name', () => {
    expect(checkWorkflow('a.yml', workflow('  lint:\n    name: Lint\n'), ['lint'])).toEqual([
      "a.yml: job 'lint' reports as 'Lint'; list the check name branch protection sees",
    ]);
  });

  it('rejects matrix jobs, which report one check per combination', () => {
    const source = workflow('  test:\n    strategy:\n      matrix:\n        node: [22, 24]\n');
    expect(checkWorkflow('a.yml', source, ['test'])).toEqual([
      "a.yml: job 'test' uses strategy.matrix, so it never reports a check named 'test'",
    ]);
    const noMatrix = workflow('  test:\n    strategy:\n      fail-fast: false\n');
    expect(checkWorkflow('a.yml', noMatrix, ['test'])).toEqual([]);
  });

  it('tolerates a job defined without a body', () => {
    expect(checkWorkflow('a.yml', workflow('  lint:\n'), ['lint'])).toEqual([]);
  });
});

describe('parseRegistryFile', () => {
  it('parses a valid file', () => {
    expect(parseRegistryFile(registry(['lint']))).toEqual({ workflow: 'ci.yml', jobs: ['lint'] });
  });

  it('rejects non-objects, bad workflow names, misnamed files and bad job lists', () => {
    expect(parseRegistryFile({ file: 'ci.json', source: '[]' })).toEqual([
      'ci.json: must be an object { "workflow": "<file>.yml", "jobs": [...] }',
    ]);
    expect(parseRegistryFile({ file: 'ci.json', source: '{"workflow":"ci","jobs":[]}' })).toEqual([
      'ci.json: "workflow" must be a workflow file name such as "ci.yml"',
      'ci.json: "jobs" must be a non-empty array of check names (job name or id)',
    ]);
    expect(parseRegistryFile(registry(['lint'], 'web.json', 'ci.yml'))).toEqual([
      'web.json: must be named after its workflow (ci.json)',
    ]);
    expect(parseRegistryFile({ file: 'ci.json', source: '{"workflow":"ci.yml","jobs":["", 3]}' })).toEqual([
      'ci.json: "jobs" must be a non-empty array of check names (job name or id)',
    ]);
  });
});

describe('checkWorkflow', () => {
  it('accepts string and list trigger forms', () => {
    expect(checkWorkflow('a.yml', 'on: workflow_dispatch\njobs: { x: {} }', ['x'])).toEqual([]);
    expect(checkWorkflow('a.yml', 'on: [push, workflow_dispatch]\njobs: { x: {} }', ['x'])).toEqual([]);
  });

  it('treats a missing on: or jobs: block as empty', () => {
    expect(checkWorkflow('a.yml', 'name: nothing', ['x'])).toEqual([
      'a.yml: required-check workflows must accept workflow_dispatch',
      "a.yml: job 'x' is listed as a required check but not defined",
    ]);
  });

  it('rejects invalid YAML and non-mapping documents', () => {
    expect(checkWorkflow('a.yml', 'on: [unclosed', ['x'])[0]).toMatch(/^a\.yml: not valid YAML/);
    expect(checkWorkflow('a.yml', '- just\n- a list', ['x'])).toEqual(['a.yml: not a workflow (expected a mapping)']);
  });
});

describe('repository registry', () => {
  it('.github/required-checks/*.json is valid against .github/workflows', () => {
    const root = join(import.meta.dirname, '../../..');
    const dir = join(root, '.github/required-checks');
    const files = readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => ({ file, source: readFileSync(join(dir, file), 'utf8') }));
    const read = (workflow: string): string | undefined => {
      const path = join(root, '.github/workflows', workflow);
      return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    };
    expect(validateRequiredChecks(files, read)).toEqual([]);
  });
});
