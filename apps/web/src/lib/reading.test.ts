import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ResolvedDay, ResolvedReading } from '@lectio/content';
import type { Reading } from '@lectio/schema/calendar';
import type { Passage } from '@lectio/schema/passage';
import { describe, expect, it } from 'vitest';

import {
  CONTENT_ISSUE_FIELDS,
  CONTENT_ISSUE_REPO,
  CONTENT_ISSUE_TEMPLATE,
  CONTEXT_NOTE_ID,
  PRINCIPAL_MASS_ID,
  citedClaims,
  firstChapter,
  htmlLang,
  initialTab,
  linkoutSource,
  notesView,
  principalFirst,
  readingPage,
  readingPath,
  readingStaticPaths,
  readingView,
  readingsBySlot,
  reportIssueUrl,
  segments,
  slotName,
  sourcesForClaims,
  tabKeyTarget,
  textDirection,
} from './reading.ts';
import { siteContext } from './site.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../..');
const repoRoot = resolve(webRoot, '../..');
const fixture = siteContext({ cwd: webRoot, env: { LECTIO_CONFIG: 'apps/web/test/lectio.config.fixture.json' } });
const { repo } = fixture;
const APPROVED = 'MT.20.1-16';
const PENDING = 'IS.55.6-9';
const mt = repo.passage(APPROVED) as Passage;
const is = repo.passage(PENDING) as Passage;

/** A copy of the approved fixture passage with `patch` applied. */
function passageWith(patch: Partial<Passage>): Passage {
  return { ...structuredClone(mt), ...patch } as Passage;
}

describe('slotName', () => {
  it('names the fixed slots and numbers the Easter Vigil slots', () => {
    expect(slotName('gospel')).toEqual({ name: 'gospel' });
    expect(slotName('first-reading')).toEqual({ name: 'first-reading' });
    expect(slotName('epistle')).toEqual({ name: 'epistle' });
    expect(slotName('reading-4')).toEqual({ name: 'reading-n', n: 4 });
    expect(slotName('psalm-7')).toEqual({ name: 'psalm-n', n: 7 });
  });

  it('rejects anything else', () => {
    expect(() => slotName('homily')).toThrow(/Not a reading slot/);
    expect(() => slotName('reading-10')).toThrow(RangeError);
  });
});

describe('language and direction', () => {
  it('maps the schema tags to HTML lang values', () => {
    expect(htmlLang('grc')).toBe('grc');
    expect(htmlLang('hbo')).toBe('hbo');
    expect(htmlLang('lat')).toBe('la');
    expect(htmlLang('en')).toBe('en');
  });

  it('runs Hebrew and Aramaic right to left', () => {
    expect(textDirection('hbo')).toBe('rtl');
    expect(textDirection('arc')).toBe('rtl');
    expect(textDirection('he-IL')).toBe('rtl');
    expect(textDirection('grc')).toBe('ltr');
    expect(textDirection('lat')).toBe('ltr');
    expect(textDirection('en')).toBe('ltr');
  });
});

describe('claim markers', () => {
  it('lists cited claims once, in order', () => {
    expect(citedClaims('a [c3][c4] b [c3] c [c12]')).toEqual(['c3', 'c4', 'c12']);
    expect(citedClaims('no markers')).toEqual([]);
  });

  it('collects the sources behind claims once, skipping unknown claims', () => {
    expect(sourcesForClaims(mt, ['c2', 'c1', 'c9'])).toEqual(['mt-20-2', 'davies-allison']);
  });

  it('turns marker runs into superscript citations numbered by source position', () => {
    const out = segments(mt, 'One. [c1] Two [c3][c4] three.', 'context');
    expect(out).toEqual([
      { kind: 'text', text: 'One.' },
      { kind: 'cite', sources: [expect.objectContaining({ id: 'davies-allison', number: 6 })] },
      { kind: 'text', text: ' Two' },
      {
        kind: 'cite',
        sources: [
          expect.objectContaining({ id: 'mt-6-22', number: 2 }),
          expect.objectContaining({ id: 'dt-15-9', number: 4, anchorId: 'context-source-dt-15-9' }),
          expect.objectContaining({ id: 'lsj-ophthalmos', number: 5 }),
        ],
      },
      { kind: 'text', text: ' three.' },
    ]);
  });

  it('ends without a trailing text segment when the prose ends in a marker', () => {
    const out = segments(mt, 'Only. [c5]', 'x');
    expect(out.map((segment) => segment.kind)).toEqual(['text', 'cite']);
  });

  it('starts with a citation when the prose starts with a marker', () => {
    expect(segments(mt, '[c4] then.', 's').map((segment) => segment.kind)).toEqual(['cite', 'text']);
  });

  it('skips source ids that the passage does not define', () => {
    const broken = passageWith({ claims: [{ id: 'c1', text: 't', sourceIds: ['nowhere'], sensitive: false }] });
    expect(segments(broken, 'X. [c1]', 's')).toEqual([
      { kind: 'text', text: 'X.' },
      { kind: 'cite', sources: [] },
    ]);
  });
});

describe('reportIssueUrl', () => {
  it('opens the content issue form prefilled with passage, note and page only', () => {
    const url = new URL(reportIssueUrl({ passage: APPROVED, note: 'v15-evil-eye', page: '2026-09-20/gospel/' }));
    expect(`${url.origin}${url.pathname}`).toBe(`${CONTENT_ISSUE_REPO}/issues/new`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      template: CONTENT_ISSUE_TEMPLATE,
      title: `Content issue: ${APPROVED} (v15-evil-eye)`,
      passage: APPROVED,
      note: 'v15-evil-eye',
      page: '2026-09-20/gospel/',
    });
  });

  it('prefills fields that exist in .github/ISSUE_TEMPLATE/content-issue.yml', () => {
    const form = readFileSync(resolve(repoRoot, '.github/ISSUE_TEMPLATE', CONTENT_ISSUE_TEMPLATE), 'utf8');
    const ids = [...form.matchAll(/^\s+id:\s*(\S+)\s*$/gm)].map((match) => match[1]);
    for (const field of CONTENT_ISSUE_FIELDS) expect(ids).toContain(field);
    expect(form).toMatch(/^name: /m);
  });
});

describe('notesView', () => {
  const view = notesView(mt, '2026-09-20/gospel/');

  it('carries the context with its sources and a report link', () => {
    expect(view.key).toBe(APPROVED);
    expect(view.summary).toBe(mt.summary);
    expect(view.context.title).toBe('Labourers in the vineyard');
    expect(view.context.paragraphs).toHaveLength(2);
    expect(view.context.sources.map((source) => source.id)).toEqual([
      'mt-20-2',
      'mt-6-22',
      'dt-15-9',
      'lsj-ophthalmos',
      'davies-allison',
    ]);
    expect(new URL(view.context.reportUrl).searchParams.get('note')).toBe(CONTEXT_NOTE_ID);
    expect(CONTEXT_NOTE_ID).toBe('_context');
  });

  it('builds every translation note with its original, sources and report link', () => {
    expect(view.translationNotes.map((note) => note.id)).toEqual(['v15-evil-eye', 'v15-agathos']);
    const [evilEye, agathos] = view.translationNotes;
    expect(evilEye).toMatchObject({
      anchorId: 'note-v15-evil-eye',
      verse: '15',
      anchor: 'envious',
      original: { text: 'ὀφθαλμός σου πονηρός', lang: 'grc', dir: 'ltr', translit: 'ophthalmos sou ponēros' },
    });
    expect(evilEye?.sources.map((source) => source.anchorId)).toEqual([
      'note-v15-evil-eye-source-mt-6-22',
      'note-v15-evil-eye-source-dt-15-9',
      'note-v15-evil-eye-source-lsj-ophthalmos',
    ]);
    expect(new URL(evilEye?.reportUrl ?? '').searchParams.get('note')).toBe('v15-evil-eye');
    expect(agathos?.sources).toEqual([
      expect.objectContaining({ id: 'mt-19-17', excerpt: 'εἷς ἐστιν ὁ ἀγαθός', excerptLang: 'grc', excerptDir: 'ltr' }),
    ]);
  });

  it('exposes web source links and leaves absent fields null', () => {
    const lsj = view.context.sources.find((source) => source.id === 'lsj-ophthalmos');
    expect(lsj?.url).toMatch(/^https:\/\/www\.perseus/);
    expect(lsj?.archivedUrl).toMatch(/^https:\/\/web\.archive\.org/);
    const print = view.context.sources.find((source) => source.id === 'davies-allison');
    expect(print).toMatchObject({ type: 'print', url: null, archivedUrl: null, excerpt: null, excerptLang: null });
  });

  it('records how and when the passage was reviewed', () => {
    expect(view.method).toBe('human');
    expect(view.lastReviewedAt).toBe('2026-09-03T17:05:00Z');
    const auto = passageWith({
      review: {
        status: 'approved',
        method: 'auto',
        approvedVia: 'auto',
        reviewers: [],
        verifierSummary: {
          confirmer: { model: 'a', minSupport: 0.95 },
          refuter: { model: 'b', minSupport: 0.93 },
          minSupport: 0.93,
          refutations: 0,
          sensitive: 0,
        },
      },
    });
    expect(notesView(auto, 'p/')).toMatchObject({ method: 'auto', lastReviewedAt: null });
  });

  it('marks Hebrew notes right to left and keeps the chapter for notes outside the first chapter', () => {
    const hebrew = passageWith({
      translationNotes: [
        {
          id: 'v21-hesed',
          verse: '21:3',
          anchor: 'mercy',
          original: { text: 'חֶסֶד', lang: 'hbo', translit: 'ḥesed', gloss: 'steadfast love' },
          summary: 's',
          body: 'b. [c1]',
        },
        {
          id: 'v1-lat',
          verse: '20:1',
          anchor: 'vineyard',
          original: { text: 'vinea', lang: 'lat', translit: 'vinea', gloss: 'vineyard' },
          summary: 's',
          body: 'b. [c1]',
        },
      ],
    });
    const [heb, lat] = notesView(hebrew, 'p/').translationNotes;
    expect(heb).toMatchObject({ verse: '21:3', original: { lang: 'hbo', dir: 'rtl' } });
    expect(lat).toMatchObject({ verse: '1', original: { lang: 'la', dir: 'ltr' } });
  });

  it('reads the first chapter from the passage key', () => {
    expect(firstChapter('MT.20.1-16')).toBe('20');
    expect(firstChapter('1COR.15.35-37_15.42-49')).toBe('15');
    expect(firstChapter('MT')).toBe('');
  });
});

describe('reading pages from the fixture content root', () => {
  it('builds one path per reading slot of every calendar day', () => {
    const paths = readingStaticPaths(repo).map(({ params }) => `${params.date}/${params.slot}`);
    expect(paths).toContain('2026-09-20/gospel');
    expect(paths).toContain('2026-09-20/first-reading');
    expect(paths).toContain('2026-09-19/psalm');
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('renders all notes of the approved Mt 20 passage', () => {
    const view = readingPage(repo, '2026-09-20', 'gospel');
    expect(view).toMatchObject({
      date: '2026-09-20',
      slot: 'gospel',
      slotName: { name: 'gospel' },
      ref: 'Mt 20:1-16a',
      key: APPROVED,
      linkout: expect.stringMatching(/^https:\/\/www\.drbo\.org\//),
      path: '2026-09-20/gospel/',
      celebration: 'Twenty-fifth Sunday in Ordinary Time',
      colour: 'green',
    });
    expect(view?.notes?.translationNotes).toHaveLength(mt.translationNotes.length);
  });

  it('renders nothing of the pending Isaiah passage', () => {
    const view = readingPage(repo, '2026-09-20', 'first-reading');
    expect(view?.key).toBe(PENDING);
    expect(is.review.status).toBe('pending');
    expect(view?.notes).toBeNull();
    // The pending fixture has a Hebrew translation note with distinctive markers; none of it may leak.
    expect(is.translationNotes).toHaveLength(1);
    const json = JSON.stringify(view);
    for (const leak of [
      is.context.title,
      is.summary,
      'PENDING-NOTE-SUMMARY',
      'PENDING-NOTE-BODY',
      'v8-thoughts',
      'מַחְשְׁבוֹתַי',
    ])
      expect(json).not.toContain(leak);
  });

  it('has no notes for a reading without a passage file', () => {
    expect(readingPage(repo, '2026-09-19', 'gospel')?.notes).toBeNull();
  });

  it('returns null for a day or slot the calendar does not have', () => {
    expect(readingPage(repo, '2026-01-01', 'gospel')).toBeNull();
    expect(readingPage(repo, '2026-09-20', 'epistle')).toBeNull();
  });

  it('never builds notes from an unapproved passage, even if one is attached', () => {
    const day = repo.resolveDay('2026-09-20') as ResolvedDay;
    const gospel = readingsBySlot(day).get('gospel') as ResolvedReading;
    expect(readingView(day, { ...gospel, approved: false }).notes).toBeNull();
    expect(readingView(day, { ...gospel, passage: null }).notes).toBeNull();
    const noCelebration = { ...day, day: { ...day.day, celebrations: [] } } as unknown as ResolvedDay;
    expect(readingView(noCelebration, gospel)).toMatchObject({ celebration: null, colour: null });
  });

  it('takes a shared slot from the Mass during the Day, after a Vigil listed first (Easter, Christmas)', () => {
    const day = repo.resolveDay('2026-09-20') as ResolvedDay;
    const [mass] = day.masses;
    const reading = (slot: string, ref: string) => ({ ...mass?.readings[0], slot, ref });
    const vigil = {
      ...mass,
      id: 'vigil',
      readings: [reading('reading-1', 'Gn 1:1-2:2'), reading('epistle', 'Rom 6:3-11'), reading('gospel', 'Mt 28:1-10')],
    };
    const dayMass = {
      ...mass,
      id: 'day',
      readings: [reading('first-reading', 'Acts 10:34a, 37-43'), reading('gospel', 'Jn 20:1-9')],
    };
    const easter = { ...day, masses: [vigil, dayMass] } as unknown as ResolvedDay;
    const refs = new Map([...readingsBySlot(easter)].map(([slot, r]) => [slot, (r as Reading).ref]));
    expect(refs.get('gospel')).toBe('Jn 20:1-9');
    expect(refs.get('first-reading')).toBe('Acts 10:34a, 37-43');
    // Slots only the Vigil has still get a page, from the Vigil.
    expect(refs.get('reading-1')).toBe('Gn 1:1-2:2');
    expect(refs.get('epistle')).toBe('Rom 6:3-11');

    const christmas = {
      ...day,
      masses: [
        { ...vigil, readings: [reading('gospel', 'Mt 1:1-25')] },
        { ...mass, id: 'night', readings: [reading('gospel', 'Lk 2:1-14')] },
        { ...mass, id: 'dawn', readings: [reading('gospel', 'Lk 2:15-20')] },
        { ...dayMass, readings: [reading('gospel', 'Jn 1:1-18')] },
      ],
    } as unknown as ResolvedDay;
    expect((readingsBySlot(christmas).get('gospel') as Reading | undefined)?.ref).toBe('Jn 1:1-18');
  });

  it('falls back to the first Mass in calendar order when no Mass is the Mass during the Day', () => {
    const day = repo.resolveDay('2026-09-20') as ResolvedDay;
    const [mass] = day.masses;
    const first = { ...mass, id: 'vigil' };
    const evening = { ...mass, id: 'evening', readings: [{ ...mass?.readings[3], ref: 'Other' }] };
    const twoMasses = { ...day, masses: [first, evening] } as unknown as ResolvedDay;
    expect((readingsBySlot(twoMasses).get('gospel') as Reading | undefined)?.ref).toBe('Mt 20:1-16a');
  });

  it('orders the principal Mass first and keeps the rest in order', () => {
    expect(principalFirst([{ id: 'vigil' }, { id: 'night' }, { id: 'day' }]).map((m) => m.id)).toEqual([
      'day',
      'vigil',
      'night',
    ]);
    expect(PRINCIPAL_MASS_ID).toBe('day');
  });

  it('builds page paths under the date', () => {
    expect(readingPath('2026-09-20', 'gospel')).toBe('2026-09-20/gospel/');
  });
});

describe('linkoutSource', () => {
  const { linkout } = fixture.config;

  it('names the provider whose host the link-out URL is on', () => {
    expect(linkoutSource(fixture.config, 'https://www.drbo.org/chapter/47020.htm')).toBe('Douay-Rheims (drbo.org)');
    expect(linkoutSource(fixture.config, 'https://bible.usccb.org/bible/matthew/20?1')).toBe(
      'New American Bible (USCCB)',
    );
  });

  it('follows the URL, not the active provider, so label and link always agree', () => {
    const switched = { linkout: { ...linkout, provider: 'usccb' } };
    expect(linkoutSource(switched, 'https://www.drbo.org/chapter/47020.htm')).toBe('Douay-Rheims (drbo.org)');
    const missing = { linkout: { ...linkout, provider: 'missing' } };
    expect(linkoutSource(missing, 'https://universalis.com/20260920/mass.htm')).toBe('Universalis');
  });

  it('falls back to the host, or the URL itself when it does not parse', () => {
    expect(linkoutSource(fixture.config, 'https://www.example.org/x')).toBe('example.org');
    expect(linkoutSource(fixture.config, 'not a url')).toBe('not a url');
    const odd = { linkout: { ...linkout, providers: { x: { label: 'X', enabled: true, builtin: 'other' } } } };
    expect(linkoutSource(odd as never, 'https://drbo.org/a')).toBe('drbo.org');
    const broken = { linkout: { ...linkout, providers: { y: { label: 'Y', enabled: true, template: 'nope' } } } };
    expect(linkoutSource(broken as never, 'https://drbo.org/a')).toBe('drbo.org');
    const neither = { linkout: { ...linkout, providers: { z: { label: 'Z', enabled: true } } } };
    expect(linkoutSource(neither as never, 'https://drbo.org/a')).toBe('drbo.org');
  });
});

describe('tabs', () => {
  it('opens the tab the fragment names, a tab holding the fragment target, or Context', () => {
    expect(initialTab('#original')).toBe('original');
    expect(initialTab('#context')).toBe('context');
    expect(initialTab('')).toBe('context');
    expect(initialTab('#unknown')).toBe('context');
    expect(initialTab('#note-v15-evil-eye', (id) => (id.startsWith('note-') ? 'original' : null))).toBe('original');
    expect(initialTab('#x', () => null)).toBe('context');
  });

  it('survives a malformed fragment, using it as written', () => {
    expect(initialTab('#%')).toBe('context');
    expect(initialTab('#%E0%A4%A', (id) => (id === '%E0%A4%A' ? 'original' : null))).toBe('original');
    expect(initialTab('#note-%C3%A9', (id) => (id === 'note-é' ? 'original' : null))).toBe('original');
  });

  it('moves with the arrow keys (wrapping), Home and End', () => {
    expect(tabKeyTarget('ArrowRight', 0, 2)).toBe(1);
    expect(tabKeyTarget('ArrowRight', 1, 2)).toBe(0);
    expect(tabKeyTarget('ArrowLeft', 0, 2)).toBe(1);
    expect(tabKeyTarget('Home', 1, 2)).toBe(0);
    expect(tabKeyTarget('End', 0, 2)).toBe(1);
    expect(tabKeyTarget('Enter', 0, 2)).toBeNull();
  });
});
