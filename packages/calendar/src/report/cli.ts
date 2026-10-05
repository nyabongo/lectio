// `npm run calendar:report [-- --year <YYYY>…]` (logic and tests: ./run.ts).
import { reportContext, runReport } from './run.ts';

process.exitCode = await runReport(process.argv.slice(2), reportContext(process.env, process.cwd()), {
  out: console.log,
  err: console.error,
});
