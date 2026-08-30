// Run with:  npx tsx --env-file=.env.local scripts/jolt-explore.mjs
//
// Schema exploration for Jolt. The production client is lib/jolt.ts — this
// script exists to poke at the 218 root queries that client does not wrap yet.
// Same role netchef-discover.mjs played for Net-Chef.
//
// ── AUTH (solved — implemented in lib/jolt.ts) ───────────────────────────────
//
// Four steps, across two hosts:
//
//   1. GET  app.joltup.com/account              -> sets PHPSESSID
//   2. POST app.joltup.com/rest/v1/app/login    -> { username, password };
//                                                  returns companyId,
//                                                  contentGroupId, timezone
//   3. GET  any app page                        -> sets jolt_auth_token
//   4. POST api.joltup.com/graphql              -> cookie must carry
//                                                  jolt_auth_token; header
//                                                  jolt_companyid scopes it
//
// Step 3 is the trap: api.joltup.com answers a PHPSESSID-only session with
// "Missing token. Please send an authentication token in the header or in a
// cookie." Nothing in the login response hands that token over — it is minted
// when the web app serves an HTML page.
//
// There is no login mutation in the GraphQL schema, and api.joltup.com 404s on
// /auth/login, /login, /v1/auth/login, /oauth/token, /session, /authenticate.
// Login is only on the app host.
//
// reCAPTCHA: app.joltup.com loads recaptcha/api.js and the bundle has a
// RecaptchaRequired path, but it is conditional. Check before assuming:
//   POST /rest/v1/app/isRecaptchaRequired { email } -> { captchaRequired }
// It returned false for this account. If it ever flips true, headless login is
// blocked and a human has to sign in.
//
// ── THREE THINGS THAT SILENTLY GIVE WRONG ANSWERS ───────────────────────────
//
// 1. TIMEZONE. Filter timestamps are unix SECONDS interpreted in the company
//    timezone — America/Chicago for HRG, returned by the login response. Using
//    the server's local time shifts the window an hour and quietly moves a
//    couple of rows in or out. lib/jolt.ts resolves this properly.
//
// 2. isActive: TRUE reproduces the List Completion Report's default view.
//    This reads backwards next to the report's "Open Lists / Closed Lists"
//    chips, so trust the numbers rather than the label. Verified: with
//    isActive true, Brentwood returns complete=241 on-time=187 late=54
//    missed=45, matching the UI exactly. With false it returns near-zero.
//
// 3. ID FORMAT. Ids are Relay global ids — base64 of "<Type>:<hex>", e.g.
//    base64("ContentGroup:001a04f0…"). Passing bare hex to a `mode` argument
//    fails with "must be a valid id format".
//
// Several queries require `mode: ModeInput!` = { mode, id }. Mode enum is
// LOCATION | CONTENT_GROUP | CONTENT_GROUP_LOCATIONS. For company-wide figures
// use CONTENT_GROUP_LOCATIONS with the encoded contentGroupId —
// lib/jolt.ts exports allLocationsMode() for exactly this.
//
// ── LOCATIONS ───────────────────────────────────────────────────────────────
//
// Jolt has 8; the dashboard tracks 12. Overlap is 7: Brentwood, College,
// Columbia, Jefferson, Spring Hill, Springfield, White House. Jolt also has
// "Hwy 52 | HRG Portland LLC", which has no Net-Chef counterpart and is
// excluded. Jolt is NOT deployed at Chesapeake, Hillcrest, Hampton, Oyster or
// Beach — those render as empty rows (lib/jolt.ts STORES_WITHOUT_JOLT).
//
// Excluding Portland is why dashboard totals differ from the Jolt UI:
// 7 stores = 1600 on-time / 240 late / 538 missed; Portland adds 25 missed,
// giving the UI's 563. On-time and late match exactly.
//
// ── USEFUL QUERIES ──────────────────────────────────────────────────────────
//
// allLocationCompletionStats  by-location table (wrapped in lib/jolt.ts)
// allListsCompletionStats     by-list-template breakdown
// allListInstances            individual instances — REQUIRES mode. This is the
//                             rich one: deadlineTimestamp, completionTimestamp,
//                             onTimeCount, lateCount, incompleteCount,
//                             submitPerson / assignedPerson / createPerson,
//                             listTemplate { title }, location { name }, score.
//                             Filter has deadlineBefore/AfterTimestamp, so
//                             "open and due soon" is a filter, not a scan.
// listCompletionTimeSeries    the daily trend line
// allItemCompletionStatsByLocation   item-level detail
// allCorrectiveActionStats, allItemFlagStats, allListProbeStats  temps/flags
//
// Note: outstandingCount comes back null on instances — use incompleteCount.

import { joltQuery, allLocationsMode } from "../src/lib/jolt.ts";

const now = Math.floor(Date.now() / 1000);
const mode = await allLocationsMode();

// ── Locations ────────────────────────────────────────────────────────────────
const locs = await joltQuery(`{ allLocations(first: 50) { edges { node { id name } } } }`);
console.log("=== LOCATIONS ===");
for (const e of locs.allLocations.edges) console.log("  ", e.node.name);

// ── Open lists due in the next 48 hours ──────────────────────────────────────
const due = await joltQuery(
  `query($f: ListInstancesFilter!, $first: Int, $mode: ModeInput!) {
     allListInstances(filter: $f, first: $first, mode: $mode) {
       edges { node {
         id instanceTitle deadlineTimestamp completionTimestamp incompleteCount
         listTemplate { id title } location { id name }
       } }
     } }`,
  {
    f: { isActive: true, isSublist: false, deadlineAfterTimestamp: now, deadlineBeforeTimestamp: now + 48 * 3600 },
    first: 300,
    mode,
  },
);
const open = due.allListInstances.edges.map(e => e.node).filter(n => !n.completionTimestamp);
console.log(`\n=== OPEN, DUE WITHIN 48H: ${open.length} ===`);
const byStore = {};
for (const n of open) {
  const s = (n.location?.name ?? "?").replace(/^HRG /, "").replace(/ LLC$/, "");
  (byStore[s] ??= []).push(n);
}
for (const [store, list] of Object.entries(byStore).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${store} — ${list.length}`);
  for (const n of list.slice(0, 3)) {
    const when = new Date(n.deadlineTimestamp * 1000)
      .toLocaleString("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
    console.log(`      ${when.padEnd(18)} ${n.listTemplate?.title ?? n.instanceTitle}`);
  }
}

// ── Who is submitting lists ──────────────────────────────────────────────────
const recent = await joltQuery(
  `query($f: ListInstancesFilter!, $first: Int, $mode: ModeInput!) {
     allListInstances(filter: $f, first: $first, mode: $mode) {
       edges { node { submitPerson { id firstName lastName } location { name } } }
     } }`,
  {
    f: { isActive: true, isSublist: false, displayAfterTimestamp: now - 7 * 86400, displayBeforeTimestamp: now },
    first: 300,
    mode,
  },
);
const people = {};
for (const e of recent.allListInstances.edges) {
  const p = e.node.submitPerson;
  if (!p) continue;
  const k = `${p.firstName} ${p.lastName}`.replace(/\s+/g, " ").trim();
  people[k] = (people[k] ?? 0) + 1;
}
console.log(`\n=== SUBMITTERS, LAST 7 DAYS: ${Object.keys(people).length} people ===`);
for (const [n, c] of Object.entries(people).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${String(c).padStart(4)}  ${n}`);
}

// ── Schema surface, for picking what to build next ───────────────────────────
const schema = await joltQuery(`{ __schema { queryType { fields { name } } } }`);
const names = schema.__schema.queryType.fields.map(f => f.name);
console.log(`\n=== SCHEMA: ${names.length} root queries ===`);
console.log(names.filter(n => /completion|stat|probe|flag|corrective|instance/i.test(n)).join("\n"));
