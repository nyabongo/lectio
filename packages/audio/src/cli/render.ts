// `npm run audio:render -- --provider fake --storage fs:.audio-out [--dry-run]`. Logic and tests: ./run.ts.
import { runRender } from './run.ts';

process.exitCode = await runRender(process.argv.slice(2), {
  cwd: process.env.INIT_CWD ?? process.cwd(),
  env: process.env,
  io: { out: console.log, err: console.error },
});
