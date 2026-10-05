// `npm run corpus:import:greek`: imports the pinned MorphGNT SBLGNT into corpus/grc-sblgnt
// (logic and tests: packages/corpus/src/importers/morphgnt.ts).
import { runImportGreek } from '../../packages/corpus/src/importers/morphgnt.ts';

process.exitCode = await runImportGreek(process.env, process.cwd(), { out: console.log, err: console.error });
