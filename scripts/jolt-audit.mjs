// Audit the Jolt tab's data against a Jolt "Browse Lists" CSV export.
//   node scripts/jolt-audit.mjs <csv> <api.json>
//
// The CSV renders each location's times in whatever timezone that location is
// configured with in Jolt, which is not necessarily the store's real zone. So
// rather than assume a zone, this infers the offset per location from the data
// and reports it — a wrong offset is itself a finding.
import { readFileSync } from "node:fs";

function parseCsv(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") {}
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const rows = parseCsv(readFileSync(process.argv[2], "utf8"));
const H = rows[0], col = n => H.indexOf(n);
const csv = rows.slice(1)
  .filter(r => r.length > 1 && (r[col("List Name")] ?? "").trim() !== "")
  .map(r => ({
    list: r[col("List Name")].trim(), loc: r[col("Location Name")].trim(),
    deadline: r[col("Deadline")].trim(), submit: r[col("Submit Time")].trim(),
    person: r[col("Submit Person")].trim(), incomplete: Number(r[col("Incomplete")] || 0),
  }));

const api = JSON.parse(readFileSync(process.argv[3], "utf8"));
const JOLT_NAME = { Brentwood:"HRG Brentwood LLC", College:"HRG College LLC", Columbia:"HRG Columbia LLC",
  Jefferson:"HRG Jefferson LLC", "Spring Hill":"HRG Spring Hill LLC", Springfield:"HRG Springfield LLC",
  "White House":"HRG White House LLC" };

const mine = [];
for (const s of api.stores) for (const r of s.rows)
  mine.push({ store: s.store, loc: JOLT_NAME[s.store], list: r.title.trim(),
    deadline: r.deadline, completedAt: r.completedAt, person: (r.completedBy ?? "").trim(), status: r.status });

// "8/29/26 8:00 PM" -> ms, read as UTC wall-clock so offsets compare cleanly.
function wallMs(s) {
  const m = s.match(/^(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)\s*(AM|PM)$/i);
  if (!m) return null;
  let [, mo, d, y, h, mi, ap] = m;
  h = Number(h) % 12 + (/pm/i.test(ap) ? 12 : 0);
  return Date.UTC(2000 + Number(y), Number(mo) - 1, Number(d), h, Number(mi));
}
// Jolt exports to minute precision; floor ours so seconds are not a false diff.
const utcWall = (epoch, offsetHours) =>
  epoch == null ? null : Math.floor((epoch + offsetHours * 3600) / 60) * 60000;
const norm = s => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const locations = [...new Set(csv.map(c => c.loc))].filter(l => Object.values(JOLT_NAME).includes(l));

console.log("=".repeat(78));
console.log("1. EXPORT TIMEZONE PER LOCATION  (inferred, offset from UTC)");
console.log("=".repeat(78));
const offsetFor = {};
for (const loc of locations) {
  const cs = csv.filter(c => c.loc === loc);
  const ms = mine.filter(m => m.loc === loc);
  const tally = {};
  for (const c of cs) for (const m of ms) {
    if (norm(c.list) !== norm(m.list) || m.deadline == null) continue;
    const diff = (wallMs(c.deadline) - Math.floor(m.deadline / 60) * 60000) / 3600000;
    if (Number.isInteger(diff) && Math.abs(diff) <= 12) tally[diff] = (tally[diff] ?? 0) + 1;
  }
  const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  const off = best ? Number(best[0]) : null;
  offsetFor[loc] = off;
  const zone = { "-5": "Central (CDT)", "-4": "Eastern (EDT)", "-6": "Mountain (MDT)", "-7": "Pacific (PDT)" }[String(off)] ?? "?";
  console.log(`   ${loc.padEnd(24)} UTC${off > 0 ? "+" : ""}${off}   ${zone}${best ? `   (${best[1]} matching rows)` : ""}`);
}

console.log("\n" + "=".repeat(78));
console.log("2. ROW-BY-ROW COMPARISON");
console.log("=".repeat(78));
const missing = [], mismatched = [];
let matched = 0;
const csvTracked = csv.filter(c => locations.includes(c.loc));

for (const c of csvTracked) {
  const off = offsetFor[c.loc];
  const hit = mine.find(m => m.loc === c.loc && norm(m.list) === norm(c.list) &&
    m.deadline != null && utcWall(m.deadline, off) === wallMs(c.deadline));
  if (!hit) { missing.push(c); continue; }

  const problems = [];
  const mySubmit = utcWall(hit.completedAt, off);
  const csvSubmit = c.submit ? wallMs(c.submit) : null;
  if (mySubmit !== csvSubmit) problems.push(`completed: csv="${c.submit || "—"}" dash(epoch)="${hit.completedAt}"`);
  if (norm(hit.person) !== norm(c.person)) problems.push(`person: csv="${c.person || "—"}" dash="${hit.person || "—"}"`);
  const expected = c.submit ? (csvSubmit > wallMs(c.deadline) ? "late" : "onTime")
                            : (hit.deadline * 1000 < Date.now() ? "missed" : "pending");
  if (expected !== hit.status) problems.push(`status: from-csv="${expected}" dash="${hit.status}"`);
  if (problems.length) mismatched.push({ c, problems }); else matched++;
}

console.log(`   CSV rows for tracked stores      ${csvTracked.length}`);
console.log(`   Matched on every field           ${matched}`);
console.log(`   Missing from dashboard           ${missing.length}`);
console.log(`   Present but mismatched           ${mismatched.length}`);

for (const c of missing) console.log(`     MISSING  ${c.loc.padEnd(22)} ${c.list.slice(0,34).padEnd(36)} due ${c.deadline}`);
for (const { c, problems } of mismatched) {
  console.log(`     DIFF     ${c.loc.replace(/^HRG | LLC$/g,"").padEnd(14)} ${c.list.slice(0,32).padEnd(34)} due ${c.deadline}`);
  for (const p of problems) console.log(`                ${p}`);
}

console.log("\n" + "=".repeat(78));
console.log("3. COVERAGE");
console.log("=".repeat(78));
console.log(`   Instances in CSV (all locations) ${csv.length}`);
console.log(`   ...Portland, excluded by design  ${csv.length - csvTracked.length}`);
console.log(`   Dashboard rows for the same day  ${mine.length}`);
console.log(`   Dashboard rows absent from CSV   ${mine.length - matched - mismatched.length}`);
