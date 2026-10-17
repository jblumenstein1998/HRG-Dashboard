// Run with:  node --env-file=.env.local scripts/workstream-retention-check.mjs [start] [end]
//
// Prints new-hire retention per store for a window, the way
// src/lib/workstreamRetention.ts computes it — so the numbers can be eyeballed
// against a period somebody already scored by hand before the bonus scorecard
// is allowed to use them. Defaults to the last 90 days.
//
// Deliberately a standalone reimplementation of the same rule rather than an
// import: this file is here to check the library, and a checker that shares the
// library's code cannot catch the library being wrong.

const BASE = "https://public-api.workstream.us";
const token = process.env.WORKSTREAM_ACCESS_TOKEN;
if (!token) {
  console.error("Set WORKSTREAM_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

const g = async (p) =>
  (await fetch(BASE + p, { headers: { Authorization: `Bearer ${token}` } })).json();

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1, d + n)));
};

const end = process.argv[3] ?? iso(new Date());
const start = process.argv[2] ?? addDays(end, -90);
console.log(`window ${start} .. ${end}\n`);

const locName = new Map(((await g("/locations?per_page=100")).data ?? []).map((l) => [l.uuid, l.name]));

const rows = [];
let page = 1;
for (let i = 0; i < 60; i++) {
  const j = await g(`/v2/employees?per_page=100&page=${page}&embed=(job_assignments,location)`);
  rows.push(...(j.data ?? []));
  if (!j.meta?.next_page) break;
  page = j.meta.next_page;
}
console.log(`${rows.length} Workstream records\n`);

const primary = (e) => {
  const all = e.job_assignments ?? [];
  return all.find((a) => a.primary && a.status === "active")
    ?? all.find((a) => a.status === "active") ?? all.find((a) => a.primary) ?? all[0] ?? null;
};
const locOf = (e) => {
  const a = primary(e);
  return a?.location_id ?? a?.working_location?.core_location_id ?? e.location?.uuid ?? null;
};

const DAYS = [30, 60, 90];
const tally = new Map();
const unattributed = { 30: 0, 60: 0, 90: 0 };

for (const e of rows) {
  const started = e.start_date ?? e.hired_date;
  if (!started) continue;
  for (const d of DAYS) {
    const anniversary = addDays(started, d);
    if (anniversary < start || anniversary > end) continue;
    const loc = locOf(e);
    const name = locName.get(loc);
    if (!name) { unattributed[d] += 1; continue; }
    if (!tally.has(name)) tally.set(name, { 30: [0, 0], 60: [0, 0], 90: [0, 0] });
    const t = tally.get(name)[d];
    t[0] += 1;
    if (!e.termination_date || e.termination_date > anniversary) t[1] += 1;
  }
}

const pct = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");
console.log("store                      30-day        60-day        90-day");
for (const [name, t] of [...tally.entries()].sort()) {
  const cell = (d) => `${pct(t[d][1], t[d][0])} (${t[d][1]}/${t[d][0]})`.padEnd(13);
  console.log(`${name.padEnd(26)} ${cell(30)} ${cell(60)} ${cell(90)}`);
}

console.log(`\nreached the mark but carry no store: 30d ${unattributed[30]}`
  + `  60d ${unattributed[60]}  90d ${unattributed[90]}`);

// Which way does dropping them bend the answer? If the storeless records are
// mostly people who left, every store's retention is flattered by their
// absence, and the figures above are too kind to be paid against.
const storeless = { kept: 0, left: 0 };
const attributed = { kept: 0, left: 0 };
for (const e of rows) {
  const started = e.start_date ?? e.hired_date;
  if (!started) continue;
  const anniversary = addDays(started, 90);
  if (anniversary < start || anniversary > end) continue;
  const bucket = locName.get(locOf(e)) ? attributed : storeless;
  if (!e.termination_date || e.termination_date > anniversary) bucket.kept += 1;
  else bucket.left += 1;
}
const share = (b) => (b.kept + b.left > 0 ? `${((b.kept / (b.kept + b.left)) * 100).toFixed(1)}%` : "—");
console.log("\n── does dropping the storeless records bias the result? (90-day cohort) ──");
console.log(`   with a store : ${attributed.kept} stayed / ${attributed.left} left  -> ${share(attributed)}`);
console.log(`   no store     : ${storeless.kept} stayed / ${storeless.left} left  -> ${share(storeless)}`);
console.log("   if the second number is far lower, the per-store figures above are flattered");
