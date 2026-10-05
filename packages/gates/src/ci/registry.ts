/**
 * The required-check registry (`.github/required-checks/<workflow>.json`) as the content-gates
 * workflow uses it: the merge-rule job dispatches every listed workflow on the approval commit, and
 * the merge job waits for every listed check on that commit before it merges.
 *
 * The registry is read from the tooling checkout (main), never from the PR head, so a PR cannot
 * shorten the list of checks its own merge waits for.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseRegistryFile } from '@lectio/shared/required-checks';

export const REGISTRY_DIR = '.github/required-checks';

export interface RequiredChecksRegistry {
  /** Workflow files, sorted (for example `ci.yml`, `content-gates.yml`). */
  readonly workflows: readonly string[];
  /** Every required check name across the registry, sorted and deduplicated. */
  readonly checks: readonly string[];
}

/** Directory access for {@link readRequiredChecks}; tests inject their own. */
export interface RegistryFs {
  readonly list: (dir: string) => readonly string[];
  readonly read: (path: string) => string;
}

export const nodeRegistryFs: RegistryFs = {
  list: (dir) => readdirSync(dir),
  read: (path) => readFileSync(path, 'utf8'),
};

/** Parses registry files; throws listing every problem with them. */
export function parseRequiredChecks(files: readonly { file: string; source: string }[]): RequiredChecksRegistry {
  const workflows = new Set<string>();
  const checks = new Set<string>();
  const problems: string[] = [];
  for (const file of files) {
    const entry = parseRegistryFile(file);
    if (Array.isArray(entry)) {
      problems.push(...entry);
      continue;
    }
    workflows.add(entry.workflow);
    for (const job of entry.jobs) checks.add(job);
  }
  if (problems.length > 0) throw new Error(`invalid required-check registry: ${problems.join('; ')}`);
  if (workflows.size === 0) throw new Error(`the required-check registry (${REGISTRY_DIR}) is empty`);
  return { workflows: [...workflows].sort(), checks: [...checks].sort() };
}

/** The registry under `root` (the tooling checkout). */
export function readRequiredChecks(root: string, fs: RegistryFs = nodeRegistryFs): RequiredChecksRegistry {
  const dir = join(root, REGISTRY_DIR);
  const files = fs
    .list(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({ file, source: fs.read(join(dir, file)) }));
  return parseRequiredChecks(files);
}
