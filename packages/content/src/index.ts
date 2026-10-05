/**
 * @lectio/content: the content repository loader and day resolver.
 *
 * `openRepo(root)` reads `calendar/<year>.json` and `passages/<key>.json` lazily, validates
 * each file on first use and resolves a date to its readings and passage notes. Errors carry
 * the file and a JSON pointer. `npm run content:validate` checks files from the command line.
 */
export const packageName = '@lectio/content';

export { ContentError, formatIssue, issuesFromAjv, pointerSegment } from './errors.ts';
export type { ContentIssue } from './errors.ts';
export {
  CALENDAR_DIR,
  PASSAGES_DIR,
  TRANSLATIONS_DIR,
  checkCalendarYear,
  checkContentText,
  checkPassage,
  checkTranslatedPassage,
  contentKindOf,
  translationPlaceOf,
  nodeFs,
  parseJson,
  yearOfFileName,
} from './files.ts';
export type { ContentFs, ContentKind } from './files.ts';
export { approvedOnly, isApproved, openRepo } from './repo.ts';
export type { ContentRepo, OpenRepoOptions, ResolvedDay, ResolvedMass, ResolvedReading } from './repo.ts';
export { contentFilesUnder, runValidate, validateContentFiles } from './validate-files.ts';
export type { ValidateCliOptions, ValidationReport } from './validate-files.ts';
