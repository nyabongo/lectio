// `npm run calendar:check [-- --year <YYYY> --region <slug>]` (logic and tests: ./run.ts).
import { processContext, runCheck } from './run.ts';

process.exitCode = await runCheck(process.argv.slice(2), processContext(process.env, process.cwd()), {
  out: console.log,
  err: console.error,
});
