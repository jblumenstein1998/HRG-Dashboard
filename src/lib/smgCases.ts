/**
 * ZCase client — Zaxby's guest-complaint cases from smg360.
 *
 * This talks to `360.smg.com`, which is a completely different application from
 * the `reporting.smg.com` WebForms app in smgTrend.ts: a JSON REST API behind a
 * bearer token. The two are joined only by the login.
 *
 * Getting a token is the non-obvious part. There is no usable login endpoint on
 * 360 itself — `api.smg.com/Users/ValidateCredentials` returns 401, and the
 * OIDC password grant at auth.smg.com returns invalid_client. What works is an
 * SSO handoff off the back of an ordinary v5 session:
 *
 *   1. log into reporting.smg.com (smgLogin, shared with the survey pull)
 *   2. GET reporting.smg.com/360/report=caselist **without following redirects**
 *   3. the token is in the `Location` header's *fragment*:
 *        https://360.smg.com/#/...#access_token=<jwt>&refresh_token=<32 chars>
 *
 * Nothing is set server-side — the SPA parses that fragment itself and writes
 * the `authorizationData` cookie. So we read the header and never need a
 * browser.
 *
 * The access token lasts ~40 minutes. There is a refresh endpoint, but we
 * deliberately don't use it: refresh tokens **rotate**, which would make the
 * credential stateful and race between the cron and any on-demand refresh. A
 * fresh login costs ~3s and a whole ingest finishes well inside 40 minutes, so
 * every run just logs in again and stays stateless.
 */
import { smgLogin, type SmgSession } from "@/lib/smgTrend";

const V5 = "https://reporting.smg.com";
const API = "https://360.smg.com";

/** Zaxby's account — every 360 request carries it as a header. */
const ACCOUNT_ID = "5ea84d0a50406425686eb3f4";

/** The ZCases card. Also the card id embedded in case deep links. */
const CARD_ID = "5ea8e7507485ed25f8e32d4f";

/** The raw-data report behind the case list. */
const REPORT_ID = "5ea8e74f7485ed25f8e32d4d";

/**
 * The report's two feed sources. `filters` is keyed by these, and each key
 * needs its own identical copy of the filter set — omitting one silently drops
 * that feed's cases rather than erroring.
 */
const SOURCE_IDS = ["5ea8e7477485ed25f8e32d08", "5ea8e7477485ed25f8e32d09"];

/**
 * Hierarchy projects this login can see. Needed both to scope the report and to
 * resolve unit ids — see fetchUnitMap for why there are three.
 */
const HIERARCHY_PROJECT_IDS = [1616, 1615, 1746];

/**
 * Measures used in filters and sorting. Ids are opaque; names are ours.
 *
 * The two date measures are the same two bases smg360's own ZCase filters
 * offer, and they answer different questions — see `eventDate` below.
 */
const MEASURE = {
  typeKey: "5ea8e7497485ed25f8e32d2a",
  statusKey: "5ea8e7497485ed25f8e32d2c",
  /** RECEIVED_DATE, which the smg360 UI labels "Feedback Date". */
  receivedDate: "5ea8e74a7485ed25f8e32d3c",
  /**
   * EVENT_DATE — the guest's visit, and the basis the tab reports on.
   *
   * The *pull* deliberately still windows on receivedDate: a visit always
   * precedes the feedback about it, so a rolling received-date window is a
   * superset of the same event-date window and can't miss feedback that
   * arrives weeks after the visit. Filtering the pull on event date would
   * drop exactly those late-arriving cases and never come back for them.
   */
  eventDate: "5ea8e74a7485ed25f8e32d40",
} as const;

const SORT_MEASURES = [
  "5ea8e74b7485ed25f8e32d4a",
  "5ea8e74a7485ed25f8e32d3c",
  "5ea8e74b7485ed25f8e32d48",
  "5ea8e74b7485ed25f8e32d46",
];

export type ZCaseType = "unsolicited" | "locationSurvey" | "hotline";

/** SMG identifies ZCase types by GUID; these are the three Zaxby's uses. */
const TYPE_BY_KEY: Record<string, ZCaseType> = {
  "D5CCDD04-60A3-4FEF-830E-9AB9F52BE3C7": "unsolicited",
  "AD593B05-2649-4D50-BE36-A1C188EA5C25": "locationSurvey",
  "ED8CBA63-77C6-4855-8F8D-CAF8912BF9FA": "hotline",
};

export const ZCASE_TYPE_LABEL: Record<ZCaseType, string> = {
  unsolicited: "Zaxby's Unsolicited Feedback",
  locationSurvey: "Zaxby's Location Survey",
  hotline: "Team Member Hotline",
};

/**
 * Status keys the card requests. 96 is resolved; 32 and 64 are the open states.
 * Every case observed so far has been 96 — HRG resolves fast enough that the
 * open states are rare — so treat `resolvedAt === null` as the authority on
 * whether a case is outstanding rather than trusting this mapping.
 */
const STATUS_KEYS = [32, 64, 96];

const PII_FIELD = /^CONTACT_|LOYALTY/;

export type ZCase = {
  /** GUID. Primary key, and what the deep link needs. */
  caseKey: string;
  /** Human-facing id, e.g. "734-461511". */
  displayKey: string;
  /** SMG's internal unit id — meaningless outside its hierarchy project. */
  unitId: string;
  /** HRG store number, e.g. "57007". Null if the unit map didn't resolve it. */
  store: string | null;
  /** e.g. "57007 - VIRGINIABEACH_57007". */
  unitName: string | null;
  type: ZCaseType | null;
  /** Where an unsolicited case came in from, e.g. "zaxbyswebsite". */
  externalSource: string | null;
  /** When the guest's visit happened. */
  eventAt: string | null;
  /** When SMG received the feedback — the clock start for resolution. */
  receivedAt: string | null;
  /** Null means still outstanding. */
  resolvedAt: string | null;
  /**
   * SMG's RESOLUTION_TIME field. Stored for provenance but **not** what the tab
   * shows: it truncates, while smg360's own case detail rounds *up* — a case
   * resolved in 45 minutes has RESOLUTION_TIME 0 and reads "Resolved In 1
   * Hours" on the site. smgCaseStore derives the displayed hours from the
   * timestamps instead. Null while outstanding.
   */
  resolutionHours: number | null;
  statusKey: number | null;
  escalated: boolean;
  /** SMG's due date for the case; drives "past due". */
  targetAt: string | null;
};

export type CaseAuth = { token: string; refreshToken: string | null };

/** Deep link to a case in smg360. The doubled card id and `%20` are required. */
export function caseDeepLink(caseKey: string): string {
  return `${API}/#/card/${CARD_ID}/case-detail/${caseKey}/%20/${CARD_ID}`;
}

// ── auth ──────────────────────────────────────────────────────────────────────

/**
 * Trades a v5 session for a 360 bearer token. Pass an existing session to share
 * one login with the survey pull.
 */
export async function getCaseToken(session?: SmgSession): Promise<CaseAuth> {
  const s = session ?? (await smgLogin());

  const res = await fetch(`${V5}/360/report=caselist`, {
    redirect: "manual",
    headers: { Cookie: s.cookie, Referer: `${V5}/dashboard.aspx?ID=1` },
  });

  const location = res.headers.get("location") ?? "";
  const hash = location.indexOf("#access_token=");
  if (hash === -1) {
    throw new Error(`SMG 360 handoff returned no token (status ${res.status})`);
  }

  const params = new URLSearchParams(location.slice(hash + 1));
  const token = params.get("access_token");
  if (!token) throw new Error("SMG 360 handoff fragment had no access_token");

  return { token, refreshToken: params.get("refresh_token") };
}

function apiHeaders(auth: CaseAuth): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${auth.token}`,
    AccountId: ACCOUNT_ID,
    TimeZone: "Eastern Standard Time",
    "SMG-LanguageIso": "en-US",
  };
}

// ── unit map ──────────────────────────────────────────────────────────────────

export type UnitInfo = { store: string | null; unitName: string };

/**
 * Maps SMG's internal unit ids to HRG store numbers.
 *
 * Cases carry a `UNIT_ID` like 3779101, which is not a store number and is only
 * unique *within a hierarchy project* — the same restaurant has a different id
 * in each one (Columbia is 3779937 in project 1615 and 3775770 in 1616). Miss
 * that and a store's cases split across several rows that each look plausible
 * while the total still reconciles, so every project is merged into one map.
 *
 * Response shape is `{ levelId: { unitId: { unitDimId, unitName, ... } } }`.
 */
export async function fetchUnitMap(auth: CaseAuth): Promise<Map<string, UnitInfo>> {
  const map = new Map<string, UnitInfo>();

  for (const projectId of HIERARCHY_PROJECT_IDS) {
    const res = await fetch(`${API}/api/userhierarchy/units/project/${projectId}`, {
      headers: apiHeaders(auth),
    });
    // A project the login can't see 404s; that's expected, not fatal.
    if (!res.ok) continue;

    const byLevel = (await res.json()) as Record<string, Record<string, { unitDimId: number; unitName: string }>>;
    for (const units of Object.values(byLevel)) {
      for (const unit of Object.values(units)) {
        const unitName = unit.unitName ?? "";
        map.set(String(unit.unitDimId), {
          // Names are "57007 - VIRGINIABEACH_57007"; the leading number is the store.
          store: unitName.match(/^(\d{4,6})/)?.[1] ?? null,
          unitName,
        });
      }
    }
  }

  return map;
}

// ── cases ─────────────────────────────────────────────────────────────────────

type RawField = { value: unknown; attribute?: { name?: string } | null };
type RawRow = { fields: RawField[] };

function sourceFilters(startISO: string, endISO: string) {
  return [
    {
      measureId: MEASURE.typeKey,
      columnName: null,
      comparisonValue: Object.keys(TYPE_BY_KEY),
      columnValueType: 1,
      sourceFilterComparison: 7,
      operator: 0,
      type: 2,
    },
    {
      measureId: MEASURE.statusKey,
      columnName: null,
      comparisonValue: STATUS_KEYS,
      columnValueType: 3,
      sourceFilterComparison: 7,
      operator: 0,
      type: 2,
    },
    { operator: 0, groupingsFilters: [], type: 1 },
    {
      operator: 0,
      type: 1,
      groupingsFilters: [
        // 6 = on/after, 5 = on/before.
        { measureId: MEASURE.receivedDate, columnName: null, comparisonValue: startISO, columnValueType: 2, sourceFilterComparison: 6, operator: 0, type: 2 },
        { measureId: MEASURE.receivedDate, columnName: null, comparisonValue: endISO, columnValueType: 2, sourceFilterComparison: 5, operator: 0, type: 2 },
      ],
    },
  ];
}

function reportBody(startISO: string, endISO: string, limit: number) {
  const filters: Record<string, unknown> = {};
  for (const sourceId of SOURCE_IDS) filters[sourceId] = sourceFilters(startISO, endISO);

  return {
    reportId: REPORT_ID,
    dateRange: null,
    // offset is always 0 — see fetchZCases for why paging is done by splitting
    // the date window instead.
    pagingParameters: { limit, offset: 0 },
    sortMeasures: SORT_MEASURES.map((measureId) => ({ measureId, order: 0 })),
    filter: {},
    joins: {},
    hierarchyProjectIds: HIERARCHY_PROJECT_IDS,
    filters,
  };
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const num = (v: unknown): number | null => {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
};

/**
 * Flattens one report row, dropping guest PII on the way in.
 *
 * The report always returns all 26 of its measures — contact name, email, phone
 * and loyalty id included — and there's no way to ask for a subset. So they're
 * discarded here, at the boundary, and never reach a caller or the database.
 *
 * Field names here are the *runtime* ones, which drop the `CASE_` prefix that
 * the report configuration's measure names carry (`CASE_DISPLAY_KEY` in the
 * config arrives as `DISPLAY_KEY`).
 */
function toZCase(row: RawRow, units: Map<string, UnitInfo>): ZCase | null {
  const f: Record<string, unknown> = {};
  for (const field of row.fields) {
    const name = field.attribute?.name;
    if (!name || PII_FIELD.test(name)) continue;
    f[name] = field.value;
  }

  const caseKey = str(f.CASE_KEY);
  if (!caseKey) return null; // no primary key, no row

  const unitId = str(f.UNIT_ID) ?? "";
  const unit = units.get(unitId);
  const typeKey = str(f.TYPE_KEY);

  return {
    caseKey,
    displayKey: str(f.DISPLAY_KEY) ?? caseKey,
    unitId,
    store: unit?.store ?? null,
    unitName: unit?.unitName ?? null,
    type: typeKey ? (TYPE_BY_KEY[typeKey.toUpperCase()] ?? null) : null,
    externalSource: str(f.EXTERNAL_CASE_ID),
    eventAt: str(f.EVENT_DATE),
    receivedAt: str(f.RECEIVED_DATE),
    resolvedAt: str(f.RESOLUTION_DATE),
    resolutionHours: num(f.RESOLUTION_TIME),
    statusKey: num(f.STATUS_KEY),
    escalated: str(f.ESCALATION) === "1",
    targetAt: str(f.TARGET_DATE),
  };
}

/**
 * Rows requested per window. Generous on purpose: a whole fiscal year is ~1,000
 * cases and comes back in one 3s request, so in practice nothing ever splits.
 */
const WINDOW_LIMIT = 2000;

/** Guards the recursion below; 2^6 sub-windows is far past any real need. */
const MAX_SPLIT_DEPTH = 6;

/** One report request for a date window. Returns raw rows. */
async function runReport(auth: CaseAuth, startISO: string, endISO: string): Promise<RawRow[]> {
  const res = await fetch(`${API}/api/rawdatareport/runRawDataReport`, {
    method: "POST",
    headers: apiHeaders(auth),
    body: JSON.stringify(reportBody(startISO, endISO, WINDOW_LIMIT)),
  });

  if (!res.ok) {
    throw new Error(`SMG runRawDataReport failed: ${res.status} ${await res.text()}`);
  }

  return ((await res.json()) as { rawData?: RawRow[] }).rawData ?? [];
}

/**
 * Collects a window, halving it if the request fails or looks truncated.
 *
 * **Do not reintroduce `offset` paging.** It is broken on this endpoint and
 * fails *silently*: asking P1 FY26 for limit 50 gives 50 rows at offset 0, a
 * 500 at offset 50, and 0 rows at offset 100 — while the same window asked for
 * in one request with limit 200 returns all 63. An earlier version paged on
 * offset and so stored 50 of P1's 63 cases while looking perfectly healthy.
 *
 * Splitting the window needs no offset and is self-checking: a short response
 * is provably the whole window, and anything else gets halved until it is.
 */
async function collectWindow(
  auth: CaseAuth,
  start: Date,
  end: Date,
  out: RawRow[],
  depth = 0,
): Promise<void> {
  let rows: RawRow[];
  try {
    rows = await runReport(auth, start.toISOString(), end.toISOString());
  } catch (err) {
    // A window SMG chokes on usually succeeds in halves — but a single-day
    // window that still fails is a real error, not something to swallow.
    if (depth >= MAX_SPLIT_DEPTH || end.getTime() - start.getTime() < 24 * 60 * 60 * 1000) throw err;
    rows = [];
    await halve(auth, start, end, out, depth);
    return;
  }

  // A full page means the window may have been truncated; only a short one
  // proves we have everything.
  if (rows.length >= WINDOW_LIMIT && depth < MAX_SPLIT_DEPTH) {
    await halve(auth, start, end, out, depth);
    return;
  }

  out.push(...rows);
}

async function halve(auth: CaseAuth, start: Date, end: Date, out: RawRow[], depth: number): Promise<void> {
  const mid = new Date((start.getTime() + end.getTime()) / 2);
  // Both filter comparisons are inclusive, so the second half starts 1ms later
  // than the first ends — otherwise a case on the boundary lands in both.
  await collectWindow(auth, start, mid, out, depth + 1);
  await collectWindow(auth, new Date(mid.getTime() + 1), end, out, depth + 1);
}

/**
 * Every ZCase SMG *received* in [start, end] — see MEASURE.eventDate for why
 * the pull uses that basis while the tab reports on the visit date.
 */
export async function fetchZCases(
  auth: CaseAuth,
  opts: { start: Date; end: Date; unitMap?: Map<string, UnitInfo> },
): Promise<ZCase[]> {
  const units = opts.unitMap ?? (await fetchUnitMap(auth));

  const rows: RawRow[] = [];
  await collectWindow(auth, opts.start, opts.end, rows);

  // Deduplicated on the primary key: the split boundaries shouldn't overlap,
  // but a retry that partially succeeded shouldn't double-count either.
  const byKey = new Map<string, ZCase>();
  for (const row of rows) {
    const c = toZCase(row, units);
    if (c) byKey.set(c.caseKey, c);
  }
  return [...byKey.values()];
}

// ── case detail ───────────────────────────────────────────────────────────────

/**
 * What a guest actually said, plus the context around it.
 *
 * Deliberately **not** part of ZCase and never written to the database. The
 * narrative is free text a guest typed about a specific visit — it's what you
 * need in front of you while the case is open and worth nothing once it's
 * closed, so it's fetched live, per case, and kept only for as long as the tab
 * is on screen. Storing it would turn a 40-minute operational need into a
 * permanent archive of guest complaints.
 */
export type ZCaseDetail = {
  caseKey: string;
  /**
   * The guest's own words. SMG returns one entry per free-text question on the
   * form and nulls the ones they didn't answer, so this holds only the answered
   * ones — usually exactly one. The label is the question ("Complaint", "Why
   * Not Satisfied") and carries real meaning, so it's kept.
   */
  narrative: { label: string; text: string }[];
  /** Visit context and survey answers: "Visit Type: Drive Thru" and the like. */
  details: { label: string; value: string }[];
};

type InfoItem = { display?: string | null; value?: string | null };

type CaseDetailResponse = {
  additionalInformation?: InfoItem[] | null;
  supplementaryInformation?: InfoItem[] | null;
  mainInformation?: InfoItem[] | null;
};

/**
 * One case's detail, as smg360's own case-detail screen loads it.
 *
 * `GET /api/caseManagement/{caseKey}` — the raw-data report behind the case
 * list has no verbatim field at all (all 26 of its measures are ids, dates and
 * flags), so the text only exists here.
 *
 * The response also carries the guest's name, email and phone. They're dropped
 * on the way out, same as in `toZCase`: nothing PII-shaped leaves this module.
 */
export async function fetchCaseDetail(auth: CaseAuth, caseKey: string): Promise<ZCaseDetail> {
  const res = await fetch(`${API}/api/caseManagement/${encodeURIComponent(caseKey)}`, {
    headers: apiHeaders(auth),
  });

  if (!res.ok) {
    throw new Error(`SMG case detail failed for ${caseKey}: ${res.status}`);
  }

  const body = (await res.json()) as CaseDetailResponse;

  const narrative: { label: string; text: string }[] = [];
  for (const item of body.mainInformation ?? []) {
    const text = str(item?.value);
    if (text) narrative.push({ label: str(item?.display) ?? "Feedback", text });
  }

  // The two lists overlap — on an unsolicited case they're identical — so
  // they're merged on the label rather than rendered twice.
  const details: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const item of [...(body.additionalInformation ?? []), ...(body.supplementaryInformation ?? [])]) {
    const label = str(item?.display);
    const value = str(item?.value);
    // Unanswered questions come back with a null value; they say nothing.
    if (!label || !value || seen.has(label)) continue;
    seen.add(label);
    details.push({ label, value });
  }

  return { caseKey, narrative, details };
}

/** Convenience: log in, resolve units, and pull a window in one call. */
export async function pullZCases(opts: {
  start: Date;
  end: Date;
  session?: SmgSession;
}): Promise<{ cases: ZCase[]; unmappedUnits: string[] }> {
  const auth = await getCaseToken(opts.session);
  const unitMap = await fetchUnitMap(auth);
  const cases = await fetchZCases(auth, { start: opts.start, end: opts.end, unitMap });

  // Surfaced rather than thrown: an unmapped unit still produces a usable row,
  // it just can't be grouped by store. Worth logging when it happens.
  const unmappedUnits = [...new Set(cases.filter((c) => !c.store).map((c) => c.unitId))];

  return { cases, unmappedUnits };
}
