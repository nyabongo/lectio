# Static JSON API v1

The site publishes a small read-only JSON API next to its pages. The Flutter apps (L-100–L-117) and the service
worker (L-061) read it; there is no separate API and no server. Every file is written at build time by Astro from
the content repository (`calendar/<year>.json`, `passages/<key>.json`) and served by the static host, so it is as
fresh as the last build (on merge and daily, L-062).

- Code: endpoints in `apps/web/src/pages/api/v1/`, logic in `apps/web/src/lib/api.ts`.
- Schemas: `@lectio/schema/api` (`packages/schema/src/api/`), emitted as JSON Schema 2020-12 to
  `packages/schema/json/api-*.schema.json` for non-TypeScript clients.
- Every document carries `"apiVersion": 1`.

## Base URL

All paths below are relative to the API root, `<site.baseUrl>api/v1/`. For the production config that is
`https://nyabongo.github.io/lectio/api/v1/`. `index.json` repeats the root as `apiRoot` and lists the endpoint
templates under `endpoints`, so a client only needs to know where `index.json` is.

## Endpoints

| Path                   | Schema (`json/…`)               | What it holds                                                                                         |
| ---------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `index.json`           | `api-index.schema.json`         | Build date, time zone, locales, years with a calendar, first and last date, approved passage count.   |
| `days/{date}.json`     | `api-day.schema.json`           | One liturgical day: celebrations, colour, Masses, readings by reference and link-out, notes inline.   |
| `passages/index.json`  | `api-passage-index.schema.json` | Every passage with approved notes, sorted by key: ref, summary, last-reviewed date, dates it is read. |
| `passages/{key}.json`  | `api-passage.schema.json`       | The approved notes for one passage and every calendar date it is read on.                             |
| `calendar/{year}.json` | `api-calendar.schema.json`      | Every day of a civil year with its readings, `hasNotes` and the one-line summary (no full notes).     |
| `upcoming.json`        | `api-upcoming.schema.json`      | The build date and the 13 days after it (14 dates), in the same shape as calendar days.               |

- `{date}` is an ISO date (`2026-09-20`); a day file exists for every date in a calendar file.
- `{key}` is a canonical passage key (`MT.20.1-16`, [ADR 0004](adr/0004-passage-keys-and-book-codes.md)); a passage
  file exists only when the passage has approved notes.
- `{year}` is a four-digit year with a calendar file (`index.json` → `years`).

### Kiswahili mirror: `sw/` (L-113)

Every endpoint above except `index.json` is also published under `sw/` (`sw/days/{date}.json`,
`sw/passages/index.json`, `sw/passages/{key}.json`, `sw/calendar/{year}.json`, `sw/upcoming.json`), with the same
schemas and the same files: the same dates, keys and approved passages. The mirror is additive; nothing under the API
root changes.

- A passage is its Kiswahili translation (`passages/i18n/sw/<key>.json`, L-112) only when that translation is
  approved **and** fresh (its `sourceSha256` equals the English file's translatable hash now, see
  [content-model.md](content-model.md)); then `locale` is `"sw"` and `summary`, `context`, each note's `anchor`,
  `original.gloss`, `summary` and `body`, and each claim's `text` are the Kiswahili ones.
- Otherwise (no translation, pending, stale or out of step with the English) it is the English notes, unchanged, with
  `locale: "en"`. Clients show those as English (the site marks them `lang="en"` with an "English only" badge).
- Keys, references, verses, original-language words, `sourceIds`, `sources` and `review` are always the English
  file's, so citations and permalinks match in both languages. `audio` stays `null`.
- Celebration names in Kiswahili are already in every day document (`celebrations[].names`, L-111).

Code: `apps/web/src/pages/api/v1/sw/`, built from `localeRepo()` in `apps/web/src/lib/notes-locale.ts`.

### Dates and time zone

The build date is "today" in the site time zone (`site.timezone`, `Africa/Nairobi`), or `LECTIO_DATE` when a build
pins it (the fixture build uses `2026-09-20`). `upcoming.json` covers `from` = build date to `to` = build date + 13
days; dates the calendar does not have are left out. Because the file is only as fresh as the last build, a client
that needs "the next seven days from the device date" (the service worker, the app's prefetch) should compute the
dates itself and fetch `days/{date}.json` for each, using `index.json` → `dates` to know what exists.

### Example: `days/2026-09-20.json` (abridged)

```json
{
  "apiVersion": 1,
  "date": "2026-09-20",
  "season": "ordinary-time",
  "seasonWeek": 25,
  "sundayCycle": "A",
  "weekdayCycle": "II",
  "colour": "green",
  "celebrations": [
    {
      "id": "ordinary-time-25-sunday",
      "name": "Twenty-fifth Sunday in Ordinary Time",
      "rank": "sunday",
      "colour": "green"
    }
  ],
  "lectionaryMissing": false,
  "masses": [
    {
      "id": "day",
      "label": "Mass of the day",
      "readings": [
        { "slot": "first-reading", "ref": "Is 55:6-9", "key": "IS.55.6-9", "linkout": "https://…", "passage": null },
        {
          "slot": "gospel",
          "ref": "Mt 20:1-16a",
          "key": "MT.20.1-16",
          "linkout": "https://…",
          "passage": {
            "key": "MT.20.1-16",
            "ref": "Mt 20:1-16a",
            "locale": "en",
            "summary": "…",
            "context": { "title": "Labourers in the vineyard", "paragraphs": ["… [c1] …"], "audio": null },
            "translationNotes": [{ "id": "v15-evil-eye", "verse": "20:15", "…": "…", "audio": null }],
            "claims": [{ "id": "c1", "text": "…", "sourceIds": ["davies-allison"], "sensitive": false }],
            "sources": [{ "id": "davies-allison", "type": "print", "citation": "…" }],
            "review": { "status": "approved", "method": "human", "lastReviewedAt": "2026-09-03T17:05:00Z" }
          }
        }
      ]
    }
  ]
}
```

## What is (and is not) published

- **Only approved notes.** A reading whose passage file is missing or still `pending` has `"passage": null` in its
  day, `"hasNotes": false` and `"summary": null` in calendar listings, no `passages/{key}.json` file and no entry in
  `passages/index.json`. The reading itself (reference and link-out) is always listed.
- **Never the reading text** ([ADR 0003](adr/0003-never-store-reading-text.md)): references, link-outs, commentary,
  claims and sources only. The schemas reject `text`/`verses` fields.
- **No provenance.** Models, run ids, prompt versions, costs and reviewer handles stay in the repository. The review
  block says only that the notes are approved, how (`human` or `auto`) and when they were last reviewed
  (`lastReviewedAt`, `null` if unknown), which is what the "Verified" mark needs.
- Context paragraphs and translation-note bodies keep their `[c1]` claim markers; resolve them through `claims` and
  `sourceIds` → `sources`.

## Audio

The context note and every translation note carry an `audio` field. It is `null` until the narration pipeline
(Phase 2, L-082) renders audio; then it becomes `{ "url": "https://…", "durationSeconds": 74.5 }`
(`durationSeconds` optional). Clients must treat `null` as "use device text-to-speech". Later issues may add
segment lists (L-082) next to these fields; that is an additive change.

## Stability policy

v1 is **additive only**. Within v1 we may:

- add new optional fields to any document, or new values where a field is documented as open;
- turn a `null` placeholder (such as `audio`) into a value of its documented shape;
- add new documents and endpoints (for example localised endpoints under `/api/v1/<locale>/`, L-113);
- add days, years and passages as content grows.

Within v1 we will never remove a field or a document, rename one, change its type or meaning, or make a nullable
field non-null in a way that breaks a reader that handles `null`. Anything else is a new major version under
`/api/v2/`, published alongside v1 for at least one app release cycle.

Clients must therefore **ignore fields they do not recognise** and must not fail on new enum values in open lists
(for example celebration ranks or reading slots added for a new rite). The schemas in `@lectio/schema/api`
describe the current v1 shape exactly (`additionalProperties: false`) so that the site's tests catch accidental
leaks; when a field is added, the schema is updated in the same pull request, and clients validating against an
older copy of the schema should validate loosely.

## Tests

`apps/web/src/lib/api.test.ts` builds every document from the fixture content root
(`apps/web/test/fixtures/content`, build date `2026-09-20`) and validates each against its schema. It also checks
that the pending fixture passage (`IS.55.6-9`) appears nowhere except as a reading reference, and that no
provenance is published. `packages/schema/src/api/index.test.ts` holds valid and invalid fixtures per document
(`packages/schema/fixtures/api/`). To inspect the real files, run `npm run build:fixture -w apps/web` and open
`apps/web/dist/api/v1/`.
