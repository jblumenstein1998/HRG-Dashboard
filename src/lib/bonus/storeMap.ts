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
  state: "TN" | "VA" | "TX";
  /**
   * Lowercase fragment of the street address, matched against a BerryAI
   * branch's `location` field. Copied from STORE_CONFIG in src/lib/stores.ts —
   * BerryAI has no store id at all, so the address is the only join available.
   */
  berryFragment: string;
  /**
   * Net-Chef's internal location id, for fetchLocationReport(). Null for a
   * store HRG's Net-Chef login can't see yet — it has no food cost until the
   * id lands here, rather than borrowing another store's.
   */
  netchefLocationId: number | null;
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

/**
 * Each store's Google listing (Places API place id), matched by street address
 * on 2026-10-18 — every one a "Zaxbys Chicken Fingers & Buffalo Wings" at the
 * store's own address. lib/storeHours.ts reads opening hours from these.
 *
 * Kept beside the store list rather than in it because only the hours job uses
 * them, and a store with no listing here simply falls back to PAR's hours.
 */
export const GOOGLE_PLACE_IDS: Record<string, string> = {
  "28901": "ChIJE6m_3GtyY4gRrNmm-UdfnpI", // Columbia — 222 S. James M Campbell Blvd., Columbia, TN 38401
  "61401": "ChIJXb-aLYaCY4gROOu9dv7aLsE", // Spring Hill — 4882 Port Royal Rd., Spring Hill, TN 37174
  "56301": "ChIJwfJv4at6ZIgR8i3Fga_Ybsk", // Brentwood — 471 Old Hickory Blvd, Brentwood, TN 37027
  "42601": "ChIJK_2Md6ROZIgRhe5XgDpxWV0", // White House — 800 Highway 76, White House, TN 37188
  "36001": "ChIJZ3WT691VZIgRA_hXnTP0lYo", // Springfield — 3509 Tom Austin Hwy., Springfield, TN 37172
  "75075": "ChIJD5gdCwDLZYgRfP0nVk93FRs", // Portland — 409 Hwy 52, Portland, TN 37148
  "57005": "ChIJWf3yYep-sIkR5H2zX54wfOA", // Jefferson — 12834 Jefferson Ave., Newport News, VA 23607 (Google lists 23608)
  "57003": "ChIJKSOBsdl4sIkROS_M7v0Zdf8", // Oyster — 531 Oyster Point Rd., Newport News, VA 23602
  "57002": "ChIJEdu8liODuokR2Xf4Ah-P04E", // Hampton — 2201 Todds Ln., Hampton, VA 23666
  "57001": "ChIJ7QLgkpefuokRNxUDe1mmE4w", // College — 6120 College Dr., Suffolk, VA 23435
  "57004": "ChIJ33C-l02guokR1E_xH7WF6DU", // Chesapeake — 2316 Chesapeake Square Ring Rd., Chesapeake, VA 23321
  "57006": "ChIJj8yitn2wuokRK72I8td8S3E", // Hillcrest — 125 Hillcrest Pkwy., Chesapeake, VA 23322
  "57007": "ChIJ77ptGADBuokRgqNLt4w7CbU", // Beach — 2332 Elson Green Ave., Virginia Beach, VA 23456
};

/**
 * Each store's private Slack channel, where the four daily reports are posted
 * (lib/slackReports.ts). Named `<store>-<PAR id>` in Slack, which is how these
 * were matched on 2026-10-29.
 */
export const SLACK_CHANNEL_IDS: Record<string, string> = {
  "28901": "C098QMMERUL", // #columbia-28901
  "36001": "C099B1KK63A", // #springfield-36001
  "42601": "C098M4SH8G5", // #white-house-42601
  "56301": "C0A1PF35QF3", // #brentwood-56301
  "61401": "C098LF99VFY", // #spring-hill-61401
  "75075": "C0BQ2QU1VGW", // #portland-75075
  "57001": "C0AQW844QCU", // #college-drive-57001
  "57002": "C0ARLU4NH40", // #hampton-57002
  "57003": "C0AQW84TGDA", // #oyster-point-57003
  "57004": "C0AQP7ZA9D3", // #chesapeake-square-57004
  "57005": "C0AR5H74TCH", // #jefferson-avenue-57005
  "57006": "C0AQSKYMZDG", // #hillcrest-57006
  "57007": "C0AR5GZGQ01", // #virginia-beach-57007
};

/** The store's local time zone. Slack reporting deadlines are local times. */
export function storeTimeZone(store: BonusStore): string {
  return store.state === "VA" ? "America/New_York" : "America/Chicago";
}

export const BONUS_STORES: BonusStore[] = [
  // Tennessee
  // The four TN stores rest on a unique name; every VA store below is confirmed
  // by its numbered manager mailbox. See workstreamLocationUuid above.
  { storeId: "28901", name: "Columbia",    state: "TN", berryFragment: "222 s. james m campbell", netchefLocationId: 689,  smgUnitKey: "28901", workstreamLocationUuid: "059d7aef-6054-4bbb-bbcd-7930ebaa0e0b" },
  { storeId: "36001", name: "Springfield", state: "TN", berryFragment: "3509 tom austin",         netchefLocationId: 771,  smgUnitKey: "36001", workstreamLocationUuid: "4221c039-909d-4683-bb7d-2d315e295b2d" },
  { storeId: "42601", name: "White House", state: "TN", berryFragment: "800 hwy. 76",             netchefLocationId: 1002, smgUnitKey: "42601", workstreamLocationUuid: "4a386af2-6f69-43ac-a8e0-cb89f61a8914" },
  { storeId: "56301", name: "Brentwood",   state: "TN", berryFragment: "471 old hickory",         netchefLocationId: 425,  smgUnitKey: "56301", workstreamLocationUuid: "9b60d4a8-1a7e-4762-946d-94d716a5cf05" },
  { storeId: "61401", name: "Spring Hill", state: "TN", berryFragment: "4882 port royal",         netchefLocationId: 632,  smgUnitKey: "61401", workstreamLocationUuid: "4f95fa9f-247c-4987-8f90-fa39f9eadf87" },
  // Opened 2026-10-05.
  { storeId: "75075", name: "Portland",    state: "TN", berryFragment: "409 hwy 52",              netchefLocationId: 1303, smgUnitKey: "75075", workstreamLocationUuid: "404f251b-0a2d-4939-a808-e16873c838a5" },
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
  // Texas — acquired October 2026. PAR and BerryAI are connected; Net-Chef
  // doesn't list them for HRG's login yet and Workstream uuids are unconfirmed.
  // Each null reads as "no data" for that vendor until its id is filled in here.
  //
  //   53003 Killeen       2150 S Clear Creek Rd, Killeen, TX 76549
  //   53004 Temple        2002 S 31st St, Temple, TX 76504
  //   53005 Pflugerville  1301 FM 685, Pflugerville, TX 78660
  //   62802 Cibolo        176 W Borgfeld Rd, Cibolo, TX 78108
  //   62803 Alamo         11903 Alamo Ranch Pkwy, San Antonio, TX 78253
  //   62804 Windcrest     7304 N Interstate 35, Windcrest, TX 78218
  { storeId: "53003", name: "Killeen",      state: "TX", berryFragment: "2150 s. clear creek",     netchefLocationId: null, smgUnitKey: "53003", workstreamLocationUuid: null },
  { storeId: "53004", name: "Temple",       state: "TX", berryFragment: "2002 s. 31st",            netchefLocationId: null, smgUnitKey: "53004", workstreamLocationUuid: null },
  { storeId: "53005", name: "Pflugerville", state: "TX", berryFragment: "1301 farm to market 685", netchefLocationId: null, smgUnitKey: "53005", workstreamLocationUuid: null },
  { storeId: "62802", name: "Cibolo",       state: "TX", berryFragment: "176 borgfeld",            netchefLocationId: null, smgUnitKey: "62802", workstreamLocationUuid: null },
  { storeId: "62803", name: "Alamo",        state: "TX", berryFragment: "11903 alamo ranch",       netchefLocationId: null, smgUnitKey: "62803", workstreamLocationUuid: null },
  { storeId: "62804", name: "Windcrest",    state: "TX", berryFragment: "7304 n. interstate 35",   netchefLocationId: null, smgUnitKey: "62804", workstreamLocationUuid: null },
];

/**
 * Restaurants Workstream knows about that this dashboard has no store for.
 *
 * Hohenwald and Lafayette are real locations with managers assigned (3 and 2)
 * but no PAR store number, and are listed so that a future reader knows they
 * were seen and left out on purpose rather than missed. Portland sat here until
 * it opened as store 75075; a location that gets a store number moves up into
 * BONUS_STORES with its uuid, the way Portland did.
 */
export const WORKSTREAM_ONLY_LOCATIONS = [
  { name: "Hohenwald", workstreamLocationUuid: "19695db9-8a5c-47a0-b252-d15c155b3ea0" },
  { name: "Lafayette", workstreamLocationUuid: "308f84bb-b9ff-4f30-8d71-af9c0c1890a7" },
] as const;

export const BONUS_STORE_IDS: string[] = BONUS_STORES.map((s) => s.storeId);

const BY_ID = new Map(BONUS_STORES.map((s) => [s.storeId, s]));
const BY_NETCHEF = new Map(
  BONUS_STORES.filter((s) => s.netchefLocationId !== null).map((s) => [s.netchefLocationId as number, s]),
);

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
