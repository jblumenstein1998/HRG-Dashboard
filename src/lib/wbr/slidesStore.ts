/**
 * The single-store deck: Overview, Sales, Labor, Food & Drive-thru for one
 * store and one week.
 *
 * Same drawing kit, palette and goal colours as the district deck
 * (lib/wbr/slidesDistrict) — food cost from lib/foodCostGoals, drive-thru from
 * the Drive-Thru tab's sales tiers, productivity from lib/wbr/targets — so a
 * store's slide and its row on the district slide always agree on a colour.
 */

import { C, Canvas, toneOf, type Tone } from "@/lib/wbr/draw";
import type { DayFigures, StoreDeckData, WeekFigures } from "@/lib/wbr/storeData";
import type { DriveThru } from "@/lib/wbr/opsData";
import { cogsLevel, varianceLevel } from "@/lib/foodCostGoals";
import { TOTAL_TIME_TIERS, WINDOW_TIME_TIERS, fmtGoalSecs } from "@/lib/salesTierGoals";
import { change, count, monDay, pctLabel, usd0, usd2, usdK, weekSpan } from "@/lib/wbr/slides";
import { driveTone, levelTone, mmss, pct1, toneText, varPct, varUsd } from "@/lib/wbr/slidesDistrict";

const W = 720;
const L = 28;
const R = W - L;

const TABS = ["OVERVIEW", "SALES", "LABOR", "FOOD & DRIVE-THRU"] as const;
type TabName = (typeof TABS)[number];
const TAB_W: Record<TabName, number> = { OVERVIEW: 62, SALES: 46, LABOR: 46, "FOOD & DRIVE-THRU": 98 };

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const dayLabel = (iso: string) => `${DOW[new Date(iso + "T12:00:00Z").getUTCDay()]} ${monDay(iso).split(" ")[1]}`;

const cur = (d: StoreDeckData) => d.weeks[d.weeks.length - 1];
const prev = (d: StoreDeckData) => d.weeks[d.weeks.length - 2];

// ── Frame ────────────────────────────────────────────────────────────────────

function frame(c: Canvas, d: StoreDeckData, tab: TabName, footer: string) {
  c.box(0, 0, W, 66, C.white);
  c.box(0, 0, 4, 66, C.red700);
  c.rule(0, 66, W, 0.75, C.gray200);
  c.text(L, 10, 400, 10, `STORE REVIEW  ·  ${weekSpan(d.week.start, d.week.end)}`, { size: 7, bold: true, color: C.gray400 });
  c.text(L, 21, 380, 26, d.label, { size: 20, bold: true, color: C.gray900 });
  const dm = d.leaders.length ? `  ·  DM ${d.leaders.join(" / ").toUpperCase()}` : "";
  c.text(L, 47, 420, 11, `${d.market}${dm}  ·  STORE ${d.storeId}`, { size: 7.5, bold: true, color: C.gray500 });

  let x = R;
  for (const t of [...TABS].reverse()) {
    x -= TAB_W[t];
    const on = t === tab;
    c.box(x, 26, TAB_W[t], 18, on ? C.gray900 : C.gray100, { round: true });
    c.text(x, 26, TAB_W[t], 18, t, { size: 7, bold: true, color: on ? C.white : C.gray500, align: "CENTER" });
    x -= 6;
  }

  c.rule(L, 388, R - L, 0.6, C.gray200);
  c.text(L, 391, 580, 9, footer, { size: 6, color: C.gray400 });
  c.text(R - 80, 391, 80, 9, `${TABS.indexOf(tab) + 1} / ${TABS.length}`, { size: 6, bold: true, color: C.gray400, align: "END" });
}

function card(c: Canvas, x: number, y: number, w: number, h: number) {
  c.box(x, y, w, h, C.white, { line: C.gray200, round: true });
}

function label(c: Canvas, x: number, y: number, w: number, text: string, note?: string) {
  c.text(x, y, w, 10, text, { size: 6.5, bold: true, color: C.gray500 });
  if (note) c.text(x, y, w, 10, note, { size: 6, color: C.gray400, align: "END" });
}

/** A KPI tile: label, big value, up to two chips on the right, a grey line underneath. */
function tile(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  t: { label: string; value: string; valueColor?: string; chips?: { head: string; text: string; tone: Tone }[]; foot?: string; footColor?: string },
) {
  card(c, x, y, w, h);
  c.text(x + 10, y + 6, w - 20, 10, t.label, { size: 6.5, bold: true, color: C.gray500 });
  const chips = t.chips ?? [];
  const chipW = 62;
  c.text(x + 10, y + 18, w - 20 - (chips.length ? chipW + 4 : 0), 26, t.value, { size: 19, bold: true, color: t.valueColor ?? C.gray900 });
  chips.forEach((ch, i) => {
    c.chip(x + w - 10 - chipW, y + 8 + i * 19, chipW, 15, `${ch.head}  ${ch.text}`, ch.tone, 6.5);
  });
  if (t.foot) c.text(x + 10, y + h - 15, w - 20, 10, t.foot, { size: 6.5, bold: true, color: t.footColor ?? C.gray400 });
}

/**
 * Vertical bars, one per week, last one dark. `compare` draws a red tick at
 * each week's prior-year value. `zero` scales from zero (sales); otherwise to
 * the data's own range (SPLH moves a few dollars on ~$70). `floor` draws the
 * target line and colours the last bar green/red against it.
 */
function bars(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  o: { values: (number | null)[]; labels: string[]; fmt: (v: number) => string; compare?: (number | null)[]; zero?: boolean; floor?: number | null },
) {
  const vals = [...o.values, ...(o.compare ?? []), ...(o.floor != null ? [o.floor] : [])].filter((v): v is number => v != null);
  if (!vals.length) {
    c.text(x, y, w, h, "No data", { size: 8, color: C.gray400, align: "CENTER" });
    return;
  }
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = max - min || max * 0.1 || 1;
  const lo = o.zero ? 0 : Math.max(0, min - span * 0.6);
  const hi = max + (max - lo) * 0.18; // headroom for the value labels
  const plotTop = y;
  const plotH = h - 10;
  const yOf = (v: number) => plotTop + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const n = o.values.length;
  const gap = 5;
  const bw = (w - (n - 1) * gap) / n;

  c.rule(x, plotTop + plotH, w, 0.6, C.gray300);
  o.values.forEach((v, i) => {
    const bx = x + i * (bw + gap);
    const last = i === n - 1;
    if (v != null) {
      const top = yOf(v);
      const color = last ? (o.floor != null ? (v >= o.floor ? C.green600 : C.red600) : C.gray900) : C.gray300;
      c.box(bx, top, bw, plotTop + plotH - top, color);
      c.text(bx - 6, top - 9, bw + 12, 8, o.fmt(v), { size: 5.5, bold: last, color: last ? C.gray900 : C.gray500, align: "CENTER" });
    }
    const pv = o.compare?.[i];
    if (pv != null) c.box(bx - 1.5, yOf(pv) - 0.75, bw + 3, 1.5, C.red700);
    c.text(bx - 6, plotTop + plotH + 1, bw + 12, 8, o.labels[i], { size: 5, bold: last, color: last ? C.gray700 : C.gray400, align: "CENTER" });
  });
  if (o.floor != null) {
    c.rule(x - 2, yOf(o.floor), w + 4, 0.75, C.gray900);
    c.text(x - 2, yOf(o.floor) - 8, 62, 7, `TARGET ${o.fmt(o.floor)}`, { size: 4.5, bold: true, color: C.gray500 });
  }
}

type Col = { head: string; w: number; align?: "START" | "CENTER" | "END" };
type Cell = { text: string; tone?: Tone; chip?: boolean };

/** A table of rounded rows; the first column is the row label. */
function table(c: Canvas, x: number, y: number, cols: Col[], rows: { cells: Cell[]; total?: boolean }[], rowH: number, pitch: number) {
  let cx = x;
  for (const col of cols) {
    c.text(cx + (col.align === "START" ? 10 : 0), y, col.w, 10, col.head, { size: 6, bold: true, color: C.gray400, align: col.align ?? "CENTER" });
    cx += col.w;
  }
  const width = cols.reduce((s, k) => s + k.w, 0);
  rows.forEach((r, i) => {
    const ry = y + 13 + i * pitch;
    c.box(x, ry, width, rowH, r.total ? C.gray100 : C.white, { line: r.total ? C.gray300 : C.gray200, round: true });
    let cx = x;
    r.cells.forEach((cell, k) => {
      const col = cols[k];
      if (cell.chip && cell.tone && cell.text !== "—" && cell.text !== "N/A") {
        c.chip(cx + 6, ry + (rowH - 13) / 2, col.w - 12, 13, cell.text, cell.tone, 6.5);
      } else {
        c.text(cx + (col.align === "START" ? 10 : 0), ry, col.w - (col.align === "START" ? 10 : 0), rowH, cell.text, {
          size: k === 0 ? 7.5 : 7.5,
          bold: k === 0 || !!r.total || !cell.tone,
          color: cell.tone ? toneText(cell.tone) : C.gray900,
          align: col.align ?? "CENTER",
        });
      }
      cx += col.w;
    });
  });
}

const weekLabels = (d: StoreDeckData) => d.weeks.map((w) => monDay(w.week.start).replace(" 0", " "));
const chg = (now: number | null | undefined, base: number | null | undefined): Cell => {
  const v = change(now ?? null, base);
  return { text: pctLabel(v), tone: toneOf(v), chip: true };
};

// ── 1. Overview ──────────────────────────────────────────────────────────────

function targetChip(v: number | null, floor: number | undefined): { head: string; text: string; tone: Tone }[] {
  if (floor == null || v == null) return [];
  return [{ head: "TARGET", text: v >= floor ? "ON" : "BELOW", tone: v >= floor ? "good" : "bad" }];
}

/** Plain-language lines for the overview, most notable first. */
export function storeHighlights(d: StoreDeckData): string[] {
  const now = cur(d);
  const before = prev(d);
  const out: string[] = [];
  const wow = change(now.netSales, before.netSales);
  const yoy = now.py ? change(now.netSales, now.py.netSales) : null;
  out.push(
    `Net sales ${usd0(now.netSales)} — ${pctLabel(wow)} on last week` + (yoy != null ? ` and ${pctLabel(yoy)} on last year.` : "; no full week last year to compare."),
  );
  const tw = change(now.transactions, before.transactions);
  const cw = change(now.avgCheck, before.avgCheck);
  out.push(`${count(now.transactions)} transactions (${pctLabel(tw)} WoW) at ${now.avgCheck == null ? "—" : usd2(now.avgCheck)} average check (${pctLabel(cw)} WoW).`);
  const t = d.targets;
  if (now.splh != null) {
    const s = t ? (now.splh >= t.splh.floor ? "on target" : `${usd2(t.splh.floor - now.splh)} below the ${usd2(t.splh.floor)} floor`) : "no target set";
    out.push(`Productivity ${usd2(now.splh)} SPLH, ${s}; TPLH ${now.tplh?.toFixed(2) ?? "—"}.`);
  }
  const f = d.ops?.food.week;
  if (f?.cogsPct != null) out.push(`Food cost ${pct1(f.cogsPct)}; variance ${varPct(f.variancePct)}, ${varUsd(f.varianceDollars)}.`);
  const dt = d.ops?.drive.week;
  if (dt?.laneSecs != null) out.push(`Drive-thru lane ${mmss(dt.laneSecs)}, window ${mmss(dt.windowSecs)} across ${count(dt.cars ?? 0)} cars.`);
  return out;
}

export function storeOverviewSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  frame(c, d, "OVERVIEW", "PAR POS sales and labor · Net-Chef food cost · BerryAI drive-thru · WoW = prior week, YoY = same fiscal week last year");
  const now = cur(d);
  const before = prev(d);
  const f = d.ops?.food;
  const dt = d.ops?.drive.week ?? null;

  const tw = (R - L - 3 * 10) / 4;
  const at = (i: number) => L + i * (tw + 10);
  const wowYoy = (n: number | null, p: number | null, py: number | null | undefined) => {
    const a = change(n, p);
    const b = py === undefined ? null : change(n, py);
    return [
      { head: "WoW", text: pctLabel(a), tone: toneOf(a) },
      { head: "YoY", text: pctLabel(b), tone: toneOf(b) },
    ];
  };

  tile(c, at(0), 78, tw, 66, { label: "NET SALES", value: usdK(now.netSales), chips: wowYoy(now.netSales, before.netSales, now.py?.netSales), foot: `Prior week ${usd0(before.netSales)}` });
  tile(c, at(1), 78, tw, 66, { label: "TRANSACTIONS", value: count(now.transactions), chips: wowYoy(now.transactions, before.transactions, now.py?.transactions), foot: `Prior week ${count(before.transactions)}` });
  tile(c, at(2), 78, tw, 66, {
    label: "AVG CHECK",
    value: now.avgCheck == null ? "—" : usd2(now.avgCheck),
    chips: wowYoy(now.avgCheck, before.avgCheck, now.py?.avgCheck ?? null),
    foot: `Prior week ${before.avgCheck == null ? "—" : usd2(before.avgCheck)}`,
  });
  tile(c, at(3), 78, tw, 66, {
    label: "SPLH",
    value: now.splh == null ? "—" : usd2(now.splh),
    chips: targetChip(now.splh, d.targets?.splh.floor),
    foot: `${now.laborHours.toFixed(0)} labor hrs · prior ${before.splh == null ? "—" : usd2(before.splh)}`,
  });

  const cogsT = levelTone(cogsLevel(f?.week.cogsPct ?? null));
  const varT = levelTone(varianceLevel(f?.week.variancePct ?? null));
  const laneT = driveTone(dt?.laneSecs, dt?.tierSales, "lane");
  tile(c, at(0), 152, tw, 66, {
    label: "TPLH",
    value: now.tplh == null ? "—" : now.tplh.toFixed(2),
    chips: targetChip(now.tplh, d.targets?.tplh.floor),
    foot: `Prior week ${before.tplh == null ? "—" : before.tplh.toFixed(2)}`,
  });
  tile(c, at(1), 152, tw, 66, {
    label: "COGS %",
    value: pct1(f?.week.cogsPct),
    valueColor: toneText(cogsT),
    foot: `${d.opsSpans.ptd.label.split(" ")[0]} to date ${pct1(f?.ptd.cogsPct)}`,
  });
  tile(c, at(2), 152, tw, 66, {
    label: "FOOD VARIANCE",
    value: varPct(f?.week.variancePct),
    valueColor: toneText(varT),
    foot: `${varUsd(f?.week.varianceDollars)} · prior week ${varPct(f?.priorWeekVariancePct)}`,
  });
  tile(c, at(3), 152, tw, 66, {
    label: "DRIVE-THRU LANE",
    value: mmss(dt?.laneSecs),
    valueColor: toneText(laneT),
    foot: dt ? `Window ${mmss(dt.windowSecs)} · ${count(dt.cars ?? 0)} cars` : "No BerryAI data",
  });

  // Net sales trend
  const half = (R - L - 10) / 2;
  card(c, L, 228, half, 152);
  label(c, L + 10, 234, half - 20, `NET SALES  ·  LAST ${d.weeks.length} WEEKS`, "same week last year");
  c.box(L + half - 88, 238, 8, 1.5, C.red700);
  bars(c, L + 12, 258, half - 24, 114, {
    values: d.weeks.map((w) => w.netSales),
    compare: d.weeks.map((w) => w.py?.netSales ?? null),
    labels: weekLabels(d),
    fmt: usdK,
    zero: true,
  });

  // Highlights
  const hx = L + half + 10;
  card(c, hx, 228, half, 152);
  c.box(hx, 238, 3, 20, C.red700);
  c.text(hx + 12, 234, half - 24, 10, "THE WEEK IN BRIEF", { size: 6.5, bold: true, color: C.red700 });
  storeHighlights(d).forEach((line, i) => {
    c.text(hx + 12, 250 + i * 25, 8, 22, "•", { size: 8, bold: true, color: C.gray400, valign: "TOP" });
    c.text(hx + 20, 250 + i * 25, half - 32, 24, line, { size: 7.5, color: C.gray700, valign: "TOP" });
  });

  return c;
}

// ── 2. Sales ─────────────────────────────────────────────────────────────────

const sumDays = (rows: (DayFigures["now"])[]) => {
  const ok = rows.filter((r): r is NonNullable<typeof r> => !!r);
  if (!ok.length) return null;
  const netSales = ok.reduce((s, r) => s + r.netSales, 0);
  const transactions = ok.reduce((s, r) => s + r.transactions, 0);
  const laborHours = ok.reduce((s, r) => s + r.laborHours, 0);
  return { netSales, transactions, avgTicket: transactions ? netSales / transactions : 0, laborHours, date: "" };
};

export function storeSalesSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  frame(c, d, "SALES", `PAR POS · days compared with the same weekday last week (LW) and the fiscal same day last year (LY) · bars: weeks starting ${monDay(d.weeks[0].week.start)}–${monDay(cur(d).week.start)}`);

  const cw = (R - L - 2 * 10) / 3;
  const charts: { title: string; values: (number | null)[]; compare: (number | null)[]; fmt: (v: number) => string; zero: boolean }[] = [
    { title: "NET SALES", values: d.weeks.map((w) => w.netSales), compare: d.weeks.map((w) => w.py?.netSales ?? null), fmt: usdK, zero: true },
    { title: "TRANSACTIONS", values: d.weeks.map((w) => w.transactions), compare: d.weeks.map((w) => w.py?.transactions ?? null), fmt: count, zero: true },
    { title: "AVERAGE CHECK", values: d.weeks.map((w) => w.avgCheck), compare: d.weeks.map((w) => w.py?.avgCheck ?? null), fmt: usd2, zero: false },
  ];
  charts.forEach((ch, i) => {
    const x = L + i * (cw + 10);
    card(c, x, 76, cw, 126);
    label(c, x + 10, 82, cw - 20, ch.title, i === 0 ? "last year" : undefined);
    if (i === 0) c.box(x + cw - 50, 86, 8, 1.5, C.red700);
    bars(c, x + 10, 104, cw - 20, 92, { values: ch.values, compare: ch.compare, labels: weekLabels(d), fmt: ch.fmt, zero: ch.zero });
  });

  label(c, L, 210, R - L, "BY DAY");
  const cols: Col[] = [
    { head: "DAY", w: 86, align: "START" },
    { head: "NET SALES", w: 78 },
    { head: "vs LW", w: 62 },
    { head: "vs LY", w: 62 },
    { head: "TRANSACTIONS", w: 78 },
    { head: "vs LW", w: 62 },
    { head: "vs LY", w: 62 },
    { head: "AVG CHECK", w: 66 },
    { head: "vs LW", w: R - L - (86 + 78 + 62 * 4 + 78 + 66) },
  ];
  const row = (name: string, n: ReturnType<typeof sumDays>, p: ReturnType<typeof sumDays>, y: ReturnType<typeof sumDays>, total = false) => ({
    total,
    cells: [
      { text: name },
      { text: n ? usd0(n.netSales) : "—" },
      chg(n?.netSales, p?.netSales),
      chg(n?.netSales, y?.netSales),
      { text: n ? count(n.transactions) : "—" },
      chg(n?.transactions, p?.transactions),
      chg(n?.transactions, y?.transactions),
      { text: n && n.transactions ? usd2(n.avgTicket) : "—" },
      chg(n && n.transactions ? n.avgTicket : null, p && p.transactions ? p.avgTicket : null),
    ] as Cell[],
  });
  const one = (r: DayFigures["now"]) => (r ? sumDays([r]) : null);
  const rows = d.days.map((day) => row(dayLabel(day.date), one(day.now), one(day.prior), one(day.py)));
  rows.push(row("Week", sumDays(d.days.map((x) => x.now)), sumDays(d.days.map((x) => x.prior)), sumDays(d.days.map((x) => x.py)), true));
  table(c, L, 224, cols, rows, 17, 19.5);

  return c;
}

// ── 3. Labor ─────────────────────────────────────────────────────────────────

export function storeLaborSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  frame(c, d, "LABOR", `PAR POS sales, transactions and labor hours · targets from the WBR (lib/wbr/targets) · days compared with the same weekday last week`);
  const t = d.targets;

  const half = (R - L - 10) / 2;
  const charts: { title: string; key: "splh" | "tplh"; fmt: (v: number) => string; floor: number | null; band: string }[] = [
    { title: "SPLH  ·  SALES PER LABOR HOUR", key: "splh", fmt: usd2, floor: t?.splh.floor ?? null, band: t ? (t.splh.ceiling ? `Target $${t.splh.floor}–${t.splh.ceiling}` : `Target $${t.splh.floor}+`) : "No target set" },
    { title: "TPLH  ·  TRANSACTIONS PER LABOR HOUR", key: "tplh", fmt: (v) => v.toFixed(2), floor: t?.tplh.floor ?? null, band: t ? `Target ${t.tplh.floor.toFixed(2)}+` : "No target set" },
  ];
  charts.forEach((ch, i) => {
    const x = L + i * (half + 10);
    card(c, x, 76, half, 132);
    label(c, x + 10, 82, half - 20, ch.title, ch.band);
    bars(c, x + 12, 104, half - 24, 98, { values: d.weeks.map((w: WeekFigures) => w[ch.key]), labels: weekLabels(d), fmt: ch.fmt, floor: ch.floor });
  });

  label(c, L, 216, R - L, "BY DAY");
  const cols: Col[] = [
    { head: "DAY", w: 86, align: "START" },
    { head: "NET SALES", w: 80 },
    { head: "TRANSACTIONS", w: 76 },
    { head: "LABOR HRS", w: 70 },
    { head: "vs LW", w: 62 },
    { head: "SPLH", w: 70 },
    { head: "vs LW", w: 62 },
    { head: "TPLH", w: 62 },
    { head: "vs LW", w: R - L - (86 + 80 + 76 + 70 + 62 + 70 + 62 + 62) },
  ];
  const ratio = (a: number, h: number) => (h > 0 ? a / h : null);
  const fmtOr = (v: number | null, f: (v: number) => string) => (v == null ? "—" : f(v));
  const row = (name: string, n: ReturnType<typeof sumDays>, p: ReturnType<typeof sumDays>, total = false) => {
    const splh = n ? ratio(n.netSales, n.laborHours) : null;
    const tplh = n ? ratio(n.transactions, n.laborHours) : null;
    const pSplh = p ? ratio(p.netSales, p.laborHours) : null;
    const pTplh = p ? ratio(p.transactions, p.laborHours) : null;
    // Labor hours: more is the bad direction, so the tone is flipped.
    const lh = change(n?.laborHours ?? null, p?.laborHours);
    const tone = (v: number | null, floor: number | undefined): Tone | undefined => (total && v != null && floor != null ? (v >= floor ? "good" : "bad") : undefined);
    return {
      total,
      cells: [
        { text: name },
        { text: n ? usd0(n.netSales) : "—" },
        { text: n ? count(n.transactions) : "—" },
        { text: n ? n.laborHours.toFixed(1) : "—" },
        { text: pctLabel(lh), tone: lh == null || Math.abs(lh) < 0.05 ? "neutral" : lh > 0 ? "bad" : "good", chip: true },
        { text: fmtOr(splh, usd2), tone: tone(splh, t?.splh.floor) },
        chg(splh, pSplh),
        { text: fmtOr(tplh, (v) => v.toFixed(2)), tone: tone(tplh, t?.tplh.floor) },
        chg(tplh, pTplh),
      ] as Cell[],
    };
  };
  const one = (r: DayFigures["now"]) => (r ? sumDays([r]) : null);
  const rows = d.days.map((day) => row(dayLabel(day.date), one(day.now), one(day.prior)));
  rows.push(row("Week", sumDays(d.days.map((x) => x.now)), sumDays(d.days.map((x) => x.prior)), true));
  table(c, L, 230, cols, rows, 16, 18);

  return c;
}

// ── 4. Food cost & drive-thru ────────────────────────────────────────────────

function tierNote(dt: DriveThru | null): string {
  if (dt?.tierSales == null) return "Goals by weekly sales tier";
  const lane = TOTAL_TIME_TIERS.find((t) => t.test(dt.tierSales!));
  const win = WINDOW_TIME_TIERS.find((t) => t.test(dt.tierSales!));
  if (!lane || !win) return "Goals by weekly sales tier";
  return `${lane.label} tier · lane green ≤ ${fmtGoalSecs(lane.greenMax)}, window green ≤ ${fmtGoalSecs(win.greenMax)}`;
}

export function storeOpsSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  const spans = d.opsSpans;
  frame(c, d, "FOOD & DRIVE-THRU", `Net-Chef food cost and BerryAI drive-thru · ${spans.week.label} · ${spans.ptd.label} · colours from the Food Cost and Drive-Thru tabs' goals`);
  const f = d.ops?.food;
  const ptdName = spans.ptd.label.split(" ")[0];

  label(c, L, 76, R - L, "FOOD COST", `${spans.week.label}  ·  ${spans.ptd.label}`);
  if (!f || f.week.salesBase == null) {
    card(c, L, 90, R - L, 40);
    c.text(L, 90, R - L, 40, "No Net-Chef food cost for this store and week.", { size: 8, color: C.gray500, align: "CENTER" });
  } else {
    const tw = (R - L - 3 * 10) / 4;
    const at = (i: number) => L + i * (tw + 10);
    const cogsT = levelTone(cogsLevel(f.week.cogsPct));
    const varT = levelTone(varianceLevel(f.week.variancePct));
    const ptdCogsT = levelTone(cogsLevel(f.ptd.cogsPct));
    const ptdVarT = levelTone(varianceLevel(f.ptd.variancePct));
    tile(c, at(0), 90, tw, 62, {
      label: "COGS % · WEEK",
      value: pct1(f.week.cogsPct),
      valueColor: toneText(cogsT),
      foot: `${f.week.cogsDollars == null ? "—" : usd0(f.week.cogsDollars)} on ${usd0(f.week.salesBase)} sales`,
    });
    tile(c, at(1), 90, tw, 62, {
      label: "VARIANCE · WEEK",
      value: varPct(f.week.variancePct),
      valueColor: toneText(varT),
      foot: `${varUsd(f.week.varianceDollars)} · prior week ${varPct(f.priorWeekVariancePct)}`,
    });
    tile(c, at(2), 90, tw, 62, {
      label: `COGS % · ${ptdName} TO DATE`,
      value: pct1(f.ptd.cogsPct),
      valueColor: toneText(ptdCogsT),
      foot: f.ptd.cogsDollars == null ? "" : `${usd0(f.ptd.cogsDollars)} on ${f.ptd.salesBase == null ? "—" : usd0(f.ptd.salesBase)} sales`,
    });
    tile(c, at(3), 90, tw, 62, {
      label: `VARIANCE · ${ptdName} TO DATE`,
      value: varPct(f.ptd.variancePct),
      valueColor: toneText(ptdVarT),
      foot: varUsd(f.ptd.varianceDollars),
    });
  }

  const dt = d.ops?.drive.week ?? null;
  const dp = d.ops?.drive.ptd ?? null;
  label(c, L, 166, R - L, "DRIVE-THRU", tierNote(dt));
  if (!dt && !dp) {
    card(c, L, 180, R - L, 40);
    c.text(L, 180, R - L, 40, "No BerryAI drive-thru data for this store.", { size: 8, color: C.gray500, align: "CENTER" });
    return c;
  }

  // Big lane/window tiles for the week, then the full breakdown table.
  const tw = (R - L - 3 * 10) / 4;
  const at = (i: number) => L + i * (tw + 10);
  const lt = (secs: number | null | undefined, field: "lane" | "window", src: DriveThru | null) => toneText(driveTone(secs, src?.tierSales, field));
  tile(c, at(0), 180, tw, 62, { label: "LANE · WEEK", value: mmss(dt?.laneSecs), valueColor: lt(dt?.laneSecs, "lane", dt), foot: `${ptdName} to date ${mmss(dp?.laneSecs)}` });
  tile(c, at(1), 180, tw, 62, { label: "WINDOW · WEEK", value: mmss(dt?.windowSecs), valueColor: lt(dt?.windowSecs, "window", dt), foot: `${ptdName} to date ${mmss(dp?.windowSecs)}` });
  tile(c, at(2), 180, tw, 62, { label: "CARS · WEEK", value: dt?.cars ? count(dt.cars) : "—", foot: dp?.cars ? `${count(dp.cars)} ${ptdName} to date` : "" });
  tile(c, at(3), 180, tw, 62, {
    label: "FLAGGED PULL-FORWARDS",
    value: dt?.flagged != null ? count(dt.flagged) : "—",
    foot: dt?.flagged != null && dt.cars ? `${((dt.flagged / dt.cars) * 100).toFixed(1)}% of cars` : "",
  });

  const cols: Col[] = [
    { head: "", w: 110, align: "START" },
    { head: "LANE", w: 70 },
    { head: "WINDOW", w: 70 },
    { head: "PEAK LANE", w: 76 },
    { head: "NON-PEAK LANE", w: 84 },
    { head: "PEAK WINDOW", w: 80 },
    { head: "NON-PEAK WINDOW", w: 88 },
    { head: "CARS", w: R - L - (110 + 70 + 70 + 76 + 84 + 80 + 88) },
  ];
  const row = (name: string, x: DriveThru | null) => {
    const tone = (s: number | null | undefined, field: "lane" | "window") => driveTone(s, x?.tierSales, field);
    return {
      cells: [
        { text: name },
        { text: mmss(x?.laneSecs), tone: tone(x?.laneSecs, "lane"), chip: true },
        { text: mmss(x?.windowSecs), tone: tone(x?.windowSecs, "window"), chip: true },
        { text: mmss(x?.peakLaneSecs), tone: tone(x?.peakLaneSecs, "lane") },
        { text: mmss(x?.nonPeakLaneSecs), tone: tone(x?.nonPeakLaneSecs, "lane") },
        { text: mmss(x?.peakWindowSecs), tone: tone(x?.peakWindowSecs, "window") },
        { text: mmss(x?.nonPeakWindowSecs), tone: tone(x?.nonPeakWindowSecs, "window") },
        { text: x?.cars ? count(x.cars) : "—" },
      ] as Cell[],
    };
  };
  const sameSpan = spans.ptd.start === spans.week.start;
  table(c, L, 254, cols, sameSpan ? [row(spans.week.label, dt)] : [row(spans.week.label, dt), row(spans.ptd.label, dp)], 20, 24);

  return c;
}

export function storeDeckSlides(d: StoreDeckData): Canvas[] {
  return [storeOverviewSlide(d), storeSalesSlide(d), storeLaborSlide(d), storeOpsSlide(d)];
}
