// `npm run corpus:licences`: the attribution list from every SOURCE.json (logic and tests: ./run.ts).
import { resolveCorpusRoot, runLicences } from './run.ts';

process.exitCode = await runLicences(resolveCorpusRoot(process.env, process.cwd()), { out: console.log, err: console.error });
