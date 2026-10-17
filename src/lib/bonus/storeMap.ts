/**
 * The one place a store's identity is spelled out for every system at once.
 *
 * Bonus attainment is the first feature that has to join all four vendors for
 * the same store in the same calculation — drive-thru times (BerryAI), survey
 * scores (SMG), food cost (Net-Chef) and sales (PAR). Each of those keys stores
 * differently, and until now the app got by with four separate lists and
 * name-substring matching:
 *
 *   src/lib/par.ts        PAR_LOCATIONS   keyed by PAR store id
 *   src/lib/stores.ts     STORE_CONFIG    keyed by a fragment of the street address
 *   src/lib/netchef.ts    LOCATION_NAMES  keyed by Net-Chef's own location id
 *   src/lib/surveyMeta.ts STORE_LABELS    keyed by PAR store id
 *
 * Matching on names is survivable when one tab reads one vendor. It is not
 * survivable here: a scorecard that silently drops a store because "Spring
 * Hill" didn't match "SPRINGHILL" produces a wrong bonus number rather than a
 * visibly empty cell. So this module keys everything on the **PAR store id**,
 * which is the only identifier that already appears in more than one system
 * (SMG labels its units "36001 - SPRINGFIELD_36001", so smg_scores.unit_key is
 * the PAR id for free).
 *
 * Pure data, no env reads — safe to import from a client component.
 */

export type BonusStore = {
  /** PAR store id — the canonical key for everything in the bonus feature. */
  storeId: string;
  /** Display name. Matches PAR_LOCATIONS, STORE_LABELS and Net-Chef exactly. */
  name: string;
  state: "TN" | "VA";
  /**
   * Lowercase fragment of the street address, matched against a BerryAI
   * branch's `location` field. Copied from STORE_CONFIG in src/lib/stores.ts —
   * BerryAI has no store id at all, so the address is the only join available.
   */
  berryFragment: string;
  /** Net-Chef's internal location id, for fetchLocationReport(). */
  netchefLocationId: number;
  /**
   * smg_scores.unit_key. Identical to storeId today, but named separately so a
   * future SMG unit whose key stops matching the PAR id is a one-line fix here
   * rather than a hunt through the scoring code.
   */
  smgUnitKey: string;
  /**
   * Workstream's location uuid.
   *
   * Eight of these are established by evidence rather than by reading names:
   * Workstream's manager logins are store mailboxes carrying the PAR store
   * number (`hampton57002@zaxbys.com`), and each one's `permission_config`
   * names the location uuid it administers. That is a real join, and
   * scripts/workstream-discover.mjs prints it.
   *
   * It is worth the trouble, because names lie here. The mailbox for 57006 is
   * `chesapeake57006@zaxbys.com` and it administers **Hillcrest** — 57006 is
   * Hillcrest's PAR id, and the word "chesapeake" in the address is a leftover.
   * Anything matching on the name would have attached Hillcrest's people to
   * Chesapeake's hours and looked entirely reasonable doing it.
   *
   * The four Tennessee stores have no numbered mailbox, so they rest on a
   * unique name plus a second signal: Workstream carries a `- Corporate` twin
   * of every location, and no user administers any of them (0 users, against
   * 3–8 for each operating restaurant). The twins are the entities, the plain
   * names are the restaurants.
   */
  workstreamLocationUuid: string | null;
};

export const BONUS_STORES: BonusStore[] = [
  // Tennessee
  // The four TN stores rest on a unique name; every VA store below is confirmed
  // by its numbered manager mailbox. See workstreamLocationUuid above.
  { storeId: "28901", name: "Columbia",    state: "TN", berryFragment: "222 s. james m campbell", netchefLocationId: 689,  smgUnitKey: "28901", workstreamLocationUuid: "059d7aef-6054-4bbb-bbcd-7930ebaa0e0b" },
  { storeId: "36001", name: "Springfield", state: "TN", berryFragment: "3509 tom austin",         netchefLocationId: 771,  smgUnitKey: "36001", workstreamLocationUuid: "4221c039-909d-4683-bb7d-2d315e295b2d" },
  { storeId: "42601", name: "White House", state: "TN", berryFragment: "800 hwy. 76",             netchefLocationId: 1002, smgUnitKey: "42601", workstreamLocationUuid: "4a386af2-6f69-43ac-a8e0-cb89f61a8914" },
  { storeId: "56301", name: "Brentwood",   state: "TN", berryFragment: "471 old hickory",         netchefLocationId: 425,  smgUnitKey: "56301", workstreamLocationUuid: "9b60d4a8-1a7e-4762-946d-94d716a5cf05" },
  { storeId: "61401", name: "Spring Hill", state: "TN", berryFragment: "4882 port royal",         netchefLocationId: 632,  smgUnitKey: "61401", workstreamLocationUuid: "4f95fa9f-247c-4987-8f90-fa39f9eadf87" },
  // Virginia
  { storeId: "57001", name: "College",     state: "VA", berryFragment: "6120 college",            netchefLocationId: 465,  smgUnitKey: "57001", workstreamLocationUuid: "741c82a9-3257-418b-a9e2-47549abba51f" },
  { storeId: "57002", name: "Hampton",     state: "VA", berryFragment: "2201 todds",              netchefLocationId: 901,  smgUnitKey: "57002", workstreamLocationUuid: "c27cebfa-4993-4305-8100-62eeb7911432" },
  { storeId: "57003", name: "Oyster",      state: "VA", berryFragment: "531 oyster point",        netchefLocationId: 950,  smgUnitKey: "57003", workstreamLocationUuid: "b99bda23-4cbb-43ba-a841-e1f82711acf7" },
  { storeId: "57004", name: "Chesapeake",  state: "VA", berryFragment: "2316 chesapeake square",  netchefLocationId: 868,  smgUnitKey: "57004", workstreamLocationUuid: "6004c6ee-57ff-4330-81bc-de1de591e727" },
  { storeId: "57005", name: "Jefferson",   state: "VA", berryFragment: "12834 jefferson",         netchefLocationId: 886,  smgUnitKey: "57005", workstreamLocationUuid: "a56371b3-e07a-4d3a-94cd-933ba9b7d99a" },
  // 57006's mailbox says "chesapeake" and administers Hillcrest. The number is
  // right and the word is wrong; this is the one the evidence saved.
  { storeId: "57006", name: "Hillcrest",   state: "VA", berryFragment: "125 hillcrest",           netchefLocationId: 869,  smgUnitKey: "57006", workstreamLocationUuid: "51a81a04-d1e9-4746-9520-c92bbdd11bdc" },
  { storeId: "57007", name: "Beach",       state: "VA", berryFragment: "2332 elson green",        netchefLocationId: 1137, smgUnitKey: "57007", workstreamLocationUuid: "ab838180-2577-48d7-a77c-c2875a7fe625" },
];

/**
 * Restaurants Workstream knows about that this dashboard has no store for.
 *
 * Portland is the thirteenth restaurant and is not in BONUS_STORES, because
 * every row there is keyed on a PAR store id and Portland has none — no
 * `PAR_TOKEN_*`, no Net-Chef location, and lib/jolt.ts already excludes it by
 * name for the same reason. Adding it above would not give it hours; it would
 * give twelve working stores and one that throws on every PAR call.
 *
 * So it is recorded here instead: known, named, and deliberately not pretended
 * to be a full store. The day Portland has a PAR store number and token, it
 * moves up into BONUS_STORES with this uuid and nothing else changes.
 *
 * Hohenwald and Lafayette are the same shape — real locations with managers
 * assigned (3 and 2) — and are listed so that a future reader knows they were
 * seen and left out on purpose rather than missed.
 */
export const WORKSTREAM_ONLY_LOCATIONS = [
  { name: "Portland",  workstreamLocationUuid: "404f251b-0a2d-4939-a808-e16873c838a5" },
  { name: "Hohenwald", workstreamLocationUuid: "19695db9-8a5c-47a0-b252-d15c155b3ea0" },
  { name: "Lafayette", workstreamLocationUuid: "308f84bb-b9ff-4f30-8d71-af9c0c1890a7" },
] as const;

export const BONUS_STORE_IDS: string[] = BONUS_STORES.map((s) => s.storeId);

const BY_ID = new Map(BONUS_STORES.map((s) => [s.storeId, s]));
const BY_NETCHEF = new Map(BONUS_STORES.map((s) => [s.netchefLocationId, s]));

export function storeById(storeId: string): BonusStore | null {
  return BY_ID.get(storeId) ?? null;
}

export function storeByNetchefId(locationId: number): BonusStore | null {
  return BY_NETCHEF.get(locationId) ?? null;
}

/**
 * Resolve a Workstream location uuid to a store.
 *
 * An exact uuid lookup against the table above, so a location nobody has
 * mapped yet returns null and its people stay out of every store's roster
 * rather than landing in an arbitrary one.
 */
export function storeByWorkstreamLocation(uuid: string | null | undefined): BonusStore | null {
  if (!uuid) return null;
  return BONUS_STORES.find((s) => s.workstreamLocationUuid === uuid) ?? null;
}

/**
 * Resolve a BerryAI branch to a store by street-address fragment.
 *
 * Berry's `location` string is free text that has changed formatting before, so
 * this stays a substring test rather than an equality check — but it returns
 * null instead of guessing, and every caller in the bonus path treats null as
 * "no drive-thru data for this store" rather than zero.
 */
export function storeByBerryLocation(location: string | null | undefined): BonusStore | null {
  const loc = (location ?? "").toLowerCase();
  if (!loc) return null;
  return BONUS_STORES.find((s) => loc.includes(s.berryFragment)) ?? null;
}
