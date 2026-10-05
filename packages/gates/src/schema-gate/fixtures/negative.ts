/**
 * Fixtures for gate 1: one valid passage and calendar year, and for every schema rule a negative
 * fixture, a small pull request that breaks exactly that rule. Commentary only: the passage
 * quotes original-language words, never an English translation (ADR 0003).
 */
import type { ChangedFile } from '../../core/git.ts';

/** A pull request: the files at its head, what it changes, and the files on its base branch. */
export interface PullRequestFixture {
  readonly head: Readonly<Record<string, string>>;
  readonly changed: readonly ChangedFile[];
  readonly base?: Readonly<Record<string, string>>;
}

type Json = Record<string, unknown>;

export const PASSAGE_PATH = 'passages/MT.20.1-16.json';
export const CALENDAR_PATH = 'calendar/2026.json';

/** A schema-valid passage that passes every gate-1 rule. */
export function validPassage(): Json {
  return {
    key: 'MT.20.1-16',
    ref: 'Mt 20:1-16a',
    locale: 'en',
    summary:
      'A landowner pays the last hired the same as the first, and asks whether his goodness is a cause for resentment.',
    context: {
      title: 'Labourers in the vineyard',
      paragraphs: [
        'Matthew alone records this parable, placed between two sayings about the last being first. [c1] The owner’s closing question uses the Jewish idiom of the evil eye. [c2]',
      ],
    },
    translationNotes: [
      {
        id: 'evil-eye',
        verse: '20:15',
        anchor: 'envious',
        original: {
          text: 'ὀφθαλμός σου πονηρός',
          lang: 'grc',
          translit: 'ophthalmos sou ponēros',
          gloss: 'your eye evil',
        },
        summary: 'Greek asks “is your eye evil?”, an idiom for begrudging another’s good.',
        body: 'The evil eye was a familiar image for stinginess and resentment (Deut 15:9). [c2] English trades the image for an abstract feeling. [c2]',
      },
    ],
    claims: [
      {
        id: 'c1',
        text: 'The parable of the labourers in the vineyard appears only in Matthew.',
        sourceIds: ['davies-allison'],
        sensitive: false,
      },
      {
        id: 'c2',
        text: 'An “evil eye” was a Jewish idiom for stinginess or begrudging another’s good.',
        sourceIds: ['dt-15-9'],
        sensitive: false,
      },
    ],
    sources: [
      { id: 'dt-15-9', type: 'scripture', citation: 'Deuteronomy 15:9', ref: 'Dt 15:9' },
      {
        id: 'davies-allison',
        type: 'print',
        citation:
          'W. D. Davies and Dale C. Allison, The Gospel According to Saint Matthew, vol. 3 (ICC), T&T Clark, 1997',
      },
    ],
    provenance: {
      generator: 'manual-seed',
      runId: 'fixture',
      models: [],
      promptVersion: 'none',
      createdAt: '2026-09-01T08:42:10Z',
    },
    review: { status: 'pending', reviewers: [] },
    schemaVersion: 1,
  };
}

/** A schema-valid calendar year with one Sunday that passes every gate-1 rule. */
export function validCalendar(): Json {
  return {
    year: 2026,
    region: 'kenya',
    generatedBy: 'fixture',
    days: [
      {
        date: '2026-09-20',
        season: 'ordinary-time',
        seasonWeek: 25,
        sundayCycle: 'A',
        weekdayCycle: 'II',
        celebrations: [{ id: 'ot-25', name: '25th Sunday in Ordinary Time', rank: 'sunday', colour: 'green' }],
        masses: [
          {
            id: 'day',
            label: 'Mass of the day',
            readings: [
              {
                slot: 'first-reading',
                ref: 'Is 55:6-9',
                key: 'IS.55.6-9',
                linkout: 'https://www.drbo.org/chapter/49055.htm',
              },
              {
                slot: 'gospel',
                ref: 'Mt 20:1-16a',
                key: 'MT.20.1-16',
                linkout: 'https://www.drbo.org/chapter/47020.htm',
              },
            ],
          },
        ],
        lectionaryMissing: false,
      },
    ],
  };
}

const text = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** A PR that adds `path` with `value`. */
export function added(path: string, value: unknown): PullRequestFixture {
  return { head: { [path]: typeof value === 'string' ? value : text(value) }, changed: [{ path, status: 'added' }] };
}

/** A PR that adds the passage after `edit` changes it. */
function passageWith(edit: (passage: Json) => void, path = PASSAGE_PATH): PullRequestFixture {
  const passage = validPassage();
  edit(passage);
  return added(path, passage);
}

/** A PR that adds the calendar year after `edit` changes it. */
function calendarWith(edit: (calendar: Json) => void, path = CALENDAR_PATH): PullRequestFixture {
  const calendar = validCalendar();
  edit(calendar);
  return added(path, calendar);
}

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** One negative fixture per schema rule, keyed by rule id. */
export const NEGATIVE_FIXTURES: Readonly<Record<string, PullRequestFixture>> = {
  'schema/valid-passage': passageWith((p: Any) => {
    delete p.summary;
  }),
  'schema/valid-calendar': calendarWith((c: Any) => {
    c.days[0].date = '2025-09-20';
  }),
  'schema/key-matches-filename': added('passages/MT.20.1-15.json', validPassage()),
  'schema/ref-parses': passageWith((p: Any) => {
    p.ref = 'Mt 21:1-16a';
  }),
  'schema/ref-is-real-verse': passageWith((p: Any) => {
    p.sources[0].ref = 'Dt 15:99';
  }),
  'schema/note-verse-in-passage': passageWith((p: Any) => {
    p.translationNotes[0].verse = '20:17';
  }),
  'schema/claim-has-source': passageWith((p: Any) => {
    p.claims[1].sourceIds = ['dt-15-9', 'lsj-ophthalmos'];
  }),
  'schema/source-is-cited': passageWith((p: Any) => {
    p.sources.push({ id: 'unused', type: 'print', citation: 'An unused book' });
  }),
  'schema/sentence-cites-claim': passageWith((p: Any) => {
    p.context.paragraphs[0] =
      'Matthew alone records this parable. It sits between two sayings about the last being first. [c1] The owner’s question uses the idiom of the evil eye. [c2]';
  }),
  'schema/unique-ids': passageWith((p: Any) => {
    p.sources.push({ ...p.sources[0] });
  }),
  'schema/note-ids-stable': {
    head: {
      [PASSAGE_PATH]: text({
        ...validPassage(),
        translationNotes: [{ ...(validPassage() as Any).translationNotes[0], id: 'ophthalmos' }],
      }),
    },
    changed: [{ path: PASSAGE_PATH, status: 'modified' }],
    base: { [PASSAGE_PATH]: text(validPassage()) },
  },
  'schema/approved-has-reviewer': passageWith((p: Any) => {
    p.review = { status: 'approved', method: 'human', reviewers: ['someone-else'], approvedVia: 'label' };
  }),
  'schema/no-fake-provenance': passageWith((p: Any) => {
    p.provenance = { ...p.provenance, generator: 'fake', models: ['fake'] };
  }),
  'schema/calendar-keys-wellformed': calendarWith((c: Any) => {
    c.days[0].masses[0].readings[1].key = 'MT.20.1-15';
  }),
};
