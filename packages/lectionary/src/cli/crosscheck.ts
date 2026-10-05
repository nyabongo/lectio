// `npm run lectionary:crosscheck -- --block <name>` (logic and tests: ./run.ts).
import { resolveLectionaryRoot, runCrosscheck } from './run.ts';

process.exitCode = await runCrosscheck(process.argv.slice(2), resolveLectionaryRoot(process.env, process.cwd()), {
  out: console.log,
  err: console.error,
});
