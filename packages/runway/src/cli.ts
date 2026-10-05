// `npm run runway [-- --from YYYY-MM-DD] [--dry-run]` (logic and tests: ./run.ts).
import { processContext, runRunway } from './run.ts';

process.exitCode = await runRunway(process.argv.slice(2), processContext(process.env, process.cwd()), {
  out: console.log,
  err: console.error,
});
