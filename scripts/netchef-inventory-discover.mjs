// Run with:  node --env-file=.env.local scripts/netchef-inventory-discover.mjs
//
// Finds the Daily Inventory Counts endpoint so lib/netchef.ts can call it.
//
// netchef-discover.mjs does this by driving a real Chrome and watching XHR,
// which works but needs a human to log in — and the ExtJS UI renders blank
// under automation, so it can't be scripted. This does it server-side instead,
// reusing the same three-step login lib/netchef.ts already relies on, then
// reading the app's own JS for every /resource/ path it knows how to call.
// Grepping the bundle beats guessing endpoint names.

const NC_BASE = "https://zaxbys.net-chef.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const username = process.env.NETCHEF_USERNAME;
const password = process.env.NETCHEF_PASSWORD;
if (!username || !password) {
  console.error("NETCHEF_USERNAME / NETCHEF_PASSWORD not set");
  process.exit(1);
}

const cookiesFrom = (headers) => {
  const set = headers.getSetCookie?.() ?? [];
  return set.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
};
const merge = (a, b) => {
  const m = new Map();
  for (const part of `${a}; ${b}`.split(";")) {
    const t = part.trim();
    if (!t) continue;
    const i = t.indexOf("=");
    if (i > 0) m.set(t.slice(0, i), t.slice(i + 1));
  }
  return [...m].map(([k, v]) => `${k}=${v}`).join("; ");
};

// ── login (mirrors lib/netchef.ts) ───────────────────────────────────────────

console.log("logging in…");
const pageRes = await fetch(`${NC_BASE}/standalone/modern.ct`, {
  headers: { "User-Agent": UA, Accept: "text/html,*/*" },
  redirect: "follow",
});
const html = await pageRes.text();
let cookies = cookiesFrom(pageRes.headers);
if (!cookies.includes("JSESSIONID")) {
  console.error("no JSESSIONID — site may be down");
  process.exit(1);
}

const authRes = await fetch(`${NC_BASE}/resource/ceslogin/auth`, {
  method: "POST",
  headers: {
    Accept: "*/*",
    "Content-Type": "application/json",
    Cookie: cookies,
    Origin: NC_BASE,
    Referer: `${NC_BASE}/standalone/modern.ct`,
    "X-Requested-With": "XMLHttpRequest",
    "X-CSRF-Token": "null",
    "User-Agent": UA,
  },
  body: JSON.stringify({ username, password, language: "eng" }),
});
const authBody = await authRes.json().catch(() => ({}));
console.log(`auth: ${authRes.status} success=${authBody.success}`);
if (!authBody.success) process.exit(1);

cookies = merge(cookies, cookiesFrom(authRes.headers));
if (process.env.NETCHEF_SESSION_ID_UTF) {
  cookies = merge(cookies, `session_idUTF=${process.env.NETCHEF_SESSION_ID_UTF}`);
}

const chooseRes = await fetch(`${NC_BASE}/resource/ceslogin/choose-location`, {
  method: "POST",
  headers: {
    Accept: "*/*",
    "Content-Type": "application/json",
    Cookie: cookies,
    Origin: NC_BASE,
    Referer: `${NC_BASE}/standalone/modern.ct`,
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": UA,
  },
  body: JSON.stringify({ locationId: 425, supplyId: null, language: "eng" }),
});
console.log(`choose-location: ${chooseRes.status}`);
cookies = merge(cookies, cookiesFrom(chooseRes.headers));

// ── harvest /resource/ paths from the app's own JS ───────────────────────────

console.log("\nreading app bundles…");

// modern.ct is only a shell; the application that calls /resource/* lives under
// /ncext/, which is what ncFetch already sends as its Referer. Scan both, and
// follow the scripts each of them pulls in.
const shells = [
  ["modern.ct", html],
];
for (const p of ["/ncext/index.ct", "/ncext/", "/standalone/index.ct"]) {
  try {
    const r = await fetch(`${NC_BASE}${p}`, {
      headers: { Cookie: cookies, "User-Agent": UA, Accept: "text/html,*/*" },
      redirect: "follow",
    });
    const t = await r.text();
    console.log(`  GET ${p.padEnd(22)} ${r.status}  ${t.length} bytes`);
    if (r.ok && t.length > 200) shells.push([p, t]);
  } catch (e) {
    console.log(`  GET ${p.padEnd(22)} ERR ${e.message}`);
  }
}

const urls = new Set();
for (const [, doc] of shells) {
  for (const m of doc.matchAll(/(?:src|href)=["']([^"']+\.js[^"']*)["']/g)) {
    const s = m[1];
    urls.add(s.startsWith("http") ? s : `${NC_BASE}${s.startsWith("/") ? "" : "/"}${s}`);
  }
}
console.log(`\n${urls.size} script(s) referenced across ${shells.length} shell(s)`);

const paths = new Set();
let scanned = 0;
for (const url of urls) {
  try {
    const r = await fetch(url, { headers: { Cookie: cookies, "User-Agent": UA } });
    if (!r.ok) continue;
    const text = await r.text();
    scanned += text.length;
    for (const m of text.matchAll(/['"`](\/resource\/[A-Za-z0-9_\-/]{3,80})['"`]/g)) paths.add(m[1]);
  } catch {}
}
console.log(`scanned ${(scanned / 1e6).toFixed(1)} MB, found ${paths.size} distinct /resource/ paths`);

const KEY = /invent|count|par|usage|waste|prep|sheet/i;
const hits = [...paths].filter((p) => KEY.test(p)).sort();

console.log(`\n── inventory/count-shaped endpoints (${hits.length}) ──`);
for (const p of hits) console.log("  " + p);

if (!hits.length) {
  console.log("\n(none matched — first 40 paths for orientation:)");
  for (const p of [...paths].sort().slice(0, 40)) console.log("  " + p);
}

// ── call the Daily Inventory Counts report ───────────────────────────────────
//
// Same envelope the working actualvstheoretical call uses, since these two
// endpoints share a naming pattern (…/location/details) and almost certainly a
// controller shape.

const ncPost = async (path, body) => {
  const r = await fetch(`${NC_BASE}${path}?_dc=${Date.now()}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookies,
      Origin: NC_BASE,
      Referer: `${NC_BASE}/ncext/index.ct`,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": UA,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};

// A recent complete week.
const START = "08/03/2026";
const END = "08/09/2026";
const LOCATION = 425; // Brentwood

const describe = (v, depth = 0) => {
  if (v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return `Array(${v.length})` + (v.length && depth < 1 ? ` of ${describe(v[0], depth + 1)}` : "");
  if (typeof v === "object") return `{ ${Object.keys(v).slice(0, 14).join(", ")} }`;
  return typeof v;
};

console.log("\n── calling dailyinventorycounts ──");

for (const [label, path, body] of [
  ["templates", "/resource/inventory/dailyinventorycounts/templates", {}],
  [
    "location/details",
    "/resource/inventory/dailyinventorycounts/location/details",
    {
      extraCriteriaMap: { startDate: START, endDate: END, locationIdFilter: LOCATION, isConsolidated: false },
      pagingInfo: { page: 1, start: 0, limit: 100000 },
    },
  ],
]) {
  const { status, json, text } = await ncPost(path, body);
  console.log(`\n${label}  →  ${status}`);
  if (!json) { console.log("  non-JSON:", text.slice(0, 200)); continue; }
  console.log("  top level:", describe(json));
  for (const k of Object.keys(json).slice(0, 10)) {
    console.log(`    ${k}: ${describe(json[k])}`);
  }
  // First row in whichever array looks like the data.
  const arrKey = Object.keys(json).find((k) => Array.isArray(json[k]) && json[k].length);
  if (arrKey) {
    console.log(`\n  first row of ${arrKey}:`);
    console.log("  " + JSON.stringify(json[arrKey][0], null, 2).split("\n").join("\n  ").slice(0, 1200));
  }

  if (label === "templates") {
    console.log("\n  all template key/value pairs:");
    for (const t of json) console.log(`    ${String(t.key).padEnd(28)} ${t.value}`);
  }
}

// ── what the counts actually look like across a week ─────────────────────────
//
// The question the bonus tab needs answered is yes/no per day (AM and PM) and
// yes/no per week (full count). A count "happened" if rows of that type exist
// on that date — the report is per product, so presence is the signal and the
// quantities are beside the point here.

console.log("\n── one location, one week, grouped ──");

const { json: wk } = await ncPost("/resource/inventory/dailyinventorycounts/location/details", {
  extraCriteriaMap: { startDate: START, endDate: END, locationIdFilter: LOCATION, isConsolidated: false },
  pagingInfo: { page: 1, start: 0, limit: 100000 },
});

const rows = (wk?.rows ?? []).filter((r) => !r.totalRow);
const types = new Map();
for (const r of rows) types.set(r.inventoryType, r.inventoryTypeLabel);
console.log(`\ndistinct inventoryType values in ${rows.length} rows:`);
for (const [k, v] of types) console.log(`  ${String(k).padEnd(14)} ${v}`);

// Day → type → how many product rows, plus the earliest clock time seen.
const byDay = new Map();
for (const r of rows) {
  const day = String(r.statusDate).split(" ")[0];
  if (!byDay.has(day)) byDay.set(day, new Map());
  const m = byDay.get(day);
  const cur = m.get(r.inventoryType) ?? { n: 0, first: null };
  cur.n++;
  const t = String(r.statusDate).split(" ")[1] ?? "";
  if (!cur.first || t < cur.first) cur.first = t;
  m.set(r.inventoryType, cur);
}
console.log("\nday → counts performed:");
for (const day of [...byDay.keys()].sort()) {
  const parts = [...byDay.get(day)].map(([t, { n, first }]) => `${t}(${n} items @ ${first})`);
  console.log(`  ${day}  ${parts.join("  ")}`);
}
