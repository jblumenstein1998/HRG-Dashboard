/**
 * Workstream — recruiting and HR system of record.
 *
 * Workstream is where a person becomes an employee: they apply against a
 * *position*, get hired, are assigned a *job* at a *location*, and carry an
 * *earning rate*. It is the only system that knows a person's hire date and
 * termination date, which makes it the only possible source for retention.
 *
 * ── What this API is not ─────────────────────────────────────────────────────
 *
 * Workstream sells itself as payroll, but the public API exposes **no payroll
 * runs** — no paychecks, no gross or net pay, no hours, no timesheets, no pay
 * period register. What it exposes that is payroll-shaped is:
 *
 *   earning_rates      the rate of record, per job assignment, with an
 *                      effective_date, so rate history is reconstructable
 *   direct_deposits    bank routing/account, per employee
 *   federal_tax        W-4 setup
 *   state_tax          state withholding setup
 *
 * Hours are PAR's, not Workstream's — lib/staffing.ts already computes regular
 * and overtime minutes from PAR shifts. So labour *cost* stays a PAR question;
 * Workstream contributes the rate of record to check PAR's `PayRate` against,
 * and the job title that PAR only knows as an unlabelled job id.
 *
 * The last three embeds above are personally identifying and Workstream rate
 * limits them harder than everything else. Nothing in this module requests
 * them, and nothing should without a reason that survives being written down.
 *
 * ── Authentication ───────────────────────────────────────────────────────────
 *
 * Two supported paths, because they become available at different times:
 *
 *   WORKSTREAM_ACCESS_TOKEN                a token minted by hand in the
 *                                          Workstream dashboard. Valid seven
 *                                          days, so this is for getting started
 *                                          and for local scripts, not for the
 *                                          deployed app — it would expire in
 *                                          production every week.
 *
 *   WORKSTREAM_CLIENT_ID / _CLIENT_SECRET  OAuth2 client_credentials against
 *                                          POST /tokens. Self-renewing, so this
 *                                          is the production path. Requires
 *                                          Workstream support to enable the
 *                                          "OAuth App" module on the company.
 *
 * The client-credentials path wins when both are set. Tokens are cached in
 * module memory only — deliberately not in Postgres, to keep this module
 * DB-free like par.ts and netchef.ts. A cold serverless instance mints one
 * token and then reuses it for the life of the instance, which is a single
 * extra POST per cold start rather than per request.
 */

const WS_BASE = "https://public-api.workstream.us";

/**
 * Cut a token's advertised lifetime short by this much before treating it as
 * expired. A token that dies mid-flight surfaces as a 401 on a real read, and
 * a five-minute skew is cheaper than teaching every caller to retry.
 */
const TOKEN_SKEW_MS = 5 * 60 * 1000;

/** Fallback lifetime when /tokens omits expires_in. Docs say seven days. */
const TOKEN_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Workstream's own ceiling on `per_page`. */
const MAX_PER_PAGE = 100;

/**
 * Hard stop on pagination. Twelve stores of Zaxby's is a few hundred active
 * employees and a few thousand lifetime, so 200 pages of 100 is far past any
 * legitimate result. It exists so a filter that silently stops being applied
 * fails as an error rather than as a request loop against a metered vendor.
 */
const MAX_PAGES = 200;

// ── Rate limiting ────────────────────────────────────────────────────────────

/**
 * Workstream publishes no concurrency number, only a 429 with Retry-After.
 * Three is conservative: the reads here are paged, so depth matters more than
 * width, and being throttled mid-backfill costs more than being slow.
 */
class Semaphore {
  private permits: number;
  private waiters: (() => void)[] = [];
  constructor(n: number) { this.permits = n; }
  acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return Promise.resolve(); }
    return new Promise((r) => this.waiters.push(r));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next(); else this.permits++;
  }
}
const sem = new Semaphore(3);

// ── Auth ─────────────────────────────────────────────────────────────────────

type CachedToken = { token: string; expiresAt: number };
let cached: CachedToken | null = null;
/** In-flight mint, so a cold instance answering N requests mints once. */
let minting: Promise<CachedToken> | null = null;

async function mintToken(): Promise<CachedToken> {
  const clientId = process.env.WORKSTREAM_CLIENT_ID;
  const clientSecret = process.env.WORKSTREAM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Workstream: set WORKSTREAM_CLIENT_ID and WORKSTREAM_CLIENT_SECRET, or WORKSTREAM_ACCESS_TOKEN",
    );
  }

  const res = await fetch(`${WS_BASE}/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      name: "HRG Dashboard",
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Workstream token mint failed: ${res.status} ${body.slice(0, 300)}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error(`Workstream token mint returned non-JSON: ${body.slice(0, 200)}`);
  }

  // The docs show `access_token`; the legacy docs show the same field nested
  // under a data envelope. Accept either rather than break on a shape we have
  // not yet seen in production.
  const envelope = (parsed.data ?? parsed) as Record<string, unknown>;
  const token = typeof envelope.access_token === "string" ? envelope.access_token : null;
  if (!token) {
    throw new Error(`Workstream token mint returned no access_token: ${body.slice(0, 200)}`);
  }

  const expiresIn = Number(envelope.expires_in);
  const ttl = Number.isFinite(expiresIn) && expiresIn > 0
    ? expiresIn * 1000
    : TOKEN_DEFAULT_TTL_MS;

  return { token, expiresAt: Date.now() + ttl - TOKEN_SKEW_MS };
}

async function accessToken(): Promise<string> {
  const clientId = process.env.WORKSTREAM_CLIENT_ID;
  const clientSecret = process.env.WORKSTREAM_CLIENT_SECRET;
  const staticToken = process.env.WORKSTREAM_ACCESS_TOKEN;

  // A hand-minted token cannot be renewed from here, so it is only used when
  // there is no client-credentials pair to renew with.
  if (!(clientId && clientSecret) && staticToken) return staticToken;

  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if (!minting) {
    minting = mintToken().finally(() => { minting = null; });
  }
  cached = await minting;
  return cached.token;
}

/** Drops the cached token so the next call mints a fresh one. */
function invalidateToken(): void {
  cached = null;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

export type WsQuery = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query: WsQuery = {}): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, WS_BASE);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * One authenticated GET, with the two retries this vendor actually needs.
 *
 * A 429 is retried on its own Retry-After — the docs promise the header, but a
 * missing one falls back to exponential backoff rather than hammering. A 401 is
 * retried exactly once after dropping the cached token, which covers the case
 * where a token expired between the skew check and the request landing.
 */
export async function wsFetch<T>(path: string, query: WsQuery = {}): Promise<T> {
  const url = buildUrl(path, query);

  await sem.acquire();
  try {
    let retriedAuth = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = await accessToken();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(30_000, 1000 * 2 ** attempt);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (res.status === 401 && !retriedAuth) {
        retriedAuth = true;
        invalidateToken();
        continue;
      }

      const body = await res.text();
      if (!res.ok) {
        throw new Error(`Workstream ${res.status} on ${path}: ${body.slice(0, 300)}`);
      }
      try {
        return JSON.parse(body) as T;
      } catch {
        throw new Error(`Workstream returned non-JSON on ${path}: ${body.slice(0, 200)}`);
      }
    }
    throw new Error(`Workstream: gave up on ${path} after repeated 429s`);
  } finally {
    sem.release();
  }
}

/**
 * Unwraps a list response.
 *
 * The v2 docs describe a paginated list but do not pin the envelope, and the v1
 * endpoints return a bare array. Rather than guess once and be wrong for a
 * whole feature, accept a bare array or any of the usual single-key envelopes.
 * scripts/workstream-discover.mjs prints the real shape — once it is confirmed
 * against the live account this can collapse to the one true case.
 */
function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["data", "results", "items", "records", "employees", "positions", "locations", "departments"]) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
  }
  return [];
}

/**
 * Every page of a paginated endpoint.
 *
 * Stops on a short page rather than trusting a total count, because the v1
 * endpoints report no count at all and a wrong one is indistinguishable from a
 * filter that stopped applying. `MAX_PAGES` is the backstop.
 */
export async function wsPaged<T>(path: string, query: WsQuery = {}): Promise<T[]> {
  const perPage = Math.min(MAX_PER_PAGE, Number(query.per_page ?? MAX_PER_PAGE));
  const out: T[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const payload = await wsFetch<unknown>(path, { ...query, page, per_page: perPage });
    const rows = unwrapList<T>(payload);
    out.push(...rows);
    if (rows.length < perPage) return out;
  }
  throw new Error(`Workstream: ${path} exceeded ${MAX_PAGES} pages — check the filters`);
}

// ── Types ────────────────────────────────────────────────────────────────────

/** A pay rate of record. `amount` is a string in the API; parse at the edge. */
export type WsEarningRate = {
  id: string;
  name: string | null;
  /** e.g. "hourly", "salary". */
  earning_type: string | null;
  amount: string | number | null;
  /** e.g. "hour", "year". */
  period: string | null;
  status: string | null;
  effective_date: string | null;
};

export type WsJobAssignment = {
  id: string;
  job_id: string | null;
  /** Exactly one assignment per employee is the primary one. */
  primary: boolean;
  status: string | null;
  /** The position name a manager would recognise, e.g. "Cook", "Shift Leader". */
  title: string | null;
  location_id: string | null;
  department_id: string | null;
  managerial: boolean | null;
  soc_code: string | null;
  earning_rates: WsEarningRate[] | null;
};

export type WsNamedRef = { uuid: string; name: string | null };

/** Workstream's employment lifecycle, in order. */
export type WsEmployeeStatus = "hired" | "onboarding" | "active" | "offboarded";

export type WsEmployee = {
  uuid: string;
  first_name: string | null;
  middle_initial: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: WsEmployeeStatus | string;
  /** Dates are YYYY-MM-DD. */
  applied_date: string | null;
  hired_date: string | null;
  onboard_date: string | null;
  start_date: string | null;
  termination_date: string | null;
  termination_note: string | null;
  location: WsNamedRef | null;
  department: WsNamedRef | null;
  job_assignments: WsJobAssignment[] | null;
};

export type WsLocation = {
  uuid: string;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
};

export type WsDepartment = { uuid: string; name: string | null };

/** A job requisition — the thing applicants apply *to*, not a person's job. */
export type WsPosition = {
  uuid: string;
  title: string | null;
  status: string | null;
  access: string | null;
  location_name: string | null;
  created_at: string | null;
};

export type WsApplicant = {
  uuid: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  position_uuid: string | null;
  position_title: string | null;
  location_name: string | null;
  applied_at: string | null;
  hired_at: string | null;
};

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The embeds every employee read needs and none it doesn't.
 *
 * `job_assignments` carries the title and the earning rates, which is the whole
 * reason for using v2 over v1. `location` and `department` come back as bare
 * uuids without them. The tax and bank embeds are deliberately absent — see the
 * header.
 */
export const EMPLOYEE_EMBED = "job_assignments,location,department";

export type ListEmployeesOptions = {
  /** Any of "hired", "onboarding", "active", "offboarded". Omit for all. */
  status?: WsEmployeeStatus[];
  /** Inclusive lower bound on hire date, YYYY-MM-DD. */
  hiredOnOrAfter?: string;
  /** Inclusive upper bound on hire date, YYYY-MM-DD. */
  hiredOnOrBefore?: string;
  /** Inclusive lower bound on termination date, YYYY-MM-DD. */
  terminatedOnOrAfter?: string;
  terminatedOnOrBefore?: string;
  embed?: string;
};

/**
 * Every employee matching the filters, across all pages.
 *
 * The status filter and the date filters compose the way you would hope:
 * asking for `offboarded` with a termination window is exactly "who left during
 * this period", which is the numerator of turnover.
 */
export async function listEmployees(opts: ListEmployeesOptions = {}): Promise<WsEmployee[]> {
  return wsPaged<WsEmployee>("/v2/employees", {
    embed: opts.embed ?? EMPLOYEE_EMBED,
    status: opts.status?.length ? opts.status.join(",") : undefined,
    "hired_date.gte": opts.hiredOnOrAfter,
    "hired_date.lte": opts.hiredOnOrBefore,
    "termination_date.gte": opts.terminatedOnOrAfter,
    "termination_date.lte": opts.terminatedOnOrBefore,
  });
}

export async function getEmployee(uuid: string, embed = EMPLOYEE_EMBED): Promise<WsEmployee> {
  const payload = await wsFetch<unknown>(`/v2/employees/${uuid}`, { embed });
  const obj = payload as Record<string, unknown>;
  return ((obj?.data ?? obj) as WsEmployee);
}

export async function listLocations(): Promise<WsLocation[]> {
  return wsPaged<WsLocation>("/locations");
}

export async function listDepartments(): Promise<WsDepartment[]> {
  return wsPaged<WsDepartment>("/departments");
}

export type ListPositionsOptions = {
  /** "pending" | "published" | "closed" | "deleted" | "cache". */
  status?: string;
  title?: string;
  locationName?: string;
};

export async function listPositions(opts: ListPositionsOptions = {}): Promise<WsPosition[]> {
  return wsPaged<WsPosition>("/positions", {
    status: opts.status,
    title: opts.title,
    location_name: opts.locationName,
  });
}

export type ListApplicantsOptions = {
  status?: string;
  positionUuid?: string;
  locationName?: string;
  /** Hire-date window, YYYY-MM-DD — the recruiting funnel's conversion end. */
  hiredOnOrAfter?: string;
  hiredOnOrBefore?: string;
};

export async function listApplicants(opts: ListApplicantsOptions = {}): Promise<WsApplicant[]> {
  return wsPaged<WsApplicant>("/position_applications", {
    status: opts.status,
    position_uuid: opts.positionUuid,
    location_name: opts.locationName,
    "hired_at.gte": opts.hiredOnOrAfter,
    "hired_at.lte": opts.hiredOnOrBefore,
  });
}

// ── Derived helpers ──────────────────────────────────────────────────────────

/** First and last name, or null when Workstream has neither. */
export function employeeName(e: WsEmployee): string | null {
  const full = [e.first_name, e.last_name].filter(Boolean).join(" ").trim();
  return full || null;
}

/**
 * The assignment that describes what someone actually does.
 *
 * Workstream allows several — a Cook who also runs shifts — and flags one as
 * primary. Falls back to the first active assignment, then to the first of any,
 * so a person with a mis-flagged record still reports a title rather than a
 * blank cell.
 */
export function primaryAssignment(e: WsEmployee): WsJobAssignment | null {
  const all = e.job_assignments ?? [];
  return all.find((a) => a.primary)
    ?? all.find((a) => a.status === "active")
    ?? all[0]
    ?? null;
}

/**
 * Hourly rate of record, in dollars.
 *
 * Only rates whose period is hourly are returned — a salaried assignment has an
 * annual `amount`, and dividing it by an assumed 2080 hours would invent a
 * number nobody agreed to. Callers that need salaried people should read
 * `primaryAssignment` themselves and say so on screen, the way staffing.ts
 * already reports salaried headcount separately from its wage run rate.
 *
 * Where several rates are effective, the latest effective_date on or before
 * `asOf` wins, which is what makes rate history reconstructable.
 */
export function hourlyRate(e: WsEmployee, asOf?: string): number | null {
  const rates = primaryAssignment(e)?.earning_rates ?? [];
  const cutoff = asOf ?? "9999-12-31";

  const hourly = rates
    .filter((r) => (r.period ?? "").toLowerCase() === "hour" || (r.earning_type ?? "").toLowerCase() === "hourly")
    .filter((r) => !r.effective_date || r.effective_date <= cutoff)
    .sort((a, b) => (a.effective_date ?? "").localeCompare(b.effective_date ?? ""));

  const latest = hourly[hourly.length - 1];
  if (!latest) return null;
  const amount = typeof latest.amount === "number" ? latest.amount : Number.parseFloat(latest.amount ?? "");
  return Number.isFinite(amount) ? amount : null;
}

/**
 * Whether someone was on the books on a given date.
 *
 * Written as a date test rather than reading `status`, because `status` is only
 * ever the present tense. Retention is a question about the past, and the only
 * honest way to answer "how many people did we have in P3" is to ask each
 * record whether its own start/termination window contains that date.
 */
export function employedOn(e: WsEmployee, isoDate: string): boolean {
  const start = e.start_date ?? e.hired_date;
  if (!start || start > isoDate) return false;
  if (e.termination_date && e.termination_date <= isoDate) return false;
  return true;
}
