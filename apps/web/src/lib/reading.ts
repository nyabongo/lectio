/**
 * The Reading page (`/[date]/[slot]/`): view models for the Context / Original / Text ↗ tabs and the note
 * components in `src/components/notes/`, plus the small pieces of tab behaviour the page script uses.
 *
 * Only approved notes reach a reader: `readingView` builds notes from `ResolvedReading.approved` (set by
 * `@lectio/content` from the passage's review status) and returns `notes: null` for a missing or pending passage,
 * so nothing of an unapproved passage is ever handed to a template. The reading text itself is never shown: the
 * Text tab is a link-out to the configured licensed source.
 *
 * This module has type-only imports so the page's client script can import the tab helpers without pulling Node
 * code into the browser bundle.
 */
import type { LectioConfig } from '@lectio/config';
import type { ContentRepo, ResolvedDay, ResolvedMass, ResolvedReading } from '@lectio/content';
import type { Reading } from '@lectio/schema/calendar';
import type { Passage, PassageClaim, PassageSource, TranslationNote } from '@lectio/schema/passage';

import { celebrationName } from './calendar-names.ts';
import type { NamedCelebration } from './calendar-names.ts';

/** The repository that takes content reports (`.github/ISSUE_TEMPLATE/content-issue.yml` lives there). */
export const CONTENT_ISSUE_REPO = 'https://github.com/nyabongo/lectio';

/** The issue form a "Report an issue" link opens. */
export const CONTENT_ISSUE_TEMPLATE = 'content-issue.yml';

/** Ids of the issue form fields the report link prefills (they must match the form's `id`s). */
export const CONTENT_ISSUE_FIELDS = ['passage', 'note', 'page'] as const;

/**
 * The note id a report about the Context panel carries. The leading underscore keeps it out of the translation-note
 * id space (note ids are slugs, which cannot start with `_`), so a report is never ambiguous.
 */
export const CONTEXT_NOTE_ID = '_context';

/** The HTML `lang` for an original-language tag: the schema's `lat` is BCP 47 `la`; the others are already tags. */
export function htmlLang(lang: string): string {
  return lang === 'lat' ? 'la' : lang;
}

const RTL_LANGS: ReadonlySet<string> = new Set(['hbo', 'he', 'arc', 'ar', 'syc']);

/** `rtl` for Hebrew-script (and other right-to-left) language tags, `ltr` otherwise. */
export function textDirection(lang: string): 'rtl' | 'ltr' {
  return RTL_LANGS.has(lang.replace(/-.*$/, '')) ? 'rtl' : 'ltr';
}

/** One source as a note or the Context panel lists it (lists and citations are in `number` order). */
export interface SourceView {
  readonly id: string;
  /** 1-based position in the passage's `sources[]`: the same number wherever the source is cited. */
  readonly number: number;
  /** The element id of this source's list entry (unique on the page). */
  readonly anchorId: string;
  readonly type: string;
  readonly citation: string;
  readonly url: string | null;
  readonly archivedUrl: string | null;
  readonly excerpt: string | null;
  readonly excerptLang: string | null;
  readonly excerptDir: 'rtl' | 'ltr' | null;
}

/** A run of prose, or the superscript source links that stand for one or more adjacent claim markers. */
export type Segment =
  { readonly kind: 'text'; readonly text: string } | { readonly kind: 'cite'; readonly sources: readonly SourceView[] };

const MARKER_RUN = /\s*((?:\[c[1-9][0-9]*\])+)/g;
const MARKER = /\[(c[1-9][0-9]*)\]/g;

function sourceViews(passage: Passage, ids: readonly string[], scope: string): SourceView[] {
  const index = new Map<string, { source: PassageSource; i: number }>(
    passage.sources.map((source: PassageSource, i: number) => [source.id, { source, i }]),
  );
  const views = ids.flatMap((id) => {
    const entry = index.get(id);
    if (entry === undefined) return [];
    const { source, i } = entry;
    const excerptLang = source.excerptLang ?? null;
    return [
      {
        id,
        number: i + 1,
        anchorId: `${scope}-source-${id}`,
        type: source.type,
        citation: source.citation,
        url: source.url ?? null,
        archivedUrl: source.archivedUrl ?? null,
        excerpt: source.excerpt ?? null,
        excerptLang: excerptLang === null ? null : htmlLang(excerptLang),
        excerptDir: excerptLang === null ? null : textDirection(excerptLang),
      },
    ];
  });
  return views.sort((a, b) => a.number - b.number);
}

/** The claim ids cited in `text`, in order of first appearance. */
export function citedClaims(text: string): string[] {
  return [...new Set([...text.matchAll(MARKER)].map((match) => match[1] as string))];
}

/** Source ids behind `claimIds`, in order of first citation, each once. */
export function sourcesForClaims(passage: Passage, claimIds: readonly string[]): string[] {
  const claims = new Map<string, PassageClaim>(passage.claims.map((claim: PassageClaim) => [claim.id, claim]));
  return [...new Set(claimIds.flatMap((id): readonly string[] => claims.get(id)?.sourceIds ?? []))];
}

/**
 * Splits marked-up prose (`"… day. [c1] The … [c3][c4]"`) into text and citation segments. A run of adjacent
 * markers becomes one citation listing each cited source once; the space before a run is dropped so the
 * superscript sits against the word.
 */
export function segments(passage: Passage, text: string, scope: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKER_RUN)) {
    if (match.index > last) out.push({ kind: 'text', text: text.slice(last, match.index) });
    const ids = sourcesForClaims(passage, citedClaims(match[1] as string));
    out.push({ kind: 'cite', sources: sourceViews(passage, ids, scope) });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** The issue-form link for a note: passage key, note id and the page path, nothing personal. */
export function reportIssueUrl(fields: { passage: string; note: string; page: string }): string {
  const url = new URL(`${CONTENT_ISSUE_REPO}/issues/new`);
  url.searchParams.set('template', CONTENT_ISSUE_TEMPLATE);
  url.searchParams.set('title', `Content issue: ${fields.passage} (${fields.note})`);
  for (const field of CONTENT_ISSUE_FIELDS) url.searchParams.set(field, fields[field]);
  return url.href;
}

/** A translation note card. */
export interface NoteView {
  readonly id: string;
  /** Element id of the card (`note-<id>`). */
  readonly anchorId: string;
  /** What follows "Verse": `15` when the note is in the passage's first chapter, else `21:3`. */
  readonly verse: string;
  readonly anchor: string;
  readonly original: {
    readonly text: string;
    readonly lang: string;
    readonly dir: 'rtl' | 'ltr';
    readonly translit: string;
    readonly gloss: string;
  };
  readonly summary: string;
  readonly body: readonly Segment[];
  readonly sources: readonly SourceView[];
  readonly reportUrl: string;
}

/** The Context panel. */
export interface ContextView {
  readonly title: string;
  readonly paragraphs: readonly (readonly Segment[])[];
  readonly sources: readonly SourceView[];
  readonly reportUrl: string;
}

/** Everything the page shows about an approved passage. */
export interface NotesView {
  readonly key: string;
  /** The language the notes are written in (the passage's `locale`). */
  readonly lang: string;
  readonly summary: string;
  readonly context: ContextView;
  readonly translationNotes: readonly NoteView[];
  /** `human` when a reviewer approved it, `auto` when the merge rule did. */
  readonly method: 'human' | 'auto';
  /** When it was last reviewed (an ISO date-time), or `null` when the passage does not say. */
  readonly lastReviewedAt: string | null;
}

/** The chapter a passage key starts in: `MT.20.1-16` → `20`. */
export function firstChapter(key: string): string {
  return key.split('.')[1] ?? '';
}

function noteView(passage: Passage, note: TranslationNote, page: string): NoteView {
  const scope = `note-${note.id}`;
  const [chapter = '', verse = ''] = note.verse.split(':');
  return {
    id: note.id,
    anchorId: scope,
    verse: chapter === firstChapter(passage.key) ? verse : note.verse,
    anchor: note.anchor,
    original: {
      text: note.original.text,
      lang: htmlLang(note.original.lang),
      dir: textDirection(note.original.lang),
      translit: note.original.translit,
      gloss: note.original.gloss,
    },
    summary: note.summary,
    body: segments(passage, note.body, scope),
    sources: sourceViews(passage, sourcesForClaims(passage, citedClaims(note.body)), scope),
    reportUrl: reportIssueUrl({ passage: passage.key, note: note.id, page }),
  };
}

/** The reader-facing notes of an approved passage; `page` is the page path the report links carry. */
export function notesView(passage: Passage, page: string): NotesView {
  const scope = 'context';
  const claimIds = passage.context.paragraphs.flatMap(citedClaims);
  return {
    key: passage.key,
    lang: passage.locale,
    summary: passage.summary,
    context: {
      title: passage.context.title,
      paragraphs: passage.context.paragraphs.map((paragraph: string) => segments(passage, paragraph, scope)),
      sources: sourceViews(passage, sourcesForClaims(passage, claimIds), scope),
      reportUrl: reportIssueUrl({ passage: passage.key, note: CONTEXT_NOTE_ID, page }),
    },
    translationNotes: passage.translationNotes.map((note: TranslationNote) => noteView(passage, note, page)),
    method: passage.review.method === 'auto' ? 'auto' : 'human',
    lastReviewedAt: passage.review.lastReviewedAt ?? null,
  };
}

/** The page path of a reading, relative to the base path: `2026-09-20/gospel/`. */
export function readingPath(date: string, slot: string): string {
  return `${date}/${slot}/`;
}

/** One Reading page. */
export interface ReadingView {
  readonly date: string;
  readonly slot: string;
  readonly ref: string;
  readonly key: string;
  readonly linkout: string;
  readonly path: string;
  readonly celebration: string | null;
  /** The language of `celebration` when it differs from the page locale (untranslated English), for `lang`. */
  readonly celebrationLang?: string | undefined;
  readonly colour: string | null;
  /** `null` unless the passage exists and is approved: unapproved notes are never rendered. */
  readonly notes: NotesView | null;
}

/** The principal celebration's name in `locale` as view fields (`celebration`, `celebrationLang`). */
function celebrationFields(
  celebration: NamedCelebration | undefined,
  locale: string | undefined,
): { celebration: string | null; celebrationLang?: string | undefined } {
  if (celebration === undefined) return { celebration: null };
  const { name, lang } = celebrationName(celebration, locale);
  return lang === undefined ? { celebration: name } : { celebration: name, celebrationLang: lang };
}

/** The view of `reading` on `day`. Notes come only from an approved passage. */
export function readingView(day: ResolvedDay, reading: ResolvedReading, locale?: string): ReadingView {
  // Read the calendar fields through `Reading`: `astro check` sees the schema types as `any`.
  const { slot, ref, key, linkout }: Reading = reading;
  const path = readingPath(day.date, slot);
  const celebration = day.day.celebrations[0];
  return {
    date: day.date,
    slot,
    ref,
    key,
    linkout,
    path,
    ...celebrationFields(celebration, locale),
    colour: celebration?.colour ?? null,
    notes: reading.approved && reading.passage !== null ? notesView(reading.passage, path) : null,
  };
}

/** The id of the Mass during the Day, the principal Mass of a day with several (Vigil, Night, Dawn, Day). */
export const PRINCIPAL_MASS_ID = 'day';

/**
 * `masses` with the principal Mass (`id === 'day'`) first and the others in calendar order. The lectionary lists a
 * solemnity's Masses Vigil first, so ordering by this decides which Mass "owns" a shared slot.
 */
export function principalFirst<M extends { readonly id: string }>(masses: readonly M[]): M[] {
  return [
    ...masses.filter((mass) => mass.id === PRINCIPAL_MASS_ID),
    ...masses.filter((mass) => mass.id !== PRINCIPAL_MASS_ID),
  ];
}

/**
 * The readings of `day` by slot. When several Masses share a slot (Easter, Christmas, Pentecost and the other vigil
 * solemnities), the Mass during the Day wins, then the first Mass in calendar order that has the slot. This is the
 * one rule for which reading a `/[date]/[slot]/` page shows; the Today page links slots by the same helper.
 */
export function readingsBySlot(day: ResolvedDay): Map<string, ResolvedReading> {
  const bySlot = new Map<string, ResolvedReading>();
  for (const mass of principalFirst(day.masses as readonly (ResolvedMass & { readonly id: string })[]))
    for (const reading of mass.readings) {
      const { slot }: Reading = reading;
      if (!bySlot.has(slot)) bySlot.set(slot, reading);
    }
  return bySlot;
}

/** The Reading page for `date` and `slot`, or `null` when the calendar has no such day or slot. */
export function readingPage(repo: ContentRepo, date: string, slot: string, locale?: string): ReadingView | null {
  const day = repo.resolveDay(date);
  if (day === null) return null;
  const reading = readingsBySlot(day).get(slot);
  return reading === undefined ? null : readingView(day, reading, locale);
}

/** Static paths for `pages/[date]/[slot]/index.astro`: one per reading slot of every day in every calendar. */
export function readingStaticPaths(repo: ContentRepo): { params: { date: string; slot: string } }[] {
  return repo
    .years()
    .flatMap((year) =>
      repo
        .listDays(`${String(year)}-01-01`, `${String(year)}-12-31`)
        .flatMap((day) => [...readingsBySlot(day).keys()].map((slot) => ({ params: { date: day.date, slot } }))),
    );
}

/** Hosts of the built-in link-out providers (`linkout.providers.*.builtin`). */
const BUILTIN_HOSTS: Readonly<Record<string, string>> = { drbo: 'drbo.org' };

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * The name of the licensed source a link-out URL opens, taken from the URL itself so the label always matches the
 * link: the label of the configured provider (the active one first) whose host is the URL's host, else the host.
 * The calendar's `linkout` URLs are generated, so a provider switch before the calendar is rebuilt never mislabels.
 */
export function linkoutSource(config: Pick<LectioConfig, 'linkout'>, url: string): string {
  const host = hostOf(url);
  if (host === null) return url;
  const { provider: active, providers } = config.linkout;
  const names = [active, ...Object.keys(providers).filter((name) => name !== active)];
  for (const name of names) {
    const provider = providers[name];
    if (provider === undefined) continue;
    const providerHost =
      provider.builtin === undefined ? hostOf(provider.template ?? '') : (BUILTIN_HOSTS[provider.builtin] ?? null);
    if (providerHost === host) return provider.label;
  }
  return host;
}

/** The tab panels in order (the Text tab is a link-out, not a panel). */
export const READING_TABS = ['context', 'original'] as const;
export type ReadingTab = (typeof READING_TABS)[number];

/** The tab to open first: the one the URL fragment names (`#original`, or an element inside it), else Context. */
export function initialTab(hash: string, panelOf: (id: string) => ReadingTab | null = () => null): ReadingTab {
  const raw = hash.replace(/^#/, '');
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    // A malformed escape (`#%`): use the fragment as written.
  }
  if ((READING_TABS as readonly string[]).includes(id)) return id as ReadingTab;
  return (id === '' ? null : panelOf(id)) ?? 'context';
}

/** The tab index a key moves focus to in a horizontal tablist of `count` tabs (wrapping), or `null` for other keys. */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
