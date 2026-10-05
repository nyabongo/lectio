// `npm run gates:docs [-- --check]`. Logic: ./run.ts.
import { runGatesDocs } from './run.ts';

process.exitCode = await runGatesDocs(process.argv.slice(2), {
  cwd: process.env.INIT_CWD ?? process.cwd(),
  log: console.log,
  error: console.error,
});
