// `npm run calendar:build -- --year <YYYY> [--region <slug>]` (logic and tests: ./run.ts).
import { processContext, runBuild } from './run.ts';

process.exitCode = await runBuild(process.argv.slice(2), processContext(process.env, process.cwd()), {
  out: console.log,
  err: console.error,
});
