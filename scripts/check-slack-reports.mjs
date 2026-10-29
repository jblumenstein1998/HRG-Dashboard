// Run with:  node scripts/check-slack-reports.mjs
//
// Fixture checks for the Slack reporting classifier (src/lib/slackReports.ts),
// the GM's "Slack completion rate". Same approach as check-bonus-engine.mjs:
// compile the real module with tsc and exercise it — nothing mocked.
//
// The fixtures are real messages from #brentwood-56301 (Central) and
// #hampton-57002 (Eastern), October 2026, with their Slack timestamps. They are
// here because every one of them is a format somebody actually uses.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const out = mkdtempSync(join(tmpdir(), "slack-reports-"));
try {
  const tsc = join(dirname(require.resolve("typescript")), "tsc.js");
  execFileSync(
    process.execPath,
    [tsc, "src/lib/slackReports.ts", "src/lib/slackFields.ts", "--outDir", out, "--module", "commonjs",
     "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck"],
    { stdio: "inherit" }
  );
  const S = require(join(out, "slackReports.js"));
  const F = require(join(out, "slackFields.js"));

  let pass = 0;
  let fail = 0;
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) pass++;
    else {
      fail++;
      console.error(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
    }
  };

  // "2026-10-28 21:12:42 EDT" → Slack ts
  const ts = (edt) => String(Date.parse(edt.replace(" ", "T") + "-04:00") / 1000);
  const msg = (edt, text) => ({ ts: ts(edt), text, user: "U1" });
  const pick = (p) => p && { date: p.date, slot: p.slot, onTime: p.onTime };
  const CT = "America/Chicago";
  const ET = "America/New_York";

  // ── Classification by content ──────────────────────────────────────────────
  check("brentwood lunch", S.classifyByContent("10/28 lunch \nNet sales- $1547\nSPH- \n11-12 $376\n12-1 $540\n1-2 $406\nProd- 71.35\nTPLH- 5 \nAvg- $14.07\nDrive time- 3:54"), "lunch");
  check("brentwood midday", S.classifyByContent("10/28/26 midday \n\nNet Sales - $2,372.61\nSPH - \n2-3 - $380.49\n3-4 - $160.15\n4-5 - $367.89\nPROD - $74.96\nTPLH - 4.99\nAVG - $15.02\nLane - 3:27"), "midday");
  check("brentwood dinner", S.classifyByContent("10/28 dinner \nNet sales- $3587\nSPH- \n4-5 $248\n5-6 $543\n6-7 $402\nProd- 70.62\nTPLH- 4.37"), "dinner");
  check("hampton midday, ranges typed 2:3", S.classifyByContent("Total net sales: $5.119.90\nHourly breakdown:\n•2:3: 797.79\n•3-4: 655.53\n•4-5: 812.72\nProductivity(SPLH): $65.25\nTotal Window: .59\nTotal time(PF): 2:59"), "midday");
  check("hampton full day, bold", S.classifyByContent("*Total net sales:$11,306.91*\n*Comp%18.60*\n*Catering: 0*\n*Productivity: :$74.34*\n*Total window: 1:01*\n*Sales projection$11.054.28*"), "previous_day");
  check("full day labelled 'dinner'", S.classifyByContent("10/15 dinner \nNet sales- $4326\nComp- +11.5 \nCatering- 0 \nSales projection- $4433"), "previous_day");
  check("no ranges, no words", S.classifyByContent("Net 1936 Prod 51 Tplh 3.5 Lane 3:43"), null);
  check("lane times are not ranges", S.classifyByContent("Net 2000 TL- 3:43 TW- 1:37 Drive time- 5:52 Lane 2:43"), null);
  check("chatter is not a report", S.isReport("Sorry for late slack"), false);
  check("drive-time follow-up is not a report", S.isReport("Dt 3:26"), false);

  // From the P10 audit on the admin tab (2026-10-29).
  check("'Netsales' with no space is a report", S.isReport("Netsales: 1,954.10\n11-12: 654.90\n12-1 446.91"), true);
  check("'Sales-' without 'net' is a report", S.isReport("10/8 whole day\nSales- $4334\nComp- +13.3%"), true);
  check("a leader's blank template is not a report", S.isReport("*Taking care of the little things*\n*Total net sales:* \n*Comp % :* \n*Catering: 0"), false);
  check("filled hours with no total is a report", S.isReport("NET SALES:\n2-3: 384\n3-4: 795\n4-5: 887\nPROD: 55.97"), true);
  check("an unfilled template is not a report", S.isReport("Net Sales: $ • 5-6: $ • 6-7: $ • 7-8: $ • Productivity: $"), false);
  check("talk about sales is not a report", S.isReport("I used the calculation for SPLH...sales for Tuesday I see as $7548"), false);
  check("ranges beat a 'comp' sign-off",
    S.classifyByContent("Total net sales: $4433\nHourly breakdown:\n2-3 $626\n3-4 $587\n4-5 $524\n\nThursday night showdown!! Getting set to comp up!@"), "midday");
  check("'5-6' pasted into a 5:09 PM report is read by the clock",
    pick(S.placeMessage(msg("2026-10-11 17:09:00", "*Net Sales $5905.94*\n*5-6 $984.80*\n*6-7 $853*"), ET)),
    { date: "2026-10-11", slot: "midday", onTime: true });

  // ── Placement (date, slot, on time) ────────────────────────────────────────
  check("CT lunch 3:17 PM ET = 2:17 CT, on time",
    pick(S.placeMessage(msg("2026-10-28 15:17:12", "10/28 lunch \nNet sales- $1547\n11-12 $376\n12-1 $540\n1-2 $406"), CT)),
    { date: "2026-10-28", slot: "lunch", onTime: true });
  check("CT full day 9:40 AM ET = 8:40 CT, ten minutes late, within grace",
    pick(S.placeMessage(msg("2026-10-28 09:40:12", "10/27/26 Full Day \n\nNet sales- $4,247.22\nComp- +17.9%"), CT)),
    { date: "2026-10-28", slot: "previous_day", onTime: true });
  check("grace ends at 15 minutes: 8:46 CT is late",
    S.placeMessage(msg("2026-10-28 09:46:00", "10/27/26 Full Day \nNet sales- $4,247.22\nComp- +17.9%"), CT).onTime, false);
  check("8:45 CT is the last minute of grace",
    [S.placeMessage(msg("2026-10-28 09:45:00", "10/27/26 Full Day \nNet sales- $4,247.22\nComp- +17.9%"), CT)].map((p) => [p.onTime, p.inGrace])[0], [true, true]);
  check("ET full day 7:34 AM, on time",
    pick(S.placeMessage(msg("2026-10-29 07:34:23", "*Total net sales:$11,306.91*\n*Comp%18.60*"), ET)),
    { date: "2026-10-29", slot: "previous_day", onTime: true });
  check("typo'd date on an on-time post uses the posting date",
    pick(S.placeMessage(msg("2026-10-27 21:38:28", "10/22 dinner \nNet sales- $3936\nSph-\n5-6 $286\n6-7 $573\n7-8 $598"), CT)),
    { date: "2026-10-27", slot: "dinner", onTime: true });
  check("typo'd month ignored",
    pick(S.placeMessage(msg("2026-10-21 15:15:39", "11/21 lunch\nNet 1357\n11-12 453\n12-1 404\n1-2 384"), CT)),
    { date: "2026-10-21", slot: "lunch", onTime: true });
  check("catch-up report next morning credits its written day, late",
    pick(S.placeMessage(msg("2026-10-22 09:05:00", "10/21 dinner\nNet 3428\n5-6 501\n6-7 401\n7-8 588"), CT)),
    { date: "2026-10-21", slot: "dinner", onTime: false });
  check("bot messages ignored",
    pick(S.placeMessage({ ...msg("2026-10-28 15:17:12", "Net 1 11-12 1"), bot_id: "B1" }, CT)), null);

  // ── Scoring a day ──────────────────────────────────────────────────────────
  // Brentwood, 10/21: the area leader posted "No 5pm or 8pm slack" about 10/20.
  const brentwood = [
    msg("2026-10-20 09:17:57", "10/19 whole day \nNet sales- $4031\nComp- +34%"),
    msg("2026-10-20 15:36:54", "10/20/26 lunch \n\nNet Sales - $1,433.72\nSPH -\n11-12 - $405.76\n12-1 - $425.78\n1-2 - $290.81"),
    msg("2026-10-21 09:50:58", "<!channel>\n\nNo 5pm or 8pm slack\n\nCan someone please explain why we can't figure out something this simple?"),
  ];
  const day = S.scoreSlackReports(brentwood, { timeZone: CT, start: "2026-10-20", end: "2026-10-20" });
  check("10/20 slots (lunch posted 2:36 CT, six minutes late, within grace)", day.days[0].slots, { previous_day: "on_time", lunch: "on_time", midday: "missed", dinner: "missed" });
  check("10/20 totals", [day.required, day.onTime, day.inGrace, day.late, day.missed, day.pct], [4, 2, 1, 0, 2, 50]);

  // A range running through today: at 3:00 PM CT on 10/20, the 2:30 report is
  // due (and in), the 5:30 and 8:30 aren't yet.
  const midday = S.scoreSlackReports(brentwood, {
    timeZone: CT, start: "2026-10-20", end: "2026-10-20", now: { date: "2026-10-20", minutes: 15 * 60 },
  });
  check("today: not-yet-due slots are upcoming, not missed",
    midday.days[0].slots, { previous_day: "on_time", lunch: "on_time", midday: "upcoming", dinner: "upcoming" });
  check("today: upcoming slots aren't counted", [midday.required, midday.missed, midday.pct], [2, 0, 100]);

  const closed = S.scoreSlackReports(brentwood, {
    timeZone: CT, start: "2026-10-20", end: "2026-10-21", openDays: new Set(["2026-10-19", "2026-10-20"]),
  });
  check("closed day: only the morning-after report is required",
    closed.days[1].slots, { previous_day: "missed", lunch: null, midday: null, dinner: null });
  check("closed day totals", closed.required, 5);

  // ── Time zones ─────────────────────────────────────────────────────────────
  check("CT midnight", S.localMidnight("2026-10-20", CT), Date.parse("2026-10-20T05:00:00Z") / 1000);
  check("ET midnight", S.localMidnight("2026-10-20", ET), Date.parse("2026-10-20T04:00:00Z") / 1000);
  check("ET midnight after DST ends", S.localMidnight("2026-11-02", ET), Date.parse("2026-11-02T05:00:00Z") / 1000);

  // ── Field parsing (src/lib/slackFields.ts) ─────────────────────────────────
  const brentwoodDay = F.parseReportFields(
    "10/22 whole day \nNet sales- $4319\nComp- +8\nCatering- 0 \nProd- 66.25\nTPLH- 4.17\nAvg- 15.88\nThird party- 17.68%\nTW- 2:06 \nTL- 6:04\nJolt- 85.7%\nSales projection- $4375\nProd projection- 55.08",
  );
  check("brentwood full day",
    [brentwoodDay.netSales, brentwoodDay.compPct, brentwoodDay.splh, brentwoodDay.tplh, brentwoodDay.avgCheck,
     brentwoodDay.windowSecs, brentwoodDay.laneSecs, brentwoodDay.joltPct],
    [4319, 8, 66.25, 4.17, 15.88, 126, 364, 85.7]);
  check("negative comp after a separator dash", F.parseReportFields("Net sales- $3851\nComp- -10%").compPct, -10);
  check("negative comp written against the number", F.parseReportFields("Net 3417\nComp -9.7").compPct, -9.7);
  check("cash: separator dash is not a sign", F.parseReportFields("Net Sales - $4,247.22\nCash - $0.37").cashOverShort, 0.37);
  check("cash over", F.parseReportFields("Net sales- $4031\nCash over- $3.47").cashOverShort, 3.47);
  check("cash plus", F.parseReportFields("Net sales- $3851\nCash- +1.09").cashOverShort, 1.09);
  const hampton = F.parseReportFields(
    "*Total net sales:$11,306.91*\n*Comp%18.60*\n*Catering: 0*\n*Productivity: :$74.34*\n*TPLH:4.10*\n*Average check: $17.69*\n*% of third party:24.13*\n*Total window: 1:01*\n*Total lane(w/PF): 3:46*\n*ArrowStream submissions: 0*\n*Cash over/short: 11.23*\n*Current Day:*\n*Sales projection$11.054.28*\n*Productivity projections 75.78*",
  );
  check("hampton full day, bold",
    [hampton.netSales, hampton.compPct, hampton.splh, hampton.tplh, hampton.avgCheck, hampton.windowSecs, hampton.laneSecs, hampton.cashOverShort],
    [11306.91, 18.6, 74.34, 4.1, 17.69, 61, 226, 11.23]);
  const hamptonMid = F.parseReportFields(
    "Total net sales: $5.119.90\nHourly breakdown:\n•2:3: 797.79\n•3-4: 655.53\n•4-5: 812.72\nProductivity(SPLH): $65.25\nTPLH: 4.0\nAverage check: $15.80\nTotal Window: .59\nTotal time(PF): 2:59",
  );
  check("hampton midday hours, typed 2:3", hamptonMid.hourly, { 14: 797.79, 15: 655.53, 16: 812.72 });
  check("hampton midday SPLH / window / lane", [hamptonMid.splh, hamptonMid.windowSecs, hamptonMid.laneSecs], [65.25, 59, 179]);
  const oyster = F.parseReportFields("Netsales -2,023.68\nHourly 11-12/341.48 12-1/ 719.79 1-2/ 359.09\nProductivity -58.36\nTPLH-3.5");
  check("oyster: 'Netsales -' and slashed hours", [oyster.netSales, oyster.splh, oyster.tplh, oyster.hourly],
    [2023.68, 58.36, 3.5, { 11: 341.48, 12: 719.79, 13: 359.09 }]);
  check("decimal comma", F.parseReportFields("Net: $7468\nProductivity: 77,35\nTPLH: 4.105").splh, 77.35);
  check("thousands comma still thousands", F.parseReportFields("Netsales: 1,954.10\nNet sales: 11,306").netSales, 1954.1);
  check("a weekly recap isn't a daily report",
    S.isReport("Gdm!!!  As you know we have completed the first week of period 10\n\nTotal net sales: 55316\nComp % : -1.33 (period)\nSales projections for the week: $52,343.00"), false);
  check("projection lines don't read as productivity",
    F.parseReportFields("Net sales: $100\nSales Projection: $6,014.65\nProductivity Projection: $85.07").splh, null);

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
