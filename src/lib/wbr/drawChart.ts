/**
 * Line charts drawn from plain shapes, styled like the dashboard's Recharts
 * trend charts: a 2pt line with dots, the latest value labelled, dashed gray
 * gridlines, gray axis labels, dashed goal lines.
 *
 * Drawn rather than written as PowerPoint chart parts on purpose. Google Slides
 * redraws an imported chart itself and drops the number formats on its labels
 * — a lane time of 4:04, stored as a fraction of a day for m:ss, came out as
 * 0.002824074, and "$74.6K" as 74629.9 (2026-11-02). Shapes and text boxes come
 * through exactly as drawn, in PowerPoint and Google alike, and every label is
 * text we formatted ourselves.
 */

import { C, Canvas } from "@/lib/wbr/draw";

export type LineSeries = {
  name: string;
  values: (number | null)[];
  color: string;
  /** Line width in points. */
  width?: number;
  dash?: boolean;
  markers?: boolean;
  /** Label the last non-null point with its value. */
  labelLast?: boolean;
  /** Colour of that label, when it should read against a goal. */
  labelColor?: string;
};

export type LineChartSpec = {
  categories: string[];
  series: LineSeries[];
  /** Formats axis and point labels — "$74.6K", "4:04", "87%". */
  fmt: (v: number) => string;
  /** Gridline steps to choose from, in the values' own units. */
  steps?: number[];
  /** Axis never goes above this (scores top out at 100). */
  ceiling?: number;
};

/** 1, 2, 2.5 or 5 × a power of ten — the steps an axis reads easily. */
function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/**
 * Axis bounds: about four gridlines around the data, not forced to zero —
 * weekly figures move a few percent, and from zero every line is flat. Top gets
 * room for the last point's label. Data that never goes negative keeps a floor
 * at zero (variance does go negative).
 */
export function axisRange(values: number[], steps?: number[]): { min: number; max: number; step: number } {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  const step = steps?.length ? (steps.find((s) => s >= span / 4) ?? steps[steps.length - 1]) : niceStep(span / 3);
  const floor = Math.floor((lo - span * 0.15) / step) * step;
  const min = lo >= 0 ? Math.max(0, floor) : floor;
  const max = Math.ceil((hi + span * 0.25) / step) * step;
  return { min, max, step };
}

/** Draws the chart into the box (x, y, w, h), axis labels included. */
export function lineChart(c: Canvas, x: number, y: number, w: number, h: number, spec: LineChartSpec) {
  const all = spec.series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (!all.length) {
    c.text(x, y, w, h, "No data", { size: 7.5, color: C.gray400, align: "CENTER" });
    return;
  }
  const r = axisRange(all, spec.steps);
  const max = spec.ceiling != null ? Math.min(r.max, spec.ceiling) : r.max;
  const min = r.min;

  // Plot area: room on the left for the axis labels, below for the weeks, above for a label.
  const axisW = 34;
  const left = x + axisW;
  const right = x + w - 6;
  const top = y + 6;
  const bottom = y + h - 13;
  const yOf = (v: number) => bottom - ((v - min) / (max - min || 1)) * (bottom - top);
  const n = spec.categories.length;
  const xOf = (i: number) => left + ((i + 0.5) * (right - left)) / n;

  // Gridlines and value-axis labels.
  for (let v = min; v <= max + r.step * 1e-6; v += r.step) {
    const gy = yOf(v);
    c.path([[left, gy], [right, gy]], C.gray200, { width: 0.5, dash: true });
    c.text(x - 4, gy - 5, axisW, 10, spec.fmt(Number(v.toPrecision(12))), { size: 6, color: C.gray400, align: "END", noWrap: true });
  }
  c.path([[left, bottom], [right, bottom]], C.gray200, { width: 0.75 });

  // Week labels.
  spec.categories.forEach((cat, i) => {
    const cw = (right - left) / n;
    c.text(xOf(i) - cw / 2 - 4, bottom + 1, cw + 8, 10, cat, { size: 6, color: C.gray400, align: "CENTER", noWrap: true });
  });

  // Series: goal lines first, so the store's line sits on top.
  const order = [...spec.series].sort((a, b) => Number(!!a.markers) - Number(!!b.markers));
  for (const s of order) {
    // A gap in the data breaks the line rather than bridging it.
    let run: [number, number][] = [];
    const flush = () => {
      if (run.length > 1) c.path(run, s.color, { width: s.width ?? 2, dash: s.dash });
      run = [];
    };
    s.values.forEach((v, i) => {
      if (v == null) return flush();
      run.push([xOf(i), yOf(v)]);
    });
    flush();

    if (s.markers) {
      s.values.forEach((v, i) => {
        if (v == null) return;
        c.dot(xOf(i), yOf(v), 2.6, s.color, { line: C.white, lineWidth: 0.9 });
      });
    }

    if (s.labelLast) {
      let last = -1;
      s.values.forEach((v, i) => {
        if (v != null) last = i;
      });
      if (last >= 0) {
        const v = s.values[last]!;
        const px = xOf(last);
        const py = yOf(v);
        // On the open side of the point: below it when the line arrives from
        // above, above it otherwise — and never off the plot.
        const prev = last > 0 ? s.values[last - 1] : null;
        const fromAbove = prev != null && yOf(prev) < py;
        let ly = fromAbove ? py + 5 : py - 16;
        if (ly < top - 4) ly = py + 5;
        if (ly + 11 > bottom) ly = py - 16;
        const text = spec.fmt(v);
        const tw = text.length * 4.3 + 6;
        // A white backing so a gridline or goal line under it can't cut through the figure.
        c.box(px - tw / 2, ly, tw, 11, C.white, { round: true, radius: 2 });
        c.text(px - tw / 2 - 6, ly, tw + 12, 11, text, { size: 7.5, bold: true, color: s.labelColor ?? s.color, align: "CENTER", noWrap: true });
      }
    }
  }
}
