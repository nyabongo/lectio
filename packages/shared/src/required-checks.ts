/**
 * Validates the required-check registry in `.github/required-checks/`.
 *
 * Each `<workflow>.json` names a workflow and the jobs that branch protection
 * requires (setup.sh, L-032, builds protection from this directory; the
 * merge-rule job, L-031, dispatches every listed workflow). A listed workflow
 * must exist, accept `workflow_dispatch` (so the merge-rule job can re-run it on
 * the approval commit), have no trigger-level `paths:`/`paths-ignore:` (a
 * filtered required check never reports and blocks the merge forever), and
 * define every listed check: a job whose display name (`name:`, falling back to
 * the job id) equals the listed entry and that has no matrix. No two jobs in a
 * listed workflow may share a display name (branch protection could not tell
 * their checks apart, so one could pass for the other), and a registry file may
 * not list the same check twice.
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
    problems.push(`${file}: "jobs" must be a non-empty array of check names (job name or id)`);
  } else {
    const duplicates = jobs.filter((job: string, index) => jobs.indexOf(job) !== index);
    for (const job of new Set(duplicates)) problems.push(`${file}: "jobs" lists '${String(job)}' more than once`);
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

  // Branch protection matches the check name a job reports: its `name:` if set,
  // otherwise its id. A matrix job reports one check per combination
  // (`name (a, b)`), so it can never match a single registered name.
  const defined = isRecord(doc['jobs']) ? doc['jobs'] : {};
  const byCheckName = new Map<string, { id: string; job: Record<string, unknown> }>();
  for (const [id, job] of Object.entries(defined)) {
    const config = isRecord(job) ? job : {};
    const name = typeof config['name'] === 'string' ? config['name'] : id;
    const clash = byCheckName.get(name);
    if (clash !== undefined) {
      problems.push(
        `${workflow}: jobs '${clash.id}' and '${id}' both report a check named '${name}'; give each job a unique name: so branch protection can tell them apart`,
      );
      continue;
    }
    byCheckName.set(name, { id, job: config });
  }
  for (const listed of jobs) {
    const match = byCheckName.get(listed);
    if (match === undefined) {
      const byId = defined[listed];
      problems.push(
        isRecord(byId) && typeof byId['name'] === 'string'
          ? `${workflow}: job '${listed}' reports as '${byId['name']}'; list the check name branch protection sees`
          : `${workflow}: job '${listed}' is listed as a required check but not defined`,
      );
    } else if (isRecord(match.job['strategy']) && 'matrix' in match.job['strategy']) {
      problems.push(
        `${workflow}: job '${match.id}' uses strategy.matrix, so it never reports a check named '${listed}'`,
      );
    }
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
