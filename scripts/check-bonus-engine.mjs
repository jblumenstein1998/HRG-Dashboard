// Run with:  node scripts/check-bonus-engine.mjs
//
// Fixture checks for the bonus scoring engine. These numbers decide what people
// are paid, so the rules config and the engine need a way to be re-verified
// after any edit — and this project has no test runner.
//
// The engine is deliberately pure (no db, no fetch, no dates), so this script
// compiles just src/lib/bonus/engine.ts to a temp directory with tsc and
// exercises the real compiled code. Nothing is duplicated or mocked.
//
// Exits non-zero on the first failing expectation count, so it can gate a
// deploy if that's ever wanted.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const out = mkdtempSync(join(tmpdir(), "bonus-engine-"));
try {
  // Run tsc's entry point under this Node rather than shelling out to `npx`:
  // Windows refuses to spawn a .cmd shim without shell:true, and enabling the
  // shell just to launch a compiler invites quoting bugs on a path that already
  // contains spaces and parentheses.
  const tsc = join(dirname(require.resolve("typescript")), "tsc.js");
  execFileSync(
    process.execPath,
    [tsc, "src/lib/bonus/engine.ts", "--outDir", out, "--module", "commonjs",
     "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck"],
    { stdio: "inherit" }
  );

  const { scorePosition, scoreStore, passesGate } = require(join(out, "engine.js"));
  const { BONUS_RULES, assertWeightsValid, manualConditions } = require(join(out, "rules.js"));

  let pass = 0;
  let fail = 0;
  const check = (name, actual, expected) => {
    const ok = actual === expected || Math.abs((actual ?? NaN) - (expected ?? NaN)) < 1e-9;
    if (ok) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}\n         expected ${expected}, got ${actual}`); }
  };
  const checkTrue = (name, c) => check(name, !!c, true);
  const cat = (r, id) => r.categories.find((c) => c.category.id === id);
  const cond = (c, id) => c.conditions.find((x) => x.condition.id === id);

  console.log("\n1. Config integrity");
  try { assertWeightsValid(); check("all six positions sum to 100", true, true); }
  catch (e) { fail++; console.log("  FAIL " + e.message); }
  for (const [id, r] of Object.entries(BONUS_RULES)) {
    const ids = r.categories.flatMap((c) =>
      [...c.conditions, ...c.disqualifiers, ...c.multipliers.flatMap((m) => m.conditions)].map((x) => x.id));
    check(`${id}: no duplicate condition ids`, ids.filter((v, i) => ids.indexOf(v) !== i).length, 0);
  }

  console.log("\n2. Drive-Thru at target (store under $45k/week)");
  const perfectDT = new Map(Object.entries({
    weeklyEquivalentSales: 40000,
    dtWindowSecs: 65, dtTotalSecs: 210, dtDaysMissingTarget: 0, dtMaxWeeklyPullForwards: 3,
    smgAccuracy: 92, smgOsat: 82, smgAccuracyMinWeekly: 70,
    lov_driveThru: 2, txnAllWeeksGrew: 1,
  }));
  let r = scorePosition("driveThru", "36001", "P7 FY2026", perfectDT);
  check("SOS payout = 50 x 1.0 x 1.25 multiplier", cat(r, "sos").payout, 62.5);
  check("Accuracy & GSAT payout", cat(r, "accuracy_gsat").payout, 40);
  check("total = 112.5 x 1.25 kicker", r.score, 140.625);
  check("pendingCount", r.pendingCount, 0);
  checkTrue("line busting N/A under $85k", cond(cat(r, "sos"), "dt_line_busting").status === "notApplicable");

  console.log("\n3. Near-miss (window 1:12 — misses 1:10 target, clears 1:15 threshold)");
  const nearMiss = new Map(perfectDT); nearMiss.set("dtWindowSecs", 72);
  r = scorePosition("driveThru", "36001", "P7 FY2026", nearMiss);
  check("SOS drops to 0.5", cat(r, "sos").score, 0.5);
  checkTrue("window time flagged as the near-miss", cond(cat(r, "sos"), "dt_window_time").isNearMiss);
  checkTrue("total time not flagged", !cond(cat(r, "sos"), "dt_total_time").isNearMiss);
  const twoShort = new Map(nearMiss); twoShort.set("dtTotalSecs", 235);
  check("two short — nothing singled out",
    scorePosition("driveThru", "36001", "P7 FY2026", twoShort).categories
      .find((c) => c.category.id === "sos").conditions.filter((c) => c.isNearMiss).length, 0);

  console.log("\n4. Disqualifiers");
  const dq = new Map(perfectDT); dq.set("dtDaysMissingTarget", 6);
  r = scorePosition("driveThru", "36001", "P7 FY2026", dq);
  check("SOS zeroed", cat(r, "sos").score, 0);
  check("multiplier suppressed", cat(r, "sos").multiplier, 1);
  check("other categories untouched", cat(r, "accuracy_gsat").payout, 40);
  const noDq = new Map(perfectDT); noDq.delete("dtDaysMissingTarget");
  r = scorePosition("driveThru", "36001", "P7 FY2026", noDq);
  check("absent disqualifier does not fire", cat(r, "sos").score, 1);
  check("but is counted pending", cat(r, "sos").pendingCount, 1);

  console.log("\n5. Pending is never zero");
  const pending = new Map(perfectDT); pending.delete("lov_driveThru");
  r = scorePosition("driveThru", "36001", "P7 FY2026", pending);
  check("LOV score null, not 0", cat(r, "lov").score, null);
  check("scoreableWeight drops to 90", r.scoreableWeight, 90);
  check("total counts only what scored", r.score, 128.125);
  const defMiss = new Map(perfectDT); defMiss.set("smgOsat", 50); defMiss.delete("smgAccuracy");
  check("a definitive miss still resolves to 0",
    cat(scorePosition("driveThru", "36001", "P7 FY2026", defMiss), "accuracy_gsat").score, 0);

  console.log("\n6. Sales tiers (store above $85k/week)");
  const bigStore = new Map(Object.entries({
    weeklyEquivalentSales: 90000,
    dtWindowSecs: 56, dtTotalSecs: 235, dtDaysMissingTarget: 0, dtMaxWeeklyPullForwards: 9,
    smgAccuracy: 92, smgOsat: 82, smgAccuracyMinWeekly: 70,
    lov_driveThru: 2, txnAllWeeksGrew: 0, dt_line_busting: 85,
  }));
  r = scorePosition("driveThru", "57004", "P7 FY2026", bigStore);
  check("0:56 clears the >$45k target of 0:57", cond(cat(r, "sos"), "dt_window_time").status, "target");
  check("3:55 clears the >$85k target of 4:00", cond(cat(r, "sos"), "dt_total_time").status, "target");
  check("line busting applies above $85k", cond(cat(r, "sos"), "dt_line_busting").status, "target");
  check("multiplier does not fire at 9 pull-forwards", cat(r, "sos").multiplier, 1);
  check("total, no kicker", r.score, 100);
  const noBust = new Map(bigStore); noBust.set("dt_line_busting", 60);
  check("line busting missed zeroes SOS",
    cat(scorePosition("driveThru", "57004", "P7 FY2026", noBust), "sos").score, 0);

  console.log("\n7. GM labor % is two-sided (target 19-21, threshold 21-22)");
  const laborStatus = (v) => cond(cat(scorePosition("gm", "36001", "P7 FY2026",
    new Map([["gm_labor_pct", v]])), "financial_ops"), "gm_labor_pct").status;
  check("20% hits Target while missing Threshold's band", laborStatus(20), "target");
  check("21.5% hits Threshold only", laborStatus(21.5), "threshold");
  check("18% — too low — misses both", laborStatus(18), "missed");
  checkTrue("bounds are inclusive", passesGate(21, { cmp: "between", value: 19, value2: 21 }));

  console.log("\n8. Director -> AGM -> GM rollup, Living Our Values excluded");
  const base = {
    weeklyEquivalentSales: 40000,
    dtWindowSecs: 65, dtTotalSecs: 210, dtDaysMissingTarget: 0, dtMaxWeeklyPullForwards: 9,
    smgAccuracy: 92, smgOsat: 82, smgFriendliness: 82, smgCleanliness: 82, smgResponses: 70,
    smgAccuracyMinWeekly: 70, smgOsatMinWeekly: 70, smgFriendlinessMinWeekly: 70, smgCleanlinessMinWeekly: 70,
    cogsPct: 28.0, varianceAbsPct: 0.8, splh: 85, tplh: 5.3, txnAllWeeksGrew: 0,
    // Every Director's LOV set to 0 on purpose — the parent must ignore it.
    lov_driveThru: 0, lov_quality: 0, lov_training: 0, lov_hospitality: 0, lov_agm: 0,
    hosp_zcase_resolution: 100, hosp_zcase_count: 3, hosp_facility_inspection: 100,
    hosp_health_cleanliness_violation: 0, hosp_recognition: 100, hosp_pulse_check: 1,
    q_jolt_completion: 100, q_mock_steritech_weekly: 1, q_health_inspection_score: 98,
    q_mock_steritech_dishonest: 0, q_high_risk: 0, q_health_inspection_100: 0, q_steritech_105: 0,
    q_inventory_counts: 2, q_truck_order_resolution: 24, q_reports_24h: 100,
    t_onboarding_completion: 100, t_lto_compliance: 100, t_onboarding_slack: 1,
    t_focus_area_improvement: 12, t_bin_management: 95,
    t_retention_30: 85, t_retention_60: 75, t_retention_90: 75,
    t_shift_lead_pipeline: 2, t_workstream_current: 1, t_pipeline_promotion: 0,
    agm_mock_rer_weekly: 1, agm_mock_rer_dishonest: 0, agm_rer_external_100: 0,
    gm_labor_pct: 20, gm_zu_completion: 100, gm_servesafe: 1, gm_missed_lto_deadlines: 0,
    gm_slack_completion: 100, gm_zu_completed_for_someone: 0, gm_monday_meetings: 1,
  };
  const all = scoreStore("36001", "P7 FY2026", new Map(Object.entries(base)));
  for (const id of ["driveThru", "quality", "training", "hospitality"]) {
    check(`${id}: LOV scores 0 as entered`, cat(all[id], "lov").payout, 0);
    check(`${id}: scoreExLov ignores it`, all[id].scoreExLov, 100);
  }
  check("driveThru's own total IS reduced by its LOV", all.driveThru.score, 90);
  check("AGM Director Performance payout = 90", cat(all.agm, "director_performance").payout, 90);
  check("AGM total = 95 (its own LOV scored 0)", all.agm.score, 95);
  check("AGM scoreExLov renormalises to 100", all.agm.scoreExLov, 100);
  check("GM AGM Performance payout = 50", cat(all.gm, "agm_performance").payout, 50);
  check("GM total = 100", all.gm.score, 100);

  // The worked example the AGM doc states in prose.
  const mixed = new Map(Object.entries(base));
  mixed.set("q_jolt_completion", 96);
  mixed.set("q_inventory_counts", 1);
  mixed.set("q_truck_order_resolution", 60);
  mixed.set("q_reports_24h", 80);
  const half = scoreStore("36001", "P7 FY2026", mixed);
  check("Quality ex-LOV = 50%", half.quality.scoreExLov, 50);
  check("AGM Director Perf = mean(100,50,100,100) = 87.5%",
    cat(half.agm, "director_performance").score * 100, 87.5);
  check("AGM Director Perf payout = 90 x 0.875", cat(half.agm, "director_performance").payout, 78.75);

  // Josh confirmed both of these explicitly on 2026-07-31. They are the two
  // places the order of operations actually changes what someone is paid, so
  // they're pinned here rather than left to the reader of the engine.
  console.log("\n8c. The kicker multiplies the multiplier-inflated total");
  const kicked = new Map(Object.entries(base));
  kicked.set("txnAllWeeksGrew", 1);
  kicked.set("dtMaxWeeklyPullForwards", 3);   // fires the SOS 1.25x
  kicked.set("lov_driveThru", 2);
  r = scoreStore("36001", "P7 FY2026", kicked).driveThru;
  check("SOS pays 50 x 1.25 category multiplier", cat(r, "sos").payout, 62.5);
  check("categories total 112.5 before the kicker",
    r.categories.reduce((s, c) => s + (c.payout ?? 0), 0), 112.5);
  check("kicker applies on top: 112.5 x 1.25", r.score, 140.625);

  console.log("\n8d. What rolls up to the parent is the PRE-kicker percentage");
  const allTargets = new Map(Object.entries(base));
  allTargets.set("txnAllWeeksGrew", 1);
  for (const id of ["driveThru", "quality", "training", "hospitality", "agm"]) {
    allTargets.set(`lov_${id}`, 2);
  }
  const rolled = scoreStore("36001", "P7 FY2026", allTargets);
  for (const id of ["driveThru", "quality", "training", "hospitality"]) {
    check(`${id}: paid at 125% with the kicker`, rolled[id].score, 125);
    check(`${id}: rolls up as 100%, kicker excluded`, rolled[id].scoreExLov, 100);
  }
  check("AGM Director Performance = 100% x 90 weight = 90 pts, not 112.5",
    cat(rolled.agm, "director_performance").payout, 90);
  check("AGM itself is then paid at 125%", rolled.agm.score, 125);
  check("GM AGM Performance = 100% x 50 weight = 50 pts", cat(rolled.gm, "agm_performance").payout, 50);
  check("GM itself is then paid at 125%", rolled.gm.score, 125);

  console.log("\n9. Multipliers take the highest, never the product");
  const bothRet = new Map(Object.entries(base));
  bothRet.set("t_retention_60", 96); bothRet.set("t_retention_90", 96);
  r = scoreStore("36001", "P7 FY2026", bothRet).training;
  check("both retention triggers -> 1.5, not 1.875", cat(r, "retention").multiplier, 1.5);
  const anyMode = new Map(Object.entries(base)); anyMode.set("q_steritech_105", 1);
  check("'any' mode fires on one trigger",
    cat(scoreStore("36001", "P7 FY2026", anyMode).quality, "food_safety").multiplier, 1.5);
  const partial = new Map(Object.entries(base));
  partial.set("smgOsat", 92); partial.set("smgFriendliness", 92);
  check("'all' mode: two of three does not fire",
    cat(scoreStore("36001", "P7 FY2026", partial).hospitality, "gsat").multiplier, 1);
  partial.set("smgCleanliness", 92);
  check("'all' mode: three of three fires",
    cat(scoreStore("36001", "P7 FY2026", partial).hospitality, "gsat").multiplier, 1.25);

  console.log("\n10. Advisory criteria are recorded but never scored");
  const noMeetings = new Map(Object.entries(base)); noMeetings.set("gm_monday_meetings", 0);
  r = scoreStore("36001", "P7 FY2026", noMeetings).gm;
  check("GM total unchanged", r.score, 100);
  check("value still present on the scorecard",
    cond(cat(r, "agm_performance"), "gm_monday_meetings").value, 0);

  console.log("\n11. Manual criteria per position");
  for (const id of Object.keys(BONUS_RULES)) console.log(`     ${id}: ${manualConditions(id).length}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
} finally {
  rmSync(out, { recursive: true, force: true });
}
