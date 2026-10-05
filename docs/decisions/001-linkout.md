# 001 · Link-out provider and study text (L-201, brief decision 1)

- **Status:** Accepted. The owner recorded this decision on 2026-10-04 ([#100](https://github.com/nyabongo/lectio/issues/100)). The default stays in force until the owner amends it.
- **Issue:** #100 (roadmap id L-201)
- **Brief question:** "Which licensed source does each reading link out to, and do we also show a public-domain study text alongside the notes?"
- **Implemented by:** L-003 (#2, config keys), L-006 (#5, versification tables), L-007 (#6, link-out URL builder)
- **Related:** [ADR 0003 · Never store reading text](../adr/0003-never-store-reading-text.md), [ADR 0004 · Passage keys and book codes](../adr/0004-passage-keys-and-book-codes.md), [011 · Lectionary source](011-lectionary-source.md)

## Decision

**There is no licensed default. Each reading links out to a public-domain Douay-Rheims chapter page, and the target is a config switch.**

1. **The provider is a switch.** `config.linkout.provider` names the active entry of `config.linkout.providers`. That entry must exist and be `enabled` (a cross-field rule in `@lectio/config`).
2. **The default is the built-in `drbo` provider.** It links to the public-domain Douay-Rheims (Challoner) text on drbo.org, one page per chapter, for example `https://www.drbo.org/chapter/47020.htm` (DR book 47 = Matthew, chapter 020).
   - The reference is first mapped to Vulgate versification by L-006 (Ps 145 → Ps 144, Mal 3:19 → Mal 4:1), because the Douay-Rheims follows the Vulgate.
   - A reference that spans chapters links to its first chapter.
   - The builder only builds URLs. It never fetches the page.
3. **Other sources are config entries, not code.** USCCB, Universalis or any other site is added as a `config.linkout.providers` entry with a URL `template`. Switching `linkout.provider` to that entry changes every link with no code change (L-007 acceptance criterion).
4. **No study text.** `linkout.studyText: 'none'`. No reading text is shown beside the notes and none is stored anywhere in the repository (ADR 0003). Readers tap through to read the passage.

### Why

- Licensing a lectionary translation (RSV-2CE, NABRE, JB) would put a negotiation on the critical path. A public-domain target removes it.
- The Douay-Rheims is a complete Catholic Bible with all 73 books, so every lectionary reference has a target.
- The Kenyan lectionary text is RSV-2CE ([011](011-lectionary-source.md)). When a licence or permission exists for a closer translation, the owner switches the provider in config.

## Config keys

All keys live in `config/lectio.config.json` and default in `packages/config/src/defaults.ts` (L-003). `config/README.md` lists them.

| Key                                      | Default                              | Meaning                                                                         |
| ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| `linkout.provider`                       | `drbo`                               | Active provider: a key of `linkout.providers` whose entry is `enabled`          |
| `linkout.providers.<name>.label`         | `Douay-Rheims (drbo.org)` for `drbo` | Display name shown with the link                                                |
| `linkout.providers.<name>.enabled`       | `true` for `drbo` only               | Only an enabled entry can be selected                                           |
| `linkout.providers.<name>.builtin`       | `drbo`                               | A provider implemented in code. Exactly one of `builtin` or `template` is set   |
| `linkout.providers.<name>.template`      | (none for `drbo`)                    | An `https://` URL with tokens, filled by the generic template provider          |
| `linkout.providers.<name>.versification` | `vulgate` for `drbo`                 | Versification the target site uses; the reference is mapped to it first (L-006) |
| `linkout.studyText`                      | `none`                               | No reading text is shown or stored                                              |

The defaults also ship two **disabled** template examples:

- `usccb`: `https://bible.usccb.org/bible/{bookSlug}/{chapter}?{verse}`
- `universalis`: `https://universalis.com/{date}/mass.htm`

## How to add a provider

1. Add an entry under `linkout.providers` in `config/lectio.config.json`:

   ```json
   {
     "linkout": {
       "provider": "mysite",
       "providers": {
         "mysite": {
           "label": "My Bible site",
           "enabled": true,
           "template": "https://example.org/read/{osis}/{chapter}#v{verse}",
           "versification": "vulgate"
         }
       }
     }
   }
   ```

2. Use the template tokens L-007 fills: `{book}`, `{bookName}`, `{bookSlug}`, `{chapter}`, `{verse}`, `{query}`, `{osis}`, `{usfm}` and `{date}` (for date-based sites such as Universalis). Set `versification` only when the site does not use the reference's own numbering.
3. Set `linkout.provider` to the new name, or leave it unchanged to keep the entry as a disabled option.
4. The config file deep-merges over the defaults, so the file needs only the keys it changes. A merge cannot remove the built-in `drbo` entry. To use a template for drbo.org, add an entry under another name.
5. Changes under `config/**` always need human review and can never be auto-merged ([003](003-auto-merge.md)).

Before enabling a site, check its terms allow deep links. A link is not a copy, but some sites ask for attribution or forbid framing. The app only links; it never embeds or fetches the page.

## Out of scope

- Licensing negotiations.
- Showing a study text beside the notes. The decision is `none`; a change needs a new owner decision and an amendment to ADR 0003.
