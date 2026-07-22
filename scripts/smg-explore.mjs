// One-shot SMG API explorer — run with: node scripts/smg-explore.mjs
// Reads SMG_USERNAME / SMG_PASSWORD from environment (or .env.local).

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Load .env.local manually (no dotenv dep required) ────────────────────────
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  const raw = readFileSync(join(root, ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* .env.local not found — rely on real env */ }

const BASE = "https://api.smg.com";
const USERNAME = process.env.SMG_USERNAME;
const PASSWORD = process.env.SMG_PASSWORD;
const PROJECT_ID = process.env.SMG_PROJECT_ID ?? "";

if (!USERNAME || !PASSWORD) {
  console.error("SMG_USERNAME and SMG_PASSWORD must be set");
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function printShape(label, obj, depth = 0) {
  const pad = "  ".repeat(depth);
  if (Array.isArray(obj)) {
    console.log(`${pad}${label}: Array(${obj.length})`);
    if (obj.length > 0) printShape("[0]", obj[0], depth + 1);
    return;
  }
  if (obj && typeof obj === "object") {
    console.log(`${pad}${label}: {`);
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        console.log(`${pad}  ${k}: Array(${v.length})`);
        if (v.length > 0) printShape(`${k}[0]`, v[0], depth + 2);
      } else if (v && typeof v === "object") {
        printShape(k, v, depth + 1);
      } else {
        console.log(`${pad}  ${k}: ${typeof v} = ${JSON.stringify(v)}`);
      }
    }
    console.log(`${pad}}`);
  } else {
    console.log(`${pad}${label}: ${typeof obj} = ${JSON.stringify(obj)}`);
  }
}

async function smgFetch(token, path) {
  const url = `${BASE}${path}`;
  console.log(`\n▶ GET ${url}`);
  const res = await fetch(url, {
    headers: {
      "User-Authentication-Token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  console.log(`  Status: ${res.status} ${res.statusText}`);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { console.log("  Raw:", text.slice(0, 500)); return null; }
  return json;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const authRes = await fetch(`${BASE}/Users/ValidateCredentials`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ UserName: USERNAME, Password: PASSWORD }),
});
console.log(`Auth: ${authRes.status} ${authRes.statusText}`);
const authText = await authRes.text();
let authJson;
try { authJson = JSON.parse(authText); } catch { console.log("Auth raw:", authText.slice(0, 500)); process.exit(1); }

if (!authRes.ok) {
  console.log("Auth failed:", JSON.stringify(authJson, null, 2));
  process.exit(1);
}

// Token might be at different keys — find it
const token =
  authJson?.["User-Authentication-Token"] ??
  authJson?.Token ??
  authJson?.token ??
  authJson?.AuthToken ??
  (typeof authJson === "string" ? authJson : null);

console.log("\n=== AUTH RESPONSE SHAPE ===");
printShape("auth", authJson);
console.log("\nToken found:", token ? token.slice(0, 20) + "…" : "(none — check shape above)");

if (!token) process.exit(1);

// ── GET /Reporting ─────────────────────────────────────────────────────────
const reporting = await smgFetch(token, "/Reporting");
if (reporting !== null) {
  console.log("\n=== /Reporting SHAPE ===");
  printShape("reporting", reporting);
  console.log("\n--- /Reporting RAW (first 3000 chars) ---");
  console.log(JSON.stringify(reporting, null, 2).slice(0, 3000));
}

// ── GET /ReportingMetaData/Questions/{projectId} ───────────────────────────
if (PROJECT_ID) {
  const questions = await smgFetch(token, `/ReportingMetaData/Questions/${PROJECT_ID}`);
  if (questions !== null) {
    console.log("\n=== /ReportingMetaData/Questions SHAPE ===");
    printShape("questions", questions);
    console.log("\n--- /ReportingMetaData/Questions RAW (first 3000 chars) ---");
    console.log(JSON.stringify(questions, null, 2).slice(0, 3000));
  }
} else {
  console.log("\n(Skipping /ReportingMetaData/Questions — SMG_PROJECT_ID not set)");
  // Try to discover project IDs from /Reporting response
  if (reporting) {
    console.log("Hint: look for project/definition IDs in the /Reporting response above.");
  }
}

// ── Also try /Hierarchy/Units without a project ID to see what's available ──
const hier = await smgFetch(token, "/Hierarchy");
if (hier !== null) {
  console.log("\n=== /Hierarchy SHAPE ===");
  printShape("hierarchy", hier);
}
