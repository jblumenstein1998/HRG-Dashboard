// Run with:  node --env-file=.env.local scripts/schoox-courses-explore.mjs
//
// Discovery, not production code. Confirms the course-level contract that
// lib/schoox.ts will be built against, from a cold server-side login — no
// browser, no cached cookie.
//
// The contract, captured off the Training > Courses panel's own XHRs:
//
//   POST /academies/panel/organize/actions.php?action=getAcademyCourses&page=dashboard
//     compliance=1 & complianceDashboard=1   restricts to compliance courses
//     sDropDowns[sUnit]=<unitId>             scopes every number to one store
//     start=<n>                              pages, 20 at a time, `loadMore` says more
//
// The pairing matters: with compliance/complianceDashboard at 0 the unit
// filter is silently ignored and every store reports the academy-wide number.
// Set both to 1 and the same call answers per store. That is the difference
// between one call per store and 68 courses x 12 stores of getCourseStats.
//
// Prints shapes and counts. Never prints a credential.

const BASE = "https://app.schoox.com";
const ACADEMY_ID = "1669014345";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const USERNAME = process.env.SCHOOX_USERNAME;
const PASSWORD = process.env.SCHOOX_PASSWORD;
if (!USERNAME || !PASSWORD) {
  console.error("SCHOOX_USERNAME / SCHOOX_PASSWORD are not set in .env.local");
  process.exit(1);
}

const cookiesFrom = (h) => (h.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).filter(Boolean);

function mergeCookies(existing, incoming) {
  const jar = new Map();
  for (const pair of [...existing.split("; ").filter(Boolean), ...incoming]) {
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function login() {
  const pageRes = await fetch(`${BASE}/login.php`, {
    headers: { "User-Agent": UA },
    redirect: "manual",
  });
  let cookies = mergeCookies("", cookiesFrom(pageRes.headers));
  const html = await pageRes.text();
  const csrfToken = html.match(/name="csrfToken"[^>]*value="([^"]*)"/)?.[1] ?? "";

  const authRes = await fetch(`${BASE}/login/index.php`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies,
      Origin: BASE,
      Referer: `${BASE}/login.php`,
    },
    body: new URLSearchParams({
      csrfToken,
      timeZone: "America/New_York",
      dateFormatClient: "",
      device_id: "",
      username: USERNAME,
      password: PASSWORD,
      button: "Log in",
      redirect: "",
      who: "",
      i: "",
      a: "",
      ev: "",
    }).toString(),
    redirect: "manual",
  });
  return mergeCookies(cookies, cookiesFrom(authRes.headers));
}

let COOKIES = "";

async function post(path, params) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Cookie: COOKIES,
      Origin: BASE,
      Referer: `${BASE}/academies/panel/dashboard2/training/courses.php?acadId=${ACADEMY_ID}`,
    },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  if (!text.length) throw new Error(`empty response from ${path} — unknown action?`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON from ${path} (${text.length}b) — session rejected?`);
  }
}

/** The compliance-course list for one scope, all pages. */
async function courses(unitId) {
  const base = {
    academyId: ACADEMY_ID,
    membersType: "3",
    sortBy: "1",
    search: "",
    category_id: "0",
    compliance: "1",
    complianceDashboard: "1",
    "sDropDowns[sType]": "0",
    "sDropDowns[sAboveUnit]": "0",
    "sDropDowns[sUnit]": unitId,
    "sDropDowns[sJob]": "0",
  };
  const all = [];
  for (let start = 0, page = 0; page < 20; page++) {
    const j = await post(
      "/academies/panel/organize/actions.php?action=getAcademyCourses&page=dashboard",
      { ...base, start: String(start) },
    );
    all.push(...(j.courses ?? []));
    if (!j.loadMore) break;
    start += (j.courses ?? []).length;
  }
  return all;
}

async function main() {
  COOKIES = await login();
  console.log("signed in (cold, headless)\n");

  const drop = await post("/academies/panel/organize/dropdowns.php", {
    academyId: ACADEMY_ID,
    membersType: "3",
    "sDropDowns[sType]": "0",
    "sDropDowns[sAboveUnit]": "0",
    "sDropDowns[sUnit]": "0",
    "sDropDowns[sJob]": "0",
    page: "dashboard",
    init: "true",
  });
  const units = (drop.dropdowns?.unit ?? []).filter((u) => u.id !== "0");
  console.log(`units: ${units.length}`);

  const academy = await courses("0");
  console.log(`academy-wide compliance courses: ${academy.length}`);
  console.log("\nfields on a course:");
  console.log("  " + Object.keys(academy[0] ?? {}).join(", "));
  console.log("  general: " + Object.keys(academy[0]?.general ?? {}).join(", "));

  // The claim under test: the same call, scoped to one store, answers that
  // store's numbers rather than the academy's.
  const unit = units[1];
  const scoped = await courses(unit.id);
  console.log(`\nscoped to ${JSON.stringify(unit.name)}: ${scoped.length} courses`);
  const byId = new Map(scoped.map((c) => [c.id, c]));
  console.log("\n  course                                academy      store");
  for (const c of academy.slice(0, 6)) {
    const s = byId.get(c.id);
    console.log(
      "  " +
        c.name.slice(0, 36).padEnd(38) +
        `${String(c.general.enrolled).padStart(4)}/${String(c.general.compliant_rate).padStart(3)}%` +
        `${String(s?.general.enrolled ?? "-").padStart(8)}/${String(s?.general.compliant_rate ?? "-").padStart(3)}%`,
    );
  }

  const differs = academy.some((c) => byId.get(c.id)?.general.enrolled !== c.general.enrolled);
  console.log(`\nstore filter honoured: ${differs ? "YES" : "NO — numbers identical"}`);
  console.log(`whole grid costs ~${Math.ceil(academy.length / 20) * (units.length + 1)} calls`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
