/**
 * The district-style WBR: one portfolio overview, then three slides per
 * district manager — Sales, Labor, Food & Drive-thru — carrying everything the
 * by-metric deck shows (sales, productivity, variance, COGS, drive times), only
 * grouped by the person accountable for it.
 *
 * Same data as the classic slides (WbrWeek) plus OpsData for food cost and
 * drive-thru; same palette; a lighter, dashboard-like frame: a white header with
 * the DM's name and section tabs, cards on gray-50, goal colours from the tabs'
 * own thresholds (lib/foodCostGoals, lib/salesTierGoals, lib/wbr/targets).
 */

import { C, Canvas, toneOf, type SlidesRequest, type Tone } from "@/lib/wbr/draw";
import type { DistrictWeek, SalesFigures, WbrWeek } from "@/lib/wbr/data";
import { totalDrive, totalFood, type DriveThru, type FoodCost, type OpsData } from "@/lib/wbr/opsData";
import { cogsLevel, varianceLevel, type GoalLevel } from "@/lib/foodCostGoals";
import { TOTAL_TIME_TIERS, WINDOW_TIME_TIERS } from "@/lib/salesTierGoals";
import {
  atTarget,
  change,
  count,
  improved,
  latest,
  marketName,
  monDay,
  newSlide,
  pctLabel,
  previous,
  productivityTakeaway,
  restaurants,
  salesReadout,
  SPLH,
  targetLabel,
  TPLH,
  usd0,
  usd2,
  usdK,
  weekSpan,
  WBR_SLIDE_PREFIX,
  type Kind,
  type Placement,
} from "@/lib/wbr/slides";

const W = 720;
const L = 28; // page margin
const R = W - L;

// ── Small formatters and goal tones ──────────────────────────────────────────

const mmss = (s: number | null | undefined) =>
  s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const pct1 = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);
/** Food-cost tab convention: negative variance in parentheses. */
const varPct = (v: number | null | undefined) => (v == null ? "—" : v < 0 ? `(${Math.abs(v).toFixed(2)}%)` : `${v.toFixed(2)}%`);
const varUsd = (v: number | null | undefined) =>
  v == null ? "—" : v < 0 ? `(${usd0(Math.abs(v))})` : usd0(v);

const levelTone = (l: GoalLevel | null): Tone => (l === null ? "neutral" : l);

/** Lane/window against the Drive-Thru tab's sales-tier goals. */
function driveTone(secs: number | null | undefined, weeklySales: number | null | undefined, field: "lane" | "window"): Tone {
  if (secs == null || weeklySales == null) return "neutral";
  const tier = (field === "lane" ? TOTAL_TIME_TIERS : WINDOW_TIME_TIERS).find(t => t.test(weeklySales));
  if (!tier) return "neutral";
  return secs <= tier.greenMax ? "good" : secs <= tier.yellowMax ? "warn" : "bad";
}

const toneText = (t: Tone) => (t === "good" ? C.green600 : t === "warn" ? C.yellow600 : t === "bad" ? C.red600 : C.gray500);

/** District SPLH/TPLH from store sales and implied labor hours (sales ÷ SPLH). */
function districtLabor(d: DistrictWeek, week: "current" | "prior") {
  let sales = 0, txns = 0, hours = 0;
  for (const s of d.stores) {
    const i = week === "current" ? s.splh.length - 1 : s.splh.length - 2;
    const splh = s.splh[i];
    const f = week === "current" ? s.current : s.prior;
    if (!splh) continue;
    sales += f.netSales;
    txns += f.transactions;
    hours += f.netSales / splh;
  }
  return { splh: hours ? sales / hours : null, tplh: hours ? txns / hours : null };
}

// ── Frame ────────────────────────────────────────────────────────────────────

const TABS = ["SALES", "LABOR", "FOOD & DRIVE-THRU"] as const;
type TabName = (typeof TABS)[number];

function frame(
  c: Canvas,
  wk: WbrWeek,
  opts: { title: string; subtitle: string; tab: TabName | null; footer: string; page: string },
) {
  // Header: white, like the dashboard's own top bar, with a red brand stripe.
  c.box(0, 0, W, 66, C.white);
  c.box(0, 0, 4, 66, C.red700);
  c.rule(0, 66, W, 0.75, C.gray200);
  c.text(L, 10, 400, 10, `WEEKLY BUSINESS REVIEW  ·  ${weekSpan(wk.week.start, wk.week.end)}`, {
    size: 7,
    bold: true,
    color: C.gray400,
  });
  c.text(L, 21, 400, 26, opts.title, { size: 20, bold: true, color: C.gray900 });
  c.text(L, 47, 400, 11, opts.subtitle, { size: 7.5, bold: true, color: C.gray500 });

  if (opts.tab) {
    // Section tabs, right-aligned; the current one filled.
    const widths: Record<TabName, number> = { SALES: 52, LABOR: 52, "FOOD & DRIVE-THRU": 104 };
    let x = R;
    for (const t of [...TABS].reverse()) {
      x -= widths[t];
      const on = t === opts.tab;
      c.box(x, 26, widths[t], 18, on ? C.gray900 : C.gray100, { round: true });
      c.text(x, 26, widths[t], 18, t, { size: 7, bold: true, color: on ? C.white : C.gray500, align: "CENTER" });
      x -= 6;
    }
  }

  c.rule(L, 388, R - L, 0.6, C.gray200);
  c.text(L, 391, 560, 9, opts.footer, { size: 6, color: C.gray400 });
  c.text(R - 120, 391, 120, 9, opts.page, { size: 6, bold: true, color: C.gray400, align: "END" });
}

const sourceLine = (wk: WbrWeek) =>
  `PAR POS · week ${monDay(wk.week.start)}–${monDay(wk.week.end)} vs prior week ${monDay(wk.priorWeek.start)}–${monDay(wk.priorWeek.end)} and same week last year`;

function sectionLabel(c: Canvas, x: number, y: number, w: number, text: string, note?: string) {
  c.text(x, y, w, 11, text, { size: 7.5, bold: true, color: C.gray900 });
  if (note) c.text(x, y, w, 11, note, { size: 6.5, color: C.gray400, align: "END" });
}

// ── Portfolio overview ───────────────────────────────────────────────────────

export function overviewSlide(wk: WbrWeek, ops: OpsData, at: Placement): SlidesRequest[] {
  const c = new Canvas(at.slideId);
  const stores = wk.districts.flatMap(d => d.stores);
  frame(c, wk, {
    title: "Portfolio overview",
    subtitle: `${wk.districts.length} DISTRICTS  ·  ${restaurants(stores.length)}`,
    tab: null,
    footer: `${sourceLine(wk)} · Net-Chef food cost · BerryAI drive-thru`,
    page: "OVERVIEW",
  });

  // Columns: label, then metric columns.
  const cols = [
    { key: "sales", label: "NET SALES", w: 92 },
    { key: "txns", label: "TRANSACTIONS", w: 70 },
    { key: "check", label: "AVG CHECK", w: 56 },
    { key: "splh", label: "SPLH", w: 52 },
    { key: "tplh", label: "TPLH", w: 46 },
    { key: "cogs", label: "COGS", w: 50 },
    { key: "var", label: "VARIANCE", w: 56 },
    { key: "lane", label: "LANE", w: 46 },
    { key: "window", label: "WINDOW", w: 50 },
  ] as const;
  const nameW = R - L - cols.reduce((s, k) => s + k.w, 0);
  let x = L + nameW;
  const colX: number[] = [];
  for (const k of cols) {
    colX.push(x);
    c.text(x, 80, k.w, 12, k.label, { size: 6.5, bold: true, color: C.gray400, align: "CENTER" });
    x += k.w;
  }
  c.text(L + 10, 80, nameW, 12, "DISTRICT", { size: 6.5, bold: true, color: C.gray400 });

  type Row = {
    name: string;
    sub: string;
    cur: SalesFigures;
    prior: SalesFigures;
    yoyNow: SalesFigures | null;
    py: SalesFigures | null;
    labor: { splh: number | null; tplh: number | null };
    splhAt: string;
    tplhAt: string;
    food: FoodCost;
    drive: DriveThru | null;
    avgSales: number | null;
    total?: boolean;
  };

  const sum = (xs: SalesFigures[]): SalesFigures => {
    const netSales = xs.reduce((s, f) => s + f.netSales, 0);
    const transactions = xs.reduce((s, f) => s + f.transactions, 0);
    return { netSales, transactions, avgCheck: transactions ? netSales / transactions : null };
  };

  const rows: Row[] = wk.districts.map(d => {
    const o = d.stores.map(s => ops.stores.get(s.label)).filter(Boolean);
    return {
      name: d.leader,
      sub: `${marketName(d)} · ${d.stores.length} stores`,
      cur: d.total.current,
      prior: d.total.prior,
      yoyNow: d.total.currentLegacy,
      py: d.total.priorYear,
      labor: districtLabor(d, "current"),
      splhAt: `${d.stores.filter(s => atTarget(s, SPLH)).length}/${d.stores.length} at target`,
      tplhAt: `${d.stores.filter(s => atTarget(s, TPLH)).length}/${d.stores.length} at target`,
      food: totalFood(o.map(x => x!.food.week)),
      drive: totalDrive(o.map(x => x!.drive.week)),
      avgSales: d.total.current.netSales / d.stores.length,
    };
  });

  // HRG total: every store once, even if a store sits under two DMs.
  const legacy = stores.filter(s => s.priorYear);
  const allOps = stores.map(s => ops.stores.get(s.label)).filter(Boolean);
  const hrgHours = stores.reduce((s, st) => s + (latest(st, SPLH) ? st.current.netSales / latest(st, SPLH)! : 0), 0);
  rows.push({
    name: "HRG total",
    sub: `${restaurants(stores.length)}`,
    cur: sum(stores.map(s => s.current)),
    prior: sum(stores.map(s => s.prior)),
    yoyNow: sum(legacy.map(s => s.current)),
    py: legacy.length ? sum(legacy.map(s => s.priorYear!)) : null,
    labor: {
      splh: hrgHours ? stores.reduce((s, st) => s + st.current.netSales, 0) / hrgHours : null,
      tplh: hrgHours ? stores.reduce((s, st) => s + st.current.transactions, 0) / hrgHours : null,
    },
    splhAt: `${stores.filter(s => atTarget(s, SPLH)).length}/${stores.length} at target`,
    tplhAt: `${stores.filter(s => atTarget(s, TPLH)).length}/${stores.length} at target`,
    food: totalFood(allOps.map(x => x!.food.week)),
    drive: totalDrive(allOps.map(x => x!.drive.week)),
    avgSales: sum(stores.map(s => s.current)).netSales / stores.length,
    total: true,
  });

  const top = 96;
  const pitch = Math.min(52, (372 - top) / rows.length);
  const rowH = pitch - 6;
  rows.forEach((r, i) => {
    const y = top + i * pitch;
    c.box(L, y, R - L, rowH, r.total ? C.gray100 : C.white, { line: r.total ? C.gray300 : C.gray200, round: true });
    if (!r.total) c.box(L, y + 8, 3, rowH - 16, C.red700);
    c.text(L + 10, y + 5, nameW - 10, 16, r.name, { size: 11, bold: true, color: C.gray900 });
    c.text(L + 10, y + 21, nameW - 10, 10, r.sub.toUpperCase(), { size: 6, bold: true, color: C.gray400 });

    const big = (i: number, text: string, color: string = C.gray900) =>
      c.text(colX[i], y + 4, cols[i].w, 16, text, { size: 10.5, bold: true, color, align: "CENTER" });
    const small = (i: number, text: string, color: string = C.gray500) =>
      c.text(colX[i], y + 21, cols[i].w, 10, text, { size: 6.5, bold: true, color, align: "CENTER" });

    const wow = change(r.cur.netSales, r.prior.netSales);
    const yoy = r.py && r.yoyNow ? change(r.yoyNow.netSales, r.py.netSales) : null;
    big(0, usdK(r.cur.netSales));
    small(0, `${pctLabel(wow)} WoW  ${pctLabel(yoy)} YoY`, toneText(toneOf(wow)));
    const tw = change(r.cur.transactions, r.prior.transactions);
    big(1, count(r.cur.transactions));
    small(1, `${pctLabel(tw)} WoW`, toneText(toneOf(tw)));
    const cw = change(r.cur.avgCheck, r.prior.avgCheck);
    big(2, r.cur.avgCheck == null ? "—" : usd2(r.cur.avgCheck));
    small(2, `${pctLabel(cw)} WoW`, toneText(toneOf(cw)));
    big(3, r.labor.splh == null ? "—" : usd2(r.labor.splh));
    small(3, r.splhAt);
    big(4, r.labor.tplh == null ? "—" : r.labor.tplh.toFixed(2));
    small(4, r.tplhAt);
    const cogsT = levelTone(cogsLevel(r.food.cogsPct));
    big(5, pct1(r.food.cogsPct), toneText(cogsT));
    small(5, r.food.cogsDollars == null ? "" : usdK(r.food.cogsDollars));
    const varT = levelTone(varianceLevel(r.food.variancePct));
    big(6, varPct(r.food.variancePct), toneText(varT));
    small(6, varUsd(r.food.varianceDollars));
    big(7, mmss(r.drive?.laneSecs), toneText(driveTone(r.drive?.laneSecs, r.avgSales, "lane")));
    small(7, r.drive?.cars ? `${count(r.drive.cars)} cars` : "");
    big(8, mmss(r.drive?.windowSecs), toneText(driveTone(r.drive?.windowSecs, r.avgSales, "window")));
    small(8, r.drive?.flagged != null ? `${count(r.drive.flagged)} flagged` : "");
  });

  return [...newSlide(at), ...c.requests];
}

// ── Per-DM: Sales ────────────────────────────────────────────────────────────

const dmTitle = (d: DistrictWeek) => d.leader;
const dmSub = (d: DistrictWeek) => `${marketName(d)}  ·  ${restaurants(d.stores.length)}`;

type Metric = { label: string; pick: (f: SalesFigures) => number | null; fmt: (v: number) => string };
const METRICS: Metric[] = [
  { label: "NET SALES", pick: f => f.netSales, fmt: usdK },
  { label: "TRANSACTIONS", pick: f => f.transactions, fmt: count },
  { label: "AVERAGE CHECK", pick: f => f.avgCheck, fmt: usd2 },
];

export function dmSalesSlide(wk: WbrWeek, d: DistrictWeek, idx: number, at: Placement): SlidesRequest[] {
  const c = new Canvas(at.slideId);
  frame(c, wk, {
    title: dmTitle(d),
    subtitle: dmSub(d),
    tab: "SALES",
    footer: sourceLine(wk) + (d.yoyLegacyOnly ? " · YoY totals cover legacy stores only" : ""),
    page: `DISTRICT ${idx + 1} OF ${wk.districts.length}  ·  1/3`,
  });

  // KPI tiles
  const tileW = (R - L - 2 * 12) / 3;
  METRICS.forEach((m, i) => {
    const x = L + i * (tileW + 12);
    c.box(x, 80, tileW, 62, C.white, { line: C.gray200, round: true });
    c.text(x + 12, 87, 120, 10, m.label, { size: 7, bold: true, color: C.gray500 });
    const now = m.pick(d.total.current);
    c.text(x + 12, 99, 120, 28, now == null ? "—" : m.fmt(now), { size: 22, bold: true, color: C.gray900 });
    const wow = change(now, m.pick(d.total.prior));
    const yoy = d.total.priorYear ? change(m.pick(d.total.currentLegacy), m.pick(d.total.priorYear)) : null;
    c.text(x + tileW - 92, 87, 40, 10, "WoW", { size: 6, bold: true, color: C.gray400, align: "CENTER" });
    c.text(x + tileW - 48, 87, 40, 10, "YoY", { size: 6, bold: true, color: C.gray400, align: "CENTER" });
    c.chip(x + tileW - 92, 100, 40, 18, pctLabel(wow), toneOf(wow), 7.5);
    c.chip(x + tileW - 48, 100, 40, 18, pctLabel(yoy), toneOf(yoy), 7.5);
    c.text(x + 12, 128, tileW - 24, 9, `Prior week ${m.pick(d.total.prior) == null ? "—" : m.fmt(m.pick(d.total.prior)!)}`, {
      size: 6.5,
      color: C.gray400,
    });
  });

  // Store table
  sectionLabel(c, L, 154, R - L, "BY STORE");
  const nameW = 130;
  const groupW = (R - L - nameW) / 3;
  METRICS.forEach((m, i) => {
    const gx = L + nameW + i * groupW;
    c.text(gx, 154, groupW, 11, m.label, { size: 6.5, bold: true, color: C.gray400, align: "CENTER" });
    c.text(gx, 166, groupW * 0.4, 10, "THIS WEEK", { size: 6, bold: true, color: C.gray400 });
    c.text(gx + groupW * 0.4, 166, groupW * 0.3, 10, "WoW", { size: 6, bold: true, color: C.gray400, align: "CENTER" });
    c.text(gx + groupW * 0.7, 166, groupW * 0.3, 10, "YoY", { size: 6, bold: true, color: C.gray400, align: "CENTER" });
  });

  const rows = d.stores.length + 1;
  const top = 180;
  const pitch = Math.min(29, (334 - top) / rows);
  const rowH = pitch - 4;
  const drawRow = (y: number, label: string, cur: SalesFigures, prior: SalesFigures, yoyNow: SalesFigures | null, py: SalesFigures | null, total: boolean) => {
    c.box(L, y, R - L, rowH, total ? C.gray100 : C.white, { line: total ? C.gray300 : C.gray200, round: true });
    c.text(L + 10, y, nameW - 10, rowH, label, { size: total ? 8 : 9, bold: true, color: C.gray900 });
    METRICS.forEach((m, i) => {
      const gx = L + nameW + i * groupW;
      const now = m.pick(cur);
      c.text(gx, y, groupW * 0.4, rowH, now == null ? "—" : m.fmt(now), { size: 9.5, bold: true, color: C.gray900 });
      const wow = change(now, m.pick(prior));
      const yoy = py && yoyNow ? change(m.pick(yoyNow), m.pick(py)) : null;
      const cy = y + (rowH - 15) / 2;
      c.chip(gx + groupW * 0.4 + 4, cy, groupW * 0.3 - 8, 15, pctLabel(wow), toneOf(wow));
      c.chip(gx + groupW * 0.7 + 4, cy, groupW * 0.3 - 8, 15, pctLabel(yoy), toneOf(yoy));
    });
  };
  d.stores.forEach((s, i) => drawRow(top + i * pitch, s.label, s.current, s.prior, s.current, s.priorYear, false));
  drawRow(top + d.stores.length * pitch, "District total", d.total.current, d.total.prior, d.total.currentLegacy, d.total.priorYear, true);

  // Readout
  const ry = 344;
  c.box(L, ry, R - L, 36, C.white, { line: C.gray200, round: true });
  c.box(L, ry + 8, 3, 20, C.red700);
  c.text(L + 12, ry + 4, 100, 10, "READOUT", { size: 6.5, bold: true, color: C.red700 });
  c.text(L + 12, ry + 15, R - L - 24, 16, salesReadout(d), { size: 8, bold: true, color: C.gray900 });

  return [...newSlide(at), ...c.requests];
}

// ── Per-DM: Labor ────────────────────────────────────────────────────────────

/** Three-week mini bars against the target floor (a dashed-looking line). */
function trendBars(c: Canvas, x: number, y: number, w: number, h: number, values: (number | null)[], floor: number | null, labels: string[]) {
  // Scaled to the data's own range, not from zero: weekly SPLH moves a few
  // dollars on a base of ~$70, which from a zero baseline is three equal bars.
  const vals = values.filter((v): v is number => v != null);
  if (!vals.length) return;
  const all = floor != null ? [...vals, floor] : vals;
  const span = Math.max(...all) - Math.min(...all) || Math.max(...all) * 0.1 || 1;
  const lo = Math.min(...all) - span * 0.6;
  const hi = Math.max(...all) + span * 0.15;
  const yOf = (v: number) => y + h - ((v - lo) / (hi - lo)) * h;
  const bw = (w - (values.length - 1) * 6) / values.length;
  values.forEach((v, i) => {
    const bx = x + i * (bw + 6);
    const last = i === values.length - 1;
    if (v != null) {
      const top = yOf(v);
      const ok = floor == null || v >= floor;
      c.box(bx, top, bw, y + h - top, last ? (ok ? C.green600 : C.red600) : C.gray300);
    }
    c.text(bx - 4, y + h + 1, bw + 8, 8, labels[i], { size: 5, bold: last, color: last ? C.gray700 : C.gray400, align: "CENTER" });
  });
  if (floor != null) {
    c.rule(x - 2, yOf(floor), w + 4, 0.75, C.gray900);
    c.text(x + w - 30, yOf(floor) - 8, 32, 7, "TARGET", { size: 4.5, bold: true, color: C.gray500, align: "END" });
  }
}

export function dmLaborSlide(wk: WbrWeek, d: DistrictWeek, idx: number, at: Placement): SlidesRequest[] {
  const c = new Canvas(at.slideId);
  const n = d.stores.length;
  frame(c, wk, {
    title: dmTitle(d),
    subtitle: dmSub(d),
    tab: "LABOR",
    footer: `PAR POS sales and labor hours · weeks starting ${wk.trendWeeks.map(w => monDay(w.start)).join(", ")} · targets per store`,
    page: `DISTRICT ${idx + 1} OF ${wk.districts.length}  ·  2/3`,
  });

  // Scorecards: district SPLH/TPLH, then counts.
  const now = districtLabor(d, "current");
  const before = districtLabor(d, "prior");
  const cards: { label: string; big: string; sub: string; tone?: Tone }[] = [
    {
      label: "DISTRICT SPLH",
      big: now.splh == null ? "—" : usd2(now.splh),
      sub: now.splh != null && before.splh != null ? `${now.splh >= before.splh ? "▲" : "▼"} ${usd2(Math.abs(now.splh - before.splh))} WoW` : "",
      tone: now.splh != null && before.splh != null ? toneOf(now.splh - before.splh) : "neutral",
    },
    {
      label: "DISTRICT TPLH",
      big: now.tplh == null ? "—" : now.tplh.toFixed(2),
      sub: now.tplh != null && before.tplh != null ? `${now.tplh >= before.tplh ? "▲" : "▼"} ${Math.abs(now.tplh - before.tplh).toFixed(2)} WoW` : "",
      tone: now.tplh != null && before.tplh != null ? (now.tplh > before.tplh ? "good" : now.tplh < before.tplh ? "bad" : "neutral") : "neutral",
    },
    { label: "SPLH AT TARGET", big: `${d.stores.filter(s => atTarget(s, SPLH)).length} / ${n}`, sub: `${d.stores.filter(s => improved(s, SPLH)).length} improved WoW` },
    { label: "TPLH AT TARGET", big: `${d.stores.filter(s => atTarget(s, TPLH)).length} / ${n}`, sub: `${d.stores.filter(s => improved(s, TPLH)).length} improved WoW` },
  ];
  const cw = (R - L - 3 * 10) / 4;
  cards.forEach((k, i) => {
    const x = L + i * (cw + 10);
    c.box(x, 78, cw, 50, C.white, { line: C.gray200, round: true });
    c.text(x + 10, 84, cw - 20, 10, k.label, { size: 6.5, bold: true, color: C.gray500 });
    c.text(x + 10, 95, cw - 20, 22, k.big, { size: 17, bold: true, color: C.gray900 });
    c.text(x + 10, 115, cw - 20, 9, k.sub, { size: 6.5, bold: true, color: k.tone ? toneText(k.tone) : C.gray500 });
  });

  // Column heads
  const nameW = 118;
  const half = (R - L - nameW) / 2;
  c.text(L + 10, 138, nameW, 11, "STORE", { size: 6.5, bold: true, color: C.gray400 });
  c.text(L + nameW, 138, half, 11, "PRODUCTIVITY  ·  SALES PER LABOR HOUR", { size: 6.5, bold: true, color: C.gray400 });
  c.text(L + nameW + half, 138, half, 11, "TPLH  ·  TRANSACTIONS PER LABOR HOUR", { size: 6.5, bold: true, color: C.gray400 });

  const top = 152;
  const pitch = Math.min(64, (348 - top) / n);
  const rowH = pitch - 5;
  const trendLabels = wk.trendWeeks.map(w => monDay(w.start));

  d.stores.forEach((s, i) => {
    const y = top + i * pitch;
    c.box(L, y, R - L, rowH, C.white, { line: C.gray200, round: true });
    c.text(L + 10, y + 4, nameW - 10, 16, s.label, { size: 11, bold: true, color: C.gray900 });
    c.text(L + 10, y + 20, nameW - 10, 10, `${usd0(s.current.netSales)} sales`, { size: 7, color: C.gray500 });

    ([SPLH, TPLH] as Kind[]).forEach((k, col) => {
      const x = L + nameW + col * half;
      if (col === 1) c.rule(x - 6, y + 6, 0.6, rowH - 12, C.gray200);
      const v = latest(s, k);
      const p = previous(s, k);
      const t = s.targets?.[k.key];
      c.text(x, y + 3, 80, 20, v == null ? "—" : k.fmt(v), { size: 15, bold: true, color: C.gray900 });
      if (v != null && p != null) {
        const dv = v - p;
        const tone: Tone = dv > 0 ? "good" : dv < 0 ? "bad" : "neutral";
        c.text(x, y + 22, 90, 10, `${dv > 0 ? "▲" : dv < 0 ? "▼" : "■"} ${dv >= 0 ? "+" : "−"}${k.delta(dv)} WoW`, {
          size: 7,
          bold: true,
          color: toneText(tone),
        });
      }
      if (t) {
        const on = v != null && v >= t.floor;
        c.chip(x + 86, y + 6, 58, 14, on ? "ON TARGET" : "BELOW", on ? "good" : "bad", 6.5);
        const gap = v == null ? null : t.floor - v;
        c.text(x + 86, y + 22, 70, 10, `Target ${targetLabel(k, t)}`, { size: 6.5, bold: true, color: C.gray700 });
        if (gap != null && gap > 0) c.text(x + 86, y + 31, 70, 9, `−${k.delta(gap)} to floor`, { size: 6.5, color: C.red600 });
      }
      trendBars(c, x + 166, y + 6, half - 180, rowH - 22, s[k.key], t?.floor ?? null, trendLabels);
    });
  });

  const ty = 352;
  c.box(L, ty, R - L, 30, C.white, { line: C.gray200, round: true });
  c.box(L, ty + 7, 3, 16, C.red700);
  c.text(L + 12, ty + 3, 100, 10, "TAKEAWAY", { size: 6.5, bold: true, color: C.red700 });
  c.text(L + 12, ty + 13, R - L - 24, 14, productivityTakeaway(d), { size: 7.5, color: C.gray700 });

  return [...newSlide(at), ...c.requests];
}

// ── Per-DM: Food cost & drive-thru ───────────────────────────────────────────

type Col = { label: string; w: number };

function tableHead(c: Canvas, x: number, y: number, nameW: number, cols: Col[]) {
  c.text(x + 10, y, nameW - 10, 10, "STORE", { size: 6, bold: true, color: C.gray400 });
  let cx = x + nameW;
  for (const col of cols) {
    c.text(cx, y, col.w, 10, col.label, { size: 6, bold: true, color: C.gray400, align: "CENTER" });
    cx += col.w;
  }
}

type Cell = { text: string; tone?: Tone; chip?: boolean };

function tableRow(c: Canvas, x: number, y: number, h: number, nameW: number, cols: Col[], name: string, cells: Cell[], total: boolean) {
  c.box(x, y, R - x, h, total ? C.gray100 : C.white, { line: total ? C.gray300 : C.gray200, round: true });
  c.text(x + 10, y, nameW - 10, h, name, { size: total ? 7.5 : 8.5, bold: true, color: C.gray900 });
  let cx = x + nameW;
  cells.forEach((cell, i) => {
    const w = cols[i].w;
    if (cell.chip && cell.tone && cell.text !== "—") {
      c.chip(cx + 5, y + (h - 14) / 2, w - 10, 14, cell.text, cell.tone, 7.5);
    } else {
      c.text(cx, y, w, h, cell.text, { size: 8, bold: true, color: cell.tone ? toneText(cell.tone) : C.gray900, align: "CENTER" });
    }
    cx += w;
  });
}

export function dmOpsSlide(wk: WbrWeek, d: DistrictWeek, ops: OpsData, idx: number, at: Placement): SlidesRequest[] {
  const c = new Canvas(at.slideId);
  frame(c, wk, {
    title: dmTitle(d),
    subtitle: dmSub(d),
    tab: "FOOD & DRIVE-THRU",
    footer: `Net-Chef food cost and BerryAI drive-thru · ${ops.week.label} · ${ops.ptd.label} · drive-thru goals by sales tier, as on the Drive-Thru tab`,
    page: `DISTRICT ${idx + 1} OF ${wk.districts.length}  ·  3/3`,
  });
  const so = d.stores.map(s => ({ s, o: ops.stores.get(s.label) }));
  const n = d.stores.length + 1;
  const nameW = 110;

  // Food cost
  const foodCols: Col[] = [
    { label: "SALES", w: 66 },
    { label: "COGS $", w: 62 },
    { label: "COGS %", w: 62 },
    { label: "VARIANCE $", w: 66 },
    { label: "VARIANCE %", w: 70 },
    { label: "PRIOR WK VAR", w: 66 },
    { label: `${ops.ptd.label.split(" ")[0]} COGS %`, w: 62 },
    { label: `${ops.ptd.label.split(" ")[0]} VAR %`, w: (R - L - nameW) - (66 + 62 + 62 + 66 + 70 + 66 + 62) },
  ];
  const pitch = Math.min(22, (140 - 14) / n);
  const rowH = pitch - 3;
  sectionLabel(c, L, 76, R - L, "FOOD COST", `${ops.week.label}  ·  ${ops.ptd.label}`);
  tableHead(c, L, 90, nameW, foodCols);
  const foodCells = (f: FoodCost, prior: number | null, p: FoodCost, sales: number | null): Cell[] => [
    { text: sales == null ? "—" : usd0(sales) },
    { text: f.cogsDollars == null ? "—" : usd0(f.cogsDollars) },
    { text: pct1(f.cogsPct), tone: levelTone(cogsLevel(f.cogsPct)), chip: true },
    { text: varUsd(f.varianceDollars) },
    { text: varPct(f.variancePct), tone: levelTone(varianceLevel(f.variancePct)), chip: true },
    { text: varPct(prior), tone: levelTone(varianceLevel(prior)) },
    { text: pct1(p.cogsPct), tone: levelTone(cogsLevel(p.cogsPct)) },
    { text: varPct(p.variancePct), tone: levelTone(varianceLevel(p.variancePct)) },
  ];
  so.forEach(({ s, o }, i) => {
    const empty: FoodCost = { cogsPct: null, cogsDollars: null, variancePct: null, varianceDollars: null, salesBase: null };
    tableRow(c, L, 102 + i * pitch, rowH, nameW, foodCols, s.label, foodCells(o?.food.week ?? empty, o?.food.priorWeekVariancePct ?? null, o?.food.ptd ?? empty, s.current.netSales), false);
  });
  const fo = so.map(x => x.o).filter(Boolean);
  const wkFood = totalFood(fo.map(o => o!.food.week));
  // Prior-week variance total, weighted like the rest by each store's own base.
  const priorTotal = (() => {
    const ok = fo.filter(o => o!.food.priorWeekVariancePct != null && o!.food.week.salesBase);
    const base = ok.reduce((s, o) => s + o!.food.week.salesBase!, 0);
    return base ? ok.reduce((s, o) => s + o!.food.priorWeekVariancePct! * o!.food.week.salesBase!, 0) / base : null;
  })();
  tableRow(c, L, 102 + d.stores.length * pitch, rowH, nameW, foodCols, "District total", foodCells(wkFood, priorTotal, totalFood(fo.map(o => o!.food.ptd)), d.total.current.netSales), true);

  // Drive-thru
  const dy = 102 + n * pitch + 14;
  const driveCols: Col[] = [
    { label: "LANE", w: 56 },
    { label: "WINDOW", w: 56 },
    { label: "CARS", w: 52 },
    { label: "FLAGGED", w: 52 },
    { label: "PEAK LANE", w: 58 },
    { label: "NON-PEAK LANE", w: 66 },
    { label: "PEAK WIN", w: 56 },
    { label: "NON-PEAK WIN", w: 62 },
    { label: "PTD LANE", w: 56 },
    { label: "PTD WINDOW", w: (R - L - nameW) - (56 + 56 + 52 + 52 + 58 + 66 + 56 + 62 + 56) },
  ];
  sectionLabel(c, L, dy, R - L, "DRIVE-THRU", "Goals by weekly sales tier");
  tableHead(c, L, dy + 14, nameW, driveCols);
  const driveCells = (w: DriveThru | null, p: DriveThru | null, tierSales: number | null): Cell[] => [
    { text: mmss(w?.laneSecs), tone: driveTone(w?.laneSecs, tierSales, "lane"), chip: true },
    { text: mmss(w?.windowSecs), tone: driveTone(w?.windowSecs, tierSales, "window"), chip: true },
    { text: w?.cars ? count(w.cars) : "—" },
    { text: w?.flagged != null ? count(w.flagged) : "—" },
    { text: mmss(w?.peakLaneSecs), tone: driveTone(w?.peakLaneSecs, tierSales, "lane") },
    { text: mmss(w?.nonPeakLaneSecs), tone: driveTone(w?.nonPeakLaneSecs, tierSales, "lane") },
    { text: mmss(w?.peakWindowSecs), tone: driveTone(w?.peakWindowSecs, tierSales, "window") },
    { text: mmss(w?.nonPeakWindowSecs), tone: driveTone(w?.nonPeakWindowSecs, tierSales, "window") },
    { text: mmss(p?.laneSecs), tone: driveTone(p?.laneSecs, p?.tierSales ?? tierSales, "lane") },
    { text: mmss(p?.windowSecs), tone: driveTone(p?.windowSecs, p?.tierSales ?? tierSales, "window") },
  ];
  so.forEach(({ s, o }, i) => {
    const w = o?.drive.week ?? null;
    tableRow(c, L, dy + 26 + i * pitch, rowH, nameW, driveCols, s.label, w || o?.drive.ptd ? driveCells(w, o?.drive.ptd ?? null, w?.tierSales ?? null) : driveCols.map(() => ({ text: "—" })), false);
  });
  const avgSales = d.total.current.netSales / d.stores.length;
  tableRow(c, L, dy + 26 + d.stores.length * pitch, rowH, nameW, driveCols, "District total", driveCells(totalDrive(fo.map(o => o!.drive.week)), totalDrive(fo.map(o => o!.drive.ptd)), avgSales), true);
  const missing = so.filter(x => !x.o?.drive.week).map(x => x.s.label);
  if (missing.length) {
    c.text(L, dy + 26 + n * pitch, R - L, 9, `No BerryAI drive-thru data for ${missing.join(", ")}.`, { size: 6, color: C.gray400 });
  }

  return [...newSlide(at), ...c.requests];
}

/** Overview, then Sales · Labor · Food & Drive-thru for each district, as per-slide request lists. */
export function wbrByDistrict(wk: WbrWeek, ops: OpsData, startIndex: number, layoutId: string, runId: string): SlidesRequest[][] {
  let i = 0;
  const at = (key: string): Placement => ({ slideId: `${WBR_SLIDE_PREFIX}${runId}${key}`, insertionIndex: startIndex + i++, layoutId });
  const out: SlidesRequest[][] = [overviewSlide(wk, ops, at("ov"))];
  wk.districts.forEach((d, k) => {
    out.push(dmSalesSlide(wk, d, k, at(`d${k}s`)));
    out.push(dmLaborSlide(wk, d, k, at(`d${k}l`)));
    out.push(dmOpsSlide(wk, d, ops, k, at(`d${k}o`)));
  });
  return out;
}
