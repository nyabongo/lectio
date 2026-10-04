#!/usr/bin/env node
// Thin wrapper: runs a pre-registered workspace script's target once it exists,
// otherwise prints "not implemented (L-NNN)". Logic: packages/shared/src/planned-script.ts.
// Usage (from a workspace, via tsx): run-planned.mjs <L-NNN> [target] [...args]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { planScriptRun } from '@lectio/shared/planned-script';

const plan = planScriptRun(process.argv.slice(2), {
  exists: existsSync,
  execPath: process.execPath,
  execArgv: process.execArgv,
});

if (plan.kind === 'exit') {
  console.error(plan.message);
  process.exit(plan.code);
}
const result = spawnSync(plan.command, plan.args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
