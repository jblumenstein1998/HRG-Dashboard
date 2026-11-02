/**
 * The single-store deck, seven slides for one store and one week:
 *
 *   Overview · Sales · Labor · Drive-thru · Food cost · SMG · Compliance
 *
 * Styled after the dashboard itself: white rounded cards on gray-50, trend
 * charts drawn the way the tabs' Recharts charts are (native PowerPoint line
 * charts — lib/wbr/pptxChart), tables as one card with hairline rows and
 * right-aligned figures, and changes as green or red ▲/▼ text the way the tabs'
 * PctCell prints them.
 *
 * Every number tied to a goal is red, yellow or green by lib/wbr/goals, which
 * reuses the tabs' and scorecards' own bands. Numbers with no goal (sales,
 * transactions, cars) stay ink; their week-over-week changes are green/red by
 * direction only.
 */

import { C, Canvas, type Tone } from "@/lib/wbr/draw";
import { lineChart, type LineChartSpec } from "@/lib/wbr/drawChart";
import type { Gate } from "@/lib/bonus/types";
import type { DayFigures, StoreDeckData } from "@/lib/wbr/storeData";
import type { DriveThru } from "@/lib/wbr/opsData";
import { SMG_METRICS } from "@/lib/wbr/storeExtras";
import { ACCURACY_METRIC, LOWER_IS_BETTER } from "@/lib/surveyMeta";
import type { SlackDay } from "@/lib/slackReports";
import { SLACK_SLOTS } from "@/lib/slackReports";
import { change, count, usd0, usd2, weekSpan } from "@/lib/wbr/slides";
import { mmss, pct1, varPct, varUsd } from "@/lib/wbr/slidesDistrict";
import {
  cogsTone,
  driveGoal,
  driveTone,
  joltTone,
  productivityTone,
  ruleGates,
  gateLabel,
  tplhTone,
  pullForwardTone,
  PULL_FORWARD_GOAL,
  slackTone,
  smgTone,
  varianceTone,
  zcase24Tone,
  zcaseCountTone,
  zuTone,
} from "@/lib/wbr/goals";
import { ZCASE_GOALS } from "@/lib/bonus/goals";

const W = 720;
const L = 28;
const R = W - L;

const TABS = ["Overview", "Sales", "Labor", "Drive-thru", "Food cost", "SMG", "Compliance"] as const;
type TabName = (typeof TABS)[number];
const TAB_W: Record<TabName, number> = { Overview: 46, Sales: 34, Labor: 34, "Drive-thru": 48, "Food cost": 48, SMG: 30, Compliance: 52 };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon 10/19" — the POS tab's day label. */
const dayLabel = (iso: string) => `${DOW[new Date(iso + "T12:00:00Z").getUTCDay()]} ${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const mdShort = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

const cur = (d: StoreDeckData) => d.weeks[d.weeks.length - 1];
const prev = (d: StoreDeckData) => d.weeks[d.weeks.length - 2];
const ptdName = (d: StoreDeckData) => d.opsSpans.ptd.label.split(" ")[0];

/** Goal tone → ink. Neutral is plain ink, not gray: a number with no verdict still reads. */
const ink = (t: Tone) => (t === "good" ? C.green600 : t === "warn" ? C.yellow600 : t === "bad" ? C.red600 : C.gray900);

// Series styling, after the dashboard's trend charts.
const THIS_YEAR = { color: C.gray900, width: 2, markers: true, labelLast: true };
const LAST_YEAR = { color: C.gray400, width: 1.5, dash: true };
const GOAL = { color: C.green600, width: 1, dash: true };
const EDGE = { color: C.yellow600, width: 1, dash: true };

// Chart label formats — drawn as text, so these are exactly what's printed.
type Fmt = (v: number) => string;
/** "$74.6K"; a whole thousand (an axis gridline) prints as "$110K". */
const FMT_K: Fmt = (v) => "$" + (v % 1000 === 0 ? String(v / 1000) : (v / 1000).toFixed(1)) + "K";
const FMT_COUNT: Fmt = (v) => Math.round(v).toLocaleString("en-US");
const FMT_USD2: Fmt = (v) => "$" + v.toFixed(2);
const FMT_RATIO: Fmt = (v) => v.toFixed(2);
const FMT_PCT1: Fmt = (v) => `${v.toFixed(1)}%`;
/** SMG scores are top-box shares — percentages, as the SMG tab prints them. */
const FMT_SCORE: Fmt = (v) => `${Math.round(v)}%`;
const smgPct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);
/** Drive times in seconds, as m:ss; gridlines on whole 5/10/15… seconds. */
const TIME = { fmt: (v: number) => mmss(v), steps: [5, 10, 15, 20, 30, 60, 120] };

// ── Change text, the PctCell way ─────────────────────────────────────────────

/** "▲ 6.8%" / "▼ 18.3%", green or red by direction; "—" when there's no base. `invert` where up is bad. */
function delta(v: number | null, invert = false): { text: string; color: string } {
  if (v == null || !isFinite(v)) return { text: "—", color: C.gray300 };
  if (Math.abs(v) < 0.05) return { text: "0.0%", color: C.gray500 };
  const good = invert ? v < 0 : v > 0;
  return { text: `${v > 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}%`, color: good ? C.green600 : C.red600 };
}

// ── Frame ────────────────────────────────────────────────────────────────────

const titleCase = (s: string) => s.toLowerCase().replace(/^\w|\b[a-z]{3}\b/g, (m) => m[0].toUpperCase() + m.slice(1));

function frame(c: Canvas, d: StoreDeckData, tab: TabName) {
  c.box(0, 0, W, 62, C.white);
  c.box(0, 0, 4, 62, C.red700);
  c.rule(0, 62, W, 0.75, C.gray200);
  c.text(L, 9, 300, 10, `Store review  ·  ${titleCase(weekSpan(d.week.start, d.week.end))}`, { size: 7.5, color: C.gray500 });
  c.text(L, 20, 300, 24, d.label, { size: 19, bold: true, color: C.gray900 });
  const parts = [titleCase(d.market), d.leaders.length ? `DM ${d.leaders.join(" / ")}` : "", `Store ${d.storeId}`].filter(Boolean);
  c.text(L, 43, 300, 11, parts.join("  ·  "), { size: 7.5, color: C.gray500 });

  // Section tabs — the dashboard's segmented control: gray-100 track, white active pill.
  const total = TABS.reduce((s, t) => s + TAB_W[t], 0) + 3 * (TABS.length - 1) + 6;
  let x = R - total;
  c.box(x, 21, total, 22, C.gray100, { round: true, radius: 5 });
  x += 3;
  for (const t of TABS) {
    const on = t === tab;
    if (on) c.box(x, 24, TAB_W[t], 16, C.white, { line: C.gray200, round: true, radius: 4 });
    c.text(x, 24, TAB_W[t], 16, t, { size: 6.5, bold: on, color: on ? C.gray900 : C.gray500, align: "CENTER" });
    x += TAB_W[t] + 3;
  }

  c.text(R - 60, 390, 60, 9, `${TABS.indexOf(tab) + 1} of ${TABS.length}`, { size: 6, color: C.gray400, align: "END" });
}

/** The dashboard's card: white, gray-200 border, rounded-lg (~6pt at slide scale). */
function card(c: Canvas, x: number, y: number, w: number, h: number) {
  c.box(x, y, w, h, C.white, { line: C.gray200, round: true, radius: 6 });
}

/** A card's heading: semibold gray-700 title, gray-400 note under it. */
function heading(c: Canvas, x: number, y: number, w: number, title: string, note?: string) {
  c.text(x, y, w, 11, title, { size: 8, bold: true, color: C.gray700 });
  if (note) c.text(x, y + 10, w, 9, note, { size: 6.5, color: C.gray400 });
}

type LegendStyle = { color: string; dash?: boolean; width?: number };
const legendW = (name: string) => 13 + name.length * 3.4 + 16;

function legendItem(c: Canvas, x: number, y: number, name: string, s: LegendStyle) {
  const h = Math.max(1, (s.width ?? 2) * 0.75);
  if (s.dash) for (let i = 0; i < 3; i++) c.box(x + i * 5, y + 4.5 - h / 2, 3, h, s.color);
  else c.box(x, y + 4.5 - h / 2, 13, h, s.color);
  c.text(x + 13, y - 1, legendW(name), 11, name, { size: 6.5, color: C.gray500 });
}

/** A legend right-aligned to `right`. */
function legend(c: Canvas, right: number, y: number, items: { name: string; style: LegendStyle }[]) {
  let x = right - items.reduce((s, i) => s + legendW(i.name), 0) + 10;
  for (const i of items) {
    legendItem(c, x, y, i.name, i.style);
    x += legendW(i.name);
  }
}

/** A trend chart card: heading, legend (one entry per distinct series name), drawn line chart. */
function chartCard(c: Canvas, x: number, y: number, w: number, h: number, o: { title: string; note: string; spec: LineChartSpec }) {
  card(c, x, y, w, h);
  heading(c, x + 12, y + 8, w - 24, o.title, o.note);
  const seen = new Set<string>();
  const items = o.spec.series.filter((s) => !seen.has(s.name) && seen.add(s.name)).map((s) => ({ name: s.name, style: s }));
  legend(c, x + w - 12, y + 9, items);
  lineChart(c, x + 8, y + 32, w - 18, h - 38, o.spec);
}

// ── Tiles ────────────────────────────────────────────────────────────────────

type Run = { text: string; color?: string };

/** A KPI card: label, value, then up to three lines of runs (changes or context). */
function tile(c: Canvas, x: number, y: number, w: number, h: number, t: { label: string; value: string; tone?: Tone; lines?: Run[][]; size?: number }) {
  card(c, x, y, w, h);
  c.text(x + 10, y + 7, w - 20, 10, t.label, { size: 6.5, color: C.gray500 });
  c.text(x + 10, y + 17, w - 20, 22, t.value, { size: t.size ?? 16, bold: true, color: ink(t.tone ?? "neutral") });
  (t.lines ?? []).forEach((line, i) => {
    let cx = x + 10;
    for (const run of line) {
      const rw = run.text.length * 3.3 + 3;
      c.text(cx, y + 39 + i * 9.5, rw + 20, 9, run.text, { size: 6.5, bold: !!run.color, color: run.color ?? C.gray400 });
      cx += rw;
    }
  });
}

const changeRun = (label: string, v: number | null, invert = false): Run => {
  const dl = delta(v, invert);
  return { text: `${dl.text} ${label}`, color: dl.color };
};

/** A row of equal tiles across the page. */
function tileRow(c: Canvas, y: number, h: number, tiles: Parameters<typeof tile>[5][]) {
  const n = tiles.length;
  const w = (R - L - (n - 1) * 8) / n;
  tiles.forEach((t, i) => tile(c, L + i * (w + 8), y, w, h, t));
}

// ── Tables ───────────────────────────────────────────────────────────────────

type Col = { head: string; w: number; align?: "START" | "END" };
type Cell = { text: string; color?: string; bold?: boolean };

/** One card, header row, hairline-divided rows; a `total` row sits on gray-50 like the tabs' footers. */
function table(c: Canvas, x: number, y: number, cols: Col[], rows: { cells: Cell[]; total?: boolean }[], rowH: number) {
  const width = cols.reduce((s, k) => s + k.w, 0);
  const headH = 18;
  card(c, x, y, width, headH + rows.length * rowH + 3);
  const pad = 10;
  const colX = (k: number) => x + cols.slice(0, k).reduce((s, col) => s + col.w, 0);
  cols.forEach((col, k) => {
    const start = (col.align ?? "END") === "START";
    c.text(colX(k) + (start ? pad : 0), y + 4, col.w - pad, 11, col.head, { size: 6, bold: true, color: C.gray400, align: start ? "START" : "END" });
  });
  c.rule(x + 1, y + headH, width - 2, 0.6, C.gray200);
  rows.forEach((r, i) => {
    const ry = y + headH + i * rowH;
    if (r.total) c.box(x + 0.75, ry + 0.6, width - 1.5, rowH - 1, C.gray50);
    else if (i > 0) c.rule(x + pad, ry, width - 2 * pad, 0.5, C.gray100);
    r.cells.forEach((cell, k) => {
      const col = cols[k];
      const start = (col.align ?? "END") === "START";
      c.text(colX(k) + (start ? pad : 0), ry, col.w - pad, rowH, cell.text, {
        size: 7.5,
        bold: cell.bold ?? (k === 0 || !!r.total),
        color: cell.color ?? (k === 0 ? C.gray900 : C.gray700),
        align: start ? "START" : "END",
      });
    });
  });
  return headH + rows.length * rowH + 3;
}

const pctCell = (now: number | null | undefined, base: number | null | undefined, invert = false): Cell => {
  const dl = delta(change(now ?? null, base), invert);
  return { text: dl.text, color: dl.color, bold: false };
};
const goalCell = (text: string, tone: Tone): Cell => ({ text, color: ink(tone), bold: true });

function emptyCard(c: Canvas, x: number, y: number, w: number, h: number, text: string) {
  card(c, x, y, w, h);
  c.text(x, y, w, h, text, { size: 7.5, color: C.gray400, align: "CENTER" });
}

// ── Shared data shaping ──────────────────────────────────────────────────────

const weekCats = (d: StoreDeckData) => d.weeks.map((w) => mdShort(w.week.start));
const trendNote = (d: StoreDeckData) => `Weeks beginning ${mdShort(d.weeks[0].week.start)} – ${mdShort(cur(d).week.start)}`;
const flat = (d: StoreDeckData, v: number) => d.weeks.map(() => v);

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

/**
 * Productivity and TPLH goals from the GM scorecard (Store Operating Targets):
 * productivity's band moves with the week's sales ($82–87, or $87–92 above
 * $85k), TPLH is 5.25 with 5.00 at 50%.
 */
const splhGates = (d: StoreDeckData) => ruleGates("gm_splh", cur(d).netSales);
const tplhGates = () => ruleGates("gm_tplh");
const dollars = (v: number) => `$${v}`;
const ratio2 = (v: number) => v.toFixed(2);
/** "Goal $87–92 · 50% $82–87", or just "Goal $82–87" when the two are the same. */
function goalText(g: { threshold: Gate; target: Gate }, fmt: (v: number) => string): string {
  const t = gateLabel(g.target, fmt);
  const h = gateLabel(g.threshold, fmt);
  return t === h ? `Goal ${t}` : `Goal ${t} · 50% ${h}`;
}
/** The low end of a gate — where its chart line goes. */
const lowOf = (g: Gate) => g.value;
const highOf = (g: Gate) => (g.cmp === "between" ? g.value2 : null);
const smgLatest = (d: StoreDeckData) => d.extras.smgWeeks[d.extras.smgWeeks.length - 1];
const OSAT = "Overall Satisfaction";

// ── 1. Overview ──────────────────────────────────────────────────────────────

/** Plain-language lines for the overview, most notable first. */
export function storeHighlights(d: StoreDeckData): string[] {
  const now = cur(d);
  const before = prev(d);
  const out: string[] = [];
  const signed = (v: number | null) => (v == null ? "n/a" : `${v >= 0 ? "up" : "down"} ${Math.abs(v).toFixed(1)}%`);
  const yoy = now.py ? change(now.netSales, now.py.netSales) : null;
  out.push(`Net sales of ${usd0(now.netSales)}, ${signed(change(now.netSales, before.netSales))} on last week` + (yoy != null ? ` and ${signed(yoy)} on last year.` : "."));
  if (now.splh != null) {
    const g = splhGates(d);
    const tone = productivityTone(now.splh, now.netSales);
    const floor = lowOf(g.target);
    const s = tone === "good" ? "on target" : `${usd2(floor - now.splh)} short of the ${usd2(floor)} target`;
    out.push(`Productivity ${usd2(now.splh)} per labor hour, ${s}; TPLH ${now.tplh?.toFixed(2) ?? "—"}.`);
  }
  const dt = d.ops?.drive.week;
  if (dt?.laneSecs != null) out.push(`Drive-thru lane ${mmss(dt.laneSecs)} and window ${mmss(dt.windowSecs)} across ${count(dt.cars ?? 0)} cars.`);
  const f = d.ops?.food.week;
  if (f?.cogsPct != null) out.push(`Food cost ${pct1(f.cogsPct)} of sales; variance ${varPct(f.variancePct)}, ${varUsd(f.varianceDollars)}.`);
  const smg = smgLatest(d);
  const z = d.extras.zcases;
  if (smg?.scores[OSAT] != null) out.push(`Overall satisfaction ${smgPct(smg.scores[OSAT])} on ${smg.responses ?? 0} surveys` + (z ? `; ${z.week.cases} ZCase${z.week.cases === 1 ? "" : "s"} this week.` : "."));
  const parts: string[] = [];
  if (d.extras.zu?.rate != null) parts.push(`ZU ${d.extras.zu.rate}%`);
  if (d.extras.jolt.week?.completePct != null) parts.push(`Jolt ${d.extras.jolt.week.completePct.toFixed(0)}%`);
  if (d.extras.slack?.weekPct != null) parts.push(`Slack reports ${d.extras.slack.weekPct.toFixed(0)}% on time`);
  if (parts.length) out.push(`Compliance: ${parts.join(", ")}.`);
  return out;
}

export function storeOverviewSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  frame(c, d, "Overview");
  const now = cur(d);
  const before = prev(d);
  const f = d.ops?.food;
  const dt = d.ops?.drive.week ?? null;
  const smg = smgLatest(d);
  const x = d.extras;

  tileRow(c, 72, 62, [
    { label: "Net Sales", value: usd0(now.netSales), lines: [[changeRun("WoW", change(now.netSales, before.netSales))], [changeRun("YoY", now.py ? change(now.netSales, now.py.netSales) : null)]] },
    { label: "Transactions", value: count(now.transactions), lines: [[changeRun("WoW", change(now.transactions, before.transactions))], [changeRun("YoY", now.py ? change(now.transactions, now.py.transactions) : null)]] },
    { label: "Average Check", value: now.avgCheck == null ? "—" : usd2(now.avgCheck), lines: [[changeRun("WoW", change(now.avgCheck, before.avgCheck))], [changeRun("YoY", now.py ? change(now.avgCheck, now.py.avgCheck) : null)]] },
    { label: "Productivity", value: now.splh == null ? "—" : usd2(now.splh), tone: productivityTone(now.splh, now.netSales), lines: [[{ text: goalText(splhGates(d), dollars) }], [{ text: `Prior week ${before.splh == null ? "—" : usd2(before.splh)}` }]] },
    { label: "TPLH", value: now.tplh == null ? "—" : now.tplh.toFixed(2), tone: tplhTone(now.tplh), lines: [[{ text: goalText(tplhGates(), ratio2) }], [{ text: `Prior week ${before.tplh == null ? "—" : before.tplh.toFixed(2)}` }]] },
  ]);
  tileRow(c, 142, 62, [
    { label: "COGS %", value: pct1(f?.week.cogsPct), tone: cogsTone(f?.week.cogsPct), lines: [[{ text: `Variance ` }, { text: varPct(f?.week.variancePct), color: ink(varianceTone(f?.week.variancePct)) }], [{ text: `${ptdName(d)} to date ${pct1(f?.ptd.cogsPct)}` }]] },
    { label: "Drive-thru Lane", value: mmss(dt?.laneSecs), tone: driveTone(dt?.laneSecs, dt?.tierSales, "lane"), lines: [[{ text: `Window ` }, { text: mmss(dt?.windowSecs), color: ink(driveTone(dt?.windowSecs, dt?.tierSales, "window")) }], [{ text: dt ? `${count(dt.cars ?? 0)} cars` : "No BerryAI data" }]] },
    { label: "Overall Satisfaction", value: smgPct(smg?.scores[OSAT]), tone: smgTone(smg?.scores[OSAT], OSAT), lines: [[{ text: smg ? `${smg.responses ?? 0} surveys` : "No SMG week" }], [{ text: x.zcases ? `${x.zcases.week.cases} ZCase${x.zcases.week.cases === 1 ? "" : "s"} this week` : "" }]] },
    {
      label: "Jolt Completion",
      value: x.jolt.none ? "No Jolt" : x.jolt.week?.completePct == null ? "—" : `${x.jolt.week.completePct.toFixed(1)}%`,
      tone: joltTone(x.jolt.week?.completePct),
      lines: [[{ text: x.jolt.ptd?.completePct != null ? `${ptdName(d)} to date ${x.jolt.ptd.completePct.toFixed(1)}%` : "" }]],
    },
    {
      label: "Slack Reports On Time",
      value: x.slack?.weekPct == null ? "—" : `${x.slack.weekPct.toFixed(0)}%`,
      tone: slackTone(x.slack?.weekPct),
      lines: [[{ text: x.slack?.ptdPct != null ? `${ptdName(d)} to date ${x.slack.ptdPct.toFixed(0)}%` : "" }], [{ text: x.zu?.rate != null ? `ZU compliance ` : "" }, ...(x.zu?.rate != null ? [{ text: `${x.zu.rate}%`, color: ink(zuTone(x.zu.rate)) }] : [])]],
    },
  ]);

  const y3 = 212;
  const h3 = 388 - y3; // down to the bottom margin now there's no footnote
  const half = (R - L - 8) / 2;
  chartCard(c, L, y3, half, h3, {
    title: "Net Sales",
    note: trendNote(d),
    spec: {
      categories: weekCats(d),
      fmt: FMT_K,
      series: [
        { name: "This year", values: d.weeks.map((w) => w.netSales), ...THIS_YEAR },
        { name: "Last year", values: d.weeks.map((w) => w.py?.netSales ?? null), ...LAST_YEAR },
      ],
    },
  });

  const hx = L + half + 8;
  card(c, hx, y3, half, h3);
  heading(c, hx + 12, y3 + 8, half - 24, "The week in brief");
  // 9pt to read across a room. Lines share the card's height evenly; each
  // slot fits two rows of 9pt, so a line that wraps doesn't crowd the next.
  const size = 9;
  const lines = storeHighlights(d);
  const top3 = y3 + 28;
  const pitch = Math.min(26, (y3 + h3 - 8 - top3) / lines.length);
  lines.forEach((line, i) => {
    const ly = top3 + i * pitch;
    c.box(hx + 13, ly + 4.5, 3.5, 3.5, C.gray400, { round: true });
    c.text(hx + 20, ly - 1, half - 34, pitch, line, { size, color: C.gray700, valign: "TOP" });
  });

  return c;
}

// ── 2. Sales ─────────────────────────────────────────────────────────────────

export function storeSalesSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  frame(c, d, "Sales");

  const cw = (R - L - 2 * 8) / 3;
  const charts: { title: string; format: Fmt; ty: (number | null)[]; ly: (number | null)[] }[] = [
    { title: "Net Sales", format: FMT_K, ty: d.weeks.map((w) => w.netSales), ly: d.weeks.map((w) => w.py?.netSales ?? null) },
    { title: "Transactions", format: FMT_COUNT, ty: d.weeks.map((w) => w.transactions), ly: d.weeks.map((w) => w.py?.transactions ?? null) },
    { title: "Average Check", format: FMT_USD2, ty: d.weeks.map((w) => w.avgCheck), ly: d.weeks.map((w) => w.py?.avgCheck ?? null) },
  ];
  charts.forEach((ch, i) => {
    chartCard(c, L + i * (cw + 8), 72, cw, 130, {
      title: ch.title,
      note: trendNote(d),
      spec: { categories: weekCats(d), fmt: ch.format, series: [{ name: "This year", values: ch.ty, ...THIS_YEAR }, { name: "Last year", values: ch.ly, ...LAST_YEAR }] },
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
  table(c, L, 210, cols, rows, 18.5);

  return c;
}

// ── 3. Labor ─────────────────────────────────────────────────────────────────

export function storeLaborSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  frame(c, d, "Labor");
  const now = cur(d);
  const sg = splhGates(d);
  const tg = tplhGates();
  const tone = { splh: (v: number | null) => productivityTone(v, now.netSales), tplh: (v: number | null) => tplhTone(v) };

  const half = (R - L - 8) / 2;
  const charts = [
    { title: "Productivity", note: `Sales per labor hour · ${trendNote(d).toLowerCase()}`, format: FMT_USD2, key: "splh" as const, g: sg, fmt: dollars },
    { title: "TPLH", note: `Transactions per labor hour · ${trendNote(d).toLowerCase()}`, format: FMT_RATIO, key: "tplh" as const, g: tg, fmt: ratio2 },
  ];
  charts.forEach((ch, i) => {
    chartCard(c, L + i * (half + 8), 72, half, 134, {
      title: ch.title,
      note: ch.note,
      spec: {
        categories: weekCats(d),
        fmt: ch.format,
        series: [
          { name: "This year", values: d.weeks.map((w) => w[ch.key]), ...THIS_YEAR, labelColor: ink(tone[ch.key](now[ch.key])) },
          // Both ends of a ranged goal (productivity's $82–87), one legend entry;
          // the 50% level gets its own yellow line only where it sits lower.
          ...((): LineChartSpec["series"] => {
            const goal = `Goal ${gateLabel(ch.g.target, ch.fmt)}`;
            const hi = highOf(ch.g.target);
            const lines: LineChartSpec["series"] = [{ name: goal, values: flat(d, lowOf(ch.g.target)), ...GOAL }];
            if (hi != null) lines.push({ name: goal, values: flat(d, hi), ...GOAL });
            if (lowOf(ch.g.threshold) < lowOf(ch.g.target)) lines.push({ name: `50% ${gateLabel(ch.g.threshold, ch.fmt)}`, values: flat(d, lowOf(ch.g.threshold)), ...EDGE });
            return lines;
          })(),
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
    { head: "PRODUCTIVITY", w: 72 },
    { head: "VS LW", w: 64 },
    { head: "TPLH", w: 64 },
    { head: "VS LW", w: R - L - (92 + 82 + 82 + 72 + 64 + 72 + 64 + 64) },
  ];
  const ratio = (a: number, h: number) => (h > 0 ? a / h : null);
  const row = (name: string, n: DayTotals | null, p: DayTotals | null, total = false) => {
    const splh = n ? ratio(n.netSales, n.laborHours) : null;
    const tplh = n ? ratio(n.transactions, n.laborHours) : null;
    return {
      total,
      cells: [
        { text: name },
        { text: n ? usd0(n.netSales) : "—" },
        { text: n ? count(n.transactions) : "—" },
        { text: n ? n.laborHours.toFixed(1) : "—" },
        // More hours for the same work is the costly direction.
        pctCell(n?.laborHours, p?.laborHours, true),
        goalCell(splh == null ? "—" : usd2(splh), productivityTone(splh, now.netSales)),
        pctCell(splh, p ? ratio(p.netSales, p.laborHours) : null),
        goalCell(tplh == null ? "—" : tplh.toFixed(2), tplhTone(tplh)),
        pctCell(tplh, p ? ratio(p.transactions, p.laborHours) : null),
      ] as Cell[],
    };
  };
  const rows = d.days.map((day) => row(dayLabel(day.date), one(day.now), one(day.prior)));
  rows.push(row("Week", sumDays(d.days.map((x) => x.now)), sumDays(d.days.map((x) => x.prior)), true));
  table(c, L, 214, cols, rows, 18);

  return c;
}

// ── 4. Drive-thru ────────────────────────────────────────────────────────────

/** BerryAI's daypart index, as the Drive-Thru tab numbers them. */
const daypartName = (index: number) => `Daypart ${index}`;

export function storeDriveSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  const sp = d.opsSpans;
  const dt = d.ops?.drive.week ?? null;
  const dp = d.ops?.drive.ptd ?? null;
  const sales = dt?.tierSales ?? cur(d).netSales;
  const lane = driveGoal(sales, "lane");
  const win = driveGoal(sales, "window");
  frame(c, d, "Drive-thru");
  if (!dt && !dp && d.extras.driveWeeks.every((w) => !w)) {
    emptyCard(c, L, 72, R - L, 60, "No BerryAI drive-thru data for this store.");
    return c;
  }

  tileRow(c, 72, 54, [
    { label: "Lane · week", value: mmss(dt?.laneSecs), tone: driveTone(dt?.laneSecs, dt?.tierSales, "lane"), lines: [[{ text: `${ptdName(d)} to date ` }, { text: mmss(dp?.laneSecs), color: ink(driveTone(dp?.laneSecs, dp?.tierSales, "lane")) }]] },
    { label: "Window · week", value: mmss(dt?.windowSecs), tone: driveTone(dt?.windowSecs, dt?.tierSales, "window"), lines: [[{ text: `${ptdName(d)} to date ` }, { text: mmss(dp?.windowSecs), color: ink(driveTone(dp?.windowSecs, dp?.tierSales, "window")) }]] },
    { label: "Peak lane · dayparts 2 & 4", value: mmss(dt?.peakLaneSecs), tone: driveTone(dt?.peakLaneSecs, dt?.tierSales, "lane"), lines: [[{ text: `Non-peak ` }, { text: mmss(dt?.nonPeakLaneSecs), color: ink(driveTone(dt?.nonPeakLaneSecs, dt?.tierSales, "lane")) }]] },
    { label: "Cars · week", value: dt?.cars ? count(dt.cars) : "—", lines: [[{ text: dp?.cars ? `${count(dp.cars)} ${ptdName(d)} to date` : "" }]] },
    { label: "Flagged pull-forwards", value: dt?.flagged != null ? count(dt.flagged) : "—", tone: pullForwardTone(dt?.flagged), lines: [[{ text: `Goal ≤${PULL_FORWARD_GOAL} a week` }]] },
  ]);

  // Trends, left; dayparts, right.
  const half = (R - L - 8) / 2;
  const trend = (field: "lane" | "window", y: number) => {
    const goal = field === "lane" ? lane : win;
    const values = d.extras.driveWeeks.map((w) => (w ? (field === "lane" ? w.laneSecs : w.windowSecs) : null));
    const last = values[values.length - 1];
    chartCard(c, L, y, half, 123, {
      title: field === "lane" ? "Lane Time" : "Window Time",
      note: trendNote(d),
      spec: {
        categories: weekCats(d),
        ...TIME,
        series: [
          { name: "This store", values, ...THIS_YEAR, labelColor: ink(driveTone(last, sales, field)) },
          ...(goal ? [{ name: `Goal ${mmss(goal.green)}`, values: flat(d, goal.green), ...GOAL }, { name: `50% ${mmss(goal.yellow)}`, values: flat(d, goal.yellow), ...EDGE }] : []),
        ],
      },
    });
  };
  trend("lane", 134);
  trend("window", 257);

  const tx = L + half + 8;
  const parts = (dt?.dayparts ?? []).filter((p) => p.cars);
  const totalCars = parts.reduce((s, p) => s + (p.cars ?? 0), 0);
  const cols: Col[] = [
    { head: "DAYPART", w: 110, align: "START" },
    { head: "LANE", w: 56 },
    { head: "WINDOW", w: 56 },
    { head: "CARS", w: 52 },
    { head: "SHARE", w: half - (110 + 56 + 56 + 52) },
  ];
  const rows: { cells: Cell[]; total?: boolean }[] = parts.map((p) => ({
    cells: [
      { text: daypartName(p.index), bold: false, color: C.gray900 },
      goalCell(mmss(p.laneSecs), driveTone(p.laneSecs, sales, "lane")),
      goalCell(mmss(p.windowSecs), driveTone(p.windowSecs, sales, "window")),
      { text: p.cars ? count(p.cars) : "—" },
      { text: totalCars && p.cars ? `${((p.cars / totalCars) * 100).toFixed(0)}%` : "—" },
    ],
  }));
  rows.push(
    { total: true, cells: [{ text: "Peak (dayparts 2, 4)" }, goalCell(mmss(dt?.peakLaneSecs), driveTone(dt?.peakLaneSecs, sales, "lane")), goalCell(mmss(dt?.peakWindowSecs), driveTone(dt?.peakWindowSecs, sales, "window")), { text: "" }, { text: "" }] },
    { total: true, cells: [{ text: "Non-peak" }, goalCell(mmss(dt?.nonPeakLaneSecs), driveTone(dt?.nonPeakLaneSecs, sales, "lane")), goalCell(mmss(dt?.nonPeakWindowSecs), driveTone(dt?.nonPeakWindowSecs, sales, "window")), { text: "" }, { text: "" }] },
    { total: true, cells: [{ text: "Week" }, goalCell(mmss(dt?.laneSecs), driveTone(dt?.laneSecs, sales, "lane")), goalCell(mmss(dt?.windowSecs), driveTone(dt?.windowSecs, sales, "window")), { text: dt?.cars ? count(dt.cars) : "—" }, { text: "" }] },
  );
  heading(c, tx, 134, half, "By Daypart", `${sp.week.label} · coloured against the week's goals`);
  table(c, tx, 156, cols, rows, Math.min(22, (380 - 156 - 21) / rows.length));

  return c;
}

// ── 5. Food cost ─────────────────────────────────────────────────────────────

export function storeFoodSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  frame(c, d, "Food cost");
  const f = d.ops?.food;
  if (!f || f.week.salesBase == null) {
    emptyCard(c, L, 72, R - L, 60, "No Net-Chef food cost for this store and week.");
    return c;
  }

  tileRow(c, 72, 62, [
    { label: "COGS % · week", value: pct1(f.week.cogsPct), tone: cogsTone(f.week.cogsPct), lines: [[{ text: `${f.week.cogsDollars == null ? "—" : usd0(f.week.cogsDollars)} on ${usd0(f.week.salesBase)} sales` }]] },
    { label: "Variance · week", value: varPct(f.week.variancePct), tone: varianceTone(f.week.variancePct), lines: [[{ text: varUsd(f.week.varianceDollars) }], [{ text: "Prior week " }, { text: varPct(f.priorWeekVariancePct), color: ink(varianceTone(f.priorWeekVariancePct)) }]] },
    { label: `COGS % · ${ptdName(d)} to date`, value: pct1(f.ptd.cogsPct), tone: cogsTone(f.ptd.cogsPct), lines: [[{ text: f.ptd.cogsDollars == null ? "" : `${usd0(f.ptd.cogsDollars)} on ${f.ptd.salesBase == null ? "—" : usd0(f.ptd.salesBase)} sales` }]] },
    { label: `Variance · ${ptdName(d)} to date`, value: varPct(f.ptd.variancePct), tone: varianceTone(f.ptd.variancePct), lines: [[{ text: varUsd(f.ptd.varianceDollars) }]] },
  ]);

  const half = (R - L - 8) / 2;
  const cogs = d.extras.foodWeeks.map((w) => w?.cogsPct ?? null);
  const vari = d.extras.foodWeeks.map((w) => w?.variancePct ?? null);
  chartCard(c, L, 142, half, 238, {
    title: "COGS %",
    note: trendNote(d),
    spec: {
      categories: weekCats(d),
      fmt: FMT_PCT1,
      series: [
        { name: "This store", values: cogs, ...THIS_YEAR, labelColor: ink(cogsTone(cogs[cogs.length - 1])) },
        { name: "Goal 28.5%", values: flat(d, 28.5), ...GOAL },
        { name: "50% 30.0%", values: flat(d, 30), ...EDGE },
      ],
    },
  });
  chartCard(c, L + half + 8, 142, half, 238, {
    title: "Variance %",
    note: `${trendNote(d)} · negative is under theoretical`,
    spec: {
      categories: weekCats(d),
      fmt: (v) => varPct(v),
      series: [
        { name: "This store", values: vari, ...THIS_YEAR, labelColor: ink(varianceTone(vari[vari.length - 1])) },
        { name: "Goal ±1.0%", values: flat(d, 1), ...GOAL },
        { name: "Goal ±1.0%", values: flat(d, -1), ...GOAL },
        { name: "50% ±1.5%", values: flat(d, 1.5), ...EDGE },
        { name: "50% ±1.5%", values: flat(d, -1.5), ...EDGE },
      ],
    },
  });

  return c;
}

// ── 6. SMG ───────────────────────────────────────────────────────────────────

export function storeSmgSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  frame(c, d, "SMG");
  const latest = smgLatest(d);
  const sw = d.extras.smgWeeks;

  // Latest week, one tile per item, with its goal and 50% level.
  tileRow(
    c,
    72,
    60,
    SMG_METRICS.map((m) => {
      const v = latest?.scores[m.name] ?? null;
      // The SMG tab's bands (surveyMeta.scoreTone): 80 / 75, or ≤5 / ≤10 where lower is better.
      const goals = LOWER_IS_BETTER.test(m.name) ? "Goal ≤5% · 50% ≤10%" : ACCURACY_METRIC.test(m.name) ? "Goal 90% · 50% 85%" : "Goal 80% · 50% 75%";
      return {
        label: m.label,
        value: smgPct(v),
        tone: smgTone(v, m.name),
        size: 15,
        lines: [[{ text: goals }], ...(m.name === OSAT ? [[{ text: `${latest?.responses ?? 0} surveys` }]] : [])],
      };
    }),
  );

  // OSAT trend, left; weekly scores by item, right.
  const half = (R - L - 8) / 2;
  const osat = sw.map((w) => w?.scores[OSAT] ?? null);
  chartCard(c, L, 140, half, 142, {
    title: "Overall Satisfaction",
    note: trendNote(d),
    spec: {
      categories: weekCats(d),
      fmt: FMT_SCORE,
      ceiling: 100,
      series: [
        { name: "This store", values: osat, ...THIS_YEAR, labelColor: ink(smgTone(osat[osat.length - 1], OSAT)) },
        { name: "Goal 80%", values: flat(d, 80), ...GOAL },
        { name: "50% 75%", values: flat(d, 75), ...EDGE },
      ],
    },
  });

  const shown = d.weeks.slice(-5).map((w, i) => ({ w, s: sw[sw.length - 5 + i] }));
  const nameW = 104;
  const colW = (half - nameW) / shown.length;
  const cols: Col[] = [{ head: "", w: nameW, align: "START" }, ...shown.map(({ w }) => ({ head: mdShort(w.week.start), w: colW }))];
  const rows = SMG_METRICS.map((m) => ({
    cells: [{ text: m.label, bold: false, color: C.gray900 }, ...shown.map(({ s }) => { const v = s?.scores[m.name] ?? null; return goalCell(smgPct(v), smgTone(v, m.name)); })] as Cell[],
  }));
  rows.push({ cells: [{ text: "Surveys", bold: false, color: C.gray500 }, ...shown.map(({ s }) => ({ text: s?.responses != null ? String(s.responses) : "—", color: C.gray500, bold: false }))] });
  table(c, L + half + 8, 140, cols, rows, 17.3);

  // ZCases
  const z = d.extras.zcases;
  heading(c, L, 289, R - L, "ZCases", "Guest complaints from smg360");
  if (!z) {
    emptyCard(c, L, 312, R - L, 68, "ZCases unavailable.");
    return c;
  }
  const zw = (R - L - 8) / 2;
  const tw = (zw - 2 * 8) / 3;
  const zy = 312;
  const zh = 380 - zy;
  const hrs = (h: number) => `${h.toFixed(0)} hr${Math.round(h) === 1 ? "" : "s"}`;
  const zt = (i: number, t: Parameters<typeof tile>[5]) => tile(c, L + i * (tw + 8), zy, tw, zh, t);
  zt(0, { label: "Opened this week", value: String(z.week.cases), lines: [[{ text: z.week.avgHours != null ? `Avg ${hrs(z.week.avgHours)} to resolve` : "" }]] });
  zt(1, { label: `Opened ${ptdName(d)} to date`, value: String(z.ptd.cases), tone: zcaseCountTone(z.ptd.cases), lines: [[{ text: `Goal ≤${ZCASE_GOALS.count.target} a period` }]] });
  zt(2, { label: `Within 24 hrs · ${ptdName(d)}`, value: z.ptd.within24Pct == null ? "—" : `${z.ptd.within24Pct.toFixed(0)}%`, tone: zcase24Tone(z.ptd.within24Pct), lines: [[{ text: z.outstanding ? `${z.outstanding} open now` : "None open now", color: z.outstanding ? C.red600 : undefined }]] });
  // Opened by week: a row of counts reads better than a chart of 0s and 1s.
  const bx = L + zw + 8;
  card(c, bx, zy, zw, zh);
  c.text(bx + 12, zy + 7, zw - 24, 10, "Opened by week", { size: 6.5, color: C.gray500 });
  const cellW = (zw - 24) / z.weekly.length;
  z.weekly.forEach((n, i) => {
    const cx = bx + 12 + i * cellW;
    const last = i === z.weekly.length - 1;
    c.text(cx, zy + 22, cellW, 22, String(n), { size: 15, bold: true, color: last ? C.gray900 : n ? C.gray700 : C.gray300, align: "CENTER" });
    c.text(cx, zy + 46, cellW, 9, mdShort(d.weeks[i].week.start), { size: 6, bold: last, color: last ? C.gray700 : C.gray400, align: "CENTER" });
  });

  return c;
}

// ── 7. Compliance ────────────────────────────────────────────────────────────

/**
 * The admin Slack table's cell tones (AdminSlackReports STATUS_CELL): a -50
 * tint with -800/-700 text. An inaccurate report keeps its status tint and
 * gets candy-cane stripes in that hue's -200 step, light enough to read the
 * label through.
 */
const SLOT_TONE: Record<"on_time" | "late" | "missed", { bg: string; fg: string; stripe: string; label: string }> = {
  on_time: { bg: "#f0fdf4", fg: "#166534", stripe: "#bbf7d0", label: "On time" }, // green-50 / 800 / 200
  late: { bg: "#fffbeb", fg: "#92400e", stripe: "#fde68a", label: "Late" }, // amber-50 / 800 / 200
  missed: { bg: "#fef2f2", fg: "#b91c1c", stripe: "#fecaca", label: "Missed" }, // red-50 / 700 / 200
};

function slotCell(c: Canvas, x: number, y: number, w: number, h: number, status: keyof typeof SLOT_TONE, inaccurate: boolean) {
  const t = SLOT_TONE[status];
  c.box(x, y, w, h, t.bg, { round: true, radius: 2.5 });
  if (inaccurate) c.stripes(x + 0.6, y + 0.6, w - 1.2, h - 1.2, t.stripe, { width: 2, gap: 2 });
  c.text(x, y, w, h, t.label, { size: 6, bold: true, color: t.fg, align: "CENTER" });
}

function slackGrid(c: Canvas, x: number, y: number, w: number, days: SlackDay[], inaccurate: Set<string> | null) {
  const nameW = 50;
  const cw = (w - nameW) / SLACK_SLOTS.length;
  const heads = ["8:30a", "2:30p", "5:30p", "8:30p"];
  SLACK_SLOTS.forEach((_, i) => c.text(x + nameW + i * cw, y, cw, 9, heads[i], { size: 6, bold: true, color: C.gray400, align: "CENTER" }));
  days.forEach((day, r) => {
    const ry = y + 12 + r * 18;
    c.text(x, ry, nameW, 14, dayLabel(day.date), { size: 7, color: C.gray700 });
    SLACK_SLOTS.forEach((sl, i) => {
      const st = day.slots[sl.id];
      const cx = x + nameW + i * cw + 2;
      // Every report is due by the time a deck is made; a closed day has nothing owed.
      if (st == null || st === "upcoming") {
        c.text(cx, ry + 1.5, cw - 4, 12, "—", { size: 6, color: C.gray300, align: "CENTER" });
        return;
      }
      slotCell(c, cx, ry + 1.5, cw - 4, 12, st, !!inaccurate?.has(`${day.date}|${sl.id}`));
    });
  });
  // Key
  const ky = y + 12 + days.length * 18 + 6;
  // Two rows: the three statuses, then the two that can also be inaccurate.
  type Key = { status: keyof typeof SLOT_TONE; inaccurate: boolean; label: string };
  const rowsOfKeys: Key[][] = [
    [
      { status: "on_time", inaccurate: false, label: "On time" },
      { status: "late", inaccurate: false, label: "Late" },
      { status: "missed", inaccurate: false, label: "Missed" },
    ],
    [
      { status: "on_time", inaccurate: true, label: "On time / inaccurate" },
      { status: "late", inaccurate: true, label: "Late / inaccurate" },
    ],
  ];
  rowsOfKeys.forEach((row, ri) => {
    const ry = ky + ri * 13;
    let kx = x;
    for (const k of row) {
      const t = SLOT_TONE[k.status];
      c.box(kx, ry + 1, 12, 8, t.bg, { line: t.stripe, round: true, radius: 1.5 });
      if (k.inaccurate) c.stripes(kx + 0.6, ry + 1.6, 10.8, 6.8, t.stripe, { width: 1.5, gap: 2 });
      c.text(kx + 13, ry - 1, 90, 11, k.label, { size: 6, color: C.gray500 });
      kx += 13 + k.label.length * 3.1 + 14;
    }
  });
  if (inaccurate == null) c.text(x, ky + 28, w, 9, "Accuracy couldn't be checked for this week.", { size: 6, color: C.gray400 });
}

/** A titled list of name → figure rows that stops with "+N more" when it runs out of room. */
function nameList(c: Canvas, x: number, y: number, w: number, h: number, title: string, rows: { left: string; right: string; color: string }[], empty: string) {
  c.text(x, y, w, 10, title.toUpperCase(), { size: 6, bold: true, color: C.gray400 });
  if (!rows.length) {
    c.text(x, y + 13, w, 12, empty, { size: 7.5, color: C.gray500 });
    return;
  }
  const rowH = 13;
  const fit = Math.floor((h - 14) / rowH);
  const shown = rows.length > fit ? rows.slice(0, fit - 1) : rows;
  const maxChars = Math.floor((w - 84) / 4.1);
  shown.forEach((r, i) => {
    const ry = y + 13 + i * rowH;
    const left = r.left.length > maxChars ? r.left.slice(0, maxChars - 1) + "…" : r.left;
    c.text(x, ry, w - 56, 12, left, { size: 7, color: C.gray700 });
    c.text(x + w - 70, ry, 70, 12, r.right, { size: 7, bold: true, color: r.color, align: "END" });
  });
  if (shown.length < rows.length) {
    c.text(x, y + 13 + shown.length * rowH, w, 12, `+${rows.length - shown.length} more`, { size: 7, color: C.gray400 });
  }
}

export function storeComplianceSlide(d: StoreDeckData): Canvas {
  const c = new Canvas();
  const x = d.extras;
  frame(c, d, "Compliance");
  const cw = (R - L - 2 * 8) / 3;
  const top = 72;
  const h = 380 - top;

  // ZU
  const zx = L;
  card(c, zx, top, cw, h);
  heading(c, zx + 12, top + 8, cw - 24, "Zaxby's University", "Average compliance rate, today");
  if (!x.zu) {
    c.text(zx, top + 40, cw, 30, "Unavailable", { size: 9, color: C.gray400, align: "CENTER" });
  } else {
    c.text(zx + 12, top + 34, cw - 24, 34, x.zu.rate == null ? "—" : `${x.zu.rate}%`, { size: 28, bold: true, color: ink(zuTone(x.zu.rate)) });
    const lines: [string, string][] = [
      ["People in scope", count(x.zu.people)],
      ["Compliant", count(x.zu.compliant)],
      ["Not compliant", count(x.zu.noncompliant)],
    ];
    lines.forEach(([k, v], i) => {
      const ly = top + 84 + i * 20;
      if (i) c.rule(zx + 12, ly - 3, cw - 24, 0.5, C.gray100);
      c.text(zx + 12, ly, cw - 24, 14, k, { size: 7.5, color: C.gray500 });
      c.text(zx + 12, ly, cw - 24, 14, v, { size: 7.5, bold: true, color: i === 2 && x.zu!.noncompliant ? C.red600 : C.gray900, align: "END" });
    });
    nameList(
      c,
      zx + 12,
      top + 150,
      cw - 24,
      380 - 10 - (top + 150),
      "Under 100%",
      x.zu.behind.map((m) => ({ left: m.name, right: m.rate == null ? "—" : `${m.rate}%`, color: ink(zuTone(m.rate)) })),
      "Everyone is at 100%.",
    );
  }

  // Jolt
  const jx = L + cw + 8;
  card(c, jx, top, cw, h);
  heading(c, jx + 12, top + 8, cw - 24, "Jolt", `Checklist completion · ${d.opsSpans.week.label}`);
  if (x.jolt.none) {
    c.text(jx, top + 40, cw, 30, "This store doesn't run Jolt.", { size: 8, color: C.gray400, align: "CENTER" });
  } else if (!x.jolt.week) {
    c.text(jx, top + 40, cw, 30, "Unavailable", { size: 9, color: C.gray400, align: "CENTER" });
  } else {
    const j = x.jolt.week;
    c.text(jx + 12, top + 34, cw - 24, 34, j.completePct == null ? "—" : `${j.completePct.toFixed(1)}%`, { size: 28, bold: true, color: ink(joltTone(j.completePct)) });
    const pt = x.jolt.ptd;
    const lines: [string, string, string?][] = [
      ["On time", j.onTimePct == null ? "—" : `${j.onTimePct.toFixed(1)}%`],
      ["Late", count(j.late), j.late ? C.yellow600 : undefined],
      ["Missed", count(j.missed), j.missed ? C.red600 : undefined],
      [`${ptdName(d)} to date`, pt?.completePct == null ? "—" : `${pt.completePct.toFixed(1)}%`, ink(joltTone(pt?.completePct))],
    ];
    lines.forEach(([k, v, col], i) => {
      const ly = top + 84 + i * 20;
      if (i) c.rule(jx + 12, ly - 3, cw - 24, 0.5, C.gray100);
      c.text(jx + 12, ly, cw - 24, 14, k, { size: 7.5, color: C.gray500 });
      c.text(jx + 12, ly, cw - 24, 14, v, { size: 7.5, bold: true, color: col ?? C.gray900, align: "END" });
    });
    nameList(
      c,
      jx + 12,
      top + 170,
      cw - 24,
      380 - 10 - (top + 170),
      "Missed or late this week",
      x.jolt.lists.map((l) => ({
        left: l.title,
        right: [l.missed ? `${l.missed} missed` : "", l.late ? `${l.late} late` : ""].filter(Boolean).join(" · "),
        color: l.missed ? C.red600 : C.yellow600,
      })),
      "Every list done on time.",
    );
  }

  // Slack
  const sx = L + 2 * (cw + 8);
  card(c, sx, top, cw, h);
  heading(c, sx + 12, top + 8, cw - 24, "Slack Reports", "Daily reports posted on time");
  if (!x.slack) {
    c.text(sx, top + 40, cw, 30, "Unavailable", { size: 9, color: C.gray400, align: "CENTER" });
  } else {
    const s = x.slack;
    c.text(sx + 12, top + 34, cw - 24, 34, s.weekPct == null ? "—" : `${s.weekPct.toFixed(0)}%`, { size: 28, bold: true, color: ink(slackTone(s.weekPct)) });
    c.text(sx + 12, top + 68, cw - 24, 10, `${ptdName(d)} to date `, { size: 7, color: C.gray500 });
    c.text(sx + 60, top + 68, cw - 72, 10, s.ptdPct == null ? "—" : `${s.ptdPct.toFixed(0)}%  (${s.ptdOnTime} of ${s.ptdRequired})`, { size: 7, bold: true, color: ink(slackTone(s.ptdPct)) });
    if (s.checked) {
      c.text(sx + 12, top + 80, cw - 24, 10, "Accurate", { size: 7, color: C.gray500 });
      c.text(sx + 60, top + 80, cw - 72, 10, `${s.accurate} of ${s.checked} posted reports`, { size: 7, bold: true, color: s.accurate < s.checked ? C.red600 : C.gray900 });
    }
    slackGrid(c, sx + 12, top + 100, cw - 24, s.week, s.inaccurate);
  }

  return c;
}

export function storeDeckSlides(d: StoreDeckData): Canvas[] {
  return [
    storeOverviewSlide(d),
    storeSalesSlide(d),
    storeLaborSlide(d),
    storeDriveSlide(d),
    storeFoodSlide(d),
    storeSmgSlide(d),
    storeComplianceSlide(d),
  ];
}

export type { DriveThru };
