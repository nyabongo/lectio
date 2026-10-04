#!/usr/bin/env node
// Thin wrapper: validates .github/required-checks/*.json against .github/workflows.
// Logic: packages/shared/src/required-checks.ts. Run with `npm run required-checks`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateRequiredChecks } from '@lectio/shared/required-checks';

const registryDir = '.github/required-checks';
const files = (existsSync(registryDir) ? readdirSync(registryDir) : [])
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => ({ file, source: readFileSync(join(registryDir, file), 'utf8') }));

/** @param {string} workflow */
const readWorkflow = (workflow) => {
  const path = join('.github/workflows', workflow);
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
};

const problems = validateRequiredChecks(files, readWorkflow);
if (problems.length > 0) {
  console.error(`required-checks: ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`required-checks: ok (${files.map((f) => f.file).join(', ')})`);
