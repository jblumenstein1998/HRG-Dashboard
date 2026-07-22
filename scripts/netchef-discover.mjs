// Run with:  node scripts/netchef-discover.mjs
// Chrome will open normally (no automation flags). Log in, choose a location,
// run the Actual/Theoretical Cost report. All XHR/fetch calls are logged here.
// Press Ctrl+C when done.

import { chromium } from "playwright-core";
import { spawn } from "child_process";
import { setTimeout as wait } from "timers/promises";
import os from "os";
import path from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const START_URL = "https://zaxbys.net-chef.com/standalone/modern.ct";
const DEBUG_PORT = 9222;
const USER_DATA_DIR = path.join(os.tmpdir(), "netchef-chrome-profile");

// Launch Chrome ourselves — no automation flags, so ExtJS renders normally
const chrome = spawn(CHROME_PATH, [
  `--remote-debugging-port=${DEBUG_PORT}`,
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${USER_DATA_DIR}`,
  START_URL,
], { detached: false });

chrome.on("error", (err) => console.error("Chrome launch error:", err));

console.log("=== Waiting for Chrome to start...");
await wait(2000);

// Connect Playwright to the already-running Chrome via CDP
const browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
const [ctx] = browser.contexts();
const [page] = ctx.pages();

// ── Log every request ────────────────────────────────────────────────────────
page.on("request", (req) => {
  const method = req.method();
  const url = req.url();
  // Skip static assets — we only care about data calls
  if (/\.(js|css|png|jpg|gif|ico|woff|woff2|ttf|svg|map)(\?|$)/i.test(url)) return;
  console.log(`\n>>> REQUEST  ${method} ${url}`);
  const body = req.postData();
  if (body) console.log("    BODY:", body.slice(0, 500));
});

// ── Log every response ───────────────────────────────────────────────────────
page.on("response", async (res) => {
  const url = res.url();
  if (/\.(js|css|png|jpg|gif|ico|woff|woff2|ttf|svg|map)(\?|$)/i.test(url)) return;

  const status = res.status();
  const ct = res.headers()["content-type"] ?? "";
  console.log(`\n<<< RESPONSE ${status} ${url}`);

  // Print body for JSON and text responses (these are the data APIs)
  if (ct.includes("json") || ct.includes("text")) {
    const text = await res.text().catch(() => "(unreadable)");
    console.log("    BODY:", text.slice(0, 1000));
  }
});

// ── Log navigation changes ───────────────────────────────────────────────────
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) {
    console.log(`\n=== NAVIGATED TO: ${frame.url()}`);
  }
});

console.log("=== Opening Net-Chef. Log in, choose a location, run the Actual/Theoretical Cost report.");
console.log("=== All network calls will be printed here. Press Ctrl+C when done.\n");

await page.goto(START_URL, { waitUntil: "domcontentloaded" });

// Keep the script alive until Ctrl+C
await new Promise(() => {});
