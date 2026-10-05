// `npm run lectionary:check [-- --block <name>]` (logic and tests: ./run.ts).
import { resolveLectionaryRoot, runCheck } from './run.ts';

process.exitCode = await runCheck(process.argv.slice(2), resolveLectionaryRoot(process.env, process.cwd()), {
  out: console.log,
  err: console.error,
});
