// `npm run corpus:find -- grc-sblgnt MT 20 15 πονηρός` (logic and tests: ./run.ts).
import { resolveCorpusRoot, runFind } from './run.ts';

process.exitCode = await runFind(process.argv.slice(2), resolveCorpusRoot(process.env, process.cwd()), { out: console.log, err: console.error });
