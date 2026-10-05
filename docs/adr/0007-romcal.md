# ADR 0007: romcal v3 for the General Roman Calendar

- Status: accepted
- Date: 2026-10-05
- Issue: L-014 (#13)

## Context

`packages/calendar` needs, for every date of a civil year, the celebrations with their ranks and colours, the season
and week, and the Sunday (A/B/C) and weekday (I/II) lectionary cycles. romcal (MIT) computes the General Roman
Calendar. Two lines were candidates:

|           | romcal 1.3.0 (npm `latest`)                                                                                                                                                                                                | romcal 3.0.0-dev.140 (npm `dev`) + `@romcal/calendar.general-roman`                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published | January 2020; no release since                                                                                                                                                                                             | 30 August 2026; the repository is still active (last push October 2026)                                                                                                                                                      |
| Data      | Calendar as of 2019. Missing later changes to the General Roman Calendar, for example St Paul VI (2019), St Faustina (2020), Sts Martha, Mary and Lazarus as one memorial, St Gregory of Narek and St Hildegard (all 2021) | Includes all of these (checked in the 2026 output)                                                                                                                                                                           |
| Runtime   | CommonJS; depends on `moment`, `moment-range`, `moment-recur`, `lodash`                                                                                                                                                    | ESM and CJS builds with TypeScript types; one dependency (`i18next`)                                                                                                                                                         |
| Output    | `key` (camelCase), `type`, `data.season`, `data.meta.cycle`                                                                                                                                                                | `id` (snake_case), `rank`, `precedence` (Table of Liturgical Days), `colors[]`, `seasons[]`, `calendar.weekOfSeason`, `cycles.sundayCycle`/`weekdayCycle`, `isOptional`, and the underlying `weekday` of a feast or memorial |
| Options   | Epiphany, Ascension and Corpus Christi transfers                                                                                                                                                                           | Same transfers plus `temporalOverrides`                                                                                                                                                                                      |
| Calendars | 55 national calendars in the package; none for Kenya                                                                                                                                                                       | General Roman and national calendars as separate `@romcal/calendar.*` packages; none for Kenya                                                                                                                               |

`romcal@3.0.0` (2023) also exists on npm but is deprecated; the v3 line is published only as `3.0.0-dev.N`.

## Decision

- Use **romcal 3.0.0-dev.140** with **`@romcal/calendar.general-roman` 3.0.0-dev.140**, the versions L-001 pinned
  (exact versions, no range). v1 has outdated data and an unmaintained, moment-based runtime; v3 has current data,
  types, and the fields Lectio needs (precedence, the weekday under a memorial, impeded memorials) without
  recomputing them.
- `generateDays(year, options)` computes the civil year (`scope: 'gregorian'`) with the English General Roman bundle
  and maps it to the calendar schema (`@lectio/schema/calendar`). `generateDetailedDays` returns the same days with
  romcal ids, precedence, every permitted colour and the underlying weekday, for the regional overrides (L-015) and
  the lectionary resolver (L-016). `options` exposes `epiphanyOnSunday`, `ascensionOnSunday` and
  `corpusChristiOnSunday`; when left out, the General Roman rule applies (6 January, Thursday, Thursday).
- Mapping rules:
  - Celebrations keep romcal's order with optional memorials after the celebration of the day. The first one decides
    season, week and cycles.
  - A day in two seasons (Easter Sunday: Triduum, then Easter Time) is filed under the later season. Triduum days have
    `seasonWeek` 0. Other weeks are romcal's `weekOfSeason`.
  - Colours: `PURPLE` becomes `violet`; the first colour is the celebration's `colour`. romcal gives no colour to
    memorials impeded by a privileged season (Lent, 17–24 December, the Christmas octave). Lectio ranks those
    `commemoration` (GIRM 355) and gives them the weekday's colour. Holy Saturday, which has no colour, gets white,
    the colour of its only Mass, the Easter Vigil.
  - Names are romcal's English names with the first letter capitalised.
  - Unknown romcal values (colour, season, rank, cycle) throw, so a romcal upgrade cannot slip in values the schema
    does not know.
- **Stable ids.** A Lectio celebration id is the romcal id in kebab-case (`matthew_apostle` → `matthew-apostle`),
  except for the entries in `ROMCAL_ID_ALIASES` (ids that would exceed the 64-character slug limit, or are unclear,
  such as `loreto`). `src/fixtures/romcal-ids.json` snapshots the mapping for every romcal definition; its test fails
  when romcal adds, drops or renames an id. On a rename, add an alias from the new romcal id to the existing Lectio
  id. Never change a released Lectio id.

## Consequences

- romcal is a prerelease, so an upgrade can change ids, names or precedence. Upgrades are deliberate: bump both
  packages together, run the tests (the id snapshot and the acceptance dates), and record the bump in the PR.
- Kenya is not in romcal. L-015 layers overrides on `generateDetailedDays` output and sets the transfer options.
- romcal reports two coinciding obligatory memorials (for example 13 June 2026) both as `memorial`. Lectio passes this
  through; L-015 may refine it.
- `calendar/<year>.json` records the romcal version in `generatedBy` (`romcalVersion()`, L-017).
