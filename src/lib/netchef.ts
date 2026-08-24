// Pure HTTP client for Net-Chef Actual vs Theoretical Cost report.
// No browser needed — login once via session cookie, then call the JSON API directly.

const NC_BASE = "https://zaxbys.net-chef.com";

export type LocationData = {
  locationName: string;
  locationId: number;
  actualCostPct: number | null;
  actualCostDollars: number | null;
  variancePct: number | null;
  varianceDollars: number | null;
};

export type NcReport = {
  locations: LocationData[];
  startDate: string;  // YYYY-MM-DD
  endDate: string;
  fetchedAt: number;
};

// ── Session management ────────────────────────────────────────────────────────

type Session = {
  cookies: string;  // raw Cookie header value
  expiresAt: number;
};

let session: Session | null = null;
const SESSION_TTL_MS = 55 * 60 * 1000; // 55 min (server timeout is typically 60)

async function login(): Promise<Session> {
  const username = process.env.NETCHEF_USERNAME;
  const password = process.env.NETCHEF_PASSWORD;
  if (!username || !password) throw new Error("NETCHEF_USERNAME / NETCHEF_PASSWORD not set");

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

  // Step 1: GET the login page — server sets JSESSIONID + hazelcast.sessionId
  const pageRes = await fetch(`${NC_BASE}/standalone/modern.ct`, {
    method: "GET",
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*" },
    redirect: "follow",
  });
  const initialCookies = cookiesFromHeaders(pageRes.headers);
  console.log("[NC] initial cookies:", initialCookies);

  if (!initialCookies.includes("JSESSIONID")) {
    throw new Error("NC login: no JSESSIONID on initial page load — site may be down");
  }

  // Step 2: POST credentials — authenticates the existing session in-place
  const authRes = await fetch(`${NC_BASE}/resource/ceslogin/auth`, {
    method: "POST",
    headers: {
      "Accept": "*/*",
      "Content-Type": "application/json",
      "Cookie": initialCookies,
      "Origin": NC_BASE,
      "Referer": `${NC_BASE}/standalone/modern.ct`,
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRF-Token": "null",
      "User-Agent": UA,
    },
    body: JSON.stringify({ username, password, language: "eng" }),
  });

  console.log("[NC] auth status:", authRes.status);

  // Dump ALL response headers so we can see every Set-Cookie the server sends
  const authHeaderDump: Record<string, string> = {};
  authRes.headers.forEach((v, k) => { authHeaderDump[k] = v; });
  console.log("[NC] auth response headers:", JSON.stringify(authHeaderDump));
  const rawSetCookie = (authRes.headers as unknown as { getSetCookie?(): string[] }).getSetCookie?.() ?? [];
  console.log("[NC] auth set-cookie array:", JSON.stringify(rawSetCookie));

  const authBody = await authRes.json().catch(() => ({})) as Record<string, unknown>;
  console.log("[NC] auth response body:", JSON.stringify(authBody));

  if (!authBody.success) {
    throw new Error(`NC login failed: ${JSON.stringify(authBody)}`);
  }

  let cookies = mergeCookies(initialCookies, cookiesFromHeaders(authRes.headers));

  // session_idUTF is a long-lived user-ID cookie set by browser JS — inject from env
  const sessionIdUtf = process.env.NETCHEF_SESSION_ID_UTF;
  if (sessionIdUtf) cookies = mergeCookies(cookies, `session_idUTF=${sessionIdUtf}`);

  console.log("[NC] post-auth cookies:", cookies);

  // Step 3: POST choose-location — finalizes the ncext session so /resource/* APIs accept it.
  // Any valid location ID works here; we use 425 (Brentwood) just to establish the session.
  const chooseRes = await fetch(`${NC_BASE}/resource/ceslogin/choose-location`, {
    method: "POST",
    headers: {
      "Accept": "*/*",
      "Content-Type": "application/json",
      "Cookie": cookies,
      "Origin": NC_BASE,
      "Referer": `${NC_BASE}/standalone/modern.ct`,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": UA,
    },
    body: JSON.stringify({ locationId: 425, supplyId: null, language: "eng" }),
  });
  console.log("[NC] choose-location status:", chooseRes.status);
  const chooseBody = await chooseRes.json().catch(() => ({})) as Record<string, unknown>;
  console.log("[NC] choose-location response:", JSON.stringify(chooseBody));
  cookies = mergeCookies(cookies, cookiesFromHeaders(chooseRes.headers));
  console.log("[NC] final session cookies:", cookies);

  return { cookies, expiresAt: Date.now() + SESSION_TTL_MS };
}

function cookiesFromHeaders(headers: Headers): string {
  const setCookie: string[] = (headers as unknown as { getSetCookie?(): string[] }).getSetCookie?.() ?? [];
  // Fallback for environments where getSetCookie isn't available
  if (!setCookie.length) {
    const raw = headers.get("set-cookie") ?? "";
    if (raw) setCookie.push(...raw.split(/,(?=[^ ])/));
  }
  return setCookie.map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
}

function mergeCookies(base: string, override: string): string {
  const map = new Map<string, string>();
  for (const pair of (base + "; " + override).split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) map.set(k, v);
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

let loginPromise: Promise<Session> | null = null;

// Limit concurrent Net-Chef API calls so a burst of 36+ requests on cold load
// doesn't cause NC to return empty totalSummaries for some locations.
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];
  constructor(permits: number) { this.permits = permits; }
  acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return Promise.resolve(); }
    return new Promise(resolve => { this.queue.push(resolve); });
  }
  release(): void {
    const next = this.queue.shift();
    if (next) { next(); } else { this.permits++; }
  }
}
const ncSemaphore = new Semaphore(4);

async function getSession(): Promise<Session> {
  if (session && Date.now() < session.expiresAt) return session;
  // Coalesce concurrent callers onto a single login attempt so that 12 parallel
  // requests don't each start their own login and stomp each other's session.
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

// ── Common fetch wrapper ──────────────────────────────────────────────────────

async function ncFetch(path: string, body: unknown): Promise<unknown> {
  await ncSemaphore.acquire();
  try {
  const s = await getSession();
  const url = `${NC_BASE}${path}?_dc=${Date.now()}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Cookie": s.cookies,
      "Origin": NC_BASE,
      "Referer": `${NC_BASE}/ncext/index.ct`,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 403) {
    invalidateSession();
    throw new Error("NC session expired — retry the request");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NC API error ${res.status} at ${path}: ${text.slice(0, 200)}`);
  }

  return res.json();
  } finally {
    ncSemaphore.release();
  }
}

// ── Location list ─────────────────────────────────────────────────────────────
// Use the hardcoded map directly — the ceslogin/locations API returns an
// incomplete set when the session is scoped to a single location via choose-location.

type NcLocation = { id: number; name: string };

function getLocations(): NcLocation[] {
  return Object.entries(LOCATION_NAMES).map(([id, name]) => ({ id: Number(id), name }));
}

export const LOCATION_NAMES: Record<number, string> = {
  425:  "Brentwood",
  868:  "Chesapeake",
  869:  "Hillcrest",
  689:  "Columbia",
  901:  "Hampton",
  950:  "Oyster",
  886:  "Jefferson",
  771:  "Springfield",
  632:  "Spring Hill",
  465:  "College",
  1137: "Beach",
  1002: "White House",
};

// ── Report fetch ──────────────────────────────────────────────────────────────

type LocationReport = { actualCostPct: number | null; actualCostDollars: number | null; variancePct: number | null; varianceDollars: number | null };
const locationReportCache = new Map<string, { report: LocationReport; fetchedAt: number }>();

export async function fetchLocationReport(
  locationId: number,
  startDate: string,
  endDate: string,
  opts: { bust?: boolean } = {}
): Promise<LocationReport> {
  const cKey = `${locationId}__${startDate}__${endDate}`;
  const cached = locationReportCache.get(cKey);
  if (!opts.bust && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.report;

  // Convert YYYY-MM-DD → MM/DD/YYYY
  const toMMDDYYYY = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y}`;
  };

  const data = await ncFetch("/resource/actualvstheoretical/location/details", {
    extraCriteriaMap: {
      startDate: toMMDDYYYY(startDate),
      endDate: toMMDDYYYY(endDate),
      locationIdFilter: locationId,
      isConsolidated: false,
    },
    pagingInfo: { page: 1, start: 0, limit: 1000000 },
  }) as Record<string, unknown>;

  let totals = (data.totalSummaries as Record<string, unknown>[] | undefined)?.[0];
  const isBlank = (t: Record<string, unknown> | undefined): t is undefined =>
    !t || (Number(t.actualCost) === 0 && Number(t.actualCostPercent) === 0);

  if (isBlank(totals)) {
    console.log("[NC] blank/missing totalSummaries for location", locationId, "— retrying in 1s");
    await new Promise(r => setTimeout(r, 1000));
    const retry = await ncFetch("/resource/actualvstheoretical/location/details", {
      extraCriteriaMap: { startDate: toMMDDYYYY(startDate), endDate: toMMDDYYYY(endDate), locationIdFilter: locationId, isConsolidated: false },
      pagingInfo: { page: 1, start: 0, limit: 1000000 },
    }) as Record<string, unknown>;
    totals = (retry.totalSummaries as Record<string, unknown>[] | undefined)?.[0];
    if (isBlank(totals)) {
      console.log("[NC] blank/missing totalSummaries for location", locationId, "after retry — giving up");
      return { actualCostPct: null, actualCostDollars: null, variancePct: null, varianceDollars: null };
    }
  }

  // Log the window we asked for next to the figure that came back, for every
  // location. A store once rendered a two-week cost under a one-week heading and
  // the old 425/689-only dump could not show whether the response belonged to the
  // range requested. salesBase is the row-level divisorValue, the denominator
  // behind actualCostPercent, and is the field that gives the window away.
  const firstRow = (data.rows as Record<string, unknown>[] | undefined)?.[0];
  console.log(
    `[NC] loc ${locationId} ${startDate}..${endDate}` +
      ` actualCost=${totals.actualCost} pct=${totals.actualCostPercent}` +
      ` salesBase=${firstRow?.divisorValue ?? "n/a"}` +
      ` summaries=${(data.totalSummaries as unknown[])?.length ?? 0}`,
  );

  const actualCostPct     = totals.actualCostPercent    != null ? Number(totals.actualCostPercent)    : null;
  const actualCostDollars = totals.actualCost           != null ? Number(totals.actualCost)           : null;
  const variancePct       = totals.valueVariancePercent != null ? Number(totals.valueVariancePercent) : null;
  const varianceDollars   = totals.valueVariance        != null ? Number(totals.valueVariance)        : null;

  const report: LocationReport = { actualCostPct, actualCostDollars, variancePct, varianceDollars };
  locationReportCache.set(cKey, { report, fetchedAt: Date.now() });
  return report;
}

// ── Report cache ──────────────────────────────────────────────────────────────

const reportCache = new Map<string, NcReport>();
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function fetchNcReport(startDate: string, endDate: string): Promise<NcReport> {
  const cKey = `${startDate}__${endDate}`;
  const cached = reportCache.get(cKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  const locs = getLocations();

  const locations: LocationData[] = await Promise.all(
    locs.map(async loc => {
      try {
        const { actualCostPct, actualCostDollars, variancePct, varianceDollars } = await fetchLocationReport(loc.id, startDate, endDate);
        return { locationName: loc.name, locationId: loc.id, actualCostPct, actualCostDollars, variancePct, varianceDollars };
      } catch (err) {
        console.error("[NC] error for location", loc.name, ":", err);
        return { locationName: loc.name, locationId: loc.id, actualCostPct: null, actualCostDollars: null, variancePct: null, varianceDollars: null };
      }
    })
  );

  const report: NcReport = { locations, startDate, endDate, fetchedAt: Date.now() };
  reportCache.set(cKey, report);
  return report;
}

// ── Item-level breakdown ──────────────────────────────────────────────────────

export type ItemData = {
  name: string;
  actualCostDollars: number | null;
  actualCostPct: number | null;
  varianceDollars: number | null;
  variancePct: number | null;
};

const detailCache = new Map<string, { rows: Record<string, unknown>[]; fetchedAt: number }>();

// Raw Actual-vs-Theoretical detail rows for one location, cached so the item
// breakdown and the category matrix share a single Net-Chef round trip.
async function fetchLocationDetailRows(
  locationId: number,
  startDate: string,
  endDate: string
): Promise<Record<string, unknown>[]> {
  const cKey = `${locationId}__${startDate}__${endDate}`;
  const cached = detailCache.get(cKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.rows;

  const toMMDDYYYY = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y}`;
  };

  const data = await ncFetch("/resource/actualvstheoretical/location/details", {
    extraCriteriaMap: {
      startDate: toMMDDYYYY(startDate),
      endDate: toMMDDYYYY(endDate),
      locationIdFilter: locationId,
      isConsolidated: false,
    },
    pagingInfo: { page: 1, start: 0, limit: 1000000 },
  }) as Record<string, unknown>;

  const rows = (data.rows as Record<string, unknown>[] | undefined) ?? [];
  if (!rows.length) {
    console.log("[NC] no detail rows for location", locationId);
    return rows; // don't cache an empty result — NC returns [] transiently
  }
  detailCache.set(cKey, { rows, fetchedAt: Date.now() });
  return rows;
}

export async function fetchLocationItems(
  locationId: number,
  startDate: string,
  endDate: string,
  mode: "actual" | "variance" = "variance",
  limit = 5
): Promise<ItemData[]> {
  const rows = await fetchLocationDetailRows(locationId, startDate, endDate);
  if (!rows.length) return [];

  const mapped = rows.map(r => ({
    name:              String(r.glDescription ?? r.glSubstructure ?? r.name ?? ""),
    actualCostDollars: r.actualCost           != null ? Number(r.actualCost)           : null,
    actualCostPct:     r.actualCostPercent     != null ? Number(r.actualCostPercent)     : null,
    varianceDollars:   r.valueVariance         != null ? Number(r.valueVariance)         : null,
    variancePct:       r.valueVariancePercent  != null ? Number(r.valueVariancePercent)  : null,
  }));

  if (mode === "actual") {
    return mapped
      .filter(r => r.name && r.actualCostPct !== null)
      .sort((a, b) => (b.actualCostPct ?? 0) - (a.actualCostPct ?? 0))
      .slice(0, limit);
  }
  return mapped
    .filter(r => r.name && r.variancePct !== null)
    .sort((a, b) => Math.abs(b.variancePct ?? 0) - Math.abs(a.variancePct ?? 0))
    .slice(0, limit);
}

// ── Category × location matrix ────────────────────────────────────────────────
// Every COGS category down the side, every location across the top. Cells carry
// both metrics so the client can flip between COGS and Variance without refetching.

export type CategoryCell = {
  cogsPct: number | null;
  cogsDollars: number | null;
  variancePct: number | null;
  varianceDollars: number | null;
};

export type CategoryRow = {
  name: string;   // glDescription, e.g. "TENDERS"
  group: string;  // glSubstructure, e.g. "Food & Beverages"
  sort: string;   // glSort, e.g. "40002 - OIL AND SHORTENING"
  cells: Record<number, CategoryCell>;  // keyed by locationId
};

export type CategoryMatrix = {
  categories: CategoryRow[];
  locations: { locationId: number; locationName: string }[];
  /** Net sales per location — the divisor behind every percent, used for weighted averages. */
  salesByLocation: Record<number, number | null>;
  startDate: string;
  endDate: string;
  fetchedAt: number;
};

const matrixCache = new Map<string, CategoryMatrix>();

export async function fetchCategoryMatrix(startDate: string, endDate: string): Promise<CategoryMatrix> {
  const cKey = `${startDate}__${endDate}`;
  const cached = matrixCache.get(cKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  const locs = getLocations();

  const perLocation = await Promise.all(locs.map(async loc => {
    try {
      return { loc, rows: await fetchLocationDetailRows(loc.id, startDate, endDate) };
    } catch (err) {
      console.error("[NC] category matrix failed for", loc.name, ":", err);
      return { loc, rows: [] as Record<string, unknown>[] };
    }
  }));

  const byName = new Map<string, CategoryRow>();
  const salesByLocation: Record<number, number | null> = {};

  for (const { loc, rows } of perLocation) {
    salesByLocation[loc.id] = null;
    for (const r of rows) {
      const name = String(r.glDescription ?? "").trim();
      if (!name) continue;

      let cat = byName.get(name);
      if (!cat) {
        cat = {
          name,
          group: String(r.glSubstructure ?? "").trim() || "Other",
          sort: String(r.glSort ?? name),
          cells: {},
        };
        byName.set(name, cat);
      }

      cat.cells[loc.id] = {
        cogsPct:         r.actualCostPercent    != null ? Number(r.actualCostPercent)    : null,
        cogsDollars:     r.actualCost           != null ? Number(r.actualCost)           : null,
        variancePct:     r.valueVariancePercent != null ? Number(r.valueVariancePercent) : null,
        varianceDollars: r.valueVariance        != null ? Number(r.valueVariance)        : null,
      };

      // divisorValue is the location's net sales, repeated on every row
      const divisor = r.divisorValue != null ? Number(r.divisorValue) : 0;
      if (divisor > 0) salesByLocation[loc.id] = divisor;
    }
  }

  // Order categories by glSort (GL number), then group by substructure in the
  // order each group first appears so the groups stay contiguous.
  const categories = [...byName.values()].sort((a, b) => a.sort.localeCompare(b.sort));
  const groupOrder = new Map<string, number>();
  for (const c of categories) if (!groupOrder.has(c.group)) groupOrder.set(c.group, groupOrder.size);
  categories.sort((a, b) => {
    const g = (groupOrder.get(a.group) ?? 0) - (groupOrder.get(b.group) ?? 0);
    return g !== 0 ? g : a.sort.localeCompare(b.sort);
  });

  const matrix: CategoryMatrix = {
    categories,
    locations: locs.map(l => ({ locationId: l.id, locationName: l.name })),
    salesByLocation,
    startDate,
    endDate,
    fetchedAt: Date.now(),
  };
  matrixCache.set(cKey, matrix);
  return matrix;
}

// ── Period-level history (per-store, last N periods + last week) ──────────────
// Each row: { label: "p1-26", "Brentwood": -0.5, "Chesapeake": 1.2, ... }
// Caller (route) supplies the ordered ranges so this module stays free of fiscal deps.

export type PeriodChartRow = Record<string, number | null | string>;

const periodHistoryCache = new Map<string, PeriodChartRow[]>();

export async function fetchPeriodHistory(
  ranges: { label: string; start: string; end: string }[]
): Promise<PeriodChartRow[]> {
  const cKey = ranges.map(r => r.label).join(",");
  if (periodHistoryCache.has(cKey)) return periodHistoryCache.get(cKey)!;

  const locs = getLocations();
  console.log(`[NC] fetchPeriodHistory: ${ranges.map(r => r.label).join(", ")}`);

  const rows = await Promise.all(ranges.map(async ({ label, start, end }) => {
    const raw = await Promise.all(locs.map(l => fetchLocationReport(l.id, start, end)));
    const row: PeriodChartRow = { label };
    locs.forEach((loc, i) => {
      const v = raw[i].variancePct;
      row[loc.name] = v != null ? Math.abs(v) : null;
    });
    return row;
  }));

  console.log(`[NC] fetchPeriodHistory done: ${rows.length} periods`);
  periodHistoryCache.set(cKey, rows);
  return rows;
}

export function invalidateNcCache(): void {
  reportCache.clear();
  historyCache.clear();
  periodHistoryCache.clear();
  locationReportCache.clear();
  detailCache.clear();
  matrixCache.clear();
}

// ── 12-month history ──────────────────────────────────────────────────────────

export type WeeklyPoint = {
  weekLabel: string;   // "4/27"
  weekStart: string;   // YYYY-MM-DD
  cogsPct: number | null;
  variancePct: number | null;
};

const historyCache = new Map<string, WeeklyPoint[]>();

async function fetchLocationWeekRaw(locationId: number, startDate: string, endDate: string) {
  const toMMDDYYYY = (iso: string) => { const [y,m,d] = iso.split("-"); return `${m}/${d}/${y}`; };
  try {
    const data = await ncFetch("/resource/actualvstheoretical/location/details", {
      extraCriteriaMap: { startDate: toMMDDYYYY(startDate), endDate: toMMDDYYYY(endDate), locationIdFilter: locationId, isConsolidated: false },
      pagingInfo: { page: 1, start: 0, limit: 1000000 },
    }) as Record<string, unknown>;
    const t = (data.totalSummaries as Record<string, unknown>[])?.[0];
    if (!t || Number(t.divisorValue) === 0) return null;
    return { actualCost: Number(t.actualCost), valueVariance: Number(t.valueVariance), divisorValue: Number(t.divisorValue) };
  } catch { return null; }
}

export async function fetchHistory(start?: string, end?: string): Promise<WeeklyPoint[]> {
  const cKey = `${start ?? ""}__${end ?? ""}`;
  if (historyCache.has(cKey)) return historyCache.get(cKey)!;

  const locs = getLocations();
  const allDates = await fetchAvailableDates(55);

  // allDates is newest-first; skip index 0 (current in-progress week)
  let periods = allDates.slice(1);
  if (start) periods = periods.filter(p => p.startDate >= start);
  if (end)   periods = periods.filter(p => p.endDate   <= end);
  periods = periods.slice(0, 52); // cap at 52 weeks

  console.log(`[NC] fetchHistory(${start ?? "*"},${end ?? "*"}): ${periods.length} periods, ${locs.length} locations`);
  if (periods.length) console.log(`[NC] fetchHistory: range ${periods[periods.length-1].startDate} → ${periods[0].endDate}`);

  const points: WeeklyPoint[] = [];
  const BATCH = 4;
  for (let i = 0; i < periods.length; i += BATCH) {
    const batch = periods.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(async p => {
      const raw = await Promise.all(locs.map(l => fetchLocationWeekRaw(l.id, p.startDate, p.endDate)));
      const valid = raw.filter(Boolean) as { actualCost: number; valueVariance: number; divisorValue: number }[];
      if (!valid.length) { console.log(`[NC] fetchHistory: week ${p.startDate} — 0/${locs.length} locs had data`); return null; }
      const sales    = valid.reduce((s, r) => s + r.divisorValue, 0);
      if (sales === 0) return null;
      const actual   = valid.reduce((s, r) => s + r.actualCost, 0);
      const variance = valid.reduce((s, r) => s + r.valueVariance, 0);
      const [, m, d] = p.startDate.split("-");
      return { weekLabel: `${parseInt(m)}/${parseInt(d)}`, weekStart: p.startDate, cogsPct: (actual / sales) * 100, variancePct: (variance / sales) * 100 } as WeeklyPoint;
    }));
    points.push(...batchResults.filter(Boolean) as WeeklyPoint[]);
  }

  console.log(`[NC] fetchHistory: ${points.length} valid points`);
  points.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  historyCache.set(cKey, points);
  return points;
}

// ── Available date ranges ─────────────────────────────────────────────────────

export type DateOption = {
  label: string;
  startDate: string;  // YYYY-MM-DD
  endDate: string;
};

async function doFetchAvailableDates(limit: number): Promise<Response> {
  const s = await getSession();
  return fetch(
    `${NC_BASE}/resource/actualvstheoretical/location/details/availabledates?_dc=${Date.now()}`,
    {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Cookie": s.cookies,
        "Origin": NC_BASE,
        "Referer": `${NC_BASE}/ncext/index.ct`,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ pagingInfo: { page: 1, start: 0, limit } }),
    }
  );
}

export async function fetchAvailableDates(limit = 25): Promise<DateOption[]> {
  let res = await doFetchAvailableDates(limit);

  if (res.status === 401 || res.status === 403) {
    console.log("[NC] availabledates got", res.status, "— invalidating session and retrying");
    invalidateSession();
    res = await doFetchAvailableDates(limit);
  }

  const text = await res.text().catch(() => "");
  console.log("[NC] availabledates status:", res.status, "body:", text.slice(0, 1000));

  if (!res.ok) throw new Error(`NC availabledates failed ${res.status}`);

  // Response is a plain array: [{ startDate: "MM/DD/YYYY HH:mm:ss", postDate: "MM/DD/YYYY HH:mm:ss" }, ...]
  const arr = JSON.parse(text) as Record<string, unknown>[];

  const toISO = (raw: string): string => {
    const datePart = raw.split(" ")[0]; // strip time
    const [m, d, y] = datePart.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  };

  const fmtLabel = (iso: string): string => {
    const [, m, d] = iso.split("-");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[Number(m) - 1]} ${Number(d)}`;
  };

  const rows: DateOption[] = arr
    .filter(r => r.startDate && r.postDate)
    .map(r => {
      const startDate = toISO(String(r.startDate));
      const endDate   = toISO(String(r.postDate));
      const label     = `${fmtLabel(startDate)} – ${fmtLabel(endDate)}`;
      return { label, startDate, endDate };
    });

  console.log("[NC] parsed date options:", rows.slice(0, 3));
  return rows;
}
