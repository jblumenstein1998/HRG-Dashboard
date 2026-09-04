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

/** uuid → location name, filled in by the Locations section and read later. */
const locNameGlobal = new Map();

/**
 * The store map, derived from evidence instead of from names.
 *
 * Workstream's manager logins are store mailboxes carrying the PAR store number
 * (`hampton57002@zaxbys.com`), and each user's `permission_config.locations`
 * names the uuid they administer. Joining those two gives a PAR store id and a
 * Workstream location uuid in the same record, with nobody reading a name.
 *
 * It matters: 57006's mailbox is `chesapeake57006@zaxbys.com` and administers
 * Hillcrest. Name matching would have put Hillcrest's people under Chesapeake.
 */
async function deriveFromManagers(locName) {
  const users = await getAll("/company_users");
  if (!users.ok) {
    console.log(`  (could not read /company_users: ${users.status})`);
    return { derived: new Map(), userCounts: new Map() };
  }

  const derived = new Map();
  const userCounts = new Map();
  for (const u of users.rows) {
    const locs = u.permission_config?.locations ?? [];
    for (const l of locs) userCounts.set(l.uuid, (userCounts.get(l.uuid) ?? 0) + 1);

    const storeId = (u.user?.email ?? "").match(/(\d{5})/)?.[1];
    if (!storeId || locs.length !== 1) continue;
    derived.set(storeId, locs[0].uuid);
    console.log(`  ${storeId}  ${(u.user?.email ?? "").padEnd(36)} ${locName.get(locs[0].uuid) ?? locs[0].uuid}`);
  }
  return { derived, userCounts };
}

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
  console.log(`  ${locations.rows.length} locations`);

  const locName = new Map(locations.rows.map((l) => [l.uuid, l.name]));
  for (const [k, v] of locName) locNameGlobal.set(k, v);

  console.log("\n  Store ids from numbered manager mailboxes — this is the evidence:");
  const { derived, userCounts } = await deriveFromManagers(locName);

  console.log("\n  Every location. `users` is how many managers administer it —");
  console.log("  an operating restaurant has several; the `- Corporate` twins have none.");
  console.log("\n  users  store  uuid                                  name");
  for (const l of locations.rows) {
    const storeId = [...derived.entries()].find(([, uuid]) => uuid === l.uuid)?.[0];
    console.log(
      `  ${String(userCounts.get(l.uuid) ?? 0).padStart(5)}  ${(storeId ?? "—").padStart(5)}  ${l.uuid}  ${l.name ?? ""}`
        + (storeId ? "" : `   [${guessStore(l)}]`),
    );
  }
  console.log("\n  Anything without a store id above is a name match and wants a human.");
  console.log("  Paste confirmed uuids into workstreamLocationUuid in src/lib/bonus/storeMap.ts.");
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
// The parentheses are mandatory. Without them the parameter is accepted and
// ignored, and every nested object silently disappears — which reads as an API
// that does not have the data. `information` is never requested: it returns
// plaintext SSNs.
const employees = await getAll("/v2/employees", {
  embed: "(job_assignments,company,location,department)",
});
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

  // The location that counts is the one on the job assignment. The employee's
  // own `location` is routinely null even when embedded.
  const primary = (e) => {
    const all = e.job_assignments ?? [];
    return all.find((a) => a.primary && a.status === "active")
      ?? all.find((a) => a.status === "active")
      ?? all.find((a) => a.primary)
      ?? all[0]
      ?? null;
  };

  const byLocation = new Map();
  for (const e of rows) {
    const a = primary(e);
    const uuid = a?.location_id ?? a?.working_location?.core_location_id ?? e.location?.uuid ?? null;
    const key = uuid ? `${uuid}  ${locNameGlobal.get(uuid) ?? ""}` : "(no location)";
    byLocation.set(key, (byLocation.get(key) ?? 0) + 1);
  }
  console.log("\n  by location, from the job assignment:");
  for (const [k, n] of [...byLocation.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${k}`);
  }

  const titles = new Map();
  const earningTypes = new Map();
  const periods = new Map();
  let withAssignment = 0;
  let withHourly = 0;
  for (const e of rows) {
    const assignments = e.job_assignments ?? [];
    if (assignments.length) withAssignment++;
    for (const a of assignments) {
      titles.set(a.title ?? "(untitled)", (titles.get(a.title ?? "(untitled)") ?? 0) + 1);
      const rates = a.earning_rates ?? [];
      for (const r of rates) {
        const t = (r.earning_type ?? "(none)").toLowerCase();
        earningTypes.set(t, (earningTypes.get(t) ?? 0) + 1);
        periods.set(r.period ?? "(none)", (periods.get(r.period ?? "(none)") ?? 0) + 1);
      }
      if (rates.some((r) => (r.earning_type ?? "").toLowerCase() === "hourly")) withHourly++;
    }
  }

  console.log(`\n  employees carrying a job assignment: ${withAssignment} of ${rows.length}`);
  console.log("  (the rest are offboarded or still onboarding)");

  console.log("\n  job titles:");
  for (const [t, n] of [...titles.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${t}`);
  }

  // A person holds several rates at once, one per earning type — not a history.
  // hourlyRate() in src/lib/workstream.ts reads the `hourly` row and nothing
  // else, so if that count is ~0 the vocabulary has changed and it needs fixing.
  console.log("\n  earning types (one row each, per assignment):");
  for (const [t, n] of [...earningTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${t}`);
  }
  console.log("\n  periods:");
  for (const [t, n] of [...periods.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${t}`);
  }
  console.log(`\n  assignments carrying an hourly rate: ${withHourly}`);

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
