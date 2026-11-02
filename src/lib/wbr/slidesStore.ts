/**
 * The single-store deck: Overview, Sales, Labor, Food & Drive-thru for one
 * store and one week.
 *
 * Styled after the dashboard itself rather than the WBR's slide look: white
 * rounded cards on gray-50, trend charts drawn the way the tabs' Recharts
 * charts are (native PowerPoint line charts — lib/wbr/pptxChart), tables as
 * one card with hairline rows and right-aligned figures, and changes as green
 * or red text the way the tabs' PctCell prints them. Goal colours come from the
 * same thresholds the tabs use (lib/foodCostGoals, the Drive-Thru tab's sales
 * tiers, lib/wbr/targets), so a store's slide and its row on the dashboard
 * always agree on a colour.
 */

import { C, Canvas, type ChartShapeSpec, type Tone } from "@/lib/wbr/draw";
import type { DayFigures, StoreDeckData } from "@/lib/wbr/storeData";
import type { DriveThru } from "@/lib/wbr/opsData";
import { cogsLevel, varianceLevel } from "@/lib/foodCostGoals";
import { TOTAL_TIME_TIERS, WINDOW_TIME_TIERS, fmtGoalSecs } from "@/lib/salesTierGoals";
import { change, count, usd0, usd2, weekSpan } from "@/lib/wbr/slides";
import { driveTone, levelTone, mmss, pct1, toneText, varPct, varUsd } from "@/lib/wbr/slidesDistrict";

const W = 720;
const L = 28;
const R = W - L;

const TABS = ["OVERVIEW", "SALES", "LABOR", "FOOD & DRIVE-THRU"] as const;
type TabName = (typeof TABS)[number];
const TAB_W: Record<TabName, number> = { OVERVIEW: 62, SALES: 46, LABOR: 46, "FOOD & DRIVE-THRU": 98 };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon 10/19" — the POS tab's day label. */
const dayLabel = (iso: string) => `${DOW[new Date(iso + "T12:00:00Z").getUTCDay()]} ${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const mdShort = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

const cur = (d: StoreDeckData) => d.weeks[d.weeks.length - 1];
const prev = (d: StoreDeckData) => d.weeks[d.weeks.length - 2];

// Series styling, after the dashboard's trend charts.
const THIS_YEAR = { color: C.gray900, width: 2, markers: true, labelLast: true };
const LAST_YEAR = { color: C.gray400, width: 1.5, dash: true };
const TARGET = { color: C.green600, width: 1, dash: true };

// Excel number formats for the chart axes and labels.
const FMT_K = `"$"#,##0.0,"K"`;
const FMT_COUNT = `#,##0`;
const FMT_USD2 = `"$"#,##0.00`;
const FMT_RATIO = `0.00`;

// ── Change text, the PctCell way ─────────────────────────────────────────────

/** "▲ 6.8%" / "▼ 18.3%", green or red; "—" when there's no base. `invert` for costs, where up is bad. */
function delta(v: number | null, invert = false): { text: string; color: string } {
  if (v == null || !isFinite(v)) return { text: "—", color: C.gray300 };
  if (Math.abs(v) < 0.05) return { text: "0.0%", color: C.gray500 };
  const good = invert ? v < 0 : v > 0;
  return { text: `${v > 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}%`, color: good ? C.green600 : C.red600 };
}

// ── Frame ────────────────────────────────────────────────────────────────────

function frame(c: Canvas, d: StoreDeckData, tab: TabName, footer: string) {
  c.box(0, 0, W, 62, C.white);
  c.box(0, 0, 4, 62, C.red700);
  c.rule(0, 62, W, 0.75, C.gray200);
  c.text(L, 9, 400, 10, `Store review  ·  ${weekSpan(d.week.start, d.week.end).toLowerCase().replace(/^\w|\b[a-z]{3}\b/g, (m) => m[0].toUpperCase() + m.slice(1))}`, {
    size: 7.5,
    color: C.gray500,
  });
  c.text(L, 20, 380, 24, d.label, { size: 19, bold: true, color: C.gray900 });
  const parts = [d.market.charAt(0) + d.market.slice(1).toLowerCase(), d.leaders.length ? `DM ${d.leaders.join(" / ")}` : "", `Store ${d.storeId}`].filter(Boolean);
  c.text(L, 43, 420, 11, parts.join("  ·  "), { size: 7.5, color: C.gray500 });

  // Section tabs — the dashboard's segmented control: gray-100 track, white active pill.
  const total = TABS.reduce((s, t) => s + TAB_W[t], 0) + 4 * (TABS.length - 1) + 6;
  let x = R - total;
  c.box(x, 21, total, 22, C.gray100, { round: true, radius: 5 });
  x += 3;
  for (const t of TABS) {
    const on = t === tab;
    if (on) c.box(x, 24, TAB_W[t], 16, C.white, { line: C.gray200, round: true, radius: 4 });
    c.text(x, 24, TAB_W[t], 16, t.charAt(0) + t.slice(1).toLowerCase().replace("drive-thru", "Drive-thru"), {
      size: 7,
      bold: on,
      color: on ? C.gray900 : C.gray500,
      align: "CENTER",
    });
    x += TAB_W[t] + 4;
  }

  c.text(L, 390, 600, 9, footer, { size: 6, color: C.gray400 });
  c.text(R - 60, 390, 60, 9, `${TABS.indexOf(tab) + 1} of ${TABS.length}`, { size: 6, color: C.gray400, align: "END" });
}

/** The dashboard's card: white, gray-200 border, rounded-lg (~6pt at slide scale). */
function card(c: Canvas, x: number, y: number, w: number, h: number) {
  c.box(x, y, w, h, C.white, { line: C.gray200, round: true, radius: 6 });
}

/** A card's heading: semibold gray-700 title, gray-400 note under or beside it. */
function heading(c: Canvas, x: number, y: number, w: number, title: string, note?: string) {
  c.text(x, y, w, 11, title, { size: 8, bold: true, color: C.gray700 });
  if (note) c.text(x, y + 10, w, 9, note, { size: 6.5, color: C.gray400 });
}

/** A legend entry: a short line swatch (dashed if asked) and its name. Returns the width used. */
function legendItem(c: Canvas, x: number, y: number, name: string, s: { color: string; dash?: boolean; width?: number }) {
  const h = Math.max(1, (s.width ?? 2) * 0.75);
  if (s.dash) {
    for (let i = 0; i < 3; i++) c.box(x + i * 5, y + 4.5 - h / 2, 3, h, s.color);
  } else {
    c.box(x, y + 4.5 - h / 2, 13, h, s.color);
  }
  const tw = name.length * 3.4 + 4;
  c.text(x + 13, y - 1, tw + 12, 11, name, { size: 6.5, color: C.gray500 });
  return 13 + tw + 12;
}

/** A legend right-aligned to `right`. */
function legend(c: Canvas, right: number, y: number, items: { name: string; style: { color: string; dash?: boolean; width?: number } }[]) {
  const widths = items.map((i) => 13 + i.name.length * 3.4 + 4 + 12);
  let x = right - widths.reduce((s, w) => s + w, 0) + 8;
  items.forEach((i) => {
    x += legendItem(c, x, y, i.name, i.style);
  });
}

/** A trend chart card: heading, legend, native line chart. */
function chartCard(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  o: { title: string; note: string; spec: ChartShapeSpec },
) {
  card(c, x, y, w, h);
  heading(c, x + 12, y + 8, w - 24, o.title, o.note);
  legend(
    c,
    x + w - 12,
    y + 9,
    o.spec.series.map((s) => ({ name: s.name, style: s })),
  );
  c.chart(x + 4, y + 30, w - 10, h - 34, o.spec);
}

// ── Tiles ────────────────────────────────────────────────────────────────────

type TileLine = { text: string; color?: string };

/** A KPI card: label, value, then lines of changes or context. */
function tile(c: Canvas, x: number, y: number, w: number, h: number, t: { label: string; value: string; valueColor?: string; lines: TileLine[][] }) {
  card(c, x, y, w, h);
  c.text(x + 12, y + 8, w - 24, 10, t.label, { size: 7, color: C.gray500 });
  c.text(x + 12, y + 19, w - 24, 24, t.value, { size: 18, bold: true, color: t.valueColor ?? C.gray900 });
  t.lines.forEach((line, i) => {
    // Runs laid left to right; widths estimated from character count (7pt ≈ 3.7pt/char).
    let cx = x + 12;
    for (const run of line) {
      const rw = run.text.length * 4.1 + 14;
      c.text(cx, y + 44 + i * 11, rw + 20, 10, run.text, { size: 7, bold: !!run.color && run.color !== C.gray400, color: run.color ?? C.gray400 });
      cx += rw;
    }
  });
}

const changeRuns = (label: string, v: number | null, invert = false): TileLine => {
  const dl = delta(v, invert);
  return { text: `${dl.text} ${label}`, color: dl.color };
};

// ── Tables ───────────────────────────────────────────────────────────────────

type Col = { head: string; w: number; align?: "START" | "END" };
type Cell = { text: string; color?: string; bold?: boolean };

/** One card, header row, hairline-divided rows; a `total` row sits on gray-50 like the tabs' footers. */
function table(c: Canvas, x: number, y: number, cols: Col[], rows: { cells: Cell[]; total?: boolean }[], rowH: number) {
  const width = cols.reduce((s, k) => s + k.w, 0);
  const headH = 18;
  card(c, x, y, width, headH + rows.length * rowH + 3);
  const pad = 12;
  const colX = (k: number) => x + cols.slice(0, k).reduce((s, col) => s + col.w, 0);
  cols.forEach((col, k) => {
    const isStart = (col.align ?? "END") === "START";
    c.text(colX(k) + (isStart ? pad : 0), y + 4, col.w - pad, 11, col.head, {
      size: 6,
      bold: true,
      color: C.gray400,
      align: isStart ? "START" : "END",
    });
  });
  c.rule(x + 1, y + headH, width - 2, 0.6, C.gray200);
  rows.forEach((r, i) => {
    const ry = y + headH + i * rowH;
    if (r.total) c.box(x + 0.75, ry + 0.6, width - 1.5, rowH - 1, C.gray50);
    else if (i > 0) c.rule(x + pad, ry, width - 2 * pad, 0.5, C.gray100);
    r.cells.forEach((cell, k) => {
      const col = cols[k];
      const isStart = (col.align ?? "END") === "START";
      c.text(colX(k) + (isStart ? pad : 0), ry, col.w - pad, rowH, cell.text, {
        size: 7.5,
        bold: cell.bold ?? (k === 0 || !!r.total),
        color: cell.color ?? (k === 0 ? C.gray900 : C.gray700),
        align: isStart ? "START" : "END",
      });
    });
  });
}

const pctCell = (now: number | null | undefined, base: number | null | undefined, invert = false): Cell => {
  const dl = delta(change(now ?? null, base), invert);
  return { text: dl.text, color: dl.color, bold: false };
};

// ── Shared data shaping ──────────────────────────────────────────────────────

const weekCats = (d: StoreDeckData) => d.weeks.map((w) => mdShort(w.week.start));
const trendNote = (d: StoreDeckData) => `Weeks beginning ${mdShort(d.weeks[0].week.start)} – ${mdShort(cur(d).week.start)}`;

type DayTotals = { netSales: number; transactions: number; laborHours: number; avgTicket: number };
const sumDays = (rows: DayFigures["now"][]): DayTotals | null => {
  const ok = rows.filter((r): r is NonNullable<typeof r> => !!r);
  if (!ok.length) return null;
  const netSales = ok.reduce((s, r) => s + r.netSales, 0);
  const transactions = ok.reduce((s, r) => s + r.transactions, 0);
  const laborHours = ok.reduce((s, r) => s + r.laborHours, 0);
  return { netSales, transactions, laborHours, avgTicket: transactions ? netSales / transactions : 0 };
};
const one = (r: DayFigures["now"]) => (r ? sumDays([r]) : null);

// ── 1. Overview ──────────────────────────────────────────────────────────────

function targetLine(v: number | null, floor: number | undefined, band: string): TileLine[] {
  if (floor == null) return [{ text: "No target set" }];
  if (v == null) return [{ text: `Target ${band}` }];
  const on = v >= floor;
  return [{ text: on ? "On target" : "Below target", color: on ? C.green600 : C.red600 }, { text: `  ${band}` }];
}
const splhBand = (d: StoreDeckData) => (d.targets ? (d.targets.splh.ceiling ? `$${d.targets.splh.floor}–${d.targets.splh.ceiling}` : `$${d.targets.splh.floor}+`) : "");
const tplhBand = (d: StoreDeckData) => (d.targets ? `${d.targets.tplh.floor.toFixed(2)}+` : "");

/** Plain-language lines for the overview, most notable first. */
export function storeHighlights(d: StoreDeckData): string[] {
  const now = cur(d);
  const before = prev(d);
  const out: string[] = [];
  const signed = (v: number | null) => (v == null ? "n/a" : `${v >= 0 ? "up" : "down"} ${Math.abs(v).toFixed(1)}%`);
  const wow = change(now.netSales, before.netSales);
  const yoy = now.py ? change(now.netSales, now.py.netSales) : null;
  out.push(`Net sales of ${usd0(now.netSales)}, ${signed(wow)} on last week` + (yoy != null ? ` and ${signed(yoy)} on last year.` : " (no full week last year to compare)."));
  out.push(
    `${count(now.transactions)} transactions (${signed(change(now.transactions, before.transactions))}) at a ${now.avgCheck == null ? "—" : usd2(now.avgCheck)} average check (${signed(change(now.avgCheck, before.avgCheck))}).`,
  );
  const t = d.targets;
  if (now.splh != null) {
    const s = t ? (now.splh >= t.splh.floor ? "on target" : `${usd2(t.splh.floor - now.splh)} short of the ${usd2(t.splh.floor)} target`) : "no target set";
    out.push(`Productivity ${usd2(now.splh)} per labor hour, ${s}; TPLH ${now.tplh?.toFixed(2) ?? "—"}.`);
  }
  const f = d.ops?.food.week;
  if (f?.cogsPct != null) out.push(`Food cost ${pct1(f.cogsPct)} of sales; variance ${varPct(f.variancePct)}, ${varUsd(f.varianceDollars)}.`);
  const dt = d.ops?.drive.week;
  if (dt?.laneSecs != null) out.push(`Drive-thru lane ${mmss(dt.laneSecs)} and window ${mmss(dt.windowSecs)} across ${count(dt.cars ?? 0)} cars.`);
  return out;
}

export function storeOverviewSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  frame(c, d, "OVERVIEW", "PAR POS sales and labor · Net-Chef food cost · BerryAI drive-thru · WoW: prior week · YoY: same fiscal week last year");
  const now = cur(d);
  const before = prev(d);
  const f = d.ops?.food;
  const dt = d.ops?.drive.week ?? null;
  const ptdName = d.opsSpans.ptd.label.split(" ")[0];

  const tw = (R - L - 3 * 10) / 4;
  const at = (i: number) => L + i * (tw + 10);
  const th = 70;

  tile(c, at(0), 74, tw, th, {
    label: "Net Sales",
    value: usd0(now.netSales),
    lines: [[changeRuns("WoW", change(now.netSales, before.netSales)), changeRuns("YoY", now.py ? change(now.netSales, now.py.netSales) : null)]],
  });
  tile(c, at(1), 74, tw, th, {
    label: "Transactions",
    value: count(now.transactions),
    lines: [[changeRuns("WoW", change(now.transactions, before.transactions)), changeRuns("YoY", now.py ? change(now.transactions, now.py.transactions) : null)]],
  });
  tile(c, at(2), 74, tw, th, {
    label: "Average Check",
    value: now.avgCheck == null ? "—" : usd2(now.avgCheck),
    lines: [[changeRuns("WoW", change(now.avgCheck, before.avgCheck)), changeRuns("YoY", now.py ? change(now.avgCheck, now.py.avgCheck) : null)]],
  });
  tile(c, at(3), 74, tw, th, {
    label: "Productivity (SPLH)",
    value: now.splh == null ? "—" : usd2(now.splh),
    lines: [targetLine(now.splh, d.targets?.splh.floor, splhBand(d)), [{ text: `${now.laborHours.toFixed(0)} labor hours` }]],
  });

  const y2 = 74 + th + 10;
  tile(c, at(0), y2, tw, th, {
    label: "TPLH",
    value: now.tplh == null ? "—" : now.tplh.toFixed(2),
    lines: [targetLine(now.tplh, d.targets?.tplh.floor, tplhBand(d)), [{ text: `Prior week ${before.tplh == null ? "—" : before.tplh.toFixed(2)}` }]],
  });
  tile(c, at(1), y2, tw, th, {
    label: "COGS %",
    value: pct1(f?.week.cogsPct),
    valueColor: toneText(levelTone(cogsLevel(f?.week.cogsPct ?? null))),
    lines: [[{ text: `${ptdName} to date ${pct1(f?.ptd.cogsPct)}` }]],
  });
  tile(c, at(2), y2, tw, th, {
    label: "Food Variance",
    value: varPct(f?.week.variancePct),
    valueColor: toneText(levelTone(varianceLevel(f?.week.variancePct ?? null))),
    lines: [[{ text: `${varUsd(f?.week.varianceDollars)} · prior week ${varPct(f?.priorWeekVariancePct)}` }]],
  });
  tile(c, at(3), y2, tw, th, {
    label: "Drive-thru Lane",
    value: mmss(dt?.laneSecs),
    valueColor: toneText(driveTone(dt?.laneSecs, dt?.tierSales, "lane")),
    lines: [[{ text: dt ? `Window ${mmss(dt.windowSecs)} · ${count(dt.cars ?? 0)} cars` : "No BerryAI data" }]],
  });

  // Net sales trend + the week in brief.
  const y3 = y2 + th + 10;
  const h3 = 380 - y3;
  const half = (R - L - 10) / 2;
  chartCard(c, L, y3, half, h3, {
    title: "Net Sales",
    note: trendNote(d),
    spec: {
      categories: weekCats(d),
      format: FMT_K,
      series: [
        { name: "This year", values: d.weeks.map((w) => w.netSales), ...THIS_YEAR },
        { name: "Last year", values: d.weeks.map((w) => w.py?.netSales ?? null), ...LAST_YEAR },
      ],
    },
  });

  const hx = L + half + 10;
  card(c, hx, y3, half, h3);
  heading(c, hx + 12, y3 + 8, half - 24, "The week in brief");
  storeHighlights(d).forEach((line, i) => {
    const ly = y3 + 28 + i * 23;
    c.box(hx + 13, ly + 4, 3, 3, C.gray400, { round: true });
    c.text(hx + 20, ly - 1, half - 34, 22, line, { size: 7.5, color: C.gray700, valign: "TOP" });
  });

  return c;
}

// ── 2. Sales ─────────────────────────────────────────────────────────────────

export function storeSalesSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  frame(c, d, "SALES", "PAR POS · LW: same weekday last week · LY: the fiscal same day last year, as on the POS tab");

  const cw = (R - L - 2 * 10) / 3;
  const charts: { title: string; format: string; ty: (number | null)[]; ly: (number | null)[] }[] = [
    { title: "Net Sales", format: FMT_K, ty: d.weeks.map((w) => w.netSales), ly: d.weeks.map((w) => w.py?.netSales ?? null) },
    { title: "Transactions", format: FMT_COUNT, ty: d.weeks.map((w) => w.transactions), ly: d.weeks.map((w) => w.py?.transactions ?? null) },
    { title: "Average Check", format: FMT_USD2, ty: d.weeks.map((w) => w.avgCheck), ly: d.weeks.map((w) => w.py?.avgCheck ?? null) },
  ];
  charts.forEach((ch, i) => {
    chartCard(c, L + i * (cw + 10), 72, cw, 130, {
      title: ch.title,
      note: trendNote(d),
      spec: {
        categories: weekCats(d),
        format: ch.format,
        series: [
          { name: "This year", values: ch.ty, ...THIS_YEAR },
          { name: "Last year", values: ch.ly, ...LAST_YEAR },
        ],
      },
    });
  });

  const cols: Col[] = [
    { head: "DAY", w: 92, align: "START" },
    { head: "NET SALES", w: 82 },
    { head: "VS LW", w: 66 },
    { head: "VS LY", w: 66 },
    { head: "TRANSACTIONS", w: 84 },
    { head: "VS LW", w: 66 },
    { head: "VS LY", w: 66 },
    { head: "AVG CHECK", w: 70 },
    { head: "VS LW", w: R - L - (92 + 82 + 66 * 4 + 84 + 70) },
  ];
  const row = (name: string, n: DayTotals | null, p: DayTotals | null, y: DayTotals | null, total = false) => ({
    total,
    cells: [
      { text: name },
      { text: n ? usd0(n.netSales) : "—", color: C.gray900, bold: true },
      pctCell(n?.netSales, p?.netSales),
      pctCell(n?.netSales, y?.netSales),
      { text: n ? count(n.transactions) : "—" },
      pctCell(n?.transactions, p?.transactions),
      pctCell(n?.transactions, y?.transactions),
      { text: n && n.transactions ? usd2(n.avgTicket) : "—" },
      pctCell(n && n.transactions ? n.avgTicket : null, p && p.transactions ? p.avgTicket : null),
    ] as Cell[],
  });
  const rows = d.days.map((day) => row(dayLabel(day.date), one(day.now), one(day.prior), one(day.py)));
  rows.push(row("Week", sumDays(d.days.map((x) => x.now)), sumDays(d.days.map((x) => x.prior)), sumDays(d.days.map((x) => x.py)), true));
  table(c, L, 212, cols, rows, 18.5);

  return c;
}

// ── 3. Labor ─────────────────────────────────────────────────────────────────

export function storeLaborSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  frame(c, d, "LABOR", "PAR POS sales, transactions and labor hours · targets per store, as on the WBR · LW: same weekday last week");
  const t = d.targets;

  const half = (R - L - 10) / 2;
  const n = d.weeks.length;
  const charts: { title: string; note: string; format: string; key: "splh" | "tplh"; floor: number | null; band: string }[] = [
    { title: "Productivity (SPLH)", note: `Sales per labor hour · ${trendNote(d).toLowerCase()}`, format: FMT_USD2, key: "splh", floor: t?.splh.floor ?? null, band: splhBand(d) },
    { title: "TPLH", note: `Transactions per labor hour · ${trendNote(d).toLowerCase()}`, format: FMT_RATIO, key: "tplh", floor: t?.tplh.floor ?? null, band: tplhBand(d) },
  ];
  charts.forEach((ch, i) => {
    chartCard(c, L + i * (half + 10), 72, half, 134, {
      title: ch.title,
      note: ch.note,
      spec: {
        categories: weekCats(d),
        format: ch.format,
        series: [
          { name: "This year", values: d.weeks.map((w) => w[ch.key]), ...THIS_YEAR },
          ...(ch.floor != null ? [{ name: `Target ${ch.band}`, values: Array(n).fill(ch.floor), ...TARGET }] : []),
        ],
      },
    });
  });

  const cols: Col[] = [
    { head: "DAY", w: 92, align: "START" },
    { head: "NET SALES", w: 82 },
    { head: "TRANSACTIONS", w: 82 },
    { head: "LABOR HRS", w: 72 },
    { head: "VS LW", w: 64 },
    { head: "SPLH", w: 72 },
    { head: "VS LW", w: 64 },
    { head: "TPLH", w: 64 },
    { head: "VS LW", w: R - L - (92 + 82 + 82 + 72 + 64 + 72 + 64 + 64) },
  ];
  const ratio = (a: number, h: number) => (h > 0 ? a / h : null);
  const row = (name: string, n: DayTotals | null, p: DayTotals | null, total = false) => {
    const splh = n ? ratio(n.netSales, n.laborHours) : null;
    const tplh = n ? ratio(n.transactions, n.laborHours) : null;
    const goal = (v: number | null, floor: number | undefined) => (total && v != null && floor != null ? (v >= floor ? C.green600 : C.red600) : undefined);
    return {
      total,
      cells: [
        { text: name },
        { text: n ? usd0(n.netSales) : "—" },
        { text: n ? count(n.transactions) : "—" },
        { text: n ? n.laborHours.toFixed(1) : "—" },
        // More hours for the same work is the costly direction.
        pctCell(n?.laborHours, p?.laborHours, true),
        { text: splh == null ? "—" : usd2(splh), color: goal(splh, t?.splh.floor) ?? C.gray900, bold: true },
        pctCell(splh, p ? ratio(p.netSales, p.laborHours) : null),
        { text: tplh == null ? "—" : tplh.toFixed(2), color: goal(tplh, t?.tplh.floor) ?? C.gray900, bold: true },
        pctCell(tplh, p ? ratio(p.transactions, p.laborHours) : null),
      ] as Cell[],
    };
  };
  const rows = d.days.map((day) => row(dayLabel(day.date), one(day.now), one(day.prior)));
  rows.push(row("Week", sumDays(d.days.map((x) => x.now)), sumDays(d.days.map((x) => x.prior)), true));
  table(c, L, 216, cols, rows, 18);

  return c;
}

// ── 4. Food cost & drive-thru ────────────────────────────────────────────────

function tierNote(dt: DriveThru | null): string {
  if (dt?.tierSales == null) return "Goals by weekly sales tier";
  const lane = TOTAL_TIME_TIERS.find((t) => t.test(dt.tierSales!));
  const win = WINDOW_TIME_TIERS.find((t) => t.test(dt.tierSales!));
  if (!lane || !win) return "Goals by weekly sales tier";
  return `${lane.label} sales tier · lane goal ${fmtGoalSecs(lane.greenMax)}, window goal ${fmtGoalSecs(win.greenMax)}`;
}

const toneColor = (t: Tone) => (t === "neutral" ? C.gray900 : toneText(t));

export function storeOpsSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  const spans = d.opsSpans;
  frame(c, d, "FOOD & DRIVE-THRU", `Net-Chef food cost and BerryAI drive-thru · ${spans.week.label} · ${spans.ptd.label} · colours from the Food Cost and Drive-Thru tabs' goals`);
  const f = d.ops?.food;
  const ptdName = spans.ptd.label.split(" ")[0];
  const tw = (R - L - 3 * 10) / 4;
  const at = (i: number) => L + i * (tw + 10);

  heading(c, L, 72, R - L, "Food Cost", `${spans.week.label}  ·  ${spans.ptd.label}`);
  if (!f || f.week.salesBase == null) {
    card(c, L, 96, R - L, 40);
    c.text(L, 96, R - L, 40, "No Net-Chef food cost for this store and week.", { size: 8, color: C.gray500, align: "CENTER" });
  } else {
    tile(c, at(0), 96, tw, 66, {
      label: "COGS % · week",
      value: pct1(f.week.cogsPct),
      valueColor: toneText(levelTone(cogsLevel(f.week.cogsPct))),
      lines: [[{ text: `${f.week.cogsDollars == null ? "—" : usd0(f.week.cogsDollars)} on ${usd0(f.week.salesBase)} sales` }]],
    });
    tile(c, at(1), 96, tw, 66, {
      label: "Variance · week",
      value: varPct(f.week.variancePct),
      valueColor: toneText(levelTone(varianceLevel(f.week.variancePct))),
      lines: [[{ text: `${varUsd(f.week.varianceDollars)} · prior week ${varPct(f.priorWeekVariancePct)}` }]],
    });
    tile(c, at(2), 96, tw, 66, {
      label: `COGS % · ${ptdName} to date`,
      value: pct1(f.ptd.cogsPct),
      valueColor: toneText(levelTone(cogsLevel(f.ptd.cogsPct))),
      lines: [[{ text: f.ptd.cogsDollars == null ? "" : `${usd0(f.ptd.cogsDollars)} on ${f.ptd.salesBase == null ? "—" : usd0(f.ptd.salesBase)} sales` }]],
    });
    tile(c, at(3), 96, tw, 66, {
      label: `Variance · ${ptdName} to date`,
      value: varPct(f.ptd.variancePct),
      valueColor: toneText(levelTone(varianceLevel(f.ptd.variancePct))),
      lines: [[{ text: varUsd(f.ptd.varianceDollars) }]],
    });
  }

  const dt = d.ops?.drive.week ?? null;
  const dp = d.ops?.drive.ptd ?? null;
  heading(c, L, 176, R - L, "Drive-thru", tierNote(dt));
  if (!dt && !dp) {
    card(c, L, 200, R - L, 40);
    c.text(L, 200, R - L, 40, "No BerryAI drive-thru data for this store.", { size: 8, color: C.gray500, align: "CENTER" });
    return c;
  }

  const tone = (secs: number | null | undefined, field: "lane" | "window", src: DriveThru | null) => toneColor(driveTone(secs, src?.tierSales, field));
  tile(c, at(0), 200, tw, 66, { label: "Lane · week", value: mmss(dt?.laneSecs), valueColor: tone(dt?.laneSecs, "lane", dt), lines: [[{ text: `${ptdName} to date ${mmss(dp?.laneSecs)}` }]] });
  tile(c, at(1), 200, tw, 66, { label: "Window · week", value: mmss(dt?.windowSecs), valueColor: tone(dt?.windowSecs, "window", dt), lines: [[{ text: `${ptdName} to date ${mmss(dp?.windowSecs)}` }]] });
  tile(c, at(2), 200, tw, 66, { label: "Cars · week", value: dt?.cars ? count(dt.cars) : "—", lines: [[{ text: dp?.cars ? `${count(dp.cars)} ${ptdName} to date` : "" }]] });
  tile(c, at(3), 200, tw, 66, {
    label: "Flagged pull-forwards",
    value: dt?.flagged != null ? count(dt.flagged) : "—",
    lines: [[{ text: dt?.flagged != null && dt.cars ? `${((dt.flagged / dt.cars) * 100).toFixed(1)}% of cars` : "" }]],
  });

  const cols: Col[] = [
    { head: "", w: 130, align: "START" },
    { head: "LANE", w: 70 },
    { head: "WINDOW", w: 70 },
    { head: "PEAK LANE", w: 76 },
    { head: "NON-PEAK LANE", w: 84 },
    { head: "PEAK WINDOW", w: 80 },
    { head: "NON-PEAK WINDOW", w: 88 },
    { head: "CARS", w: R - L - (130 + 70 + 70 + 76 + 84 + 80 + 88) },
  ];
  const row = (name: string, x: DriveThru | null) => {
    const col = (s: number | null | undefined, field: "lane" | "window"): Cell => ({ text: mmss(s), color: tone(s, field, x), bold: true });
    return {
      cells: [
        { text: name },
        col(x?.laneSecs, "lane"),
        col(x?.windowSecs, "window"),
        col(x?.peakLaneSecs, "lane"),
        col(x?.nonPeakLaneSecs, "lane"),
        col(x?.peakWindowSecs, "window"),
        col(x?.nonPeakWindowSecs, "window"),
        { text: x?.cars ? count(x.cars) : "—" },
      ] as Cell[],
    };
  };
  const sameSpan = spans.ptd.start === spans.week.start;
  table(c, L, 278, cols, sameSpan ? [row(spans.week.label, dt)] : [row(spans.week.label, dt), row(spans.ptd.label, dp)], 22);

  return c;
}

export function storeDeckSlides(d: StoreDeckData): Canvas[] {
  return [storeOverviewSlide(d), storeSalesSlide(d), storeLaborSlide(d), storeOpsSlide(d)];
}
