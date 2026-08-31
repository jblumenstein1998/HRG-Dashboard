// Reconcile PAR "Sales Summary" PDFs against the par_daily_metrics rollup.
//
//   node --env-file=.env.local scripts/par-reconcile-summaries.mjs <dir>
//
// PAR's report is the authority we cannot get from the API: GetOrders can answer
// ResultCode=0 with an empty <Orders/> for a day the store actually traded, and
// nothing in the API distinguishes that from a real closure. Totalling a whole
// store history against the report is exhaustive where sampling is not — an
// exact match proves no day is missing, rather than suggesting it.
//
// PDF text is drawn as hex CID strings from a subset font whose glyph ids sit 29
// below the ASCII codepoint (glyph 3 = space), so decoding is a fixed shift.
import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const sql = neon(process.env.DATABASE_URL);
const dir = process.argv[2] ?? ".";

function contentStreams(buf) {
  const out = [];
  let i = 0;
  while (true) {
    const s = buf.indexOf("stream", i);
    if (s < 0) break;
    let st = s + 6;
    if (buf[st] === 13) st++;
    if (buf[st] === 10) st++;
    const e = buf.indexOf("endstream", st);
    if (e < 0) break;
    const chunk = buf.subarray(st, e);
    try { out.push(zlib.inflateSync(chunk).toString("latin1")); }
    catch { try { out.push(zlib.inflateRawSync(chunk).toString("latin1")); } catch { /* binary */ } }
    i = e + 9;
  }
  return out;
}

const decodeHex = hex => {
  let s = "";
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    const gid = parseInt(hex.slice(i, i + 4), 16);
    if (!Number.isNaN(gid) && gid !== 0) s += String.fromCharCode(gid + 29);
  }
  return s;
};

function extractLines(file) {
  const all = contentStreams(fs.readFileSync(file)).join("\n");
  const re = /(?:([\d.-]+)\s+([\d.-]+)\s+T[dD])|(?:<([0-9A-Fa-f]+)>\s*Tj)/g;
  const items = [];
  let x = 0, y = 0, m;
  while ((m = re.exec(all)) !== null) {
    if (m[3] !== undefined) items.push({ x, y, text: decodeHex(m[3]) });
    else { x = parseFloat(m[1]); y = parseFloat(m[2]); }
  }
  const lines = new Map();
  for (const it of items) {
    const key = Math.round(it.y * 2) / 2;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(it);
  }
  return [...lines.entries()].sort((a, b) => b[0] - a[0])
    .map(([, arr]) => arr.sort((a, b) => a.x - b.x).map(i => i.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const num = s => Number(String(s).replace(/[$,]/g, ""));
const usDate = s => { const [m, d, y] = s.split("/").map(Number); return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };

const NAMES = {
  "36001": "Springfield", "42601": "White House", "56301": "Brentwood", "61401": "Spring Hill",
  "28901": "Columbia", "57001": "College", "57002": "Hampton", "57003": "Oyster",
  "57004": "Chesapeake", "57005": "Jefferson", "57006": "Hillcrest", "57007": "Beach",
};

const files = fs.readdirSync(dir).filter(f => /\.pdf$/i.test(f) && /sales summary/i.test(f));
const parsed = [];
for (const f of files) {
  let lines;
  try { lines = [...new Set(extractLines(path.join(dir, f)))]; } catch { continue; }
  const blob = lines.join("\n");
  const storeId = (blob.match(/[A-Za-z]+_(\d{5})/) ?? [])[1];
  const range = blob.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  const netSales = blob.match(/Net Sales\s+\$?([\d,]+\.\d{2})/);
  const laborHours = blob.match(/Labor Hours:\s*([\d,]+\.?\d*)/);
  if (!storeId || !range || !netSales || !laborHours) continue;
  parsed.push({ f, storeId, start: usDate(range[1]), end: usDate(range[2]), parSales: num(netSales[1]), parHours: num(laborHours[1]) });
}

// Only the full-history reports; ignore older short-range downloads in the folder.
const [dbRange] = await sql`SELECT MIN(business_date) mn, MAX(business_date) mx FROM par_daily_metrics`;
const DB_START = dbRange.mn.toISOString().slice(0, 10);
const DB_END = dbRange.mx.toISOString().slice(0, 10);
const full = parsed.filter(p => p.start <= DB_START && p.end >= DB_END);

console.log(`DB range ${DB_START}..${DB_END}`);
console.log(`${parsed.length} Sales Summary PDFs parsed, ${full.length} cover the full history\n`);

console.log("store         report range              | net sales: ours vs PAR            | labor hrs: ours vs PAR");
let salesBad = 0, laborBad = 0;
const gaps = [];
for (const p of full.sort((a, b) => (NAMES[a.storeId] ?? "").localeCompare(NAMES[b.storeId] ?? ""))) {
  const [row] = await sql`
    SELECT SUM(net_sales) s, SUM(labor_minutes) m FROM par_daily_metrics
    WHERE store_id = ${p.storeId} AND business_date BETWEEN ${p.start} AND ${p.end}`;
  const ourSales = Number(row.s), ourHours = Number(row.m) / 60;
  const dS = ourSales - p.parSales, dH = ourHours - p.parHours;
  if (Math.abs(dS) >= 0.01) { salesBad++; gaps.push({ store: p.storeId, name: NAMES[p.storeId], dS, start: p.start, end: p.end }); }
  if (Math.abs(dH) >= 0.01) laborBad++;
  const mark = Math.abs(dS) >= 0.01 || Math.abs(dH) >= 0.01 ? "  <<<" : "";
  console.log(
    `${(NAMES[p.storeId] ?? p.storeId).padEnd(12)}  ${p.start}..${p.end} | ` +
    `${ourSales.toFixed(2).padStart(13)} ${p.parSales.toFixed(2).padStart(13)} ${dS.toFixed(2).padStart(11)} | ` +
    `${ourHours.toFixed(2).padStart(10)} ${p.parHours.toFixed(2).padStart(10)} ${dH.toFixed(2).padStart(9)}${mark}`
  );
}

console.log(`\nstores with a sales gap: ${salesBad}/${full.length}   labor gap: ${laborBad}/${full.length}`);
if (gaps.length) {
  console.log("\nMissing sales by store (ours minus PAR; negative = we are short):");
  for (const g of gaps) console.log(`  ${(g.name ?? g.store).padEnd(12)} ${g.dS.toFixed(2).padStart(12)}`);
  console.log(`  ${"TOTAL".padEnd(12)} ${gaps.reduce((s, g) => s + g.dS, 0).toFixed(2).padStart(12)}`);
}
