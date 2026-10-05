// `npm run review:approve -- <files…> --reviewer <handle>`. Logic: ./run.ts.
import { runApprove } from './run.ts';

process.exitCode = await runApprove(process.argv.slice(2), {
  cwd: process.env.INIT_CWD ?? process.cwd(),
  env: process.env,
  now: () => new Date(),
  log: console.log,
  error: console.error,
});
