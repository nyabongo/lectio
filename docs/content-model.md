# Content model

Lectio's content is plain JSON files in this repository, keyed by passage
([ADR 0002](adr/0002-content-keyed-by-passage.md)). The schemas live in `packages/schema` (`@lectio/schema`, L-004)
as TypeScript `as const` objects (JSON Schema 2020-12). Types are derived with `json-schema-to-ts`, and every schema
ships an ajv validator.

| File                      | Schema        | Import                                                                | Emitted JSON Schema                             |
| ------------------------- | ------------- | --------------------------------------------------------------------- | ----------------------------------------------- |
| `passages/<key>.json`     | passage       | `import { validatePassage } from '@lectio/schema/passage'`            | `@lectio/schema/json/passage.schema.json`       |
| `calendar/<year>.json`    | calendar year | `import { validateCalendarYear } from '@lectio/schema/calendar'`      | `@lectio/schema/json/calendar-year.schema.json` |
| gate output (L-023–L-031) | gate result   | `import { validateGateResult } from '@lectio/schema/gate-result'`     | `@lectio/schema/json/gate-result.schema.json`   |
| shared fragments          | common        | `import { passageKeySchema, createAjv } from '@lectio/schema/common'` | (embedded in each file above)                   |

**The reading text is never stored** ([ADR 0003](adr/0003-never-store-reading-text.md)): only references, link-outs,
commentary, claims and sources. The passage schema rejects a passage-level `text` or `verses` field by name, and a
calendar reading carries only `slot`, `ref`, `key` and `linkout`.

## Package layout

- One directory per schema under `packages/schema/src/<name>/index.ts`, exported as `@lectio/schema/<name>` through
  `"./*": "./src/*/index.ts"`. There is **no barrel** (`src/index.ts`): a new schema (`api`, L-052;
  `translated-passage`, L-112) is a new directory plus one line in `src/cli/emit-schemas.ts`, with no shared file to
  merge.
- `npm run schema:emit` writes `packages/schema/json/<name>.schema.json` (committed). A unit test fails when those
  files drift from the TypeScript source; rerun the command and commit the result.
- Valid and invalid fixtures per schema live in `packages/schema/fixtures/<schema>/{valid,invalid}/`. Each invalid
  fixture breaks one rule, and the tests name the error it must produce.
- Validators are compiled once per module with `createAjv()` (strict, `allErrors`, with the `date`, `date-time` and
  `uri` formats). After a failed call, `validatePassage.errors` holds every problem; `formatErrors()` turns them into
  one line each.

## Common fragments

| Fragment          | Rule                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ISO date          | `YYYY-MM-DD`, a real calendar day (`2026-02-30` fails).                                                                                                                         |
| Timestamp         | RFC 3339 with an explicit offset (`2026-09-01T08:30:00Z`).                                                                                                                      |
| URL               | absolute `http(s)` URL.                                                                                                                                                         |
| Locale            | BCP 47 subset: `en`, `en-KE`, `sw`, `pt-BR`, `zh-Hant`, `es-419`.                                                                                                               |
| Passage key       | shape from [ADR 0004](adr/0004-passage-keys-and-book-codes.md), as `toKey` writes it: `MT.20.1-16`, `PHIL.1.20-24_1.27`, `ECCL.11.9-12.8`, `PS.23`, `IS.40-41`, `PS.23_24.1-3`. |
| Liturgical colour | `white`, `red`, `green`, `violet`, `rose`, `black`, `gold`.                                                                                                                     |
| Reading slot      | `first-reading`, `psalm`, `second-reading`, `gospel`, `reading-1`…`reading-9`, `psalm-1`…`psalm-9`, `epistle`.                                                                  |
| Slug              | lower-case kebab-case, at most 64 characters (`evil-eye`).                                                                                                                      |

The passage-key pattern checks shape only: the book code, then `_`-joined segments, each one of `c`, `c-c` (whole
chapters), `c.v`, `c.v-v` or `c.v-c.v`. A range never mixes a whole chapter with a verse (`MT.1-2.3` fails). Whether
the book code exists, the spelling is canonical and the verses are real is the reference parser's job
(`@lectio/refs`, L-005), applied by gate 1.

## Passage (`passages/<key>.json`)

| Field                | Rule                                                                                                                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`                | canonical passage key; equals the file name.                                                                                                                                                                                                                                                                     |
| `ref`                | lectionary-style reference with sub-verse letters kept (`Mt 20:1-16a`).                                                                                                                                                                                                                                          |
| `locale`             | language of the commentary.                                                                                                                                                                                                                                                                                      |
| `summary`            | one line, at most 140 characters.                                                                                                                                                                                                                                                                                |
| `context`            | `title` and `paragraphs[]`. Every paragraph is prose followed by claim markers (`[c1]`, `[c2][c3]`) and ends in a marker; square brackets are reserved for markers.                                                                                                                                              |
| `translationNotes[]` | `id` (stable slug), `verse` (`chapter:verse`, e.g. `20:15`), `anchor` (the English word or phrase, at most 6 words), `original` {`text`, `lang`: `grc`\|`hbo`\|`arc`\|`lat`, `translit`, `gloss`}, `summary`, `body` (one line, prose followed by `[cN]` markers, ending in a marker, like a context paragraph). |
| `claims[]`           | `id` (`c1`, `c2`, …), `text`, `sourceIds[]` (at least one), `sensitive` (set by the generator).                                                                                                                                                                                                                  |
| `sources[]`          | `id` (slug), `type`: `scripture` (needs `ref`) \| `web` (needs `url` and `retrievedAt`) \| `print`; `citation`; optional `url`, `archivedUrl`, `ref`, `excerpt`, `excerptLang` (needs `excerpt`), `retrievedAt`.                                                                                                 |
| `provenance`         | `generator`: `research-cli` (needs at least one model) \| `manual-seed` \| `fake`; `runId`, `models[]`, `promptVersion`, `createdAt`, optional `costUsd`.                                                                                                                                                        |
| `review`             | see [Review block](#review-block).                                                                                                                                                                                                                                                                               |
| `schemaVersion`      | `1`.                                                                                                                                                                                                                                                                                                             |

No other top-level field is allowed, and `text` and `verses` are banned by name.

A trimmed example for the Gospel of the 25th Sunday in Ordinary Time, Year A (Mt 20:1-16a). Note that it quotes
original-language words only, never an English translation of the passage:

```json passage
{
  "key": "MT.20.1-16",
  "ref": "Mt 20:1-16a",
  "locale": "en",
  "summary": "A landowner pays the last hired the same as the first, and asks whether his goodness is a cause for resentment.",
  "context": {
    "title": "Labourers in the vineyard",
    "paragraphs": [
      "Matthew alone records this parable, placed between two sayings about the last being first. [c1] The owner’s closing question uses the Jewish idiom of the evil eye, an image for begrudging another’s good fortune. [c2]"
    ]
  },
  "translationNotes": [
    {
      "id": "evil-eye",
      "verse": "20:15",
      "anchor": "envious",
      "original": {
        "text": "ὀφθαλμός σου πονηρός",
        "lang": "grc",
        "translit": "ophthalmos sou ponēros",
        "gloss": "your eye evil"
      },
      "summary": "Greek asks “is your eye evil?”, an idiom for begrudging another’s good.",
      "body": "The evil eye was a familiar image for stinginess and resentment (Deut 15:9). [c2] English trades the image for an abstract feeling. [c2]"
    }
  ],
  "claims": [
    {
      "id": "c1",
      "text": "The parable of the labourers in the vineyard appears only in Matthew.",
      "sourceIds": ["davies-allison"],
      "sensitive": false
    },
    {
      "id": "c2",
      "text": "An “evil eye” was a Jewish idiom for stinginess or begrudging another’s good.",
      "sourceIds": ["dt-15-9", "lsj-ophthalmos"],
      "sensitive": false
    }
  ],
  "sources": [
    { "id": "dt-15-9", "type": "scripture", "citation": "Deuteronomy 15:9", "ref": "Dt 15:9" },
    {
      "id": "lsj-ophthalmos",
      "type": "web",
      "citation": "Liddell, Scott, Jones, A Greek-English Lexicon, s.v. ὀφθαλμός (Perseus Digital Library)",
      "url": "https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.04.0057:entry=o)fqalmo/s",
      "retrievedAt": "2026-09-01T08:30:00Z"
    },
    {
      "id": "davies-allison",
      "type": "print",
      "citation": "W. D. Davies and Dale C. Allison, The Gospel According to Saint Matthew, vol. 3 (ICC), T&T Clark, 1997"
    }
  ],
  "provenance": {
    "generator": "research-cli",
    "runId": "2026-09-01-mt-20-1-16-a1b2c3",
    "models": ["claude-opus-5-5"],
    "promptVersion": "research-v1",
    "createdAt": "2026-09-01T08:42:10Z",
    "costUsd": 0.84
  },
  "review": { "status": "pending", "reviewers": [] },
  "schemaVersion": 1
}
```

### Review block

Both approval paths write the same block (L-031): the human path (a configured reviewer approves with
`npm run review:approve`, a label or an `/approve` comment) and the auto path (the merge rule finds every gate green
with high confidence).

| Status / method  | Required                                                                             | Constraints                                                         |
| ---------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `pending`        | `status`, `reviewers`                                                                | no `method`, no `approvedVia`                                       |
| `approved` (any) | `method`, `approvedVia`                                                              |                                                                     |
| `method: human`  |                                                                                      | `approvedVia` is `cli`, `label` or `comment`; at least one reviewer |
| `method: auto`   | `verifierSummary` {`confirmer`, `refuter`, `minSupport`, `refutations`, `sensitive`} | `approvedVia` is `auto`                                             |

`lastReviewedAt` is optional in the schema; both approval paths set it. A pending block may carry a
`verifierSummary` when gate 4 ran but flagged the passage.

Pending, as written by the research CLI:

```json review
{ "status": "pending", "reviewers": [] }
```

Approved by a human reviewer through the `approved` label:

```json review
{
  "status": "approved",
  "method": "human",
  "reviewers": ["fr-reviewer"],
  "approvedVia": "label",
  "lastReviewedAt": "2026-09-03T17:05:00Z"
}
```

Approved automatically by the merge rule:

```json review
{
  "status": "approved",
  "method": "auto",
  "reviewers": [],
  "approvedVia": "auto",
  "lastReviewedAt": "2026-09-02T06:15:00Z",
  "verifierSummary": {
    "confirmer": { "model": "claude-opus-5-5", "minSupport": 0.93 },
    "refuter": { "model": "gpt-6", "minSupport": 0.91 },
    "minSupport": 0.91,
    "refutations": 0,
    "sensitive": 0
  }
}
```

`verifierSummary`: `confirmer` and `refuter` each record the verifier's model id (different families) and the
lowest per-claim support score it gave (0–1), so the merge rule (L-028) can show both met the threshold. The top-level
`minSupport` is the lower of the two; `refutations` and `sensitive` are claim counts.

## Calendar year (`calendar/<year>.json`)

```text
{ year, region, generatedBy, days[] }
days[]:   { date, season, seasonWeek, sundayCycle, weekdayCycle, celebrations[], masses[], lectionaryMissing }
celebrations[]: { id, name, rank, colour }
masses[]:       { id, label, readings[] }
readings[]:     { slot, ref, key, linkout }
```

- `season`: `advent`, `christmas`, `ordinary-time`, `lent`, `paschal-triduum`, `easter`; `seasonWeek` 0–34 (0 for
  the days before a season's first Sunday, such as Ash Wednesday).
- `sundayCycle`: `A` | `B` | `C`; `weekdayCycle`: `I` | `II`.
- `rank`: `solemnity`, `sunday`, `feast`, `memorial`, `optional-memorial`, `commemoration`, `weekday`; `colour` is the
  liturgical colour.
- At least one celebration per day. When `lectionaryMissing` is `false` the day has at least one Mass; when it is
  `true`, `masses` may be empty and the site shows the day without readings.
- A reading is a reference (`ref`, letters kept), its passage key and a link-out to a licensed or public-domain text.

## Gate result

```text
{ gate, status, items[], meta }
items[]: { ruleId, severity, file?, pointer, claimId?, message }
```

- `gate`: slug (`schema`, `evidence`, `licence`, `verifiers`, `merge-rule`); `status`: `pass` | `fail` | `flag` |
  `skipped`.
- `ruleId`: `<gate>/<rule>` in kebab-case (`schema/valid-passage`, `licence/quoted-english-run`); `severity`:
  `error` | `warning` | `info`; `file`: repository-relative, omitted for findings about the whole pull request (for
  example a merge-rule decision, with `pointer` `""`); `pointer`: RFC 6901 JSON pointer into that file; `claimId`
  when the finding is about one claim.
- Status and items agree: `pass` has no `error` item, `fail` has at least one, `flag` has at least one item.
- `meta` is a free-form object for gate-specific details (timings, models, costs).

## Not checked by the schemas

These rules span fields or files and belong to gate 1 (L-024) and `calendar:check` (L-017):

- every `[cN]` marker in `context.paragraphs` and translation-note bodies names a claim, and every claim is cited;
- every `sourceIds` entry names a source in the same file; claim, note and source ids are unique;
- `key` matches the file name and parses (`@lectio/refs`) to real verses; translation-note verses fall inside it;
- calendar dates are unique, sorted and inside `year`; each reading's `key` matches its `ref`.
