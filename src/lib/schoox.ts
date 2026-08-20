/**
 * Zaxby's University (Schoox) compliance stats.
 *
 * Schoox publishes no API key for this academy, so this is the same shape as
 * lib/netchef.ts: log in once over plain HTTP, hold the session cookie, then
 * call the endpoints the admin panel's own Angular front end calls. Nothing is
 * scraped out of HTML — `actions.php` and `dropdowns.php` both answer JSON.
 *
 * The two calls that matter, both POST, both form-encoded:
 *
 *   dropdowns.php                        the store list, as {id, name} pairs
 *   actions.php?action=getMainStats      the stat tiles for one filter scope
 *
 * `sDropDowns[sUnit]` is the store filter — 0 means every store, otherwise a
 * Schoox unit id. That is exactly the "Choose Store" control on the compliance
 * dashboard, so a per-store number here is the number a manager sees there.
 */

import { unstable_cache } from "next/cache";
import { STORE_LABELS } from "@/lib/surveyMeta";

const BASE = "https://app.schoox.com";

/**
 * The academy this dashboard reports on, from the admin panel URL. Only one
 * exists, so it is a constant rather than an environment variable — an env var
 * would imply it varies per deployment, and a wrong value would fail as a
 * silent empty report rather than as a missing-configuration error.
 */
const ACADEMY_ID = "1669014345";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

/** The unfiltered scope — Schoox's own "Choose Store" placeholder id. */
const ALL_STORES_UNIT = "0";

/**
 * How long a cached read stays good. Declared up here because both cache
 * wrappers below reference it at module scope, where a `const` further down
 * the file would still be in its temporal dead zone and throw on import.
 */
const REVALIDATE_SECONDS = 60 * 60;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ZuStats = {
  /** The "Average Compliance Rate" tile, 0–100. Null when Schoox omits it. */
  complianceRate: number | null;
  /** People in scope. */
  people: number;
  compliant: number;
  noncompliant: number;
  /** Compliant / people as Schoox computes it — the gauge, not the tile. */
  complianceScore: number | null;
  /** Average courses per person. */
  averageCourses: number;
  /** Total training time, pre-formatted by Schoox (e.g. "522:38:34"). */
  totalTime: string;
};

export type ZuStore = ZuStats & {
  /** Schoox's internal unit id, used as the filter value. */
  unitId: string;
  /** HRG store number parsed from the Schoox unit name, e.g. "28901". */
  storeId: string;
  /** HRG's name for the store, e.g. "Columbia". */
  label: string;
  /**
   * The store's compliance rate before rounding — the mean of its members'
   * rates, which is what Schoox rounds to produce `complianceRate`.
   *
   * Only used for rolling several stores into a subtotal. Weighting the
   * rounded integers instead drifts about a third of a point low, because
   * Schoox's per-store rounding is biased rather than symmetric, and that was
   * enough to print Tennessee as 88% when its people average 89%.
   */
  exactRate: number | null;
};

export type ZuReport = {
  /** Every store together — the unfiltered dashboard. */
  total: ZuStats;
  stores: ZuStore[];
  fetchedAt: number;
};

/** One person, as the compliance dashboard's own roster lists them. */
export type ZuMember = {
  id: string;
  name: string;
  /** 0–100. Null when Schoox omits it. */
  complianceRate: number | null;
  totalCourses: number;
  completions: number;
};

// ── Session ───────────────────────────────────────────────────────────────────

type Session = { cookies: string; expiresAt: number };

let session: Session | null = null;
const SESSION_TTL_MS = 30 * 60 * 1000;

function cookiesFromHeaders(headers: Headers): string[] {
  const getSetCookie = (headers as unknown as { getSetCookie?(): string[] }).getSetCookie;
  const raw = getSetCookie ? getSetCookie.call(headers) : [];
  return raw.map((c) => c.split(";")[0]).filter(Boolean);
}

/**
 * Later pairs win, so the cookies the login response sets replace the
 * pre-login ones of the same name. Schoox rotates `SchooxSession` on sign-in;
 * sending both values would send the anonymous one.
 */
function mergeCookies(existing: string, incoming: string[]): string {
  const jar = new Map<string, string>();
  for (const pair of [...existing.split("; ").filter(Boolean), ...incoming]) {
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function login(): Promise<Session> {
  const username = process.env.SCHOOX_USERNAME;
  const password = process.env.SCHOOX_PASSWORD;
  if (!username || !password) {
    throw new Error("SCHOOX_USERNAME / SCHOOX_PASSWORD not set");
  }

  // Step 1: GET the login page — sets SchooxSession and carries the CSRF token.
  const pageRes = await fetch(`${BASE}/login.php`, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
    redirect: "manual",
  });
  const initial = mergeCookies("", cookiesFromHeaders(pageRes.headers));
  const html = await pageRes.text();
  if (!initial.includes("SchooxSession")) {
    throw new Error("Schoox login: no SchooxSession on the login page — site may be down");
  }

  // Served empty today; read it anyway so this keeps working if Schoox starts
  // populating it, rather than failing the day they do.
  const csrfToken = html.match(/name="csrfToken"[^>]*value="([^"]*)"/)?.[1] ?? "";

  // Step 2: POST credentials against that same session.
  const form = new URLSearchParams({
    csrfToken,
    timeZone: "America/New_York",
    dateFormatClient: "",
    device_id: "",
    username,
    password,
    button: "Log in",
    redirect: "",
    who: "",
    i: "",
    a: "",
    ev: "",
  });

  // Note the path: the page is served from /login.php but its <form> targets
  // /login/index.php. Posting back to /login.php answers a cheerful 200 and
  // authenticates nothing, which then surfaces as a 403 on the first data call.
  const authRes = await fetch(`${BASE}/login/index.php`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: initial,
      Origin: BASE,
      Referer: `${BASE}/login.php`,
    },
    body: form.toString(),
    redirect: "manual",
  });

  const cookies = mergeCookies(initial, cookiesFromHeaders(authRes.headers));

  // Deliberately not asserting on the status: Schoox answers 200 whether the
  // credentials were accepted or not. The caller probes a real endpoint
  // instead, which is the check that actually matters — a session that can't
  // read the dashboard is no session at all, however the login page felt.
  return { cookies, expiresAt: Date.now() + SESSION_TTL_MS };
}

async function getSession(): Promise<string> {
  if (session && Date.now() < session.expiresAt) return session.cookies;
  session = await login();
  return session.cookies;
}

/** Drops the cached session so the next call signs in again. */
export function invalidateSchooxSession(): void {
  session = null;
}

/**
 * POSTs to the admin panel and parses JSON.
 *
 * An expired or rejected session doesn't 401 — Schoox answers 200 with the
 * login page's HTML. So a parse failure is retried once against a fresh login
 * before it is reported, which is what makes a stale cookie self-healing rather
 * than a five-minute outage on the tab.
 */
async function postJson<T>(path: string, body: URLSearchParams): Promise<T> {
  const attempt = async (cookies: string): Promise<T | null> => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*; q=0.01",
        Cookie: cookies,
        Origin: BASE,
        Referer: `${BASE}/academies/panel/dashboard2/compliance/employees.php?acadId=${ACADEMY_ID}`,
      },
      body: body.toString(),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  };

  const first = await attempt(await getSession());
  if (first !== null) return first;

  invalidateSchooxSession();
  const second = await attempt(await getSession());
  if (second !== null) return second;

  throw new Error(
    `Schoox returned a non-JSON response for ${path} — the sign-in was rejected. Check SCHOOX_USERNAME / SCHOOX_PASSWORD.`,
  );
}

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * The filter block every dashboard call carries. `sUnit` is the store; the rest
 * are the other three "Choose …" dropdowns, left unset. Copied from the panel's
 * own request so the numbers here match the numbers on screen — in particular
 * `acadMembersStatus: 4` (active members) and `complianceType: courses`, which
 * are what the Compliance-by-Course view sends.
 */
function filterParams(unitId: string): URLSearchParams {
  return new URLSearchParams({
    academyId: ACADEMY_ID,
    membersType: "3",
    "sDropDowns[sType]": "0",
    "sDropDowns[sAboveUnit]": "0",
    "sDropDowns[sUnit]": unitId,
    "sDropDowns[sJob]": "0",
  });
}

type GeneralStats = {
  employees?: number;
  hours?: string;
  courses?: number;
  compliant_rate?: string;
  completion_rate?: string;
  compliantUsersNr?: number;
  notCompliantUsersNr?: number;
  compliantProgress?: number;
};

function pct(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number.parseFloat(v.replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

function toStats(g: GeneralStats): ZuStats {
  return {
    // `compliant_rate` is the tile labelled "Average Compliance Rate".
    // `completion_rate` tracks it today but is a different measure, so it is a
    // fallback rather than an equal alternative.
    complianceRate: pct(g.compliant_rate) ?? pct(g.completion_rate),
    people: g.employees ?? 0,
    compliant: g.compliantUsersNr ?? 0,
    noncompliant: g.notCompliantUsersNr ?? 0,
    complianceScore: typeof g.compliantProgress === "number" ? g.compliantProgress : null,
    averageCourses: g.courses ?? 0,
    totalTime: g.hours ?? "",
  };
}

async function fetchStats(unitId: string): Promise<ZuStats> {
  const body = filterParams(unitId);
  body.set("search", "");
  body.set("order", "1");
  body.set("dueDate", "1");
  body.set("sorting", "name");
  body.set("sorting_type", "1");
  body.set("returnDropDowns", "false");
  body.set("from", "");
  body.set("to", "");
  body.set("all", "0");
  body.set("extId", "");
  body.set("acadMembersStatus", "4");
  body.set("complianceType", "courses");
  body.set("past", "false");
  body.set("limitedAccess", "");

  const json = await postJson<{ generalStats?: GeneralStats }>(
    "/academies/panel/organize/actions.php?action=getMainStats&page=dashboard",
    body,
  );
  return toStats(json.generalStats ?? {});
}

type MemberRow = {
  id?: string;
  name?: string;
  surname?: string;
  compliant_rate?: number;
  completion_rate?: number;
  total_courses?: number;
  total_completions?: number;
};

/**
 * The people behind one store's number.
 *
 * `getMain` answers the whole roster in a single response — it reports `all`
 * alongside `members` and the two matched for every store, the largest of which
 * is around fifty — so there is no paging to do. If a store ever outgrows that,
 * `all` is the count to compare against `members.length` to notice.
 */
async function fetchMembers(unitId: string): Promise<ZuMember[]> {
  const body = filterParams(unitId);
  body.set("search", "");
  body.set("order", "1");
  body.set("dueDate", "1");
  body.set("sorting", "name");
  body.set("sorting_type", "1");
  body.set("returnDropDowns", "false");
  body.set("from", "");
  body.set("to", "");
  body.set("all", "0");
  body.set("extId", "");
  body.set("acadMembersStatus", "4");
  body.set("complianceType", "courses");
  body.set("past", "false");
  body.set("limitedAccess", "");

  const json = await postJson<{ members?: MemberRow[] }>(
    "/academies/panel/organize/actions.php?action=getMain&page=dashboard",
    body,
  );

  const members = (json.members ?? []).map((m) => ({
    id: String(m.id ?? ""),
    name: [m.name, m.surname].filter(Boolean).join(" ").trim() || "(no name)",
    complianceRate:
      typeof m.compliant_rate === "number"
        ? m.compliant_rate
        : typeof m.completion_rate === "number"
          ? m.completion_rate
          : null,
    totalCourses: m.total_courses ?? 0,
    completions: m.total_completions ?? 0,
  }));

  // Lowest rate first: the point of opening a store is to see who is behind,
  // and Schoox's own alphabetical order buries them.
  members.sort((a, b) => (a.complianceRate ?? 101) - (b.complianceRate ?? 101));
  return members;
}

const cachedMembers = unstable_cache(fetchMembers, ["zu-members"], {
  revalidate: REVALIDATE_SECONDS,
  tags: ["zu-compliance"],
});

export function fetchZuMembers(unitId: string): Promise<ZuMember[]> {
  return cachedMembers(unitId);
}

type Unit = { id: string; name: string };

/**
 * The store list, read from Schoox rather than hardcoded.
 *
 * A hardcoded map would be one line shorter and would silently omit the next
 * store HRG opens. The names come back as "28901 - Columbia, TN"; only the
 * leading number is used, because Schoox's own city names disagree with the
 * ones every other tab shows (57001 is "Suffolk" there and "College" here).
 * STORE_LABELS is the arbiter so a store reads the same on ZU as on SMG.
 */
async function fetchUnits(): Promise<{ unitId: string; storeId: string; label: string }[]> {
  const body = filterParams(ALL_STORES_UNIT);
  body.set("page", "dashboard");
  body.set("init", "true");

  const json = await postJson<{ dropdowns?: { unit?: Unit[] } }>(
    "/academies/panel/organize/dropdowns.php",
    body,
  );

  return (json.dropdowns?.unit ?? [])
    .filter((u) => u.id !== ALL_STORES_UNIT)
    .map((u) => {
      const storeId = u.name.match(/^\s*(\d+)/)?.[1] ?? "";
      return { unitId: u.id, storeId, label: STORE_LABELS[storeId] ?? u.name };
    });
}

// ── Report ────────────────────────────────────────────────────────────────────

/**
 * One request per store plus one for the total, capped at four in flight.
 *
 * Schoox recomputes these server-side and a store takes a second or two, so
 * firing all thirteen at once is both rude and slower in practice than a small
 * pipeline. The result is cached (below), so this runs once per revalidation
 * window rather than once per viewer.
 */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function buildReport(): Promise<ZuReport> {
  const [total, units] = await Promise.all([fetchStats(ALL_STORES_UNIT), fetchUnits()]);

  // The roster is fetched alongside the stats so each store carries an
  // unrounded rate for subtotalling. It costs a second call per store on a
  // build that already runs hourly, and it warms the same cache the expanded
  // rows read, so opening a store row is usually instant.
  const stores = await mapLimited(units, 4, async (u) => {
    const [stats, members] = await Promise.all([
      fetchStats(u.unitId),
      fetchZuMembers(u.unitId).catch(() => [] as ZuMember[]),
    ]);
    const rated = members.filter((m) => m.complianceRate !== null);
    return {
      ...u,
      ...stats,
      exactRate: rated.length
        ? rated.reduce((t, m) => t + (m.complianceRate ?? 0), 0) / rated.length
        : null,
    };
  });

  // Sorted by the label every other tab uses, so the ZU table reads in the same
  // order as SMG and Food Cost rather than in Schoox's store-number order.
  stores.sort((a, b) => a.label.localeCompare(b.label));

  return { total, stores, fetchedAt: Date.now() };
}

/**
 * Wrapped in `unstable_cache` for the same reason lib/par.ts is: a module-level
 * cache doesn't survive between requests on Vercel, where each invocation may
 * land on a different instance. Compliance moves as people finish courses, so
 * an hour-old number is the right trade against thirteen upstream requests.
 */
const cachedReport = unstable_cache(buildReport, ["zu-compliance"], {
  revalidate: REVALIDATE_SECONDS,
  tags: ["zu-compliance"],
});

export function fetchZuReport(): Promise<ZuReport> {
  return cachedReport();
}

/** Bypasses the cache — for the tab's Refresh control. */
export function fetchZuReportFresh(): Promise<ZuReport> {
  invalidateSchooxSession();
  return buildReport();
}

// ── Certification tests ───────────────────────────────────────────────────────

/**
 * The four certification tests the ZU tab reports on, in the order they sit on
 * the career path: trainer, shift leader, assistant manager, general manager.
 *
 * Hardcoded rather than discovered because this is an editorial choice, not a
 * complete list — Zaxby's publishes sixty-eight compliance courses and these
 * are the four HRG manages against. The ids come from the academy's course
 * catalogue; `scripts/schoox-courses-explore.mjs` prints the full list with ids
 * if one is ever renamed or replaced.
 */
export const ZU_TESTS = [
  { id: "806609", label: "Train-the-Trainer", short: "Train-the-Trainer" },
  { id: "7041306", label: "Shift Leader Performance Assessment", short: "Shift Leader" },
  { id: "4966964", label: "Assistant Manager Readiness Check", short: "Assistant Mgr" },
  { id: "9116252", label: "General Manager Certification Test", short: "General Mgr" },
] as const;

/** One person's result on each test. Null means not assigned that test. */
export type ZuTestPerson = {
  id: string;
  name: string;
  /** Test id → progress 0–100. */
  results: Record<string, number | null>;
};

export type ZuTestStore = {
  unitId: string;
  storeId: string;
  label: string;
  /** Test id → the store's completion rate for it, 0–100. */
  rates: Record<string, number | null>;
  people: ZuTestPerson[];
};

/**
 * The report carries the test list it was built from. The ZU tab is a client
 * component and cannot import ZU_TESTS directly — this module reaches for
 * next/cache and holds a session at module scope, neither of which belongs in a
 * browser bundle — so shipping the labels with the data keeps one definition
 * instead of two that can drift apart.
 */
export type ZuTestReport = {
  tests: { id: string; label: string; short: string }[];
  stores: ZuTestStore[];
  fetchedAt: number;
};

type CourseMember = {
  id?: number | string;
  name?: string;
  surname?: string;
  progress?: string | number;
};

/** Schoox returns at most this many roster rows per request. */
const COURSE_PAGE_SIZE = 50;

/**
 * One test, for one store: the store's completion rate plus every assigned
 * person's progress.
 *
 * Note where `courseId` goes — the query string, beside `action`, not the body.
 * In the body it is ignored and the response covers the whole academy, which is
 * how this endpoint hid through forty-odd name guesses that all posted it as a
 * form field.
 *
 * `all` is the row offset, despite the name. It reads like a boolean asking for
 * everything, and sending "1" for that reason quietly skipped the first person
 * of every roster — alphabetically first, so always a real person, and the
 * store's percentage never moved because Schoox computes `general` over the
 * whole roster rather than the page it hands back. Offsets are the only paging
 * that works here: start, length and limit are all accepted and all ignored.
 */
async function fetchTestForUnit(
  courseId: string,
  unitId: string,
): Promise<{ rate: number | null; members: CourseMember[] }> {
  const page = (offset: number) => {
    const body = filterParams(unitId);
    body.set("search", "");
    body.set("order", "1");
    body.set("coupon_id", "0");
    body.set("dueDate", "1");
    body.set("sorting", "name");
    body.set("sorting_type", "1");
    body.set("returnDropDowns", "false");
    body.set("all", String(offset));
    body.set("customFields", "");

    return postJson<{
      general?: { completion_rates?: number; compliant_rate?: number };
      members?: CourseMember[];
    }>(
      `/academies/panel/organize/actions.php?action=getCourse&courseId=${courseId}` +
        `&academyId=${ACADEMY_ID}&membersType=3&page=dashboard`,
      body,
    );
  };

  const members: CourseMember[] = [];
  let general: { completion_rates?: number; compliant_rate?: number } = {};

  // Every HRG store sits well inside one page today, so this is a single
  // request in practice; the loop is what keeps it correct if a roster grows.
  for (let offset = 0, guard = 0; guard < 40; guard++) {
    const json = await page(offset);
    if (offset === 0) general = json.general ?? {};

    const rows = json.members ?? [];
    members.push(...rows);
    if (rows.length < COURSE_PAGE_SIZE) break;
    offset += rows.length;
  }

  const rate =
    typeof general.completion_rates === "number"
      ? general.completion_rates
      : typeof general.compliant_rate === "number"
        ? general.compliant_rate
        : null;

  return { rate, members };
}

function progressOf(m: CourseMember): number | null {
  const n = typeof m.progress === "number" ? m.progress : Number.parseFloat(String(m.progress));
  return Number.isFinite(n) ? n : null;
}

/**
 * The whole grid: every store against the four tests, with the people behind
 * each store's numbers.
 *
 * Four tests across twelve stores is forty-eight requests, so it is built once
 * per revalidation window and served whole. The people are bundled rather than
 * fetched per expanded row because they arrive in the same responses the rates
 * come from — asking for them separately would mean making these calls twice.
 */
async function buildTestReport(): Promise<ZuTestReport> {
  const units = await fetchUnits();

  const stores = await mapLimited(units, 4, async (u) => {
    const rates: Record<string, number | null> = {};
    const byPerson = new Map<string, ZuTestPerson>();

    for (const test of ZU_TESTS) {
      const { rate, members } = await fetchTestForUnit(test.id, u.unitId);
      rates[test.id] = rate;

      for (const m of members) {
        const id = String(m.id ?? "");
        if (!id) continue;
        let person = byPerson.get(id);
        if (!person) {
          person = {
            id,
            name: [m.name, m.surname].filter(Boolean).join(" ").trim() || "(no name)",
            // Absent stays absent: a test a person was never assigned reads as
            // "—", not as a zero they failed to earn.
            results: Object.fromEntries(ZU_TESTS.map((t) => [t.id, null])),
          };
          byPerson.set(id, person);
        }
        person.results[test.id] = progressOf(m);
      }
    }

    const people = [...byPerson.values()].sort((a, b) => {
      // Least finished first, on the tests each person actually holds — the
      // reason to open a store is to find who still owes something.
      const done = (p: ZuTestPerson) => {
        const held = Object.values(p.results).filter((v): v is number => v !== null);
        return held.length ? held.reduce((t, v) => t + v, 0) / held.length : 101;
      };
      return done(a) - done(b) || a.name.localeCompare(b.name);
    });

    return { ...u, rates, people };
  });

  stores.sort((a, b) => a.label.localeCompare(b.label));
  return { tests: ZU_TESTS.map((t) => ({ ...t })), stores, fetchedAt: Date.now() };
}

const cachedTestReport = unstable_cache(buildTestReport, ["zu-tests"], {
  revalidate: REVALIDATE_SECONDS,
  tags: ["zu-compliance"],
});

export function fetchZuTestReport(): Promise<ZuTestReport> {
  return cachedTestReport();
}
