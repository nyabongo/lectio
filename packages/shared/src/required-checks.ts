/**
 * Validates the required-check registry in `.github/required-checks/`.
 *
 * Each `<workflow>.json` names a workflow and the jobs that branch protection
 * requires (setup.sh, L-032, builds protection from this directory; the
 * merge-rule job, L-031, dispatches every listed workflow). A listed workflow
 * must exist, accept `workflow_dispatch` (so the merge-rule job can re-run it on
 * the approval commit), have no trigger-level `paths:`/`paths-ignore:` (a
 * filtered required check never reports and blocks the merge forever), and
 * define every listed job.
 *
 * `npm run required-checks` (scripts/check-required-checks.mjs) is the thin CLI.
 */
import { parse } from 'yaml';

export interface RegistryFile {
  /** File name inside `.github/required-checks/`, e.g. `ci.json`. */
  file: string;
  /** Raw file contents. */
  source: string;
}

export interface RegistryEntry {
  workflow: string;
  jobs: string[];
}

/** Reads a workflow file by name (e.g. `ci.yml`); undefined when it does not exist. */
export type WorkflowReader = (workflow: string) => string | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses one registry file; returns the entry or the reasons it is malformed. */
export function parseRegistryFile({ file, source }: RegistryFile): RegistryEntry | string[] {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch (error) {
    return [`${file}: not valid JSON (${(error as Error).message})`];
  }
  if (!isRecord(data)) return [`${file}: must be an object { "workflow": "<file>.yml", "jobs": [...] }`];
  const { workflow, jobs } = data;
  const problems: string[] = [];
  if (typeof workflow !== 'string' || !/^[\w.-]+\.ya?ml$/.test(workflow)) {
    problems.push(`${file}: "workflow" must be a workflow file name such as "ci.yml"`);
  } else if (file.replace(/\.json$/, '') !== workflow.replace(/\.ya?ml$/, '')) {
    problems.push(`${file}: must be named after its workflow (${workflow.replace(/\.ya?ml$/, '')}.json)`);
  }
  if (!Array.isArray(jobs) || jobs.length === 0 || !jobs.every((job) => typeof job === 'string' && job !== '')) {
    problems.push(`${file}: "jobs" must be a non-empty array of job ids`);
  }
  return problems.length > 0 ? problems : { workflow: workflow as string, jobs: jobs as string[] };
}

/** Problems with one workflow against the jobs the registry requires from it. */
export function checkWorkflow(workflow: string, source: string, jobs: string[]): string[] {
  let doc: unknown;
  try {
    doc = parse(source);
  } catch (error) {
    return [`${workflow}: not valid YAML (${(error as Error).message})`];
  }
  if (!isRecord(doc)) return [`${workflow}: not a workflow (expected a mapping)`];

  const problems: string[] = [];
  const on = doc['on'];
  const triggers: Record<string, unknown> =
    typeof on === 'string'
      ? { [on]: null }
      : Array.isArray(on)
        ? Object.fromEntries(on.map((name) => [String(name), null]))
        : isRecord(on)
          ? on
          : {};
  if (!('workflow_dispatch' in triggers)) {
    problems.push(`${workflow}: required-check workflows must accept workflow_dispatch`);
  }
  for (const [trigger, config] of Object.entries(triggers)) {
    if (!isRecord(config)) continue;
    for (const key of ['paths', 'paths-ignore']) {
      if (key in config) {
        problems.push(`${workflow}: on.${trigger} uses trigger-level ${key}:, which required checks must never use`);
      }
    }
  }

  const defined = isRecord(doc['jobs']) ? doc['jobs'] : {};
  for (const job of jobs) {
    if (!(job in defined)) problems.push(`${workflow}: job '${job}' is listed as a required check but not defined`);
  }
  return problems;
}

/** Every problem across the registry; empty when it is valid. */
export function validateRequiredChecks(files: RegistryFile[], readWorkflow: WorkflowReader): string[] {
  if (files.length === 0) return ['.github/required-checks/ has no <workflow>.json files'];
  const problems: string[] = [];
  for (const file of files) {
    const entry = parseRegistryFile(file);
    if (Array.isArray(entry)) {
      problems.push(...entry);
      continue;
    }
    const source = readWorkflow(entry.workflow);
    if (source === undefined) {
      problems.push(`${file.file}: workflow .github/workflows/${entry.workflow} does not exist`);
      continue;
    }
    problems.push(...checkWorkflow(entry.workflow, source, entry.jobs));
  }
  return problems;
}
