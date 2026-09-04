// Run with:  node --env-file=.env.local scripts/workstream-discover.mjs
//
// Reads Workstream once and prints what nobody can know without looking:
//
//   1. which auth path works, and whether /tokens returns what the docs claim
//   2. the response envelope — bare array, or wrapped in `data`? unwrapList()
//      in src/lib/workstream.ts currently accepts several shapes because this
//      has never been confirmed against the live account; once it has, that
//      function can collapse to the one true case
//   3. every location with its uuid, next to the PAR store it looks like —
//      the uuids go into workstreamLocationUuid in src/lib/bonus/storeMap.ts
//   4. the real vocabulary of job titles, so the staffing tab's position column
//      can be read before it is built on
//   5. how many employees sit at each location, and how many at none
//
// The store suggestions in (3) are a *suggestion*. Paste the uuid in yourself
// after reading the address — a location matched by name is exactly the mistake
// storeMap.ts exists to prevent.
//
// Nothing is written. No tax, bank or SSN embed is requested. One employee is
// printed in full so the field names can be seen, with the contact details
// blanked — a discovery script should not leave a roster's phone numbers in a
// terminal buffer.

import { readFileSync } from "node:fs";

const BASE = "https://public-api.workstream.us";

// ── Auth ─────────────────────────────────────────────────────────────────────

async function getToken() {
  const id = process.env.WORKSTREAM_CLIENT_ID;
  const secret = process.env.WORKSTREAM_CLIENT_SECRET;
  const staticToken = process.env.WORKSTREAM_ACCESS_TOKEN;

  if (id && secret) {
    console.log("Auth: client_credentials against POST /tokens");
    const res = await fetch(`${BASE}/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: id,
        client_secret: secret,
        name: "HRG Dashboard discovery",
        // Required. Must be a subset of what the Super Admin ticked when the
        // credentials were created, or the reads below 403.
        scopes: ["employees", "locations", "departments", "positions"],
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`  /tokens failed: ${res.status}`);
      console.error(`  ${text.slice(0, 500)}`);
      if (res.status === 400 || res.status === 422) {
        console.error(
          "  A 400/422 here may mean /tokens wants these as query parameters rather\n" +
          "  than a JSON body — the docs describe them as query-based. If so, fix it\n" +
          "  here and in mintToken() in src/lib/workstream.ts together.",
        );
      }
      process.exit(1);
    }
    const parsed = JSON.parse(text);
    console.log(`  keys returned: ${Object.keys(parsed).join(", ")}`);
    const env = parsed.data ?? parsed;
    if (!env.access_token) {
      console.error(`  no access_token in the response: ${text.slice(0, 300)}`);
      process.exit(1);
    }
    console.log(`  expires_in: ${env.expires_in ?? "(absent — the client assumes 7 days)"}`);
    return env.access_token;
  }

  if (staticToken) {
    console.log("Auth: WORKSTREAM_ACCESS_TOKEN (hand-minted, expires in 7 days)");
    return staticToken;
  }

  console.error(
    "Set WORKSTREAM_CLIENT_ID and WORKSTREAM_CLIENT_SECRET, or WORKSTREAM_ACCESS_TOKEN, in .env.local",
  );
  process.exit(1);
}

const token = await getToken();

// ── Fetch ────────────────────────────────────────────────────────────────────

/** One GET, reporting the envelope it found rather than hiding it. */
async function get(path, query = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: text.slice(0, 400) };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, status: res.status, body: `non-JSON: ${text.slice(0, 200)}` };
  }

  let rows = null;
  let envelope = "bare array";
  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (parsed && typeof parsed === "object") {
    for (const key of ["data", "results", "items", "records", "employees", "positions", "locations", "departments"]) {
      if (Array.isArray(parsed[key])) {
        rows = parsed[key];
        envelope = `{ ${key}: [...] } — other keys: ${Object.keys(parsed).filter((k) => k !== key).join(", ") || "none"}`;
        break;
      }
    }
    if (!rows) envelope = `object with keys: ${Object.keys(parsed).join(", ")}`;
  }
  return { ok: true, rows, envelope, parsed };
}

/** Every page. Stops on a short page, same rule as wsPaged in the client. */
async function getAll(path, query = {}) {
  const out = [];
  let envelope = null;
  for (let page = 1; page <= 50; page++) {
    const r = await get(path, { ...query, page, per_page: 100 });
    if (!r.ok) return { ok: false, status: r.status, body: r.body, rows: out };
    envelope ??= r.envelope;
    if (!r.rows) return { ok: true, rows: out, envelope, note: "no array found in the response" };
    out.push(...r.rows);
    if (r.rows.length < 100) break;
  }
  return { ok: true, rows: out, envelope };
}

// ── The PAR store list, read from the source of truth ─────────────────────────

/**
 * Parsed out of storeMap.ts rather than copied, so this script cannot drift
 * from the table it is telling you to fill in.
 */
function parStores() {
  const src = readFileSync(new URL("../src/lib/bonus/storeMap.ts", import.meta.url), "utf8");
  const out = [];
  const re = /storeId:\s*"(\d+)",\s*name:\s*"([^"]+)",\s*state:\s*"(\w+)",\s*berryFragment:\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(src))) {
    out.push({ storeId: m[1], name: m[2], state: m[3], fragment: m[4] });
  }
  return out;
}

const stores = parStores();
console.log(`\nRead ${stores.length} stores from src/lib/bonus/storeMap.ts`);

/** A guess, printed as a guess. Matches on store number, then on address, then on name. */
function guessStore(loc) {
  const hay = [loc.name, loc.address, loc.city].filter(Boolean).join(" ").toLowerCase();
  const byNumber = stores.find((s) => hay.includes(s.storeId));
  if (byNumber) return `${byNumber.storeId} ${byNumber.name} (store number in the text)`;
  const byAddress = stores.find((s) => s.fragment && hay.includes(s.fragment));
  if (byAddress) return `${byAddress.storeId} ${byAddress.name} (street address)`;
  const byName = stores.find((s) => hay.includes(s.name.toLowerCase()));
  if (byName) return `${byName.storeId} ${byName.name} (name only — check this one)`;
  return "no obvious match";
}

// ── Locations ────────────────────────────────────────────────────────────────

console.log("\n=== Locations ==========================================================");
const locations = await getAll("/locations");
if (!locations.ok) {
  console.error(`  failed: ${locations.status} ${locations.body}`);
} else {
  console.log(`  envelope: ${locations.envelope}`);
  console.log(`  ${locations.rows.length} locations\n`);
  for (const l of locations.rows) {
    console.log(`  ${l.uuid ?? l.id ?? "(no uuid field!)"}`);
    console.log(`    name    : ${l.name ?? ""}`);
    console.log(`    address : ${[l.address, l.city, l.state, l.zipcode].filter(Boolean).join(", ")}`);
    console.log(`    looks like: ${guessStore(l)}`);
  }
  console.log("\n  Paste each uuid into workstreamLocationUuid in src/lib/bonus/storeMap.ts.");
}

// ── Departments ──────────────────────────────────────────────────────────────

console.log("\n=== Departments ========================================================");
const departments = await getAll("/departments");
if (!departments.ok) {
  console.error(`  failed: ${departments.status} ${departments.body}`);
} else {
  console.log(`  envelope: ${departments.envelope}`);
  for (const d of departments.rows) console.log(`  ${d.uuid ?? d.id}  ${d.name ?? ""}`);
}

// ── Positions ────────────────────────────────────────────────────────────────

console.log("\n=== Positions (job requisitions) =======================================");
const positions = await getAll("/positions");
if (!positions.ok) {
  console.error(`  failed: ${positions.status} ${positions.body}`);
} else {
  console.log(`  envelope: ${positions.envelope}`);
  console.log(`  ${positions.rows.length} positions`);
  const byTitle = new Map();
  for (const p of positions.rows) {
    const key = `${p.title ?? "(untitled)"} — ${p.status ?? "?"}`;
    byTitle.set(key, (byTitle.get(key) ?? 0) + 1);
  }
  for (const [k, n] of [...byTitle.entries()].sort()) console.log(`  ${String(n).padStart(3)}  ${k}`);
}

// ── Employees ────────────────────────────────────────────────────────────────

console.log("\n=== Employees ==========================================================");
const employees = await getAll("/v2/employees", { embed: "job_assignments,location,department" });
if (!employees.ok) {
  console.error(`  failed: ${employees.status} ${employees.body}`);
  console.error("  (a 403 here usually means the API user lacks the employees scope)");
} else {
  const rows = employees.rows;
  console.log(`  envelope: ${employees.envelope}`);
  console.log(`  ${rows.length} employees\n`);

  const byStatus = new Map();
  for (const e of rows) byStatus.set(e.status ?? "(none)", (byStatus.get(e.status ?? "(none)") ?? 0) + 1);
  console.log("  by status:");
  for (const [k, n] of [...byStatus.entries()].sort()) console.log(`    ${String(n).padStart(4)}  ${k}`);

  const byLocation = new Map();
  for (const e of rows) {
    const key = e.location?.uuid ? `${e.location.uuid}  ${e.location.name ?? ""}` : "(no location)";
    byLocation.set(key, (byLocation.get(key) ?? 0) + 1);
  }
  console.log("\n  by location:");
  for (const [k, n] of [...byLocation.entries()].sort()) console.log(`    ${String(n).padStart(4)}  ${k}`);

  const titles = new Map();
  let withRate = 0;
  let hourly = 0;
  for (const e of rows) {
    for (const a of e.job_assignments ?? []) {
      const t = a.title ?? "(untitled)";
      titles.set(t, (titles.get(t) ?? 0) + 1);
      const rates = a.earning_rates ?? [];
      if (rates.length) withRate++;
      if (rates.some((r) => (r.period ?? "").toLowerCase() === "hour" || (r.earning_type ?? "").toLowerCase() === "hourly")) {
        hourly++;
      }
    }
  }
  console.log("\n  job assignment titles:");
  for (const [t, n] of [...titles.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${t}`);
  }
  console.log(`\n  assignments carrying any earning rate: ${withRate}`);
  console.log(`  assignments carrying an hourly rate   : ${hourly}`);
  console.log("  (if the second number is ~0, `period`/`earning_type` are spelled differently");
  console.log("   than hourlyRate() in src/lib/workstream.ts assumes — fix it there)");

  // How many people could ever link automatically. This is the number that
  // says whether the review queue is a morning's work or a fortnight's.
  const key = (f, l) => `${(f ?? "").trim().toLowerCase()} ${(l ?? "").trim().toLowerCase()}`;
  const nameCounts = new Map();
  for (const e of rows) nameCounts.set(key(e.first_name, e.last_name), (nameCounts.get(key(e.first_name, e.last_name)) ?? 0) + 1);
  const dupes = [...nameCounts.entries()].filter(([, n]) => n > 1);
  console.log(`\n  duplicate first+last names inside Workstream: ${dupes.length}`);
  for (const [n, c] of dupes) console.log(`    ${c}×  ${n}`);
  console.log("  (each of these can never be auto-linked and will always need confirming)");

  const sample = rows[0];
  if (sample) {
    const redacted = {
      ...sample,
      email: sample.email ? "(redacted)" : null,
      phone: sample.phone ? "(redacted)" : null,
    };
    console.log("\n  one employee in full, so the field names can be seen:");
    console.log(JSON.stringify(redacted, null, 2).split("\n").map((l) => `    ${l}`).join("\n"));
  }
}

console.log("\nDone. Nothing was written.");
