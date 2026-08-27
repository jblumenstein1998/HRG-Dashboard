// PAR/Brink Labor2 field discovery.
//
// Run with:
//   node --env-file=.env.local scripts/par-labor-discovery.mjs
//   node --env-file=.env.local scripts/par-labor-discovery.mjs --start 2026-08-10 --end 2026-08-23
//   node --env-file=.env.local scripts/par-labor-discovery.mjs --store 28901 --dump
//
// Answers two questions the code cannot:
//   1. Which operations does Labor2.svc expose (from its WSDL)?
//   2. Which fields actually come back on a <Shift>, and how often are they
//      populated — across a whole pay period and every store, so a field that
//      is merely rare (a missed clock-out, a minor's break) still shows up.
//
// Reports a field inventory, NOT raw XML: 12 stores x 14 days is ~168
// responses and nobody reads that. Pass --dump to also write the raw
// responses to .par-discovery/ (gitignored — they contain employee PII).
//
// Read-only. Makes no writes to PAR, the database, or the dashboard.

// ── Args ─────────────────────────────────────────────────────────────────────

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}
const hasFlag = (f) => process.argv.includes(f);

// Business dates in Central, matching parRollup.todayCentralISO. "Yesterday" is
// the default end because today's shifts are still open and half its fields are
// legitimately empty — that would skew every fill-rate in the report downward.
function centralToday() {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

function shiftDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

function dateRange(start, end) {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const out = [];
  for (let t = Date.UTC(ys, ms - 1, ds), last = Date.UTC(ye, me - 1, de); t <= last; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const END = arg("--end", shiftDays(centralToday(), -1));
// 14 days = one biweekly pay period. HRG's *fiscal* periods (fiscal.ts) are
// 4-5 weeks Mon-Sun and are a different thing; pass --start/--end for those.
const START = arg("--start", shiftDays(END, -13));
const ONLY_STORE = arg("--store");
const DUMP = hasFlag("--dump");

// ── Config (mirrors src/lib/par.ts) ──────────────────────────────────────────

const BASE_URL = process.env.PAR_BASE_URL ?? "https://api-apiint.brinkpos.net";
const ACCESS_TOKEN = process.env.PAR_ACCESS_TOKEN ?? "";
const IS_SANDBOX = BASE_URL.includes("apiint");

const PROD_STORES = [
  ["36001", "Springfield"], ["42601", "White House"], ["56301", "Brentwood"],
  ["61401", "Spring Hill"], ["28901", "Columbia"],    ["57001", "College"],
  ["57002", "Hampton"],     ["57003", "Oyster"],      ["57004", "Chesapeake"],
  ["57005", "Jefferson"],   ["57006", "Hillcrest"],   ["57007", "Beach"],
];

const STORES = IS_SANDBOX
  ? [["SANDBOX", "API Lab-01"]]
  : ONLY_STORE
    ? PROD_STORES.filter(([id]) => id === ONLY_STORE)
    : PROD_STORES;

const locationToken = (storeId) =>
  IS_SANDBOX ? (process.env.PAR_SANDBOX_LOCATION_TOKEN ?? "") : (process.env[`PAR_TOKEN_${storeId}`] ?? "");

// ── Rate limiting (5 concurrent, per PAR's best-practice guide) ──────────────

class Semaphore {
  constructor(n) { this.permits = n; this.waiters = []; }
  async acquire() {
    if (this.permits > 0) { this.permits--; return; }
    await new Promise((r) => this.waiters.push(r));
  }
  release() {
    const next = this.waiters.shift();
    if (next) next(); else this.permits++;
  }
}
const sem = new Semaphore(5);

async function soapPost(service, action, body, token) {
  await sem.acquire();
  try {
    const res = await fetch(`${BASE_URL}/${service}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": `"${action}"`,
        "AccessToken": ACCESS_TOKEN,
        "LocationToken": token,
      },
      body: `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`,
      signal: AbortSignal.timeout(30_000),
    });
    return { status: res.status, xml: await res.text() };
  } finally {
    sem.release();
  }
}

// ── Generic XML walker ───────────────────────────────────────────────────────
// Deliberately NOT the tagVal/allTags regex approach par.ts uses: those only
// find tags you already know the name of, which is precisely the blind spot
// this script exists to fill. This walks whatever comes back and records every
// leaf path it finds, known or not.

const TOKEN_RE = /<(\/?)([A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?)((?:\s[^>]*?)?)(\/?)>/g;
const localName = (n) => (n.includes(":") ? n.split(":")[1] : n);

function walkLeaves(xml, onLeaf) {
  const stack = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(xml)) !== null) {
    const [, closing, rawName, attrs, selfClose] = m;
    const name = localName(rawName);
    if (closing) {
      const frame = stack.pop();
      if (!frame) continue;
      if (!frame.hadChildren) {
        const path = stack.map((f) => f.name).concat(frame.name).join(".");
        onLeaf(path, xml.slice(frame.contentStart, m.index).trim(), frame.isNil);
      }
    } else {
      if (stack.length) stack[stack.length - 1].hadChildren = true;
      // xsi:nil="true" is a real signal: the field EXISTS in the contract and
      // is explicitly null, which is different from absent. Worth telling apart.
      const isNil = /\bnil\s*=\s*"true"/i.test(attrs);
      if (selfClose) {
        onLeaf(stack.map((f) => f.name).concat(name).join("."), "", isNil);
      } else {
        stack.push({ name, contentStart: TOKEN_RE.lastIndex, hadChildren: false, isNil });
      }
    }
  }
}

// Pull each <Shift> block out of the envelope so paths are relative to it.
function shiftBlocks(xml) {
  const re = /<(?:[a-zA-Z]+:)?Shift(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-zA-Z]+:)?Shift>/gi;
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

// ── PII handling ─────────────────────────────────────────────────────────────
// A field inventory needs to prove a field exists and is populated. It does not
// need to print employee names into a terminal that may end up in a log or a
// screenshot, so identity-ish fields report their shape and nothing else.

const SENSITIVE_RE = /name|ssn|social|email|phone|address|birth|dob|firstn|lastn/i;
const isSensitive = (path) => SENSITIVE_RE.test(path.split(".").pop() ?? "");

function sampleFor(path, values) {
  if (values.size === 0) return "—";
  if (isSensitive(path)) {
    const lens = [...values].map((v) => v.length);
    return `«redacted» (${values.size} distinct, len ${Math.min(...lens)}-${Math.max(...lens)})`;
  }
  return [...values].slice(0, 3).map((v) => (v.length > 32 ? v.slice(0, 29) + "..." : v)).join(" | ");
}

// ── What par.ts reads today ──────────────────────────────────────────────────
// Anything discovered outside this set is data you are already receiving and
// currently throwing away in parseShiftsXml.

const PARSED_TODAY = new Set([
  "MinutesWorked",
  "StartTime.DateTime",
  "EndTime.DateTime",
  "Breaks.Break.StartTime.DateTime",
  "Breaks.Break.EndTime.DateTime",
]);

// ── WSDL: what operations does the service even define? ──────────────────────

async function discoverOperations() {
  for (const suffix of ["?singleWsdl", "?wsdl"]) {
    try {
      const res = await fetch(`${BASE_URL}/Labor2.svc${suffix}`, {
        headers: { "AccessToken": ACCESS_TOKEN },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) continue;
      const wsdl = await res.text();
      const ops = new Set();
      for (const m of wsdl.matchAll(/<(?:[a-zA-Z]+:)?operation\s+name="([^"]+)"/gi)) ops.add(m[1]);
      if (ops.size) return { suffix, ops: [...ops].sort() };
    } catch {
      // fall through to the next suffix / give up quietly — the field
      // inventory below is the primary result, this is a bonus.
    }
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (!ACCESS_TOKEN) {
  console.error("PAR_ACCESS_TOKEN is not set. Run with: node --env-file=.env.local scripts/par-labor-discovery.mjs");
  process.exit(1);
}

const dates = dateRange(START, END);
const jobs = [];
for (const d of dates) for (const [id, name] of STORES) jobs.push({ storeId: id, storeName: name, date: d });

console.log(`PAR Labor2 discovery`);
console.log(`  endpoint : ${BASE_URL}${IS_SANDBOX ? "  (SANDBOX)" : "  (PRODUCTION)"}`);
console.log(`  range    : ${START} -> ${END}  (${dates.length} days)`);
console.log(`  stores   : ${STORES.length}`);
console.log(`  calls    : ${jobs.length}\n`);

const wsdl = await discoverOperations();
if (wsdl) {
  console.log(`Labor2.svc operations (from ${wsdl.suffix}) — ${wsdl.ops.length} defined:`);
  for (const op of wsdl.ops) console.log(`  - ${op}`);
  console.log(`  NOTE: the WSDL lists what the service defines, not what your token is`);
  console.log(`        authorized to call. An operation here can still fault at runtime.\n`);
} else {
  console.log(`Labor2.svc WSDL not retrievable — field inventory below is unaffected.\n`);
}

// path -> { count, nonEmpty, nilCount, values:Set }
const inventory = new Map();
const faults = new Map();
const perStoreShifts = new Map();
let okCalls = 0, faultCalls = 0, shiftCount = 0;

if (DUMP) await (await import("node:fs/promises")).mkdir(".par-discovery", { recursive: true });

let finished = 0;
await Promise.all(jobs.map(async ({ storeId, storeName, date }) => {
  const token = locationToken(storeId);
  if (!token) {
    faults.set(`no PAR_TOKEN_${storeId} in env`, (faults.get(`no PAR_TOKEN_${storeId} in env`) ?? 0) + 1);
    return;
  }

  let xml, status;
  try {
    ({ xml, status } = await soapPost(
      "Labor2.svc",
      "http://www.brinksoftware.com/webservices/labor/v2/ILaborWebService2/GetShifts",
      `<GetShifts xmlns="http://www.brinksoftware.com/webservices/labor/v2"><request><BusinessDate>${date}T00:00:00</BusinessDate></request></GetShifts>`,
      token,
    ));
  } catch (e) {
    faults.set(`transport: ${e.message}`, (faults.get(`transport: ${e.message}`) ?? 0) + 1);
    return;
  } finally {
    finished++;
    if (process.stderr.isTTY) process.stderr.write(`\r  ${finished}/${jobs.length} calls done   `);
  }

  if (DUMP) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(`.par-discovery/${storeId}-${date}.xml`, xml);
  }

  // A SOAP fault is itself a finding: faulting on some stores but not others
  // means the location tokens differ in scope, not that the operation is gone.
  const fault = xml.match(/<(?:[a-zA-Z]+:)?(?:faultstring|Message)(?:\s[^>]*)?>([\s\S]*?)<\//i);
  if (status !== 200 || /<(?:[a-zA-Z]+:)?Fault[\s>]/i.test(xml)) {
    const key = `HTTP ${status}: ${(fault?.[1] ?? "unknown fault").trim().slice(0, 120)}`;
    faults.set(key, (faults.get(key) ?? 0) + 1);
    faultCalls++;
    return;
  }
  okCalls++;

  const blocks = shiftBlocks(xml);
  shiftCount += blocks.length;
  perStoreShifts.set(storeName, (perStoreShifts.get(storeName) ?? 0) + blocks.length);

  for (const block of blocks) {
    walkLeaves(block, (path, value, isNil) => {
      let e = inventory.get(path);
      if (!e) { e = { count: 0, nonEmpty: 0, nilCount: 0, values: new Set() }; inventory.set(path, e); }
      e.count++;
      if (isNil) e.nilCount++;
      else if (value !== "") {
        e.nonEmpty++;
        if (e.values.size < 200) e.values.add(value);
      }
    });
  }
}));
if (process.stderr.isTTY) process.stderr.write("\r" + " ".repeat(40) + "\r");

// ── Report ───────────────────────────────────────────────────────────────────

console.log(`Calls: ${okCalls} ok, ${faultCalls} faulted, ${jobs.length - okCalls - faultCalls} skipped`);
console.log(`Shifts parsed: ${shiftCount}\n`);

if (faults.size) {
  console.log(`Faults (a fault on SOME stores = per-location token scope, not a missing operation):`);
  for (const [msg, n] of [...faults].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}x  ${msg}`);
  console.log();
}

if (shiftCount === 0) {
  console.log(`No shifts returned. Nothing to inventory — widen the range or check the range is not`);
  console.log(`entirely in the future, then re-run.`);
  process.exit(0);
}

// A path that prefixes another discovered path is a container element, not a
// field — an empty <Breaks/> on a shift with no breaks would otherwise report as
// a 0%-filled field and land in the "present but empty" list below, which is
// reserved for fields that are genuinely ambiguous.
const allPaths = [...inventory.keys()];
const containers = new Set(allPaths.filter((p) => allPaths.some((q) => q !== p && q.startsWith(p + "."))));

const rows = [...inventory.entries()]
  .filter(([path]) => !containers.has(path))
  .map(([path, e]) => ({
    path,
    count: e.count,
    fill: e.count ? Math.round((e.nonEmpty / e.count) * 100) : 0,
    distinct: e.values.size,
    nil: e.nilCount,
    sample: e.values.size === 0 && e.nilCount > 0
      ? `xsi:nil on ${e.nilCount}/${e.count}`
      : sampleFor(path, e.values),
    known: PARSED_TODAY.has(path),
  }))
  .sort((a, b) => a.path.localeCompare(b.path));

const w = Math.max(24, ...rows.map((r) => r.path.length));
const header = `${"FIELD".padEnd(w + 1)}  ${"SEEN".padStart(6)}  ${"FILL".padStart(5)}  ${"DIST".padStart(5)}  SAMPLE`;
console.log(`Shift field inventory  (${rows.length} fields across ${shiftCount} shifts` +
  `${containers.size ? `, ${containers.size} container element${containers.size === 1 ? "" : "s"} omitted` : ""})`);
console.log(header);
console.log("-".repeat(header.length));
for (const r of rows) {
  const mark = r.known ? " " : "*";
  const fill = `${r.fill}%`;
  const dist = r.distinct >= 200 ? "200+" : String(r.distinct);
  console.log(`${(mark + r.path).padEnd(w + 1)}  ${String(r.count).padStart(6)}  ${fill.padStart(5)}  ${dist.padStart(5)}  ${r.sample}`);
}

const unused = rows.filter((r) => !r.known);
console.log(`\n* = returned by PAR but NOT read by parseShiftsXml (src/lib/par.ts:191).`);
console.log(`  ${unused.length} of ${rows.length} fields are being discarded today.\n`);

if (unused.length) {
  console.log(`Discarded fields worth a look, best-populated first:`);
  for (const r of [...unused].sort((a, b) => b.fill - a.fill || b.distinct - a.distinct).slice(0, 15)) {
    console.log(`  ${r.fill.toString().padStart(3)}% populated  ${r.distinct.toString().padStart(4)} distinct  ${r.path}`);
  }
  console.log();
}

console.log(`Shifts per store:`);
for (const [name, n] of [...perStoreShifts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(14)} ${n}`);
}

// A field at 0% fill across a whole pay period is the one result that stays
// ambiguous: either PAR never populates it, or nothing in this window
// exercised it. Flag them rather than letting them read as "unavailable".
const empties = rows.filter((r) => r.fill === 0);
if (empties.length) {
  console.log(`\n${empties.length} field(s) present but empty for this entire range — inconclusive,`);
  console.log(`not proof they are unavailable: ${empties.map((r) => r.path).slice(0, 10).join(", ")}`);
}

if (DUMP) console.log(`\nRaw responses written to .par-discovery/ — contains employee PII, gitignored.`);
