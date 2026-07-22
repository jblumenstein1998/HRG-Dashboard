import { chromium, Browser, BrowserContext, Page } from "playwright-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SMG_BASE = "https://reporting.smg.com";

export const SURVEY_ITEMS = ["631212", "631215", "631218", "631220"];
export const METRIC_LABELS: Record<string, string> = {
  "631212": "Overall Satisfaction",
  "631215": "Accuracy of Order",
  "631218": "Friendliness",
  "631220": "Cleanliness",
};

const RANGE_LABEL_MAP: Record<string, string> = {
  "7d": "7 Days",
  "cw": "Current Week",
  "pw": "Previous Week",
  "cp": "Current Period",
  "pp": "Previous Period",
};

export type StoreScore = {
  unitId: string;
  unitName: string;
  scores: Record<string, number | null>;
  counts: Record<string, number>;
};

export type SmgReport = {
  range: { start: string; end: string };
  stores: StoreScore[];
  fetchedAt: number;
};

// ── Browser / session ─────────────────────────────────────────────────────────

let browser: Browser | null = null;
let ctx: BrowserContext | null = null;
let smgLoggedIn = false;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
  });
  ctx = null;
  smgLoggedIn = false;
  return browser;
}

async function getContext(): Promise<BrowserContext> {
  const b = await getBrowser();
  if (ctx) return ctx;
  ctx = await b.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  });
  return ctx;
}

async function ensureLoggedIn(): Promise<BrowserContext> {
  const context = await getContext();
  if (smgLoggedIn) return context;

  const username = process.env.SMG_USERNAME;
  const password = process.env.SMG_PASSWORD;
  if (!username || !password) throw new Error("SMG_USERNAME / SMG_PASSWORD not set");

  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  try {
    await page.goto(`${SMG_BASE}/index.aspx`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("#ctl00_cphMain_txtUserName", { timeout: 15_000 });
    await page.fill("#ctl00_cphMain_txtUserName", username);
    await page.fill("#ctl00_cphMain_txtPassword", password);
    await page.waitForSelector("#smg360LoginButton:not([disabled])", { timeout: 10_000 }).catch(() => {});
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {}),
      page.click("#smg360LoginButton"),
    ]);
    await new Promise(r => setTimeout(r, 2000));
    const url = page.url();
    if (url.includes("index.aspx") || url.includes("AppError")) {
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
      if (page.url().includes("index.aspx") || page.url().includes("AppError")) {
        throw new Error("SMG login failed — check credentials");
      }
    }
    smgLoggedIn = true;
    console.log("[SMG] logged in:", page.url());
  } finally {
    await page.close();
  }
  return context;
}

// ── Report cache ──────────────────────────────────────────────────────────────

const reportCache = new Map<string, SmgReport>();
const CACHE_TTL_MS = 60 * 60 * 1000;

// ── Main fetch ────────────────────────────────────────────────────────────────

export async function fetchSmgReport(start: string, end: string, rangeKey = "cp"): Promise<SmgReport> {
  const cKey = `${start}__${end}__${rangeKey}`;
  const cached = reportCache.get(cKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  const context = await ensureLoggedIn();
  const page = await context.newPage();
  // Prevent default timeout from cutting off slow dashboards
  page.setDefaultNavigationTimeout(90_000);
  page.setDefaultTimeout(90_000);

  // Capture every .ashx response in full for diagnostics
  const intercepted = new Map<string, string>(); // url -> body
  page.on("response", async resp => {
    const url = resp.url();
    if (!url.includes(".ashx")) return;
    const body = await resp.text().catch(() => "");
    intercepted.set(url, body);
    console.log(`[SMG] XHR: ${url.replace(SMG_BASE, "")} — ${body.length} bytes`);
    if (body.length > 0 && body.length < 2000) {
      console.log(`[SMG] XHR body: ${body}`);
    } else if (body.length >= 2000) {
      console.log(`[SMG] XHR body (first 1000): ${body.slice(0, 1000)}`);
    }
  });

  try {
    await page.goto(`${SMG_BASE}/dashboard.aspx?ID=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });

    if (!page.url().includes("dashboard")) {
      smgLoggedIn = false;
      ctx = null;
      throw new Error("SMG session expired — retry the request");
    }

    // Wait for first networkidle, then wait for component AJAX to fire and settle.
    // The dashboard loads a shell first, then each widget fires its own XHR —
    // so we need to wait for those secondary requests to complete too.
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    console.log("[SMG] initial networkidle — XHRs so far:", intercepted.size);

    // Wait for at least one .ashx response (component data loading)
    if (intercepted.size === 0) {
      await page.waitForResponse(r => r.url().includes(".ashx"), { timeout: 20_000 }).catch(() => {});
    }
    // Let all remaining component requests settle
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    console.log("[SMG] components settled — XHRs:", intercepted.size, "| url:", page.url());

    // ── Dump page state so we can identify the correct selectors ─────────────
    await dumpPageState(page).catch(e => console.log("[SMG] dumpPageState error:", e.message));

    // ── Step 1: Ensure "Visit Date" is selected ───────────────────────────────
    // Screenshot shows it's pre-selected, but click it to be sure and trigger
    // component refresh before we read data.
    const visitDateClicked = await tryClick(page, [
      'input[type="radio"][id*="isit" i]',
      'input[type="radio"][value*="isit" i]',
      'label:has-text("Visit Date")',
      'span:has-text("Visit Date")',
    ], "Visit Date");

    if (visitDateClicked) {
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      console.log("[SMG] After Visit Date confirm — XHRs:", intercepted.size);
    } else {
      console.log("[SMG] Visit Date radio not found — checking current state...");
      await dumpDateControls(page).catch(e => console.log("[SMG] dumpDateControls error:", e.message));
    }

    // ── Step 2: Set date range via the dropdowns visible in Highest/Lowest ────
    const rangeLabel = RANGE_LABEL_MAP[rangeKey] ?? "Current Period";
    const rangeSet = await trySelectOptionByRegex(page, [
      'select[id*="aterange" i]',
      'select[id*="daterange" i]',
      'select[id*="range" i]',
      'select[id*="period" i]',
      'select[id*="date" i]',
    ], new RegExp(rangeLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `date range "${rangeLabel}"`);

    if (!rangeSet) {
      console.log(`[SMG] date range "${rangeLabel}" not set — dumping selects`);
      await dumpAllSelects(page).catch(e => console.log("[SMG] dumpAllSelects error:", e.message));
    } else {
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    }

    // ── Step 3: Set report level to Location if possible ─────────────────────
    const locationFiltered = await trySelectOptionByRegex(page, [
      'select[id*="evel" i]',
      'select[id*="roup" i]',
      'select[id*="ilter" i]',
      'select[id*="ocation" i]',
      'select[id*="report" i]',
    ], /location/i, "Location level");

    if (locationFiltered) {
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    } else {
      console.log("[SMG] Location filter not found — using current grouping");
    }

    // ── Step 4: Find the "How Do I Compare" endpoint from intercepted XHRs ───
    console.log(`[SMG] Total intercepted XHRs: ${intercepted.size}`);
    for (const [url, body] of intercepted) {
      console.log(`[SMG]   ${url.replace(SMG_BASE, "")}  (${body.length}b)`);
    }

    // Find the best candidate for comparison data
    let compareBaseUrl: string | null = null;
    for (const [url, body] of intercepted) {
      const lower = url.toLowerCase();
      if (lower.includes("compare") || lower.includes("howdo") || lower.includes("scorecard")) {
        compareBaseUrl = url.split("?")[0];
        console.log("[SMG] compare endpoint candidate:", url.replace(SMG_BASE, ""));
        break;
      }
    }
    // Fallback: any .ashx that returned JSON with array data
    if (!compareBaseUrl) {
      for (const [url, body] of intercepted) {
        try {
          const parsed = JSON.parse(body);
          if (Array.isArray(parsed) || (parsed && typeof parsed === "object")) {
            compareBaseUrl = url.split("?")[0];
            console.log("[SMG] using first JSON .ashx as compare candidate:", url.replace(SMG_BASE, ""));
            break;
          }
        } catch { /* not JSON */ }
      }
    }

    // ── Step 5: Fetch per-metric comparison data ──────────────────────────────
    const metricScores = new Map<string, Map<string, { score: number; count: number }>>();

    for (const itemId of SURVEY_ITEMS) {
      const label = METRIC_LABELS[itemId];
      // Use context.request — runs in Node.js, immune to page navigation
      const body = await fetchCompareBody(context, itemId, compareBaseUrl, intercepted);
      console.log(`[SMG] ${label} (${itemId}) raw body: ${body.slice(0, 800)}`);

      const units = parseCompareBody(body);
      console.log(`[SMG] ${label}: ${units.size} units parsed`);
      for (const [unitName, data] of units) {
        console.log(`  └ ${unitName}: ${data.score.toFixed(1)}% (n=${data.count})`);
      }
      metricScores.set(itemId, units);
    }

    // ── Step 6: DOM table fallback ────────────────────────────────────────────
    const totalUnits = Array.from(metricScores.values()).reduce((s, m) => s + m.size, 0);
    if (totalUnits === 0) {
      console.log("[SMG] HTTP approach yielded no data — trying DOM table read");
      await page.screenshot({ path: "smg-debug.png", fullPage: true }).catch(() => {});
      const domScores = await readCompareTableFromDom(page).catch(() => new Map<string, Record<string, number>>());
      console.log(`[SMG] DOM read: ${domScores.size} units`);
      for (const [unitName, itemScores] of domScores) {
        for (const [iId, score] of Object.entries(itemScores)) {
          if (!metricScores.has(iId)) metricScores.set(iId, new Map());
          metricScores.get(iId)!.set(unitName, { score, count: 0 });
        }
      }
    }

    // ── Build StoreScore list ─────────────────────────────────────────────────
    const allUnits = new Set<string>();
    for (const scores of metricScores.values()) {
      for (const unitName of scores.keys()) allUnits.add(unitName);
    }

    const stores: StoreScore[] = Array.from(allUnits).map(unitName => {
      const scores: Record<string, number | null> = {};
      const counts: Record<string, number> = {};
      for (const itemId of SURVEY_ITEMS) {
        const data = metricScores.get(itemId)?.get(unitName);
        scores[itemId] = data?.score ?? null;
        counts[itemId] = data?.count ?? 0;
      }
      return { unitId: unitName, unitName, scores, counts };
    });

    console.log("[SMG] final store count:", stores.length);

    if (stores.length === 0) {
      await page.screenshot({ path: "smg-debug.png", fullPage: true }).catch(() => {});
      const pageText = await page.evaluate(() => document.body.innerText.slice(0, 5000)).catch(() => "");
      console.log("[SMG] ERROR no data. Page text:\n", pageText);
      throw new Error("SMG returned no store data — check server logs and smg-debug.png");
    }

    const report: SmgReport = { range: { start, end }, stores, fetchedAt: Date.now() };
    reportCache.set(cKey, report);
    return report;
  } finally {
    await page.close();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function tryClick(page: Page, selectors: string[], label: string): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3_000 })) {
        await el.click({ timeout: 5_000 });
        console.log(`[SMG] clicked "${label}" via: ${sel}`);
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

// Fixed: properly matches options by RegExp instead of passing RegExp as label string
async function trySelectOptionByRegex(
  page: Page,
  selectSelectors: string[],
  optionPattern: RegExp,
  label: string
): Promise<boolean> {
  for (const sel of selectSelectors) {
    try {
      const el = page.locator(sel).first();
      if (!(await el.isVisible({ timeout: 3_000 }))) continue;

      const options = await el.locator("option").all();
      const optTexts: string[] = [];
      for (const opt of options) {
        const text = (await opt.textContent() ?? "").trim();
        optTexts.push(text);
        if (optionPattern.test(text)) {
          const value = await opt.getAttribute("value") ?? text;
          await el.selectOption(value);
          console.log(`[SMG] selected "${label}" (matched option "${text}") via: ${sel}`);
          return true;
        }
      }
      console.log(`[SMG] select "${sel}" found but no option matched ${optionPattern}. Options: [${optTexts.join(", ")}]`);
    } catch (e) {
      console.log(`[SMG] trySelectOptionByRegex error for ${sel}:`, e);
    }
  }
  return false;
}

// Fetch per-metric comparison data using context.request (Node.js side, immune to page navigation)
async function fetchCompareBody(
  context: BrowserContext,
  surveyItemId: string,
  compareBaseUrl: string | null,
  intercepted: Map<string, string>
): Promise<string> {
  const r = Date.now();
  const candidateUrls: string[] = [];

  // Best candidates: re-use intercepted .ashx bases with our params
  for (const [url] of intercepted) {
    const base = url.split("?")[0];
    candidateUrls.push(`${base}?function=getnewdata&surveyitem=${surveyItemId}&reportlevel=10&datetype=1&r=${r}`);
    candidateUrls.push(`${base}?function=getdata&surveyitem=${surveyItemId}&reportlevel=10&datetype=1&r=${r}`);
  }

  if (compareBaseUrl) {
    candidateUrls.unshift(`${compareBaseUrl}?function=getnewdata&surveyitem=${surveyItemId}&reportlevel=10&datetype=1&r=${r}`);
    candidateUrls.unshift(`${compareBaseUrl}?function=getdata&surveyitem=${surveyItemId}&reportlevel=10&datetype=1&r=${r}`);
  }

  // Fallback guesses
  for (const g of ["HowDoICompare", "HowDoICompareComponent", "HighLowComponent", "ScorecardComponent", "CompareComponent"]) {
    candidateUrls.push(`${SMG_BASE}/handlers/HomepageComponents/${g}.ashx?function=getnewdata&surveyitem=${surveyItemId}&reportlevel=10&datetype=1&r=${r}`);
  }

  const deduped = [...new Set(candidateUrls)];
  for (const url of deduped) {
    try {
      const resp = await context.request.get(url);
      if (!resp.ok()) continue;
      const text = await resp.text();
      if (text && text.trim().length > 5) {
        console.log(`[SMG] ${surveyItemId} data from: ${url.replace(SMG_BASE, "")}`);
        return text;
      }
    } catch { /* try next */ }
  }

  console.log(`[SMG] ${surveyItemId} — no endpoint returned data (tried ${deduped.length} URLs)`);
  return "";
}

function parseCompareBody(body: string): Map<string, { score: number; count: number }> {
  const units = new Map<string, { score: number; count: number }>();
  if (!body || !body.trim()) return units;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    console.log("[SMG] parseCompareBody: not JSON:", body.slice(0, 100));
    return units;
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  for (const el of candidates) {
    if (!el || typeof el !== "object") continue;
    const obj = el as Record<string, unknown>;

    // Log all top-level keys so we can identify the structure
    console.log("[SMG] response keys:", Object.keys(obj).join(", "));

    // Try every known data array key
    const dataKeys = ["HiLowData", "HowDoICompareData", "ScorecardData", "CompareData", "Data",
                      "LocationData", "UnitData", "StoreData", "Rows", "Items", "Results"];
    for (const key of dataKeys) {
      const arr = obj[key];
      if (!Array.isArray(arr) || arr.length === 0) continue;
      console.log(`[SMG] trying key "${key}" (${arr.length} rows), sample:`, JSON.stringify(arr[0]));

      for (const row of arr as Record<string, unknown>[]) {
        const name = String(
          row.Region ?? row.Unit ?? row.Location ?? row.Store ?? row.Name ?? row.UnitName ?? row.LocationName ?? ""
        ).trim();
        const rawScore = String(row.TopBox ?? row.Score ?? row.Value ?? row.Percent ?? row.Pct ?? "")
          .replace("%", "").trim();
        const score = parseFloat(rawScore);
        const count = Number(row.Responses ?? row.Count ?? row.N ?? 0);
        if (name && !isNaN(score)) units.set(name, { score, count });
      }
      if (units.size > 0) {
        console.log(`[SMG] parsed ${units.size} units from key "${key}"`);
        return units;
      }
    }

    // If it's an array itself, try treating each element as a unit row
    if (Array.isArray(parsed)) {
      for (const row of parsed as Record<string, unknown>[]) {
        const name = String(
          row.Region ?? row.Unit ?? row.Location ?? row.Store ?? row.Name ?? row.UnitName ?? ""
        ).trim();
        const rawScore = String(row.TopBox ?? row.Score ?? row.Value ?? row.Percent ?? "")
          .replace("%", "").trim();
        const score = parseFloat(rawScore);
        const count = Number(row.Responses ?? row.Count ?? 0);
        if (name && !isNaN(score)) units.set(name, { score, count });
      }
      if (units.size > 0) {
        console.log(`[SMG] parsed ${units.size} units from top-level array`);
        return units;
      }
    }
  }

  return units;
}

async function readCompareTableFromDom(page: Page): Promise<Map<string, Record<string, number>>> {
  const result = await page.evaluate((itemIds: string[]) => {
    const out: Record<string, Record<string, number>> = {};
    const tables = Array.from(document.querySelectorAll("table"));
    console.log("[SMG DOM] table count:", tables.length);

    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll("tr"));
      if (rows.length < 2) continue;
      const headerText = (rows[0] as HTMLElement).innerText.trim();
      console.log("[SMG DOM] table header:", headerText.slice(0, 120));

      for (let i = 1; i < rows.length; i++) {
        const cells = Array.from(rows[i].querySelectorAll("td, th"))
          .map(c => (c as HTMLElement).innerText.trim());
        if (cells.length < 2) continue;
        const name = cells[0];
        if (!name) continue;
        const nums = cells.slice(1)
          .map(c => parseFloat(c.replace("%", "").trim()))
          .filter(n => !isNaN(n) && n >= 0 && n <= 100);
        if (nums.length > 0) {
          out[name] = out[name] ?? {};
          itemIds.forEach((id, idx) => {
            if (nums[idx] !== undefined) out[name][id] = nums[idx];
          });
        }
      }
    }
    return out;
  }, SURVEY_ITEMS);

  const map = new Map<string, Record<string, number>>();
  for (const [name, scores] of Object.entries(result as Record<string, Record<string, number>>)) {
    map.set(name, scores);
  }
  return map;
}

// ── Diagnostic helpers ────────────────────────────────────────────────────────

async function dumpPageState(page: Page): Promise<void> {
  const state = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll("select")).map(s => ({
      id: s.id, name: s.name,
      options: Array.from(s.options).map(o => `${o.value}=${o.text.trim()}`),
      selected: s.value,
    }));
    const radios = Array.from(document.querySelectorAll('input[type="radio"]')).map(r => {
      const inp = r as HTMLInputElement;
      const lbl = document.querySelector(`label[for="${inp.id}"]`);
      return { id: inp.id, name: inp.name, value: inp.value, checked: inp.checked, label: (lbl as HTMLElement)?.innerText?.trim() ?? "" };
    });
    const links = Array.from(document.querySelectorAll("a, [role='tab'], [class*='tab']"))
      .map(a => (a as HTMLElement).innerText.trim())
      .filter(t => t.length > 0 && t.length < 50)
      .slice(0, 30);
    return { selects, radios, links };
  });

  console.log("[SMG] PAGE SELECTS:", JSON.stringify(state.selects, null, 2));
  console.log("[SMG] PAGE RADIOS:", JSON.stringify(state.radios, null, 2));
  console.log("[SMG] PAGE LINKS/TABS:", state.links.join(" | "));
}

async function dumpDateControls(page: Page): Promise<void> {
  const text = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("*"))
      .filter(el => {
        const t = (el as HTMLElement).innerText?.trim() ?? "";
        return (t.toLowerCase().includes("visit") || t.toLowerCase().includes("survey") || t.toLowerCase().includes("date type"))
          && t.length < 200 && el.children.length === 0;
      })
      .map(el => {
        const e = el as HTMLElement;
        return `[${el.tagName}#${el.id}.${el.className.split(" ")[0]}] "${e.innerText.trim()}"`;
      });
    return els.slice(0, 20);
  });
  console.log("[SMG] Date-type controls found:", text.join("\n  "));
}

async function dumpAllSelects(page: Page): Promise<void> {
  const selects = await page.evaluate(() =>
    Array.from(document.querySelectorAll("select")).map(s => ({
      id: s.id, name: s.name,
      options: Array.from(s.options).map(o => o.text.trim()),
    }))
  );
  console.log("[SMG] ALL SELECTS:", JSON.stringify(selects, null, 2));
}

export function invalidateSmgCache() {
  reportCache.clear();
}
