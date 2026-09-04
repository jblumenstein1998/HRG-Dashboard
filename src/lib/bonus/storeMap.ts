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
   * Workstream's location uuid, or null until someone has looked.
   *
   * Deliberately not derived from the location's name at runtime. Workstream
   * names its locations by street address and store number in a format nobody
   * here controls, and a name-matched store link would silently attach one
   * restaurant's roster to another's hours — which is worse than an empty
   * column, because it is wrong rather than missing.
   *
   * Fill these in by hand from `node --env-file=.env.local
   * scripts/workstream-discover.mjs`, which prints every location with its uuid
   * next to the PAR store it looks like. A person reads that list once and
   * pastes the uuids here; that is the confirmation step, and it is cheap
   * because there are twelve stores and they change about never.
   */
  workstreamLocationUuid: string | null;
};

export const BONUS_STORES: BonusStore[] = [
  // Tennessee
  { storeId: "28901", name: "Columbia",    state: "TN", berryFragment: "222 s. james m campbell", netchefLocationId: 689,  smgUnitKey: "28901", workstreamLocationUuid: null },
  { storeId: "36001", name: "Springfield", state: "TN", berryFragment: "3509 tom austin",         netchefLocationId: 771,  smgUnitKey: "36001", workstreamLocationUuid: null },
  { storeId: "42601", name: "White House", state: "TN", berryFragment: "800 hwy. 76",             netchefLocationId: 1002, smgUnitKey: "42601", workstreamLocationUuid: null },
  { storeId: "56301", name: "Brentwood",   state: "TN", berryFragment: "471 old hickory",         netchefLocationId: 425,  smgUnitKey: "56301", workstreamLocationUuid: null },
  { storeId: "61401", name: "Spring Hill", state: "TN", berryFragment: "4882 port royal",         netchefLocationId: 632,  smgUnitKey: "61401", workstreamLocationUuid: null },
  // Virginia
  { storeId: "57001", name: "College",     state: "VA", berryFragment: "6120 college",            netchefLocationId: 465,  smgUnitKey: "57001", workstreamLocationUuid: null },
  { storeId: "57002", name: "Hampton",     state: "VA", berryFragment: "2201 todds",              netchefLocationId: 901,  smgUnitKey: "57002", workstreamLocationUuid: null },
  { storeId: "57003", name: "Oyster",      state: "VA", berryFragment: "531 oyster point",        netchefLocationId: 950,  smgUnitKey: "57003", workstreamLocationUuid: null },
  { storeId: "57004", name: "Chesapeake",  state: "VA", berryFragment: "2316 chesapeake square",  netchefLocationId: 868,  smgUnitKey: "57004", workstreamLocationUuid: null },
  { storeId: "57005", name: "Jefferson",   state: "VA", berryFragment: "12834 jefferson",         netchefLocationId: 886,  smgUnitKey: "57005", workstreamLocationUuid: null },
  { storeId: "57006", name: "Hillcrest",   state: "VA", berryFragment: "125 hillcrest",           netchefLocationId: 869,  smgUnitKey: "57006", workstreamLocationUuid: null },
  { storeId: "57007", name: "Beach",       state: "VA", berryFragment: "2332 elson green",        netchefLocationId: 1137, smgUnitKey: "57007", workstreamLocationUuid: null },
];

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
