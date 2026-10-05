#!/usr/bin/env node
// Thin wrapper: fails if the coverage configuration drops below the 96% floor.
// Logic: packages/shared/src/coverage-floor.ts. Run with `npm run coverage:floor`.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkCoverageFloor, DART_COVERAGE_CHECK } from '@lectio/shared/coverage-floor';

const { default: exported } = await import(pathToFileURL(resolve('vitest.config.ts')).href);
const vitestConfig = typeof exported === 'function' ? await exported({ mode: 'test', command: 'serve' }) : exported;
const dartSource = existsSync(DART_COVERAGE_CHECK) ? readFileSync(DART_COVERAGE_CHECK, 'utf8') : undefined;

const problems = checkCoverageFloor({ vitestConfig, dartSource });
if (problems.length > 0) {
  console.error(`coverage-floor: ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`coverage-floor: ok (vitest thresholds ≥ 96${dartSource === undefined ? '' : ', Dart threshold ≥ 96'})`);
