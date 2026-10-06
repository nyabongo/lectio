/**
 * The bad week (L-033): one pull request whose files, between them, show the failure message of
 * every content rule of gates 1 to 3 at least once, for the gate docs (L-043) and as a regression
 * check that each message still reads well. Committed under tests/gates/fixtures/bad-week/:
 *
 *     head/<path>        the files at the PR head (all added, except the one in base/)
 *     base/<path>        a file as it was on the base branch (the PR modifies it)
 *
 * On disk the content directories are `_passages/` and `_calendar/` (see {@link diskPath}), so the
 * tools that find content files by directory name anywhere in a PR (the merge rule's review-block
 * check among them) do not take the fixtures for real content.
 *     pages/index.json   the source pages the fetcher serves (FixtureSourceFetcher)
 *     comment.md         the rendered PR comment (a file snapshot, see bad-week.test.ts)
 *
 * Each bad file is a variant of one valid passage (`MT.20.1-16`, `MT.20.1-17`, …, a key per file) that breaks one
 * rule; `EXPECTED` lists the rules each file breaks. Every text is invented or commentary
 * written for this fixture: no Bible translation and no published commentary is reproduced
 * (ADR 0003). Two rules cannot be shown from content: `licence/pd-bible-overlap` (it would need
 * English Bible wording in the repository) and `licence/guard-index` (a broken index or config);
 * the licence gate's unit tests cover both.
 *
 * Refresh the committed files after changing this module:
 *
 *     npx tsx tests/gates/helpers/write-bad-week.ts
 */
import { join } from 'node:path';

import type { Passage } from '@lectio/schema/passage';
import { translatableSha256 } from '@lectio/schema/translated-passage';

import { validCalendar, validPassage } from '../../../packages/gates/src/schema-gate/fixtures/negative.ts';
import { validTranslation } from '../../../packages/gates/src/schema-gate/translations/fixtures/negative.ts';
import { REPO_ROOT } from './gate-test.ts';

export const BAD_WEEK_DIR = join(REPO_ROOT, 'tests', 'gates', 'fixtures', 'bad-week');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The commentary page every passage cites (invented for this fixture). */
export const PAGE_URL = 'https://commentary.example.org/bad-week/matthew-20';
/** A cited page the fetcher does not have (a 404). */
export const MISSING_URL = 'https://commentary.example.org/bad-week/gone';

export const PAGE_TEXT =
  'The parable of the householder is told by Matthew alone among the evangelists, and it closes a ' +
  'long answer to the question Peter put about the reward of those who had left everything. The ' +
  'householder goes out at dawn and again at the third, sixth, ninth and eleventh hours, and at evening ' +
  'every labourer receives the same denarius whatever the length of the day he worked. The grumbling of ' +
  'the first hired is met with a question about the evil eye, the old figure for a grudging spirit that ' +
  'cannot bear the good fortune of a neighbour.\n';

const WEB_SOURCE = {
  id: 'householder-page',
  type: 'web',
  citation: 'A commentary page written for the bad-week fixture',
  url: PAGE_URL,
  excerpt: 'told by Matthew alone among the evangelists',
  excerptLang: 'en',
  retrievedAt: '2026-10-05T08:00:00Z',
};

/** The valid passage for key `MT.20.<from>-<to>`, citing the fixture page instead of a print source. */
export function cleanPassage(from: number, to: number): Json {
  const passage: Json = validPassage();
  passage['key'] = `MT.20.${String(from)}-${String(to)}`;
  passage['ref'] = `Mt 20:${String(from)}-${String(to)}`;
  passage['sources'] = [passage['sources'][0], { ...WEB_SOURCE }];
  passage['claims'][0]['sourceIds'] = [WEB_SOURCE.id];
  return passage;
}

interface BadWeek {
  readonly head: Record<string, Json>;
  readonly base: Record<string, Json>;
  /** The rules (warnings and errors) each head file must break, sorted. */
  readonly expected: Record<string, readonly string[]>;
}

/** The bad week's files: one passage key per file (`MT.20.1-16`, `MT.20.1-17`, …), each breaking one rule. */
function buildBadWeek(): BadWeek {
  const head: Record<string, Json> = {};
  const base: Record<string, Json> = {};
  const expected: Record<string, readonly string[]> = {};
  let from = 1;
  let to = 15;
  /** The next clean passage: verse 20:15 (the note's verse) is in every one, and Matthew 20 ends at 34. */
  const next = (): Json => {
    to += 1;
    if (to > 34) [from, to] = [from + 1, 16];
    return cleanPassage(from, to);
  };
  const add = (file: string, value: Json, rules: readonly string[]): void => {
    head[file] = value;
    expected[file] = [...rules].sort();
  };
  const passagePath = (passage: Json): string => `passages/${String(passage['key'])}.json`;
  const variant = (rules: readonly string[], edit: (passage: Json) => void): Json => {
    const passage = next();
    edit(passage);
    add(passagePath(passage), passage, rules);
    return passage;
  };

  // The control: a passage that passes every gate.
  variant([], () => undefined);

  // Gate 1, schema.
  variant(['schema/valid-passage'], (p) => {
    delete p['summary'];
  });
  const misnamed = next();
  add(`passages/MT.20.${String(from)}-${String(to)}a.json`, misnamed, ['schema/key-matches-filename']);
  variant(['schema/ref-parses'], (p) => {
    p['ref'] = `Mt 21:${String(from)}-${String(to)}`;
  });
  variant(['schema/ref-is-real-verse', 'evidence/scripture-source-real'], (p) => {
    p['sources'][0]['ref'] = 'Dt 15:99';
  });
  variant(['schema/note-verse-in-passage', 'evidence/original-word-in-verse'], (p) => {
    p['translationNotes'][0]['verse'] = '21:15';
  });
  variant(['schema/claim-has-source'], (p) => {
    p['claims'][1]['sourceIds'] = ['dt-15-9', 'lsj-ophthalmos'];
  });
  variant(['schema/source-is-cited', 'evidence/print-source-flag'], (p) => {
    p['sources'].push({ id: 'unused', type: 'print', citation: 'An unused book' });
  });
  variant(['schema/sentence-cites-claim'], (p) => {
    p['context']['paragraphs'][0] =
      'Matthew alone records this parable. It sits between two sayings about the last being first. [c1] The owner’s question uses the idiom of the evil eye. [c2]';
  });
  variant(['schema/unique-ids'], (p) => {
    p['claims'].push({ ...p['claims'][1] });
  });
  // note-ids-stable: the base branch had the note as `evil-eye`; the PR renames it.
  const renamed = variant(['schema/note-ids-stable'], (p) => {
    p['translationNotes'][0]['id'] = 'ophthalmos';
  });
  base[passagePath(renamed)] = cleanPassage(from, to);
  variant(['schema/approved-has-reviewer'], (p) => {
    p['review'] = { status: 'approved', method: 'human', reviewers: ['someone-else'], approvedVia: 'label' };
  });
  variant(['schema/no-fake-provenance'], (p) => {
    p['provenance'] = { ...p['provenance'], generator: 'fake', models: ['fake'] };
  });
  const calendar: Json = validCalendar();
  calendar['days'][0]['date'] = '2025-09-20';
  add('calendar/2026.json', calendar, ['schema/valid-calendar']);
  const keys: Json = validCalendar();
  keys['year'] = 2027;
  keys['days'][0]['date'] = '2027-09-19';
  keys['days'][0]['masses'][0]['readings'][1]['key'] = 'MT.20.1-15';
  add('calendar/2027.json', keys, ['schema/calendar-keys-wellformed']);

  // Gate 1, translations: each translates a clean English passage of its own.
  const translation = (rules: readonly string[], edit: (t: Json, english: Json) => void): void => {
    const english = variant([], () => undefined);
    const t: Json = validTranslation();
    t['translationOf'] = english['key'];
    t['sourceSha256'] = translatableSha256(english as Passage);
    edit(t, english);
    add(`passages/i18n/sw/${String(t['translationOf'])}.json`, t, rules);
  };
  translation(['schema/valid-translation'], (t) => {
    delete t['sourceSha256'];
  });
  translation(['schema/translation-of-exists'], (t) => {
    t['translationOf'] = 'MT.20.1-14';
  });
  translation(['schema/translation-matches-source'], (t) => {
    t['claims'].pop();
  });
  translation(['schema/translation-not-stale'], (t, english) => {
    const older = { ...english, summary: 'A landowner pays every labourer the same wage, whenever they were hired.' };
    t['sourceSha256'] = translatableSha256(older as Passage);
  });
  translation(['schema/translation-quoted-run'], (t) => {
    t['claims'][0]['text'] =
      'Mathayo anaandika “mmoja wawili watatu wanne watano sita saba nane tisa kumi kumi na moja”.';
  });
  translation(['schema/translation-needs-review'], (t) => {
    t['review'] = { status: 'pending', reviewers: [] };
  });

  // Gate 2, evidence.
  variant(['evidence/web-excerpt-found'], (p) => {
    p['sources'][1]['excerpt'] = 'told by Mark alone among the evangelists';
  });
  variant(['evidence/scripture-source-real'], (p) => {
    p['sources'].push({
      id: 'mt-20-14',
      type: 'scripture',
      citation: 'Matthew 20:14',
      ref: 'Mt 20:14',
      excerpt: 'ὀφθαλμός',
      excerptLang: 'grc',
    });
    p['claims'][1]['sourceIds'].push('mt-20-14');
  });
  variant(['evidence/original-word-in-verse'], (p) => {
    p['translationNotes'][0]['original']['text'] = 'ὀφθαλμὸς σου πονηρρός';
  });
  variant(['evidence/print-source-flag'], (p) => {
    p['sources'][1] = {
      id: WEB_SOURCE.id,
      type: 'print',
      citation:
        'W. D. Davies and Dale C. Allison, The Gospel According to Saint Matthew, vol. 3 (ICC), T&T Clark, 1997',
    };
  });

  // Gate 3, licence.
  variant(['licence/quoted-english-run'], (p) => {
    p['claims'][0]['text'] =
      'Matthew calls it “a parable told to the twelve about the last who become first in the kingdom”.';
  });
  variant(['licence/commentary-overlap'], (p) => {
    p['translationNotes'][0]['body'] =
      'Every labourer receives the same denarius whatever the length of the day he worked. [c2] English trades the image for an abstract feeling. [c2]';
  });
  variant(['evidence/web-excerpt-found', 'licence/commentary-unchecked'], (p) => {
    p['sources'][1] = { ...p['sources'][1], url: MISSING_URL };
  });
  variant(['licence/excerpt-length'], (p) => {
    p['sources'][1]['excerpt'] =
      'The householder goes out at dawn and again at the third, sixth, ninth and eleventh hours, and at evening every labourer receives the same denarius whatever the length of the day';
  });
  return { head, base, expected };
}

/** Where a PR path (`passages/…`, `calendar/…`) is stored under head/ or base/. */
export function diskPath(path: string): string {
  return path.replace(/^(passages|calendar)\//u, '_$1/');
}

/** The PR path of a file stored at `path` under head/ or base/. */
export function prPath(path: string): string {
  return path.replace(/^_(passages|calendar)\//u, '$1/');
}

const text = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Every committed file of the bad week, by path under {@link BAD_WEEK_DIR}. */
export function badWeekFiles(): Record<string, string> {
  const { head, base } = buildBadWeek();
  const files: Record<string, string> = {};
  for (const [file, value] of Object.entries(head)) files[`head/${diskPath(file)}`] = text(value);
  for (const [file, value] of Object.entries(base)) files[`base/${diskPath(file)}`] = text(value);
  files['pages/index.json'] = text({ [PAGE_URL]: { file: 'matthew-20.txt' } });
  files['pages/matthew-20.txt'] = PAGE_TEXT;
  return files;
}

/** The rules (warnings and errors, deduplicated and sorted) each head file must break. */
export const EXPECTED: Readonly<Record<string, readonly string[]>> = buildBadWeek().expected;

/** Content rules of gates 1 to 3 the bad week cannot show (see the module comment). */
export const NOT_SHOWN: readonly string[] = ['licence/guard-index', 'licence/pd-bible-overlap'];
