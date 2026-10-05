// `npm run research -- [run|plan|fixup|translate] …` (logic and tests: ./main.ts).
import { main, processContext } from './main.ts';

process.exitCode = await main(process.argv.slice(2), processContext(process.env, process.cwd()), {
  out: console.log,
  err: console.error,
});
