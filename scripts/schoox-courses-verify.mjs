// Run with:  node --env-file=.env.local scripts/schoox-courses-verify.mjs
//
// Mirrors lib/schoox.ts's fetchCourses + fetchCourseStores exactly, against the
// live academy, so the two paths behind the ZU tab's course table are known to
// answer before the tab is opened. Prints no credential.

const BASE = "https://app.schoox.com";
const ACADEMY_ID = "1669014345";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const cookiesFrom = (h) => (h.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).filter(Boolean);
const merge = (e, i) => {
  const j = new Map();
  for (const p of [...e.split("; ").filter(Boolean), ...i]) {
    const q = p.indexOf("=");
    if (q > 0) j.set(p.slice(0, q), p.slice(q + 1));
  }
  return [...j].map(([k, v]) => `${k}=${v}`).join("; ");
};

let COOKIES = "";

async function login() {
  const pr = await fetch(`${BASE}/login.php`, { headers: { "User-Agent": UA }, redirect: "manual" });
  let c = merge("", cookiesFrom(pr.headers));
  const html = await pr.text();
  const csrfToken = html.match(/name="csrfToken"[^>]*value="([^"]*)"/)?.[1] ?? "";
  const ar = await fetch(`${BASE}/login/index.php`, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Cookie: c, Origin: BASE, Referer: `${BASE}/login.php` },
    body: new URLSearchParams({ csrfToken, timeZone: "America/New_York", dateFormatClient: "", device_id: "", username: process.env.SCHOOX_USERNAME, password: process.env.SCHOOX_PASSWORD, button: "Log in", redirect: "", who: "", i: "", a: "", ev: "" }).toString(),
    redirect: "manual",
  });
  COOKIES = merge(c, cookiesFrom(ar.headers));
}

async function postJson(path, params) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", Accept: "application/json, text/javascript, */*; q=0.01", Cookie: COOKIES, Origin: BASE, Referer: `${BASE}/academies/panel/dashboard2/training/courses.php?acadId=${ACADEMY_ID}` },
    body: params.toString(),
  });
  return JSON.parse(await res.text());
}

const filterParams = (unitId) =>
  new URLSearchParams({ academyId: ACADEMY_ID, membersType: "3", "sDropDowns[sType]": "0", "sDropDowns[sAboveUnit]": "0", "sDropDowns[sUnit]": unitId, "sDropDowns[sJob]": "0" });

const courseParams = (unitId, start) =>
  new URLSearchParams({ academyId: ACADEMY_ID, membersType: "3", sortBy: "1", search: "", category_id: "0", compliance: "1", complianceDashboard: "1", "sDropDowns[sType]": "0", "sDropDowns[sAboveUnit]": "0", "sDropDowns[sUnit]": unitId, "sDropDowns[sJob]": "0", start: String(start) });

async function fetchCourses(unitId) {
  const out = [];
  for (let start = 0, page = 0; page < 20; page++) {
    const j = await postJson("/academies/panel/organize/actions.php?action=getAcademyCourses&page=dashboard", courseParams(unitId, start));
    const rows = j.courses ?? [];
    for (const c of rows) {
      const g = c.general ?? {};
      out.push({ id: String(c.id ?? ""), name: c.name ?? "", enrolled: g.enrolled ?? 0, complianceRate: typeof g.compliant_rate === "number" ? g.compliant_rate : null, averageProgress: typeof g.average_progress === "number" ? g.average_progress : null, averageTime: g.average_time ?? "", overdue: g.overdue ?? 0 });
    }
    if (!j.loadMore || rows.length === 0) break;
    start += rows.length;
  }
  out.sort((a, b) => (a.complianceRate ?? 101) - (b.complianceRate ?? 101));
  return out;
}

async function main() {
  await login();

  const drop = await postJson("/academies/panel/organize/dropdowns.php", (() => { const b = filterParams("0"); b.set("page", "dashboard"); b.set("init", "true"); return b; })());
  // Mirrors fetchUnits(): the dropdown answers {id, name}, the lib carries
  // {unitId, storeId, label}. Reading u.unitId off the raw dropdown row yields
  // undefined, which Schoox reads as no filter at all — every store then
  // reports the academy number, identically and plausibly.
  const units = (drop.dropdowns?.unit ?? [])
    .filter((u) => u.id !== "0")
    .map((u) => ({ unitId: u.id, name: u.name }));

  const all = await fetchCourses("0");
  console.log(`fetchCourses("0") -> ${all.length} courses, worst first:\n`);
  for (const c of all.slice(0, 5)) {
    console.log(`  ${String(c.complianceRate).padStart(3)}%  ${String(c.enrolled).padStart(4)} enrolled  ${c.averageTime.padStart(8)}  ${c.name.slice(0, 44)}`);
  }

  // fetchCourseStores, for the worst course
  const worst = all[0];
  console.log(`\nfetchCourseStores(${worst.id}) — "${worst.name.slice(0, 40)}":\n`);
  const rows = [];
  for (const u of units) {
    const body = filterParams(u.unitId);
    body.set("courseId", worst.id);
    const j = await postJson("/academies/panel/organize/actions.php?action=getCourseStats&page=dashboard", body);
    const g = j.course?.general ?? {};
    rows.push({ name: u.name, enrolled: g.enrolled_users ?? 0, rate: typeof g.compliant_rate === "number" ? g.compliant_rate : null });
  }
  const shown = rows.filter((r) => r.enrolled > 0).sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101));
  for (const r of shown) console.log(`  ${String(r.rate).padStart(3)}%  ${String(r.enrolled).padStart(3)} enrolled  ${r.name}`);
  console.log(`\n  ${rows.length - shown.length} store(s) with nobody assigned, hidden`);
  console.log(`\nOK — both paths answer.`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
