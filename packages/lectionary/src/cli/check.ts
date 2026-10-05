// `npm run lectionary:check [-- --block <name> --calendar <calendar/YYYY.json>]` (logic and tests: ./run.ts).
import { invocationDir, resolveLectionaryRoot, runCheck } from './run.ts';

process.exitCode = await runCheck(
  process.argv.slice(2),
  resolveLectionaryRoot(process.env, process.cwd()),
  { out: console.log, err: console.error },
  invocationDir(process.env, process.cwd()),
);
