/**
 * Workstream — recruiting and HR system of record.
 *
 * Workstream is where a person becomes an employee: they apply against a
 * *position*, get hired, are assigned a *job* at a *location*, and carry an
 * *earning rate*. It is the only system that knows a person's hire date and
 * termination date, which makes it the only possible source for retention.
 *
 * ── The embed syntax, which is the whole ballgame ────────────────────────────
 *
 * Embedded resources must be wrapped in **parentheses**:
 *
 *     ?embed=(job_assignments,company,location,department)
 *
 * Without them the parameter is accepted and silently ignored, and the employee
 * comes back as twelve flat fields — no location, no title, no pay. That looks
 * exactly like an API that does not have the data, and it cost a day of
 * concluding so. A bare comma list, repeated `embed` params, `include` and
 * `expand` all fail the same quiet way; `embed[]` is at least an honest 400.
 *
 * With the parentheses the account returns everything documented: the job
 * assignment with its title and location, and the earning rates behind it.
 *
 * ── Never ask for `information` ───────────────────────────────────────────────
 *
 * The `information` embed returns **social security numbers in plaintext**,
 * along with date of birth, ethnicity, gender and marital status. `address`,
 * `emergency_contact`, `eligibility`, `direct_deposits`, `federal_tax` and
 * `state_tax` are the same class of thing.
 *
 * None of them appear in EMPLOYEE_EMBED and none should. This dashboard shows
 * who is on shift and what a store costs; there is no screen in it that an SSN
 * belongs on, and data you never fetch is data you cannot leak, log or cache.
 * If a future feature seems to need one of these, that is a conversation to
 * have out loud, not a string to extend.
 *
 * ── What is genuinely not here ───────────────────────────────────────────────
 *
 * No payroll runs — no paychecks, no gross or net pay, no hours, no timesheets,
 * no pay period register. Hours are PAR's, and lib/staffing.ts computes them.
 * So Workstream gives the rate of record and the job title; PAR gives the clock
 * and what each shift was actually costed at, and where the two rates disagree
 * somebody wants to know.
 *
 * Measured against the live account on 2026-09-04: 1,224 employees, 868 with a
 * job assignment, 896 assignments carrying a location id. Titles are Crew,
 * Cook, Cashier, Shift Lead, Crew Trainer, Director, AGM, General Manager,
 * District Manager and Director of Operations. A full paged fetch with these
 * embeds takes about 35 seconds, which is why workstreamRoster.ts caches it for
 * an hour rather than reading it per request.
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

/**
 * The permissions this app asks for, and deliberately no more.
 *
 * `POST /tokens` requires a scope list, and the token a Super Admin creates in
 * the dashboard carries whatever was ticked there — so these two have to agree
 * or a read fails with a 403 that looks like a bug in the endpoint rather than
 * a missing permission.
 *
 * Workstream also offers company_users, company_roles, team_members and
 * imported_employee_infos. None of them are asked for. Nothing here reads a
 * user register, and a token that could is a token that will eventually be
 * used to.
 */
const SCOPES = ["employees", "locations", "departments", "positions"] as const;

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
      scopes: SCOPES,
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
 * Pagination as the API reports it: `{ data: [...], meta: {...} }`.
 *
 * Confirmed against the live account — /locations, /departments, /positions,
 * /v2/employees and /team_members all use it. `imported_employee_infos` is the
 * one exception and returns its own key, which is why the bare-array and
 * named-key fallbacks survive rather than collapsing to `data` alone.
 */
type WsMeta = {
  total_count?: number;
  current_page?: number;
  next_page?: number | null;
  total_pages?: number;
};

function unwrapList<T>(payload: unknown): { rows: T[]; meta: WsMeta | null } {
  if (Array.isArray(payload)) return { rows: payload as T[], meta: null };
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const meta = (obj.meta ?? null) as WsMeta | null;
    if (Array.isArray(obj.data)) return { rows: obj.data as T[], meta };
    for (const key of ["results", "items", "records", "employees", "positions", "locations", "departments", "team_members", "position_applications", "imported_employee_infos"]) {
      if (Array.isArray(obj[key])) {
        // These endpoints put the counts at the top level rather than in meta.
        return { rows: obj[key] as T[], meta: (meta ?? obj) as WsMeta };
      }
    }
  }
  return { rows: [], meta: null };
}

/**
 * Every page of a paginated endpoint.
 *
 * `meta.next_page` is authoritative where it appears — it is the only thing
 * that distinguishes "that was the last page" from "the page came back short
 * for some other reason". Falls back to the short-page rule for the endpoints
 * that report no meta at all, with `MAX_PAGES` as the backstop either way.
 */
export async function wsPaged<T>(path: string, query: WsQuery = {}): Promise<T[]> {
  const perPage = Math.min(MAX_PER_PAGE, Number(query.per_page ?? MAX_PER_PAGE));
  const out: T[] = [];

  let page = 1;
  for (let i = 0; i < MAX_PAGES; i++) {
    const payload = await wsFetch<unknown>(path, { ...query, page, per_page: perPage });
    const { rows, meta } = unwrapList<T>(payload);
    out.push(...rows);

    if (meta && meta.next_page !== undefined) {
      if (meta.next_page === null) return out;
      page = meta.next_page;
      continue;
    }
    if (rows.length < perPage) return out;
    page += 1;
  }
  throw new Error(`Workstream: ${path} exceeded ${MAX_PAGES} pages — check the filters`);
}

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * One rate of record. A person has several at once — not a history.
 *
 * A Cashier comes back with `hourly` 13.50 *and* `overtime` 20.25, plus rows
 * for `pto`, `sick`, `paid_holiday` at their own amounts. So "their pay rate"
 * means the row whose `earning_type` is `hourly`, and summing or averaging
 * these would invent a number nobody is paid. Seen in the wild: hourly,
 * overtime, double_overtime, pto, sick, paid_holiday, salaried,
 * rest_and_recovery, non_productive.
 *
 * `amount` is a number here, unlike most money in this API. `period` is
 * "hourly" or "annually" — not "hour"/"year" as the docs imply.
 *
 * `effective_date` is null on every row on this account, so rate history is
 * *not* reconstructable from these; `latest_earning_snapshot` is where dated
 * periods live if that is ever needed.
 */
export type WsEarningRate = {
  id: string;
  name: string | null;
  earning_type: string | null;
  amount: number | string | null;
  /** "hourly" | "annually". */
  period: string | null;
  status: string | null;
  /** Payroll's own code, e.g. "hourly", "overtime". */
  external_earning_code_id: string | null;
  effective_date: string | null;
};

/** A dated snapshot of what someone earned. Not read today; see WsEarningRate. */
export type WsEarningSnapshot = {
  id: string;
  version: number | null;
  created_at: string | null;
  periods: {
    id: string;
    start_date: string | null;
    end_date: string | null;
    earning_rates_data: WsEarningRate[] | null;
  }[] | null;
};

/**
 * A job at a location, with the pay behind it. The thing this whole module is
 * for.
 *
 * `location_id` is a Workstream location uuid and joins straight to
 * BONUS_STORES.workstreamLocationUuid — which is what makes per-store possible.
 * `working_location.core_location_id` says the same thing and is used as a
 * fallback.
 *
 * `primary` and `status` disagree more often than you would like: people carry
 * inactive assignments from a previous store or role. See primaryAssignment.
 */
export type WsJobAssignment = {
  id: string;
  job_id: string | null;
  primary: boolean;
  /** "active" | "inactive". */
  status: string | null;
  /** "Crew", "Cook", "Cashier", "Shift Lead", "General Manager"… */
  title: string | null;
  location_id: string | null;
  department_id: string | null;
  managerial: boolean | null;
  soc_code: string | null;
  created_at: string | null;
  working_location: { id: string; core_location_id: string | null } | null;
  manage_locations: unknown[] | null;
  earning_rates: WsEarningRate[] | null;
  latest_earning_snapshot: WsEarningSnapshot | null;
};

export type WsNamedRef = { uuid: string; name: string | null };

/** Workstream's employment lifecycle, in order. */
export type WsEmployeeStatus = "hired" | "onboarding" | "active" | "offboarded";

export type WsEmployee = {
  uuid: string;
  first_name: string | null;
  middle_initial: string | null;
  last_name: string | null;
  /**
   * What they go by. Often the shorter form of the legal first name, and
   * occasionally the *only* form anyone at the store would recognise — so it is
   * worth showing a reviewer, though never worth matching on unaided.
   */
  preferred_name: string | null;
  /** Absent from the list endpoint on the HRG account. See the header. */
  email?: string | null;
  phone?: string | null;
  status: WsEmployeeStatus | string;
  /** Dates are YYYY-MM-DD. */
  applied_date: string | null;
  hired_date: string | null;
  onboard_date: string | null;
  start_date: string | null;
  termination_date: string | null;
  termination_note: string | null;
  /**
   * All present only when asked for with EMPLOYEE_EMBED — and the top-level
   * `location` is frequently null even then, because the location that matters
   * is the one on the job assignment. Read it through employeeLocationId().
   */
  company?: WsNamedRef | null;
  location?: WsNamedRef | null;
  department?: WsNamedRef | null;
  job_assignments?: WsJobAssignment[] | null;
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

/**
 * A job requisition — the thing applicants apply *to*, not a person's job.
 *
 * `pay_amount` is advertising copy, not a rate: "Starting at $14.00", "Up to
 * $20.00". It is a string because that is what it is, and it must never be
 * parsed into a number and shown as somebody's pay.
 *
 * There is no location field. The store appears only as a slug inside
 * `job_url` (".../zaxbys/springfield-26019/..."), which is not something to
 * build a store join on.
 */
export type WsPosition = {
  uuid: string;
  digest_key: string | null;
  title: string | null;
  overview: string | null;
  status: string | null;
  /** The requisition number, e.g. "0118". */
  number: string | null;
  access: string | null;
  pay_amount: string | null;
  /** "hour", "year". */
  pay_frequency: string | null;
  job_type: string | null;
  remote_type: string | null;
  job_url: string | null;
};

/**
 * An application to a position.
 *
 * The only record in this API that carries a contact detail — email and phone
 * are populated here where they are empty on the employee. If a person-level
 * join ever needs a stronger key than a name, this is where one exists.
 *
 * It does not name the position or the location it was for, despite being the
 * application *to* a position.
 */
export type WsApplicant = {
  uuid: string;
  digest_key: string | null;
  first_name: string | null;
  last_name: string | null;
  /** First and last already joined, as the API returns it. */
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  /** Where they are in the pipeline, e.g. "Hiring Complete". */
  current_stage: string | null;
  /** Where the application came from, e.g. "Indeed". */
  referer_source: string | null;
  application_date: string | null;
  latest_interview_date: string | null;
  hired_at: string | null;
};

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * Everything this app needs and nothing it doesn't.
 *
 * The parentheses are required — without them the parameter is ignored and the
 * nested objects silently vanish. See the header.
 *
 * `information`, `address`, `emergency_contact`, `eligibility`,
 * `direct_deposits`, `federal_tax` and `state_tax` are deliberately absent.
 * The first of those returns plaintext SSNs.
 */
export const EMPLOYEE_EMBED = "(job_assignments,company,location,department)";

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
};

export async function listPositions(opts: ListPositionsOptions = {}): Promise<WsPosition[]> {
  return wsPaged<WsPosition>("/positions", {
    status: opts.status,
    title: opts.title,
  });
}

export type ListApplicantsOptions = {
  /** Required in practice — see below. */
  status?: string;
  /** Hire-date window, YYYY-MM-DD — the recruiting funnel's conversion end. */
  hiredOnOrAfter?: string;
  hiredOnOrBefore?: string;
};

/**
 * Applications, which must be filtered.
 *
 * Unfiltered, `/position_applications` times out at the gateway — a 504 on
 * every attempt, at any page size. With `status` it answers immediately. So a
 * status is required here rather than optional-with-a-default: a caller that
 * forgets one gets a clear error instead of a minute of retries and a failure
 * that reads like an outage.
 */
export async function listApplicants(opts: ListApplicantsOptions = {}): Promise<WsApplicant[]> {
  if (!opts.status) {
    throw new Error("Workstream: listApplicants needs a status — unfiltered, the endpoint times out");
  }
  return wsPaged<WsApplicant>("/position_applications", {
    status: opts.status,
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
 * What they go by, when it isn't just their first name again.
 *
 * Shown to a reviewer beside the legal name, because "Amy Schutt (Amy)" is
 * noise but "Robert Ellison (Trey)" is the whole reason PAR and Workstream
 * disagree about who someone is.
 */
export function preferredName(e: WsEmployee): string | null {
  const pref = (e.preferred_name ?? "").trim();
  if (!pref) return null;
  return pref.toLowerCase() === (e.first_name ?? "").trim().toLowerCase() ? null : pref;
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
  // Active beats primary, because a stale assignment is often still flagged
  // primary after someone moves store or role — and the live one is the one a
  // staffing screen is asking about.
  return all.find((a) => a.primary && a.status === "active")
    ?? all.find((a) => a.status === "active")
    ?? all.find((a) => a.primary)
    ?? all[0]
    ?? null;
}

/**
 * Which store someone works at, as a Workstream location uuid.
 *
 * Taken from the job assignment rather than the employee's top-level
 * `location`, which is frequently null even when embedded. Join it to
 * BONUS_STORES.workstreamLocationUuid.
 */
export function employeeLocationId(e: WsEmployee): string | null {
  const a = primaryAssignment(e);
  return a?.location_id ?? a?.working_location?.core_location_id ?? e.location?.uuid ?? null;
}

/** The job title of record, e.g. "Shift Lead". */
export function jobTitle(e: WsEmployee): string | null {
  return primaryAssignment(e)?.title ?? null;
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
  return rateOfType(e, "hourly", asOf);
}

/**
 * What overtime is paid at, where Workstream states it.
 *
 * Worth reading rather than deriving: staffing.ts multiplies the base rate by a
 * constant to cost overtime, and this is the number payroll will actually use.
 */
export function overtimeRate(e: WsEmployee, asOf?: string): number | null {
  return rateOfType(e, "overtime", asOf);
}

/** Annual salary, for the people `hourlyRate` correctly refuses to answer for. */
export function annualSalary(e: WsEmployee, asOf?: string): number | null {
  return rateOfType(e, "salaried", asOf);
}

/**
 * One earning type's amount off the primary assignment.
 *
 * A person holds several rates at once — hourly, overtime, pto, sick, holiday —
 * so the type has to be named. Inactive rates are ignored, and where a rate
 * carries an `effective_date` the latest one on or before `asOf` wins. On this
 * account every effective_date is null, so that ordering is inert today and
 * correct the day it isn't.
 */
function rateOfType(e: WsEmployee, earningType: string, asOf?: string): number | null {
  const rates = primaryAssignment(e)?.earning_rates ?? [];
  const cutoff = asOf ?? "9999-12-31";

  const matching = rates
    .filter((r) => (r.earning_type ?? "").toLowerCase() === earningType)
    .filter((r) => (r.status ?? "active").toLowerCase() === "active")
    .filter((r) => !r.effective_date || r.effective_date <= cutoff)
    .sort((a, b) => (a.effective_date ?? "").localeCompare(b.effective_date ?? ""));

  const latest = matching[matching.length - 1];
  if (!latest) return null;
  const amount = typeof latest.amount === "number" ? latest.amount : Number.parseFloat(latest.amount ?? "");
  return Number.isFinite(amount) && amount > 0 ? amount : null;
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
