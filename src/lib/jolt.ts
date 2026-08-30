// Pure HTTP client for Jolt's list-completion reporting.
//
// Jolt splits auth across two hosts, which is the only awkward part:
//
//   1. GET  app.joltup.com/account                 -> sets PHPSESSID
//   2. POST app.joltup.com/rest/v1/app/login       -> authenticates that session,
//                                                     returns companyId
//   3. GET  any app page                           -> sets jolt_auth_token
//   4. POST api.joltup.com/graphql                 -> needs jolt_auth_token in the
//                                                     cookie plus jolt_companyid
//
// Step 3 is easy to miss: the GraphQL host rejects a PHPSESSID-only session with
// "Missing token", and nothing in the login response hands the token over. It is
// minted when the web app serves a page.
//
// Everything the reports need is GraphQL, and introspection is enabled on the
// endpoint, so `scripts/jolt-explore.mjs` can enumerate the schema rather than
// guessing at it.

const APP = "https://app.joltup.com";
const API = "https://api.joltup.com/graphql";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

// ── Store naming ──────────────────────────────────────────────────────────────
// Jolt calls the stores "HRG <name> LLC"; the rest of the dashboard calls them
// "<name>". Portland is a Jolt-only location with no Net-Chef counterpart and is
// deliberately left out.

const JOLT_TO_STORE: Record<string, string> = {
  "HRG Brentwood LLC": "Brentwood",
  "HRG College LLC": "College",
  "HRG Columbia LLC": "Columbia",
  "HRG Jefferson LLC": "Jefferson",
  "HRG Spring Hill LLC": "Spring Hill",
  "HRG Springfield LLC": "Springfield",
  "HRG White House LLC": "White House",
};

/** Jolt locations the dashboard has no store for. */
const EXCLUDED_JOLT_LOCATIONS = ["Hwy 52 | HRG Portland LLC"];

/** Dashboard stores Jolt is not deployed to — rendered as empty rows. */
export const STORES_WITHOUT_JOLT = ["Chesapeake", "Hillcrest", "Hampton", "Oyster", "Beach"];

// ── Session ───────────────────────────────────────────────────────────────────

type Session = { cookies: string; companyId: string; contentGroupId: string; timezone: string; expiresAt: number };

let session: Session | null = null;
let loginPromise: Promise<Session> | null = null;
const SESSION_TTL_MS = 25 * 60 * 1000; // conservative; the real TTL is unknown

function jarFrom(headers: Headers, into: Map<string, string>): Map<string, string> {
  const raw: string[] = (headers as unknown as { getSetCookie?(): string[] }).getSetCookie?.() ?? [];
  for (const c of raw) {
    const pair = c.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) into.set(pair.slice(0, eq), pair);
  }
  return into;
}

async function login(): Promise<Session> {
  const username = process.env.JOLT_USERNAME;
  const password = process.env.JOLT_PASSWORD;
  if (!username || !password) throw new Error("JOLT_USERNAME / JOLT_PASSWORD not set");

  const jar = new Map<string, string>();
  const cookie = () => [...jar.values()].join("; ");

  // 1. Seed a PHP session.
  jarFrom((await fetch(`${APP}/account`, { headers: { "User-Agent": UA } })).headers, jar);

  // 2. Authenticate it.
  const res = await fetch(`${APP}/rest/v1/app/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
      Origin: APP,
      Referer: `${APP}/account`,
      Cookie: cookie(),
    },
    body: JSON.stringify({ username, password }),
  });
  jarFrom(res.headers, jar);

  const body = (await res.json().catch(() => ({}))) as {
    companyId?: string;
    contentGroupId?: string;
    isAuthenticated?: boolean;
    timezone?: string;
  };
  if (!body.isAuthenticated || !body.companyId) {
    throw new Error(`Jolt login failed (status ${res.status})`);
  }

  // 3. Serving an app page is what mints the GraphQL token.
  jarFrom(
    (await fetch(`${APP}/review/review/listCompletionReporting`, {
      headers: { "User-Agent": UA, Cookie: cookie() },
    })).headers,
    jar,
  );
  if (!jar.has("jolt_auth_token")) {
    throw new Error("Jolt login: no jolt_auth_token issued — the API will reject this session");
  }

  return {
    cookies: cookie(),
    companyId: body.companyId,
    contentGroupId: body.contentGroupId ?? "",
    // Jolt computes report windows in the company timezone, not the caller's.
    timezone: body.timezone || "America/Chicago",
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
}

async function getSession(): Promise<Session> {
  if (session && Date.now() < session.expiresAt) return session;
  // Coalesce concurrent callers onto one login rather than racing several.
  if (!loginPromise) {
    loginPromise = login()
      .then(s => { session = s; loginPromise = null; return s; })
      .catch(err => { loginPromise = null; throw err; });
  }
  return loginPromise;
}

function invalidateSession() {
  session = null;
  loginPromise = null;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const run = async () => {
    const s = await getSession();
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
        jolt_companyid: s.companyId,
        Cookie: s.cookies,
        "User-Agent": UA,
        Origin: APP,
        Referer: `${APP}/`,
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
    if (json.errors?.length) {
      const unauth = json.errors.some(e => e.extensions?.code === "UNAUTHENTICATED");
      throw Object.assign(new Error(`Jolt GraphQL: ${json.errors[0].message}`), { unauth });
    }
    if (!json.data) throw new Error("Jolt GraphQL: empty response");
    return json.data;
  };

  try {
    return await run();
  } catch (err) {
    // A stale cookie looks like an auth error; log in again and retry once.
    if ((err as { unauth?: boolean }).unauth) {
      invalidateSession();
      return run();
    }
    throw err;
  }
}

/**
 * Escape hatch for discovery scripts and for queries not yet wrapped in a
 * typed helper. Uses the same cached session as everything else.
 */
export function joltQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  return gql<T>(query, variables);
}

/**
 * Several queries take a required `mode`, which scopes them to a content group
 * or to one location. Everything the dashboard wants is company-wide.
 */
export async function allLocationsMode(): Promise<{ mode: string; id: string }> {
  const { contentGroupId } = await getSession();
  // Ids on this API are Relay global ids: base64 of "<Type>:<hex>". Passing the
  // bare hex fails validation with "must be a valid id format".
  return {
    mode: "CONTENT_GROUP_LOCATIONS",
    id: Buffer.from(`ContentGroup:${contentGroupId}`).toString("base64"),
  };
}

// ── Completion by location ────────────────────────────────────────────────────

export type LocationCompletion = {
  store: string;             // dashboard name, e.g. "Brentwood"
  joltName: string;          // "HRG Brentwood LLC"
  completeCount: number;
  onTimeCount: number;
  lateCount: number;
  missedCount: number;
  totalDoneCount: number;
  /** complete ÷ (done + missed), the figure the Jolt report calls Complete (%). */
  completePct: number | null;
  onTimePct: number | null;
  latePct: number | null;
  missedPct: number | null;
};

export type CompletionReport = {
  locations: LocationCompletion[];
  /** Dashboard stores with no Jolt deployment, so the UI can render empty rows. */
  storesWithoutJolt: string[];
  startDate: string;
  endDate: string;
  fetchedAt: number;
};

const LOCATION_STATS_QUERY = `
  query locationCompletion($filter: LocationCompletionStatsFilter!, $first: Int) {
    allLocationCompletionStats(filter: $filter, first: $first) {
      edges {
        node {
          location { id name }
          completeCount
          completeOnTimeCount
          completeLateCount
          missedCount
          totalDoneCount
        }
      }
    }
  }
`;

type StatsNode = {
  location: { id: string; name: string };
  completeCount: number;
  completeOnTimeCount: number;
  completeLateCount: number;
  missedCount: number;
  totalDoneCount: number;
};

const reportCache = new Map<string, CompletionReport>();
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Milliseconds a zone is ahead of UTC at a given instant. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const p = Object.fromEntries(parts.filter(x => x.type !== "literal").map(x => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - utcMs;
}

/**
 * Unix SECONDS for a wall-clock date in the company timezone. Jolt windows are
 * Central for HRG, and getting this wrong silently shifts the window by an hour,
 * which pulls a couple of extra rows in or out of the report.
 */
function toEpochSeconds(iso: string, timeZone: string, endOfDay = false): number {
  const [y, m, d] = iso.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  // Two passes so a window edge landing on a DST change still resolves.
  let utc = naive - zoneOffsetMs(naive, timeZone);
  utc = naive - zoneOffsetMs(utc, timeZone);
  return Math.floor(utc / 1000);
}

export async function fetchCompletionByLocation(
  startDate: string,
  endDate: string,
  opts: { bust?: boolean } = {},
): Promise<CompletionReport> {
  const key = `${startDate}__${endDate}`;
  const cached = reportCache.get(key);
  if (!opts.bust && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  const { timezone } = await getSession();
  const data = await gql<{ allLocationCompletionStats: { edges: { node: StatsNode }[] } }>(
    LOCATION_STATS_QUERY,
    {
      filter: {
        displayAfterTimestamp: toEpochSeconds(startDate, timezone),
        displayBeforeTimestamp: toEpochSeconds(endDate, timezone, true),
        // Verified against the live report: true reproduces the figures the
        // List Completion Report shows by default. Do not flip this casually.
        isActive: true,
        isSublist: false,
        listTemplateIds: [],
        locationGroupIds: [],
        locationIds: [],
      },
      first: 100,
    },
  );

  const locations: LocationCompletion[] = [];
  for (const { node } of data.allLocationCompletionStats.edges) {
    if (EXCLUDED_JOLT_LOCATIONS.includes(node.location.name)) continue;
    const store = JOLT_TO_STORE[node.location.name];
    if (!store) {
      console.warn("[jolt] unmapped location:", node.location.name);
      continue;
    }
    // Jolt's own denominator: everything that was scheduled in the window.
    const denom = node.totalDoneCount + node.missedCount;
    const pct = (n: number) => (denom > 0 ? (n / denom) * 100 : null);
    locations.push({
      store,
      joltName: node.location.name,
      completeCount: node.completeCount,
      onTimeCount: node.completeOnTimeCount,
      lateCount: node.completeLateCount,
      missedCount: node.missedCount,
      totalDoneCount: node.totalDoneCount,
      completePct: pct(node.completeCount),
      onTimePct: pct(node.completeOnTimeCount),
      latePct: pct(node.completeLateCount),
      missedPct: pct(node.missedCount),
    });
  }
  // On-time is the metric that matters, so rank on it rather than on raw completion.
  locations.sort((a, b) => (b.onTimePct ?? -1) - (a.onTimePct ?? -1));

  const report: CompletionReport = {
    locations,
    storesWithoutJolt: STORES_WITHOUT_JOLT,
    startDate,
    endDate,
    fetchedAt: Date.now(),
  };
  reportCache.set(key, report);
  return report;
}

// ── Deep links into Jolt ──────────────────────────────────────────────────────
// Per-instance detail lives behind a client-side route inside Browse Lists —
// /review/review/review?id=<hex> just 302s back to the browser — so these link
// to the report a person would land on and filter from there.

export const JOLT_URL = {
  completionReport: `${APP}/review/review/listCompletionReporting`,
  browseLists: `${APP}/review/review/browseLists`,
  scorecard: `${APP}/review/review/scorecard`,
} as const;

// ── Locations ─────────────────────────────────────────────────────────────────

type JoltLocation = { id: string; name: string; store: string };
let locationCache: { at: number; locations: JoltLocation[] } | null = null;

async function fetchJoltLocations(): Promise<JoltLocation[]> {
  if (locationCache && Date.now() - locationCache.at < CACHE_TTL_MS) return locationCache.locations;
  const d = await gql<{ allLocations: { edges: { node: { id: string; name: string } }[] } }>(
    `{ allLocations(first: 50) { edges { node { id name } } } }`,
    {},
  );
  const locations = d.allLocations.edges
    .map(e => ({ id: e.node.id, name: e.node.name, store: JOLT_TO_STORE[e.node.name] ?? "" }))
    .filter(l => l.store);
  locationCache = { at: Date.now(), locations };
  return locations;
}

// ── Completion by list, broken down by store ──────────────────────────────────
// Jolt aggregates by list template across all locations in one call, so the
// per-store split comes from running that query once per location. Seven small
// queries in parallel beats paginating thousands of individual instances.

export type ListStoreStat = {
  store: string;
  listCount: number;
  onTimeCount: number;
  lateCount: number;
  missedCount: number;
  onTimePct: number | null;
  completePct: number | null;
};

export type ListCompletion = {
  listId: string;
  title: string;
  listCount: number;
  onTimeCount: number;
  lateCount: number;
  missedCount: number;
  onTimePct: number | null;
  completePct: number | null;
  byStore: ListStoreStat[];
};

export type ListReport = {
  lists: ListCompletion[];
  startDate: string;
  endDate: string;
  fetchedAt: number;
};

type ListStatsNode = {
  listTemplate: { id: string; title: string } | null;
  listCount: number;
  completeCount: number;
  completeOnTimeCount: number;
  completeLateCount: number;
  missedCount: number;
};

const LIST_STATS_QUERY = `
  query listStats($filter: ListCompletionStatsFilter!, $first: Int) {
    allListsCompletionStats(filter: $filter, first: $first) {
      edges {
        node {
          listTemplate { id title }
          listCount
          completeCount
          completeOnTimeCount
          completeLateCount
          missedCount
        }
      }
    }
  }
`;

const listReportCache = new Map<string, ListReport>();

/** Scheduled = everything that came due in the window, done or not. */
const share = (n: number, denom: number) => (denom > 0 ? (n / denom) * 100 : null);

export async function fetchListCompletion(
  startDate: string,
  endDate: string,
  opts: { bust?: boolean } = {},
): Promise<ListReport> {
  const key = `${startDate}__${endDate}`;
  const cached = listReportCache.get(key);
  if (!opts.bust && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  const { timezone } = await getSession();
  const locations = await fetchJoltLocations();
  const filterBase = {
    displayAfterTimestamp: toEpochSeconds(startDate, timezone),
    displayBeforeTimestamp: toEpochSeconds(endDate, timezone, true),
    isActive: true,
    isSublist: false,
    listTemplateIds: [],
    locationGroupIds: [],
  };

  const perLocation = await Promise.all(
    locations.map(async loc => {
      const d = await gql<{ allListsCompletionStats: { edges: { node: ListStatsNode }[] } }>(
        LIST_STATS_QUERY,
        { filter: { ...filterBase, locationIds: [loc.id] }, first: 200 },
      );
      return { loc, nodes: d.allListsCompletionStats.edges.map(e => e.node) };
    }),
  );

  const byId = new Map<string, ListCompletion>();
  for (const { loc, nodes } of perLocation) {
    for (const n of nodes) {
      if (!n.listTemplate) continue;
      let entry = byId.get(n.listTemplate.id);
      if (!entry) {
        entry = {
          listId: n.listTemplate.id,
          title: n.listTemplate.title,
          listCount: 0, onTimeCount: 0, lateCount: 0, missedCount: 0,
          onTimePct: null, completePct: null,
          byStore: [],
        };
        byId.set(n.listTemplate.id, entry);
      }
      const scheduled = n.completeOnTimeCount + n.completeLateCount + n.missedCount;
      entry.listCount += n.listCount;
      entry.onTimeCount += n.completeOnTimeCount;
      entry.lateCount += n.completeLateCount;
      entry.missedCount += n.missedCount;
      entry.byStore.push({
        store: loc.store,
        listCount: n.listCount,
        onTimeCount: n.completeOnTimeCount,
        lateCount: n.completeLateCount,
        missedCount: n.missedCount,
        onTimePct: share(n.completeOnTimeCount, scheduled),
        completePct: share(n.completeOnTimeCount + n.completeLateCount, scheduled),
      });
    }
  }

  const lists = [...byId.values()];
  for (const l of lists) {
    const scheduled = l.onTimeCount + l.lateCount + l.missedCount;
    l.onTimePct = share(l.onTimeCount, scheduled);
    l.completePct = share(l.onTimeCount + l.lateCount, scheduled);
    l.byStore.sort((a, b) => (b.onTimePct ?? -1) - (a.onTimePct ?? -1));
  }
  // Worst on-time first — the point of the table is finding what is slipping.
  lists.sort((a, b) => (a.onTimePct ?? 101) - (b.onTimePct ?? 101));

  const report: ListReport = { lists, startDate, endDate, fetchedAt: Date.now() };
  listReportCache.set(key, report);
  return report;
}

// ── Open lists due soon ───────────────────────────────────────────────────────

export type DueSoonList = {
  id: string;
  store: string;
  title: string;
  deadline: number;   // unix seconds
  incompleteCount: number | null;
};

export type DueSoonReport = {
  instances: DueSoonList[];
  hours: number;
  timezone: string;
  fetchedAt: number;
};

const LIST_INSTANCES_QUERY = `
  query dueSoon($filter: ListInstancesFilter!, $first: Int, $mode: ModeInput!) {
    allListInstances(filter: $filter, first: $first, mode: $mode) {
      edges {
        node {
          id
          instanceTitle
          deadlineTimestamp
          completionTimestamp
          incompleteCount
          listTemplate { id title }
          location { id name }
        }
      }
    }
  }
`;

type InstanceNode = {
  id: string;
  instanceTitle: string | null;
  deadlineTimestamp: number | null;
  completionTimestamp: number | null;
  incompleteCount: number | null;
  listTemplate: { id: string; title: string } | null;
  location: { id: string; name: string } | null;
};

const dueSoonCache = new Map<string, DueSoonReport>();
const DUE_SOON_TTL_MS = 10 * 60 * 1000; // shorter: this is the "act now" panel

export async function fetchDueSoon(hours = 24, opts: { bust?: boolean } = {}): Promise<DueSoonReport> {
  const key = String(hours);
  const cached = dueSoonCache.get(key);
  if (!opts.bust && cached && Date.now() - cached.fetchedAt < DUE_SOON_TTL_MS) return cached;

  const { timezone } = await getSession();
  const mode = await allLocationsMode();
  const now = Math.floor(Date.now() / 1000);

  const d = await gql<{ allListInstances: { edges: { node: InstanceNode }[] } }>(
    LIST_INSTANCES_QUERY,
    {
      filter: {
        isActive: true,
        isSublist: false,
        deadlineAfterTimestamp: now,
        deadlineBeforeTimestamp: now + hours * 3600,
      },
      first: 500,
      mode,
    },
  );

  const instances: DueSoonList[] = [];
  for (const { node } of d.allListInstances.edges) {
    if (node.completionTimestamp) continue;      // already done
    if (!node.location || !node.deadlineTimestamp) continue;
    const store = JOLT_TO_STORE[node.location.name];
    if (!store) continue;                        // drops Portland
    instances.push({
      id: node.id,
      store,
      title: node.listTemplate?.title ?? node.instanceTitle ?? "Untitled list",
      deadline: node.deadlineTimestamp,
      incompleteCount: node.incompleteCount,
    });
  }
  instances.sort((a, b) => a.deadline - b.deadline);

  const report: DueSoonReport = { instances, hours, timezone, fetchedAt: Date.now() };
  dueSoonCache.set(key, report);
  return report;
}

// ── Who is completing lists ───────────────────────────────────────────────────

export type Submitter = {
  personId: string;
  name: string;
  total: number;
  byStore: Record<string, number>;
};

export type SubmitterReport = {
  submitters: Submitter[];
  startDate: string;
  endDate: string;
  fetchedAt: number;
};

const SUBMITTERS_QUERY = `
  query submitters($filter: ListInstancesFilter!, $first: Int, $mode: ModeInput!) {
    allListInstances(filter: $filter, first: $first, mode: $mode) {
      edges {
        node {
          completionTimestamp
          submitPerson { id firstName lastName }
          location { id name }
        }
      }
    }
  }
`;

const submitterCache = new Map<string, SubmitterReport>();

export async function fetchSubmitters(
  startDate: string,
  endDate: string,
  opts: { bust?: boolean } = {},
): Promise<SubmitterReport> {
  const key = `${startDate}__${endDate}`;
  const cached = submitterCache.get(key);
  if (!opts.bust && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  const { timezone } = await getSession();
  const mode = await allLocationsMode();

  const d = await gql<{
    allListInstances: {
      edges: {
        node: {
          completionTimestamp: number | null;
          submitPerson: { id: string; firstName: string; lastName: string } | null;
          location: { id: string; name: string } | null;
        };
      }[];
    };
  }>(SUBMITTERS_QUERY, {
    filter: {
      isActive: true,
      isSublist: false,
      displayAfterTimestamp: toEpochSeconds(startDate, timezone),
      displayBeforeTimestamp: toEpochSeconds(endDate, timezone, true),
    },
    first: 500,
    mode,
  });

  const byPerson = new Map<string, Submitter>();
  for (const { node } of d.allListInstances.edges) {
    const p = node.submitPerson;
    if (!p || !node.completionTimestamp) continue;
    const store = node.location ? JOLT_TO_STORE[node.location.name] : undefined;
    if (!store) continue;
    let entry = byPerson.get(p.id);
    if (!entry) {
      // Jolt has double spaces in some names.
      const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.replace(/\s+/g, " ").trim();
      entry = { personId: p.id, name: name || "Unknown", total: 0, byStore: {} };
      byPerson.set(p.id, entry);
    }
    entry.total += 1;
    entry.byStore[store] = (entry.byStore[store] ?? 0) + 1;
  }

  const submitters = [...byPerson.values()].sort((a, b) => b.total - a.total);
  const report: SubmitterReport = { submitters, startDate, endDate, fetchedAt: Date.now() };
  submitterCache.set(key, report);
  return report;
}


export function invalidateJoltCache(): void {
  reportCache.clear();
  listReportCache.clear();
  dueSoonCache.clear();
  submitterCache.clear();
  storeListsCache.clear();
  locationCache = null;
  invalidateSession();
}

// ── Every list, per store ─────────────────────────────────────────────────────
// The tab's primary view: one section per store listing each assigned list with
// its deadline, completion time and who submitted it.
//
// This is the one query that genuinely needs pagination. A single week across
// the eight Jolt locations is ~950 instances, so the `first: 500` the other
// helpers use would quietly drop rows — and a truncated list reads as "nothing
// was assigned" rather than as an error.

export type ListInstanceStatus = "onTime" | "late" | "missed" | "pending";

export type ListInstanceRow = {
  id: string;
  title: string;
  /** Unix seconds, company timezone. Null for unscheduled lists. */
  deadline: number | null;
  completedAt: number | null;
  completedBy: string | null;
  status: ListInstanceStatus;
};

export type StoreLists = {
  store: string;
  joltName: string;
  onTimeCount: number;
  lateCount: number;
  missedCount: number;
  /** Assigned, not yet done, deadline still in the future. */
  pendingCount: number;
  /** on-time + late + missed — everything whose deadline has passed. */
  dueCount: number;
  /** onTime ÷ dueCount. Pending lists are excluded: they cannot be late yet. */
  onTimePct: number | null;
  /**
   * (onTime + late) ÷ dueCount — got done at all, on time or not. Shares the
   * denominator with onTimePct, which is how Jolt defines its own pair:
   * verified that Jolt's completePercent and completeOnTimePercent are both
   * over complete + missed.
   */
  completePct: number | null;
  rows: ListInstanceRow[];
};

export type StoreListsReport = {
  stores: StoreLists[];
  storesWithoutJolt: string[];
  startDate: string;
  endDate: string;
  timezone: string;
  /** The instant used to split "missed" from "still pending". */
  asOf: number;
  truncated: boolean;
  fetchedAt: number;
};

const STORE_LISTS_QUERY = `
  query storeLists($filter: ListInstancesFilter!, $first: Int, $after: String, $mode: ModeInput!) {
    allListInstances(filter: $filter, first: $first, after: $after, mode: $mode) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          instanceTitle
          deadlineTimestamp
          completionTimestamp
          listTemplate { id title }
          location { id name }
          submitPerson { id firstName lastName }
          assignedPerson { id firstName lastName }
        }
      }
    }
  }
`;

type StoreListNode = {
  id: string;
  instanceTitle: string | null;
  deadlineTimestamp: number | null;
  completionTimestamp: number | null;
  listTemplate: { id: string; title: string } | null;
  location: { id: string; name: string } | null;
  submitPerson: { id: string; firstName: string; lastName: string } | null;
  assignedPerson: { id: string; firstName: string; lastName: string } | null;
};

const PAGE_SIZE = 500;
/** ~20k instances. A window big enough to exceed this is a mistake, not a query. */
const MAX_PAGES = 40;

const storeListsCache = new Map<string, StoreListsReport>();

/** Jolt stores some names with double spaces. */
function personName(p: { firstName: string; lastName: string } | null): string | null {
  if (!p) return null;
  const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.replace(/\s+/g, " ").trim();
  return name || null;
}

export async function fetchStoreLists(
  startDate: string,
  endDate: string,
  opts: { bust?: boolean; hours?: number } = {},
): Promise<StoreListsReport> {
  const key = `${startDate}__${endDate}__${opts.hours ?? ""}`;
  const cached = storeListsCache.get(key);
  if (!opts.bust && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  const { timezone } = await getSession();
  const mode = await allLocationsMode();

  // A rolling window ("last 24 hours") can't be expressed as whole days, so it
  // bypasses the date bounds entirely. startDate/endDate still come along to
  // label the report and key the cache.
  const now = Math.floor(Date.now() / 1000);

  // The window is keyed on DISPLAY time — when the list was assigned — because
  // that is what Jolt's own List Completion Report groups by, and this tab is
  // meant to tie out against it. An overnight closing list assigned 10:30 PM
  // Monday and due 12:00 AM Tuesday therefore counts toward Monday.
  //
  // Keying on deadlineTimestamp instead was tried and reverted: it reads more
  // naturally per shift, but it moves boundary lists to the other day and puts
  // this tab permanently out of step with the report people check it against.
  const filter = {
    isActive: true,
    isSublist: false,
    displayAfterTimestamp: opts.hours ? now - opts.hours * 3600 : toEpochSeconds(startDate, timezone),
    displayBeforeTimestamp: opts.hours ? now : toEpochSeconds(endDate, timezone, true),
  };

  const nodes: StoreListNode[] = [];
  let after: string | null = null;
  let pages = 0;
  let truncated = false;

  do {
    const page: {
      allListInstances: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: { node: StoreListNode }[];
      };
    } = await gql(STORE_LISTS_QUERY, { filter, first: PAGE_SIZE, after, mode });

    nodes.push(...page.allListInstances.edges.map(e => e.node));
    after = page.allListInstances.pageInfo.hasNextPage ? page.allListInstances.pageInfo.endCursor : null;
    if (++pages >= MAX_PAGES && after) { truncated = true; break; }
  } while (after);

  const asOf = Math.floor(Date.now() / 1000);
  const byStore = new Map<string, StoreLists>();

  for (const node of nodes) {
    if (!node.location) continue;
    const store = JOLT_TO_STORE[node.location.name];
    if (!store) continue; // drops Portland

    let entry = byStore.get(store);
    if (!entry) {
      entry = {
        store, joltName: node.location.name,
        onTimeCount: 0, lateCount: 0, missedCount: 0, pendingCount: 0,
        dueCount: 0, onTimePct: null, completePct: null, rows: [],
      };
      byStore.set(store, entry);
    }

    const deadline = node.deadlineTimestamp;
    const completedAt = node.completionTimestamp;
    let status: ListInstanceStatus;
    if (completedAt) {
      // An unscheduled list has no deadline to be late against.
      status = deadline && completedAt > deadline ? "late" : "onTime";
    } else if (deadline && deadline < asOf) {
      status = "missed";
    } else {
      status = "pending";
    }

    entry.rows.push({
      id: node.id,
      title: node.listTemplate?.title ?? node.instanceTitle ?? "Untitled list",
      deadline,
      completedAt,
      // Jolt occasionally completes an instance with no submitter recorded;
      // the person it was assigned to is the useful fallback.
      completedBy: completedAt ? personName(node.submitPerson) ?? personName(node.assignedPerson) : null,
      status,
    });

    if (status === "onTime") entry.onTimeCount++;
    else if (status === "late") entry.lateCount++;
    else if (status === "missed") entry.missedCount++;
    else entry.pendingCount++;
  }

  for (const entry of byStore.values()) {
    entry.dueCount = entry.onTimeCount + entry.lateCount + entry.missedCount;
    entry.onTimePct = share(entry.onTimeCount, entry.dueCount);
    entry.completePct = share(entry.onTimeCount + entry.lateCount, entry.dueCount);
    // Chronological: the period reads top to bottom, and anything not yet due
    // lands at the end where it belongs. Undated lists sort last.
    entry.rows.sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity));
  }

  const report: StoreListsReport = {
    stores: [...byStore.values()].sort((a, b) => a.store.localeCompare(b.store)),
    storesWithoutJolt: STORES_WITHOUT_JOLT,
    startDate, endDate, timezone, asOf, truncated,
    fetchedAt: Date.now(),
  };
  storeListsCache.set(key, report);
  return report;
}
