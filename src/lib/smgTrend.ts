/**
 * SMG guest-satisfaction client — pure HTTP, no browser.
 *
 * Replaces the dead Playwright scraper in `smg.ts` (which could never run on
 * Vercel) and the manual "export TrendReport and paste it into a .ts file"
 * workflow behind smgTrendData.ts / smgTrendDataVA.ts / smgTrendDataMonthly.ts.
 *
 * SMG's Report Builder is an ASP.NET WebForms app. Getting trend data out of it
 * takes four steps, in this order — skipping any of them makes the next one
 * return `{"Error":"An Error Occurred!"}` or an empty array:
 *
 *   1. form-post login, follow the redirect chain to dashboard.aspx
 *   2. GET ReportBuilder.aspx (keep __VIEWSTATE) + the ReportBuilder.ashx
 *      handshake — this primes server-side session state
 *   3. POST ReportViewer.ashx?function=getdata — saves the report criteria to
 *      the session. Returns only the report *shell*, never the rows.
 *   4. POST back to ReportBuilder.aspx as an UpdatePanel async postback — this
 *      is what actually renders the grid HTML, which we parse.
 */

const BASE = "https://reporting.smg.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const CTRL = "ctl00$TheContentPlaceHolder$TheReportViewerControl$TheReportViewerBridgeControl";

/** Report Builder "Generate report for this level" values. */
export const LEVEL = {
  store: 10,
  gm: 60,
  entity: 110,
  districtManager: 210,
  regionManager: 310,
  licensee: 410,
} as const;
export type LevelKey = keyof typeof LEVEL;

/**
 * Enhanced Trend returns at most 24 periods per report and **silently trims
 * the oldest** beyond that — no error, no flag, just missing leading periods.
 * Ask for 26 weeks and you get weeks 3–26. Backfill in chunks no larger than
 * this or you lose data on every chunk boundary.
 */
export const MAX_TREND_PERIODS = 24;

/** Date-type values, shared by DateTypeChoose and ShowLastType. */
export const DATE_TYPE = { weekly: 7, period: 5, threeMonth: 9, quarterly: 10 } as const;
export type DateTypeKey = keyof typeof DATE_TYPE;

/**
 * Survey item ids, taken from Report Builder's own item list. Ids are NOT
 * sequential by topic — 631216 is "Ease of Placing Order", not a problem
 * metric, and "Experienced Problem" is 631222. Verify against the live list
 * (`rbSurveyItemSEL1` options) before adding new ones.
 */
export const SURVEY_ITEM = {
  overall: "631212",
  taste: "631213",
  temperature: "631214",
  quality: "705509",
  accuracy: "631215",
  easeOfOrdering: "631216",
  speedOfService: "631217",
  friendliness: "631218",
  cleanliness: "631220",
  value: "631221",
  problem: "631222",
  problemResolution: "631223",
  likelihoodToReturn: "631224",
  likelihoodToRecommend: "631225",
  overallDineIn: "631593",
  overallToGo: "631594",
  overallDriveThru: "631595",
  overallDigital: "692596",
} as const;
export type SurveyItemKey = keyof typeof SURVEY_ITEM;

/** The six HRG tracks week to week. Response counts come back with every item. */
export const DEFAULT_ITEMS: SurveyItemKey[] = [
  "overall",
  "temperature",
  "accuracy",
  "friendliness",
  "cleanliness",
  "problem",
];

/**
 * Weekly period ids are sequential: Week N of 2026 === 925895 + N.
 * Verified against SMG's own dropdown (Week 29, 2026 === 925924).
 * Weeks run back to Week 1, 2020, so the anchor extrapolates backwards across
 * year boundaries only if you know each year's week count — prefer
 * `listPeriods()` when you need ids outside the current year.
 */
export const WEEK_ID_ANCHOR = { year: 2026, base: 925895 };

export function weeklyPeriodId(year: number, week: number): number {
  if (year !== WEEK_ID_ANCHOR.year) {
    throw new Error(
      `weeklyPeriodId only extrapolates within ${WEEK_ID_ANCHOR.year}; use listPeriods() for ${year}`,
    );
  }
  return WEEK_ID_ANCHOR.base + week;
}

// ── session ───────────────────────────────────────────────────────────────────

export type SmgSession = {
  cookie: string;
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
  scriptManagerHidden: string;
};

type Jar = Map<string, string>;

function absorb(jar: Jar, res: Response): void {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

const jarHeader = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function request(jar: Jar, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: { "User-Agent": UA, Cookie: jarHeader(jar), ...(init.headers ?? {}) },
  });
  absorb(jar, res);
  return res;
}

function hiddenField(html: string, name: string): string {
  const m =
    html.match(new RegExp(`id="${name}"[^>]*value="([^"]*)"`)) ??
    html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`));
  return m ? m[1] : "";
}

/** Logs in and primes the Report Builder session. */
export async function smgLogin(): Promise<SmgSession> {
  const username = process.env.SMG_USERNAME;
  const password = process.env.SMG_PASSWORD;
  if (!username || !password) throw new Error("SMG_USERNAME / SMG_PASSWORD not set");

  const jar: Jar = new Map();

  const loginPage = await (await request(jar, `${BASE}/index.aspx`)).text();
  let res = await request(jar, `${BASE}/index.aspx`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${BASE}/index.aspx` },
    body: new URLSearchParams({
      __VIEWSTATE: hiddenField(loginPage, "__VIEWSTATE"),
      __VIEWSTATEGENERATOR: hiddenField(loginPage, "__VIEWSTATEGENERATOR"),
      __EVENTVALIDATION: hiddenField(loginPage, "__EVENTVALIDATION"),
      __EVENTTARGET: "",
      __EVENTARGUMENT: "",
      "ctl00$cphMain$txtUserName": username,
      "ctl00$cphMain$txtPassword": password,
    }).toString(),
  });

  // login lands via LandingPage -> MultiSiteSelection -> LandingPage -> dashboard
  let location = res.headers.get("location");
  for (let hop = 0; location && hop < 8; hop++) {
    res = await request(jar, location.startsWith("http") ? location : BASE + location);
    location = res.headers.get("location");
  }

  const rb = await (await request(jar, `${BASE}/ReportBuilder.aspx`)).text();
  if (!rb.includes("__VIEWSTATE") || /txtUserName/.test(rb)) {
    throw new Error("SMG login failed — check SMG_USERNAME / SMG_PASSWORD");
  }

  return {
    cookie: jarHeader(jar),
    viewState: hiddenField(rb, "__VIEWSTATE"),
    viewStateGenerator: hiddenField(rb, "__VIEWSTATEGENERATOR"),
    eventValidation: hiddenField(rb, "__EVENTVALIDATION"),
    scriptManagerHidden: hiddenField(rb, "ctl00_TheScriptManager_HiddenField"),
  };
}

function sessionJar(session: SmgSession): Jar {
  const jar: Jar = new Map();
  for (const part of session.cookie.split("; ")) {
    const i = part.indexOf("=");
    if (i > 0) jar.set(part.slice(0, i), part.slice(i + 1));
  }
  return jar;
}

// ── periods ───────────────────────────────────────────────────────────────────

export type SmgPeriod = {
  /** Period id to pass as DateRangeStart / DateRangeEnd. */
  id: string;
  label: string;
  /** Matches a DATE_TYPE value: 7 weekly, 5 period, 9 3M, 10 quarterly. */
  dateTypeValue: number;
  year: number | null;
  number: number | null;
};

/**
 * Every selectable period SMG knows about, back to Week 1 2020. Ids are
 * sequential within a year but the per-year week count varies, so read them
 * from here rather than extrapolating across a year boundary.
 */
export async function listPeriods(session: SmgSession): Promise<SmgPeriod[]> {
  const jar = sessionJar(session);
  const raw = await request(
    jar,
    `${BASE}/handlers/ReportBuilder.ashx?function=getreportcontroller&reporttype=61&reportsubtype=0&r=${Math.random()}&periodId=`,
  ).then((r) => r.text());

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const out: SmgPeriod[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (typeof o.V === "string" && typeof o.T === "string" && typeof o.I === "number") {
      const m = o.T.match(/^(?:Week|Period|Month|Quarter)\s+(\d+),\s*(\d{4})$/i);
      out.push({
        id: o.V,
        label: o.T,
        dateTypeValue: o.I,
        number: m ? Number(m[1]) : null,
        year: m ? Number(m[2]) : null,
      });
    }
    Object.values(o).forEach(walk);
  };
  walk(parsed);

  return out.filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i);
}

/** Periods of one granularity, newest first. */
export async function listPeriodsOfType(
  session: SmgSession,
  dateType: DateTypeKey = "weekly",
): Promise<SmgPeriod[]> {
  const want = DATE_TYPE[dateType];
  return (await listPeriods(session))
    .filter((p) => p.dateTypeValue === want)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.number ?? 0) - (a.number ?? 0));
}

// ── units ─────────────────────────────────────────────────────────────────────

export type SmgUnit = { id: string; label: string; storeId: string | null; name: string };

/**
 * Units available at a level. SMG labels stores as "36001 - SPRINGFIELD_36001",
 * so the PAR store id falls out of the label directly.
 */
export async function listUnits(session: SmgSession, level: LevelKey = "store"): Promise<SmgUnit[]> {
  const jar = sessionJar(session);
  const res = await request(
    jar,
    `${BASE}/handlers/ReportBuilder.ashx?function=getunits&reporttype=61&reportsubtype=0&reportlevel=${LEVEL[level]}&r=${Math.random()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: "",
    },
  );
  const raw = await res.text();

  // Payload is [{rId, responseData: "<li><input id='3959571'><label ...>28901 - COLUMBIA_28901</label></li>..."}]
  let html = "";
  try {
    const parsed = JSON.parse(raw) as Array<{ responseData?: string }>;
    html = parsed.map((p) => p?.responseData ?? "").join("");
  } catch {
    return [];
  }

  const out: SmgUnit[] = [];
  for (const li of html.match(/<li>[\s\S]*?<\/li>/g) ?? []) {
    const id = li.match(/<input[^>]*id='(\d+)'/)?.[1];
    const label = li.match(/<label[^>]*>([\s\S]*?)<\/label>/)?.[1]?.trim();
    if (!id || !label) continue;
    const m = label.match(/^(\d+)\s*-\s*(.+)$/);
    out.push({ id, label, storeId: m ? m[1] : null, name: m ? m[2].trim() : label });
  }

  return out.filter((u, i, a) => a.findIndex((x) => x.id === u.id) === i);
}

// ── report ────────────────────────────────────────────────────────────────────

export type TrendRow = {
  unitId: string | null;
  unitLabel: string;
  unitName: string;
  period: string;
  metric: string;
  score: number | null;
  responses: number | null;
  /** SMG flags cells whose response count is under its reporting threshold. */
  belowMinResponses: boolean;
};

export type TrendQuery = {
  level?: LevelKey;
  dateType?: DateTypeKey;
  /** Period ids from `listPeriods()`; both required. */
  startPeriodId: number | string;
  endPeriodId: number | string;
  /** How many periods back the report spans. */
  periods: number;
  items?: SurveyItemKey[];
  /** Unit ids from `listUnits()`. Omit and they're resolved automatically. */
  unitIds?: string[];
  /**
   * Which date a response is attributed to. "visit" is when the guest actually
   * came in; "survey" is when they filled the survey out — they routinely fall
   * in different weeks, so this materially changes the numbers.
   */
  dateBasis?: "visit" | "survey";
  /**
   * "SHOWLAST" = the most recent `periods` periods (DateRangeStart/End ignored).
   * "DATERANGE" = the explicit window between startPeriodId and endPeriodId,
   * which is what historical backfill needs.
   */
  dateRangeType?: "SHOWLAST" | "DATERANGE";
};

function criteria(q: TrendQuery, unitIds: string[]): string {
  const level = LEVEL[q.level ?? "store"];
  const dateType = DATE_TYPE[q.dateType ?? "weekly"];
  const items = (q.items ?? DEFAULT_ITEMS).map((k) => SURVEY_ITEM[k]).join(",");
  const dateBasis = (q.dateBasis ?? "visit") === "visit" ? "Visit" : "Survey";
  const dateRangeType = q.dateRangeType ?? "DATERANGE";

  return new URLSearchParams({
    // Report Builder sends exactly one of these two (see its own JS:
    // `DateRangeType: h ? "SHOWLAST" : "DATERANGE"`). Any other value errors.
    // Defaults to DATERANGE because this API always takes explicit period ids —
    // under SHOWLAST the server silently ignores them and returns the most
    // recent N periods instead, which makes historical backfill a no-op.
    DateRangeType: dateRangeType,
    // Only meaningful under SHOWLAST — verified to have no effect in DATERANGE
    // mode, where the range itself bounds the result (subject to
    // MAX_TREND_PERIODS).
    ShowLastNumber: String(q.periods),
    ShowLastType: String(dateType),
    DateRangeStart: String(q.startPeriodId),
    DateRangeEnd: String(q.endPeriodId),
    ReportLevel: String(level),
    GroupByLevel: String(level),
    Benchmarks: "",
    SurveyItems: items,
    Filters: "[]",
    ColumnWrap: "True",
    YearOverYear: "False",
    RestaurantCount: "False",
    Combined: "",
    GraphEach: "unit",
    UnitCount: "false",
    DateType: dateBasis,
    HideLegend: "false",
    DateTypeChoose: String(dateType),
    CompareBy: "Units",
    CompareToOtherDatesTimePeriod: "0",
    // Must be non-empty — an empty Units list renders a grid with no rows.
    Units: unitIds.join(","),
    HierarchyStructureScoreType: "",
    HierarchyStructureType: "LevelAlignment",
  }).toString();
}

/** Runs a trend report and returns one row per unit × period × metric. */
export async function fetchTrend(session: SmgSession, q: TrendQuery): Promise<TrendRow[]> {
  const jar = sessionJar(session);

  // prime — ReportViewer rejects criteria without this handshake
  await request(
    jar,
    `${BASE}/handlers/ReportBuilder.ashx?function=getdata&reporttype=0&reportsubtype=0&r=${Math.random()}`,
  ).then((r) => r.text());
  await request(
    jar,
    `${BASE}/handlers/ReportBuilder.ashx?function=getreportcontroller&reporttype=61&reportsubtype=0&r=${Math.random()}&periodId=`,
  ).then((r) => r.text());
  await request(
    jar,
    `${BASE}/handlers/ReportBuilder.ashx?function=getunits&reporttype=61&reportsubtype=0&reportlevel=${LEVEL[q.level ?? "store"]}&r=${Math.random()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
      body: "",
    },
  ).then((r) => r.text());

  const unitIds = q.unitIds?.length
    ? q.unitIds
    : (await listUnits(session, q.level ?? "store")).map((u) => u.id);
  if (!unitIds.length) throw new Error(`SMG returned no units for level "${q.level ?? "store"}"`);

  // save criteria to session
  const saved = await request(
    jar,
    `${BASE}/handlers/ReportViewer.ashx?function=getdata&reporttype=61&reportsubtype=0&disableunits=false&r=${Math.random()}&translateBtnClicked=false&translateFlag=false`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${BASE}/ReportBuilder.aspx`,
      },
      body: criteria(q, unitIds),
    },
  ).then((r) => r.text());

  if (saved.includes("An Error Occurred")) {
    throw new Error("SMG rejected the report criteria (getdata returned an error)");
  }

  // render the grid via the UpdatePanel postback
  const postback = new URLSearchParams({
    "ctl00$TheScriptManager": `${CTRL}$TheUpdatePanel|${CTRL}$TheBuildReportBTN`,
    ctl00_TheScriptManager_HiddenField: session.scriptManagerHidden,
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: session.viewState,
    __VIEWSTATEGENERATOR: session.viewStateGenerator,
    __EVENTVALIDATION: session.eventValidation,
    "ctl00$TheTextBox": "",
    rbDateTypeRadio: "on",
    rbDateRadio: "on",
    InsertType: "Pushed",
    UnitOptionType: "UserLevel",
    __ASYNCPOST: "true",
    [`${CTRL}$TheBuildReportBTN`]: "",
  });

  const html = await request(jar, `${BASE}/ReportBuilder.aspx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "X-MicrosoftAjax": "Delta=true",
      Referer: `${BASE}/ReportBuilder.aspx`,
      Origin: BASE,
    },
    body: postback.toString(),
  }).then((r) => r.text());

  if (html.includes("pageRedirect") && html.includes("Index.aspx")) {
    throw new Error("SMG session expired mid-report");
  }

  return parseTrendHtml(html);
}

// ── comparison (arbitrary calendar date range) ────────────────────────────────

export type ComparisonQuery = {
  /** Inclusive calendar dates. Any span — this is not tied to fiscal periods. */
  start: Date;
  end: Date;
  level?: LevelKey;
  items?: SurveyItemKey[];
  unitIds?: string[];
  dateBasis?: "visit" | "survey";
};

export type ComparisonRow = {
  unitId: string | null;
  unitLabel: string;
  unitName: string;
  metric: string;
  score: number | null;
  responses: number | null;
  belowMinResponses: boolean;
};

/** SMG's date text boxes take M/D/YYYY. */
export function smgDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** Rolling window of `days` ending yesterday (today is rarely complete). */
export function rollingWindow(days = 7, endingDaysAgo = 1): { start: Date; end: Date } {
  const end = new Date();
  end.setDate(end.getDate() - endingDaysAgo);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return { start, end };
}

/**
 * Comparison report (reporttype=27) — one aggregate row per unit over an
 * arbitrary calendar range, which is how you get a rolling 7-day view. Enhanced
 * Trend can't do this: it only aggregates by whole fiscal periods.
 *
 * Note it returns a single figure per unit for the whole window, not a
 * day-by-day breakdown.
 */
export async function fetchComparison(
  session: SmgSession,
  q: ComparisonQuery,
): Promise<ComparisonRow[]> {
  const jar = sessionJar(session);
  const level = LEVEL[q.level ?? "store"];
  const items = (q.items ?? DEFAULT_ITEMS).map((k) => SURVEY_ITEM[k]).join(",");
  const dateBasis = (q.dateBasis ?? "visit") === "visit" ? "Visit" : "Survey";

  await request(jar, `${BASE}/handlers/ReportBuilder.ashx?function=getdata&reporttype=0&reportsubtype=0&r=${Math.random()}`).then((r) => r.text());
  await request(jar, `${BASE}/handlers/ReportBuilder.ashx?function=getreportcontroller&reporttype=27&reportsubtype=0&r=${Math.random()}&periodId=`).then((r) => r.text());
  await request(
    jar,
    `${BASE}/handlers/ReportBuilder.ashx?function=getunits&reporttype=27&reportsubtype=0&reportlevel=${level}&r=${Math.random()}`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" }, body: "" },
  ).then((r) => r.text());

  const unitIds = q.unitIds?.length ? q.unitIds : (await listUnits(session, q.level ?? "store")).map((u) => u.id);
  if (!unitIds.length) throw new Error(`SMG returned no units for level "${q.level ?? "store"}"`);

  // Field set and values copied from what Report Builder itself posts.
  // CompareBy is "0", NOT "Units" — sending "Units" here returns an error.
  const body = new URLSearchParams({
    StartDate: smgDate(q.start),
    EndDate: smgDate(q.end),
    CustomQuickDateId: "",
    CustomStartDate: "",
    CustomEndDate: "",
    ReportLevel: String(level),
    GroupByLevel: String(level),
    Benchmarks: "",
    SurveyItems: items,
    Filters: "[]",
    CompareBy: "0",
    BreakoutCompareType: "undefined",
    MultiParentHierarchyLevelBy: "0",
    // Must be False. With wrapping on, SMG splits the metrics across two
    // blocks — each unit row carries only the first few, and the rest land in
    // a trailing section that the last unit's segment then absorbs (which is
    // how Spring Hill ended up reporting the all-store total as its own).
    ColumnWrap: "False",
    UnitCount: "false",
    DateType: dateBasis,
    CCTypeList: "",
    HierarchyList: "",
    CompareToOtherDatesTimePeriod: "0",
    QuickDateValue: "null",
    Units: unitIds.join(","),
    HierarchyStructureScoreType: "",
    HierarchyStructureType: "LevelAlignment",
  });

  await request(
    jar,
    `${BASE}/handlers/ReportViewer.ashx?function=getdata&reporttype=27&reportsubtype=0&disableunits=false&r=${Math.random()}&translateBtnClicked=false&translateFlag=false`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${BASE}/ReportBuilder.aspx`,
      },
      body: body.toString(),
    },
  ).then((r) => r.text());

  const postback = new URLSearchParams({
    "ctl00$TheScriptManager": `${CTRL}$TheUpdatePanel|${CTRL}$TheBuildReportBTN`,
    ctl00_TheScriptManager_HiddenField: session.scriptManagerHidden,
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: session.viewState,
    __VIEWSTATEGENERATOR: session.viewStateGenerator,
    __EVENTVALIDATION: session.eventValidation,
    "ctl00$TheTextBox": "",
    rbDateTypeRadio: "on",
    rbDateRadio: "on",
    InsertType: "Pushed",
    UnitOptionType: "UserLevel",
    __ASYNCPOST: "true",
    [`${CTRL}$TheBuildReportBTN`]: "",
  });

  const html = await request(jar, `${BASE}/ReportBuilder.aspx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "X-MicrosoftAjax": "Delta=true",
      Referer: `${BASE}/ReportBuilder.aspx`,
      Origin: BASE,
    },
    body: postback.toString(),
  }).then((r) => r.text());

  return parseComparisonHtml(html);
}

/**
 * Parses the Comparison grid (`table.Default_Grid`). Each score cell carries a
 * `title` of "Metric\r\n75%\r\nn = 16", which is more reliable than positional
 * column matching, so we read the metric name and count straight out of it.
 */
export function parseComparisonHtml(html: string): ComparisonRow[] {
  const rows: ComparisonRow[] = [];

  // Each row embeds a drill-down menu built from nested <table>s. Strip those
  // first: they break <tr> matching (a non-greedy </tr> stops inside the menu)
  // and they carry no scores. Repeat until none remain, innermost outwards.
  let grid = html;
  for (let pass = 0; pass < 10; pass++) {
    const before = grid;
    grid = grid.replace(/<table\b(?:(?!<table\b)[\s\S])*?<\/table>/g, (t) =>
      t.includes("Default_ReportLink") ? "" : t,
    );
    if (grid === before) break;
  }

  // Segment by unit label. Row classes alternate (Default_RowColor /
  // Default_AltRowColor), so keying on one class drops every other unit.
  const marker = /<span onclick="ShowHideDrillPNL\('[^']*'\);">([\s\S]*?)<\/span>/g;
  const starts: { label: string; index: number }[] = [];
  for (const m of grid.matchAll(marker)) {
    const label = stripTags(m[1]);
    if (label) starts.push({ label, index: m.index! });
  }

  for (let i = 0; i < starts.length; i++) {
    const unitLabel = starts[i].label;
    // Bounded by the next unit marker. The last unit's segment runs past its
    // own row into the grand-total block that follows the grid, so we rely on
    // taking only the first cell per metric (below) to stop at the row end.
    const segment = grid.slice(starts[i].index, starts[i + 1]?.index ?? grid.length);
    const idMatch = unitLabel.match(/^(\d+)\s*-\s*(.+)$/);

    const seenMetrics = new Set<string>();
    for (const cell of segment.matchAll(/<td title="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)) {
      const title = cell[1]
        .replace(/&#32;/g, " ")
        .replace(/&#13;&#10;|&#10;/g, "\n")
        .replace(/&amp;/g, "&");
      const [metric, , countLine] = title.split("\n");
      if (!metric) continue;
      // One cell per metric per unit; anything repeating is a stray block.
      if (seenMetrics.has(metric)) continue;
      seenMetrics.add(metric);

      const score = parseFloat(stripTags(cell[2]).replace("%", ""));
      const responses = parseInt((countLine ?? "").replace(/[^0-9-]/g, ""), 10);

      rows.push({
        unitId: idMatch ? idMatch[1] : null,
        unitLabel,
        unitName: idMatch ? idMatch[2].trim() : unitLabel,
        metric: metric.trim(),
        score: Number.isNaN(score) ? null : score,
        responses: Number.isNaN(responses) ? null : responses,
        belowMinResponses: /BelowMinResp/.test(cell[0]),
      });
    }
  }

  return rows;
}

// ── parser ────────────────────────────────────────────────────────────────────

const stripTags = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();

/**
 * Parses the rendered trend grid. Shape (one table per unit):
 *
 *   <table class="trend2-table">
 *     <tr class="measure-header">
 *       <th class="cell-start">36001 - SPRINGFIELD_36001</th>
 *       <th colspan="2">Overall Satisfaction</th> ...
 *     <tr class="measure-header"> <th/><th>Scores</th><th>Responses</th> ...
 *     <tbody class="labels"><tr>
 *       <td><label>Week 18, 2026</label></td>
 *       <td>100%</td><td>12</td> ...
 *
 * Each metric contributes a (score, responses) pair, in header order.
 */
export function parseTrendHtml(html: string): TrendRow[] {
  const rows: TrendRow[] = [];

  for (const table of html.match(/<table class="trend2-table">[\s\S]*?<\/table>/g) ?? []) {
    const headerMatch = table.match(
      /<th class="cell-start">([\s\S]*?)<\/th>([\s\S]*?)<\/tr>/,
    );
    if (!headerMatch) continue;

    const unitLabel = stripTags(headerMatch[1]);
    const metrics = [...headerMatch[2].matchAll(/<th colspan="2"[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
      stripTags(m[1]),
    );
    if (!metrics.length) continue;

    const idMatch = unitLabel.match(/^(\d+)\s*-\s*(.+)$/);
    const storeId = idMatch ? idMatch[1] : null;
    const unitName = idMatch ? idMatch[2].trim() : unitLabel;

    for (const tr of table.match(/<tr class="(?:odd|even)">[\s\S]*?<\/tr>/g) ?? []) {
      const cells = [...tr.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((m) => ({
        attrs: m[1],
        text: stripTags(m[2]),
      }));
      if (cells.length < 3) continue;

      const period = cells[0].text;
      if (!period) continue;

      metrics.forEach((metric, i) => {
        const scoreCell = cells[1 + i * 2];
        const respCell = cells[2 + i * 2];
        if (!scoreCell || !respCell) return;

        const score = parseFloat(scoreCell.text.replace("%", ""));
        const responses = parseInt(respCell.text.replace(/[^0-9-]/g, ""), 10);

        rows.push({
          unitId: storeId,
          unitLabel,
          unitName,
          period,
          metric,
          score: Number.isNaN(score) ? null : score,
          responses: Number.isNaN(responses) ? null : responses,
          belowMinResponses: /BelowMinResp/.test(scoreCell.attrs),
        });
      });
    }
  }

  return rows;
}
