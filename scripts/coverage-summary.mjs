#!/usr/bin/env node
// Thin wrapper: prints coverage/coverage-summary.json as a Markdown table
// (appended to the CI job summary). Logic: packages/shared/src/coverage-summary.ts.
import { readFileSync } from 'node:fs';

import { renderCoverageSummary } from '@lectio/shared/coverage-summary';

const path = process.argv[2] ?? 'coverage/coverage-summary.json';
process.stdout.write(renderCoverageSummary(JSON.parse(readFileSync(path, 'utf8'))));
