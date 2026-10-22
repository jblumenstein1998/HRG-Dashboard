/**
 * The WBR's per-district sales and productivity slides, drawn from WbrWeek.
 *
 * Layout is the 10.19–10.25 deck's (the format Josh asked to keep), measured off
 * its slides in points; colours are the dashboard's. Each builder appends a
 * createSlide plus everything on it, under object ids prefixed with `slideId`,
 * so a later run can find and replace exactly what an earlier one drew.
 */

import { C, Canvas, toneOf, type SlidesRequest, type Tone } from "@/lib/wbr/draw";
import type { DistrictWeek, SalesFigures, StoreWeek, WbrWeek } from "@/lib/wbr/data";
import type { Target } from "@/lib/wbr/targets";

/** Every slide this module draws has an id starting with this. */
export const WBR_SLIDE_PREFIX = "wbr";

const W = 720;

// ── Formatting ───────────────────────────────────────────────────────────────

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const parts = (iso: string) => iso.split("-").map(Number) as [number, number, number];

const usd0 = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const usd2 = (v: number) => `$${v.toFixed(2)}`;
const usdK = (v: number) => `$${(v / 1000).toFixed(1)}K`;
const count = (v: number) => Math.round(v).toLocaleString("en-US");

/** Percent change, or null when there is no base to compare with. */
const change = (now: number | null, base: number | null | undefined): number | null =>
  now == null || base == null || base === 0 ? null : ((now - base) / base) * 100;
const pctLabel = (v: number | null) => (v == null ? "N/A" : `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(1)}%`);

/** "OCT 12–18, 2026", or "SEP 28–OCT 4, 2026" across a month boundary. */
function weekSpan(start: string, end: string): string {
  const [, sm, sd] = parts(start);
  const [ey, em, ed] = parts(end);
  const tail = sm === em ? `${ed}` : `${MONTHS[em - 1]} ${ed}`;
  return `${MONTHS[sm - 1]} ${sd}–${tail}, ${ey}`;
}
const mdy = (iso: string) => {
  const [y, m, d] = parts(iso);
  return `${m}/${d}/${y}`;
};
const md = (iso: string) => {
  const [, m, d] = parts(iso);
  return `${m}/${d}`;
};
const monDay = (iso: string) => {
  const [, m, d] = parts(iso);
  return `${MONTHS[m - 1]} ${String(d).padStart(2, "0")}`;
};

// ── Shared chrome ────────────────────────────────────────────────────────────

/** Where a slide goes, and which of the deck's layouts it borrows. */
export type Placement = { slideId: string; insertionIndex: number; layoutId: string };

function newSlide({ slideId, insertionIndex, layoutId }: Placement): SlidesRequest[] {
  return [
    { createSlide: { objectId: slideId, insertionIndex, slideLayoutReference: { layoutId } } },
    {
      updatePageProperties: {
        objectId: slideId,
        pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: { red: 0xf9 / 255, green: 0xfa / 255, blue: 0xfb / 255 } } } } },
        fields: "pageBackgroundFill",
      },
    },
  ];
}

function header(c: Canvas, opts: { title: string; subtitle?: string; right: string; rightSub?: string }) {
  c.box(0, 0, W, 59, C.gray900);
  c.box(0, 59, W, 3.5, C.red700);
  c.text(27, 8.6, 486, 10.3, "HUDSON RESTAURANT GROUP  /  WEEKLY BUSINESS REVIEW", { size: 7, bold: true, color: C.gray400 });
  c.text(27, 24.8, 500, 28.1, opts.subtitle ? `${opts.title}  /  ${opts.subtitle}` : opts.title, {
    size: 20,
    bold: true,
    color: C.white,
  });
  c.text(520, 8.6, 172.8, 11.9, opts.right, { size: 8, bold: true, color: C.gray300, align: "END" });
  if (opts.rightSub) c.text(546.5, 33.5, 146.9, 13.5, opts.rightSub, { size: 8, color: C.gray300, align: "END" });
}

const restaurants = (n: number) => `${n} RESTAURANT${n === 1 ? "" : "S"}`;
const pageOf = (i: number, n: number) => `${String(i + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}`;
const leaderTitle = (d: DistrictWeek) => d.leader.toUpperCase();
const marketName = (d: DistrictWeek) => (d.market === "TN" ? "TENNESSEE" : d.market === "VA" ? "VIRGINIA" : "TENNESSEE / VIRGINIA");

// ── Sales / transactions / average check ─────────────────────────────────────

type Metric = { label: string; pick: (f: SalesFigures) => number | null; fmtBig: (v: number) => string; fmtRow: (v: number) => string };
const METRICS: Metric[] = [
  { label: "NET SALES", pick: f => f.netSales, fmtBig: usdK, fmtRow: usdK },
  { label: "TRANSACTIONS", pick: f => f.transactions, fmtBig: count, fmtRow: count },
  { label: "AVERAGE CHECK", pick: f => f.avgCheck, fmtBig: usd2, fmtRow: usd2 },
];

function salesReadout(d: DistrictWeek): string {
  const wow = (s: StoreWeek) => change(s.current.netSales, s.prior.netSales) ?? 0;
  const mover = [...d.stores].sort((a, b) => Math.abs(wow(b)) - Math.abs(wow(a)))[0];
  const district = `DISTRICT SALES ${pctLabel(change(d.total.current.netSales, d.total.prior.netSales))} WoW`;
  const yoy = d.total.priorYear ? `, ${pctLabel(change(d.total.currentLegacy.netSales, d.total.priorYear.netSales))} YoY` : "";
  if (!mover) return district + yoy;
  const traffic = pctLabel(change(mover.current.transactions, mover.prior.transactions));
  return `${mover.label.toUpperCase()} SALES ${pctLabel(wow(mover))} WoW AND TRAFFIC ${traffic}  •  ${district}${yoy}`;
}

export function salesSlide(wk: WbrWeek, d: DistrictWeek, page: number, pages: number, at: Placement): SlidesRequest[] {
  const c = new Canvas(at.slideId);
  header(c, {
    title: leaderTitle(d),
    subtitle: marketName(d),
    right: weekSpan(wk.week.start, wk.week.end),
    rightSub: restaurants(d.stores.length),
  });

  const yoyNote = d.yoyLegacyOnly ? "WoW: all stores  •  YoY: legacy stores only" : "Full district  •  same-store comparisons";

  // KPI cards
  METRICS.forEach((m, i) => {
    const x = 27 + i * 226.8;
    c.box(x, 74.5, 213.3, 63.7, C.white, { line: C.gray200, round: true });
    c.box(x, 82, 3, 48.7, C.red700);
    c.text(x + 11.9, 81, 113.4, 10.3, m.label, { size: 8, bold: true, color: C.gray500 });
    const now = m.pick(d.total.current);
    c.text(x + 11.9, 92.3, 137.7, 27.5, now == null ? "—" : m.fmtBig(now), { size: 20, bold: true, color: C.gray900 });
    c.text(x + 150.1, 84.8, 19.4, 9.2, "WoW", { size: 6, bold: true, color: C.gray500, align: "CENTER", valign: "TOP" });
    c.text(x + 178.2, 84.8, 18.4, 9.2, "YoY", { size: 6, bold: true, color: C.gray500, align: "CENTER", valign: "TOP" });
    const wow = change(now, m.pick(d.total.prior));
    const yoy = d.total.priorYear ? change(m.pick(d.total.currentLegacy), m.pick(d.total.priorYear)) : null;
    c.chip(x + 143.6, 97.7, 30.2, 17.8, pctLabel(wow), toneOf(wow), 6);
    c.chip(x + 176, 97.7, 30.2, 17.8, pctLabel(yoy), toneOf(yoy), 6);
    c.text(x + 11.9, 124.7, 191.7, 7.6, yoyNote, { size: 6, color: C.gray500 });
  });

  // Column headers
  c.text(32.4, 148.5, 110.7, 13.5, "LOCATION", { size: 8, bold: true, color: C.gray500 });
  const groupX = [151.7, 332.1, 511.9];
  METRICS.forEach((m, i) => {
    c.box(groupX[i], 143.1, 173.9, 20.5, C.gray100, { round: true });
    c.text(groupX[i], 143.1, 173.9, 20.5, m.label, { size: 8, bold: true, color: C.gray600, align: "CENTER" });
    c.text(groupX[i] + 4.9, 166.3, 72.4, 13.5, "CURRENT", { size: 7, bold: true, color: C.gray400 });
    c.text(groupX[i] + 79.4, 166.3, 43.2, 13.5, "WoW", { size: 7, bold: true, color: C.gray400, align: "CENTER" });
    c.text(groupX[i] + 126.4, 166.3, 41, 13.5, "YoY", { size: 7, bold: true, color: C.gray400, align: "CENTER" });
  });

  // Rows: stores then the district total. Five or more stores tighten the pitch
  // so the readout still clears the footer.
  const rows = d.stores.length + 1;
  const pitch = Math.min(30.2, (335 - 184.1) / rows);
  const rowH = pitch - 3.2;
  const cellX = [157.7, 338, 517.9];

  const drawRow = (y: number, label: string, cur: SalesFigures, prior: SalesFigures, yoyNow: SalesFigures | null, py: SalesFigures | null, total: boolean) => {
    c.box(27, y, 665.3, rowH, total ? C.gray100 : C.white, { line: total ? C.gray300 : C.gray200, round: true });
    if (total) c.box(27, y + 5, 3.1, rowH - 10, C.red700);
    c.text(34.6, y, 114.5, rowH, label, { size: total ? 8 : 9, bold: total, color: C.gray900 });
    METRICS.forEach((m, i) => {
      const now = m.pick(cur);
      c.text(cellX[i], y, 74, rowH, now == null ? "—" : m.fmtRow(now), { size: 10, bold: true, color: C.gray900 });
      const wow = change(now, m.pick(prior));
      const yoy = py && yoyNow ? change(m.pick(yoyNow), m.pick(py)) : null;
      const chipY = y + (rowH - 15.7) / 2;
      c.chip(cellX[i] + 70.7, chipY, 42.1, 15.7, pctLabel(wow), toneOf(wow));
      c.chip(cellX[i] + 118.2, chipY, 42.1, 15.7, pctLabel(yoy), toneOf(yoy));
    });
  };

  d.stores.forEach((s, i) => drawRow(184.1 + i * pitch, s.label, s.current, s.prior, s.current, s.priorYear, false));
  const totalY = 184.1 + d.stores.length * pitch;
  drawRow(totalY, "DISTRICT TOTAL", d.total.current, d.total.prior, d.total.currentLegacy, d.total.priorYear, true);

  // Readout
  const ry = Math.max(341.3, totalY + rowH + 6);
  c.box(27, ry, 665.3, 33.5, C.white, { line: C.gray200, round: true });
  c.box(27, ry + 6, 3.2, 21.5, C.red700);
  c.text(37.3, ry + 4, 100, 9, "READOUT", { size: 7, bold: true, color: C.gray500 });
  c.text(37.3, ry + 14.5, 643.7, 14, salesReadout(d), { size: 8, bold: true, color: C.gray900 });

  // Footer
  c.rule(27, 387.7, 665.8, 0.6, C.gray200);
  const missing = d.stores.filter(s => s.missingDays.length).map(s => `${s.label} missing ${s.missingDays.map(md).join(", ")}`);
  c.text(
    28.1,
    390.4,
    600,
    9,
    `SOURCE: PAR POS • Week ${mdy(wk.week.start)}–${mdy(wk.week.end)}  |  Prior week ${md(wk.priorWeek.start)}–${md(wk.priorWeek.end)}  |  YoY vs ${md(wk.priorYearWeek.start)}–${mdy(wk.priorYearWeek.end)}` +
      (missing.length ? `  |  INCOMPLETE: ${missing.join("; ")}` : ""),
    { size: 6, color: missing.length ? C.red600 : C.gray500 },
  );
  c.text(632, 389.9, 60.1, 9.7, pageOf(page, pages), { size: 7, color: C.gray500, align: "END" });

  return [...newSlide(at), ...c.requests];
}

// ── Productivity (SPLH) and TPLH ─────────────────────────────────────────────

type Kind = { key: "splh" | "tplh"; fmt: (v: number) => string; delta: (v: number) => string };
const SPLH: Kind = { key: "splh", fmt: usd2, delta: v => `$${Math.abs(v).toFixed(2)}` };
const TPLH: Kind = { key: "tplh", fmt: v => v.toFixed(2), delta: v => Math.abs(v).toFixed(2) };

const targetLabel = (k: Kind, t: Target) =>
  k.key === "splh"
    ? t.ceiling ? `$${t.floor}–${t.ceiling}` : `$${t.floor}+`
    : `${t.floor.toFixed(2)}+`;

const latest = (s: StoreWeek, k: Kind) => s[k.key][s[k.key].length - 1];
const previous = (s: StoreWeek, k: Kind) => s[k.key][s[k.key].length - 2];
const atTarget = (s: StoreWeek, k: Kind) => {
  const v = latest(s, k);
  const t = s.targets?.[k.key];
  return v != null && t != null && v >= t.floor;
};
const improved = (s: StoreWeek, k: Kind) => {
  const v = latest(s, k);
  const p = previous(s, k);
  return v != null && p != null && v > p;
};

function productivityTakeaway(d: DistrictWeek): string {
  const n = d.stores.length;
  const splhAt = d.stores.filter(s => atTarget(s, SPLH));
  const tplhAt = d.stores.filter(s => atTarget(s, TPLH)).length;
  const swing = (s: StoreWeek) => (latest(s, SPLH) ?? 0) - (previous(s, SPLH) ?? latest(s, SPLH) ?? 0);
  const mover = [...d.stores].sort((a, b) => Math.abs(swing(b)) - Math.abs(swing(a)))[0];
  const first =
    splhAt.length === 0
      ? `No store met its productivity target`
      : splhAt.length === n
        ? `Every store met its productivity target`
        : `${splhAt.map(s => s.label).join(" and ")} ${splhAt.length === 1 ? "is" : "are"} at productivity target`;
  const second = tplhAt === 0 ? "none met TPLH" : `${tplhAt} of ${n} met TPLH`;
  const third = mover && swing(mover) !== 0
    ? ` ${mover.label} had the largest week-over-week move (${swing(mover) > 0 ? "+" : "−"}$${Math.abs(swing(mover)).toFixed(2)}).`
    : "";
  return `${first}; ${second}.${third}`;
}

export function productivitySlide(wk: WbrWeek, d: DistrictWeek, page: number, pages: number, at: Placement): SlidesRequest[] {
  const c = new Canvas(at.slideId);
  const n = d.stores.length;
  const [ey, em, ed] = parts(wk.week.end);

  c.box(0, 0, W, 60.5, C.gray900);
  c.box(25.4, 15.1, 3, 28.1, C.red700);
  c.text(36.2, 9.7, 399.6, 8.6, "HUDSON RESTAURANT GROUP  /  WEEKLY BUSINESS REVIEW", { size: 7, bold: true, color: C.gray400 });
  c.text(35.1, 23.2, 420, 28.6, leaderTitle(d), { size: 22, bold: true, color: C.white });
  c.text(545.4, 13, 146.9, 12, `WEEK ENDED ${MONTHS[em - 1]} ${ed}, ${ey}`, { size: 8, bold: true, color: C.white, align: "END" });
  c.text(545.4, 29, 146.9, 12, marketName(d), { size: 8, bold: true, color: C.gray300, align: "END" });
  c.box(0, 60.5, W, 3, C.red700);

  // Scorecards
  const cards: [string, string, string][] = [
    ["PRODUCTIVITY AT TARGET", `${d.stores.filter(s => atTarget(s, SPLH)).length} / ${n}`, "stores meeting goal"],
    ["TPLH AT TARGET", `${d.stores.filter(s => atTarget(s, TPLH)).length} / ${n}`, "stores meeting goal"],
    ["PRODUCTIVITY IMPROVED", `${d.stores.filter(s => improved(s, SPLH)).length} / ${n}`, "vs. prior week"],
    ["TPLH IMPROVED", `${d.stores.filter(s => improved(s, TPLH)).length} / ${n}`, "vs. prior week"],
  ];
  cards.forEach(([label, big, sub], i) => {
    const x = 25.4 + i * 169.6;
    c.box(x, 72.4, 162, 48.1, C.white, { line: C.gray200, round: true });
    c.text(x + 9.2, 78.3, 143.6, 9.7, label, { size: 7, bold: true, color: C.gray500 });
    c.text(x + 9.2, 88.6, 70.2, 23.8, big, { size: 17, bold: true, color: C.gray900 });
    c.text(x + 52, 97.7, 102, 11.9, sub, { size: 7, color: C.gray500, align: "END" });
  });

  c.text(34.6, 137.2, 114.5, 10.8, "LOCATION & SALES", { size: 8, bold: true, color: C.gray500 });
  c.text(153.4, 137.2, 254.9, 10.8, "PRODUCTIVITY  /  SALES PER LABOR HOUR", { size: 8, bold: true, color: C.gray500 });
  c.text(427.7, 137.2, 261.9, 10.8, "TPLH  /  TRANSACTIONS PER LABOR HOUR", { size: 8, bold: true, color: C.gray500 });
  c.rule(25.4, 152.3, 669.1, 0.6, C.gray200);

  // Store rows. Up to three use the roomy layout; four or more the compact one.
  const compact = n >= 4;
  const rowH = compact ? Math.min(50.5, (372 - 157.1) / n - 4) : 65.6;
  const pitch = compact ? rowH + 4.1 : 72.4;
  const trend = wk.trendWeeks;

  d.stores.forEach((s, i) => {
    const y = 157.1 + i * pitch;
    c.box(25.4, y, 669.1, rowH, C.white, { line: C.gray200, round: true });
    c.box(25.4, y + 6.5, 2.5, rowH - 13, C.red700);
    c.text(35.1, y + 6, 106.9, 18, s.label, { size: 12, bold: true, color: C.gray900 });
    const salesY = y + rowH - (compact ? 21 : 21.5);
    c.text(35.6, salesY, 39.4, 9.2, "NET SALES", { size: 6, bold: true, color: C.gray500 });
    c.text(74.5, salesY, 63.7, 9.7, usd0(s.current.netSales), { size: 8, bold: true, color: C.gray700 });
    c.rule(143.6, y + 7.6, 0.6, rowH - 15, C.gray200);
    c.rule(419, y + 7.6, 0.6, rowH - 15, C.gray200);

    ([SPLH, TPLH] as Kind[]).forEach((k, col) => {
      const x = col === 0 ? 154.4 : 429.8;
      const v = latest(s, k);
      const p = previous(s, k);
      const t = s.targets?.[k.key];
      c.text(x, y + 3.8, 90.2, 21.6, v == null ? "—" : k.fmt(v), { size: compact ? 15 : 18, bold: true, color: C.gray900 });

      if (v != null && p != null) {
        const dv = v - p;
        // By sign alone: a TPLH move of 0.03 is real at this scale, where
        // toneOf's dead band (built for percentages) would grey it out.
        const tone: Tone = dv > 0 ? "good" : dv < 0 ? "bad" : "neutral";
        const arrow = dv > 0 ? "▲" : dv < 0 ? "▼" : "■";
        c.text(x + 82.1, y + 9.5, 105, 11.9, `${arrow}  ${dv >= 0 ? "+" : "−"}${k.delta(dv)} WoW`, {
          size: 8,
          bold: true,
          color: tone === "good" ? C.green600 : tone === "bad" ? C.red600 : C.gray500,
        });
      }

      if (t) {
        const on = v != null && v >= t.floor;
        c.chip(x + 188, y + 7.6, 65.9, 16.2, on ? "ON TARGET" : "BELOW TARGET", on ? "good" : "bad");
        const targetY = y + (compact ? 24.5 : 28.7);
        c.text(x + 1.1, targetY, 117.2, 10.3, `TARGET  ${targetLabel(k, t)}`, { size: 8, bold: true, color: C.gray700 });
        const gap = v == null ? null : t.floor - v;
        c.text(x + 119.4, targetY, 134.5, 10.3, gap == null ? "" : gap <= 0 ? "At / above floor" : `−${k.delta(gap)} to floor`, {
          size: 8,
          bold: true,
          color: gap != null && gap > 0 ? C.red600 : C.green600,
          align: "END",
        });
      }

      const trendY = y + (compact ? 37.5 : 50.5);
      trend.forEach((w, j) => {
        const tv = s[k.key][j];
        const last = j === trend.length - 1;
        c.text(x + 1.1 + j * 81, trendY, last ? 92.9 : 80, 9.7, `${monDay(w.start)}   ${tv == null ? "—" : k.fmt(tv)}`, {
          size: 7,
          bold: last,
          color: last ? C.gray900 : C.gray500,
        });
      });
    });
  });

  c.text(27.5, 380.2, 75, 10.8, "DISTRICT TAKEAWAY", { size: 7, bold: true, color: C.red700 });
  c.text(103, 380.2, 560, 10.8, productivityTakeaway(d), { size: 7, color: C.gray700 });
  c.text(640, 394.2, 53.4, 7, `${page + 1} / ${pages}`, { size: 6, color: C.gray500, align: "END" });

  return [...newSlide(at), ...c.requests];
}

/**
 * Every sales slide, then every productivity slide — the deck's order — as one
 * request list per slide (so callers can send them in batches), inserted from
 * `startIndex` on using `layoutId`.
 */
export function wbrSalesAndProductivity(wk: WbrWeek, startIndex: number, layoutId: string, runId: string): SlidesRequest[][] {
  const n = wk.districts.length;
  const at = (kind: "s" | "p", i: number, offset: number): Placement => ({
    slideId: `${WBR_SLIDE_PREFIX}${runId}${kind}${i}`,
    insertionIndex: startIndex + offset,
    layoutId,
  });
  return [
    ...wk.districts.map((d, i) => salesSlide(wk, d, i, n, at("s", i, i))),
    ...wk.districts.map((d, i) => productivitySlide(wk, d, i, n, at("p", i, n + i))),
  ];
}
