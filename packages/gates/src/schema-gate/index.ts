/**
 * Gate `schema` (Schema tests, L-024): every file validates, every claim has a source, every
 * reference parses to a real verse.
 *
 * The gate checks each passage (`passages/<key>.json`) and calendar year (`calendar/<year>.json`)
 * the pull request adds, modifies or renames, under the configured content root:
 *
 * 1. the schema (`@lectio/content`'s `checkPassage` / `checkCalendarYear`, the same validators
 *    `npm run content:validate` and the loader use, including the date-in-year check);
 * 2. for a schema-valid file, the rules that span fields (./passage.ts, ./calendar.ts): file
 *    names, references and verses, per-sentence citations, orphans, unique ids, the review block
 *    and provenance;
 * 3. for a passage that exists on the base branch, that no translation-note or claim id was
 *    dropped (./stable-ids.ts), read through the context's git reader.
 *
 * Every finding is an error (the gate fails), except deleting a published passage, which is a
 * `warning` (the gate flags it for a person).
 */
import type { CalendarYear } from '@lectio/schema/calendar';
import type { Passage } from '@lectio/schema/passage';
import { checkCalendarYear, checkPassage, parseJson } from '@lectio/content';
import type { ContentError, ContentKind } from '@lectio/content';

import type { Gate, GateContext } from '../core/gate.ts';
import type { ChangedFile } from '../core/git.ts';
import { finding, resultFromFindings } from '../core/result.ts';
import type { GateResult, GateResultItem } from '../core/result.ts';
import type { Rule } from '../core/rules.ts';
import { checkCalendarRules } from './calendar.ts';
import { checkPassageRules } from './passage.ts';
import { SCHEMA_RULES } from './rules.ts';
import { checkStableIds } from './stable-ids.ts';

export { SCHEMA_RULES } from './rules.ts';

const GATE_ID = 'schema';

/** The repository-relative prefix of the content root: `.` → `""`, `./content/` → `"content/"`. */
export function contentPrefix(root: string): string {
  const trimmed = root.replace(/^\.\/?/, '').replace(/\/+$/, '');
  return trimmed === '' ? '' : `${trimmed}/`;
}

/** `passage` or `calendar` for a JSON file directly in that directory under the content root, else `null`. */
export function contentKindAt(path: string, prefix: string): ContentKind | null {
  if (!path.startsWith(prefix) || !path.endsWith('.json')) return null;
  const rest = path.slice(prefix.length);
  const slash = rest.indexOf('/');
  if (slash < 0 || rest.indexOf('/', slash + 1) >= 0) return null;
  const dir = rest.slice(0, slash);
  if (dir === 'passages') return 'passage';
  if (dir === 'calendar') return 'calendar';
  return null;
}

/** Schema problems as findings of the file's validity rule. */
function schemaFindings(rule: Rule, error: ContentError): GateResultItem[] {
  return error.issues.map((issue) =>
    finding(rule, { file: error.file, pointer: issue.pointer, message: issue.message }),
  );
}

function checkText(kind: ContentKind, path: string, text: string, context: GateContext): GateResultItem[] {
  const rule = kind === 'passage' ? SCHEMA_RULES.validPassage : SCHEMA_RULES.validCalendar;
  let value: Passage | CalendarYear;
  try {
    const parsed = parseJson(text, path);
    value = kind === 'passage' ? checkPassage(parsed, path) : checkCalendarYear(parsed, path);
  } catch (error) {
    // checkPassage, checkCalendarYear and parseJson only throw ContentError.
    return schemaFindings(rule, error as ContentError);
  }
  return kind === 'passage'
    ? checkPassageRules(path, value as Passage, context.config)
    : checkCalendarRules(path, value as CalendarYear);
}

/** The base-branch text a changed passage is compared with; `null` for a file new in the PR. */
function baseText(change: ChangedFile, context: GateContext): string | null {
  if (change.status === 'added' || change.status === 'copied') return null;
  return context.readBase(change.previousPath ?? change.path);
}

/** Every finding for the pull request's content files, and how many files were checked. */
export function checkSchema(context: GateContext): { items: GateResultItem[]; files: number } {
  const prefix = contentPrefix(context.config.content.root);
  const items: GateResultItem[] = [];
  let files = 0;
  for (const change of context.changedFiles) {
    const kind = contentKindAt(change.path, prefix);
    if (kind === null) continue;
    const text = change.status === 'deleted' ? null : context.readFile(change.path);
    if (text !== null) {
      files += 1;
      items.push(...checkText(kind, change.path, text, context));
    }
    if (kind === 'passage') items.push(...checkStableIds(change, baseText(change, context), text));
  }
  return { items, files };
}

export const schemaGate: Gate = {
  id: GATE_ID,
  title: 'Schema tests',
  rules: Object.values(SCHEMA_RULES),
  run(context): GateResult {
    const { items, files } = checkSchema(context);
    return resultFromFindings(GATE_ID, items, { files });
  },
};
