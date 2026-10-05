// `npm run content:validate [files…]`. Logic: ../validate-files.ts.
import { runValidate } from '../validate-files.ts';

process.exitCode = runValidate(process.argv.slice(2), {
  cwd: process.env.INIT_CWD ?? process.cwd(),
  env: process.env,
  log: console.log,
  error: console.error,
});
