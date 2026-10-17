// Drive the PAR shift-history job by hand, until the backfill is done.
// Run with:  node --env-file=.env.local scripts/run-par-shifts.mjs [baseUrl] [budgetSeconds] [maxRuns] [nightly]
//
// Calls /api/cron/par-shifts?backfillOnly=1 in a loop, printing each run's
// summary, and stops when nothing is left to fill or a run makes no progress.
// Pass "nightly" as the fourth argument to run the job exactly as the cron
// does, trailing 14-day re-read included, once.
// Point it at a local `next dev` to load history without waiting on the nightly
// cron's few minutes a day; the writes go to whatever DATABASE_URL that server
// has.
const [base = "http://localhost:3000", budget = "600", maxRuns = "100", mode = ""] = process.argv.slice(2);
const nightly = mode === "nightly";

for (let run = 1; run <= (nightly ? 1 : Number(maxRuns)); run++) {
  const started = Date.now();
  const res = await fetch(`${base}/api/cron/par-shifts?budget=${budget}${nightly ? "" : "&backfillOnly=1"}`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  const secs = Math.round((Date.now() - started) / 1000);
  if (!res.ok || !body.backfill) {
    console.log(`run ${run}: failed after ${secs}s — ${body.error ?? JSON.stringify(body).slice(0, 200)}`);
    process.exit(1);
  }
  const b = body.backfill;
  if (body.window) console.log(`window ${body.window.start}..${body.window.end}: ok ${body.window.ok}, failed ${body.window.failed}`);
  console.log(
    `run ${run}: ${secs}s — synced ${b.synced}, failed ${b.failed}, ${b.shifts} shifts, ` +
    `reached ${b.oldestReached ?? "-"}, ${b.remaining} left`,
  );
  for (const e of body.errors ?? []) console.log(`  ${e}`);
  if (b.remaining === 0) { console.log("backfill complete"); break; }
  if (b.synced === 0) { console.log("no progress this run — stopping"); break; }
}
