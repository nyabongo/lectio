// `lectio-gates run|decide …` (npm run -w @lectio/gates gates -- …). Logic: ./run.ts.
import { runGatesCli } from './run.ts';

process.exitCode = await runGatesCli(process.argv.slice(2), {
  cwd: process.env.INIT_CWD ?? process.cwd(),
  env: process.env,
  log: console.log,
  error: console.error,
});
