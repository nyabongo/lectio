/**
 * Stable Lectio celebration ids.
 *
 * A Lectio id is the romcal id in kebab-case (`matthew_apostle` → `matthew-apostle`), unless
 * `ROMCAL_ID_ALIASES` says otherwise. Content, overrides (L-015) and lectionary data (L-016) are
 * keyed by these ids, so they must never change: when a romcal upgrade renames an id, add an
 * alias from the new romcal id to the old Lectio id. `fixtures/romcal-ids.json` snapshots the
 * whole mapping and its test fails on any rename (see ADR 0007).
 */

/** Ids must be schema slugs: lower-case words joined by `-`, at most 64 characters. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX = 64;

/**
 * romcal ids whose kebab-case form would be too long for a slug or unclear. Values are
 * Lectio ids and are frozen once released; keys follow romcal.
 */
export const ROMCAL_ID_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  cyril_constantine_the_philosopher_monk_and_methodius_michael_of_thessaloniki_bishop:
    'cyril-monk-and-methodius-bishop',
  andrew_kim_tae_gon_priest_paul_chong_ha_sang_and_companions_martyrs:
    'andrew-kim-tae-gon-paul-chong-ha-sang-and-companions-martyrs',
  loreto: 'our-lady-of-loreto',
});

/** The stable Lectio celebration id for a romcal liturgical-day id. Throws if it is not a valid slug. */
export function toLectioId(romcalId: string): string {
  const id = Object.hasOwn(ROMCAL_ID_ALIASES, romcalId)
    ? (ROMCAL_ID_ALIASES[romcalId] as string)
    : romcalId.replaceAll('_', '-');
  if (!SLUG.test(id) || id.length > SLUG_MAX) {
    throw new Error(
      `romcal id ${JSON.stringify(romcalId)} maps to ${JSON.stringify(id)}, which is not a slug of at most ` +
        `${String(SLUG_MAX)} characters; add an entry to ROMCAL_ID_ALIASES`,
    );
  }
  return id;
}
