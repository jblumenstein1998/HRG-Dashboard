/**
 * Native PowerPoint line charts (DrawingML chart parts), styled like the
 * dashboard's Recharts trend charts: a 2pt gray-900 line with small dots,
 * dashed gray horizontal gridlines, gray-400 axis labels and no tick marks.
 *
 * A real chart part rather than drawn shapes, so PowerPoint and Google Slides
 * render it as vectors at any zoom. The data is carried as literals (no
 * embedded workbook): the chart shows and prints normally; only PowerPoint's
 * "Edit Data" has nothing to open.
 */

import { FONT } from "@/lib/wbr/draw";

export type ChartSeries = {
  name: string;
  values: (number | null)[];
  color: string;
  /** Line width in points. */
  width?: number;
  dash?: boolean;
  markers?: boolean;
  /** Label the last non-null point with its value. */
  labelLast?: boolean;
};

export type ChartSpec = {
  categories: string[];
  series: ChartSeries[];
  /** Excel number format for the axis and labels, e.g. `"$"#,##0.0,"K"`. */
  format: string;
};

const hex = (c: string) => c.replace("#", "").toUpperCase();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const solid = (c: string) => `<a:solidFill><a:srgbClr val="${hex(c)}"/></a:solidFill>`;
const txPr = (size: number, color: string, bold = false) =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${Math.round(size * 100)}" b="${bold ? 1 : 0}">${solid(color)}` +
  `<a:latin typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;

/** 1, 2, 2.5 or 5 × a power of ten — the steps an axis reads easily. */
function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/**
 * Axis bounds: about four gridlines around the data, not forced to zero —
 * weekly figures move a few percent, and from zero every line is flat. Top gets
 * room for the last point's label.
 */
export function axisRange(values: number[]): { min: number; max: number; step: number } {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  const step = niceStep(span / 3);
  const min = Math.max(0, Math.floor((lo - span * 0.15) / step) * step);
  const max = Math.ceil((hi + span * 0.25) / step) * step;
  return { min, max, step };
}

export function chartXml(spec: ChartSpec): string {
  const n = spec.categories.length;
  const all = spec.series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const range = all.length ? axisRange(all) : null;

  const cat =
    `<c:cat><c:strLit><c:ptCount val="${n}"/>` +
    spec.categories.map((c, i) => `<c:pt idx="${i}"><c:v>${esc(c)}</c:v></c:pt>`).join("") +
    `</c:strLit></c:cat>`;

  const ser = spec.series
    .map((s, k) => {
      const w = Math.round((s.width ?? 2) * 12700);
      const line = `<a:ln w="${w}" cap="rnd">${solid(s.color)}${s.dash ? `<a:prstDash val="dash"/>` : ""}<a:round/></a:ln>`;
      const marker = s.markers
        ? `<c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr>${solid(s.color)}<a:ln w="9525">${solid("#ffffff")}</a:ln></c:spPr></c:marker>`
        : `<c:marker><c:symbol val="none"/></c:marker>`;
      let last = -1;
      s.values.forEach((v, i) => {
        if (v != null) last = i;
      });
      const off = `<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>`;
      const dLbls =
        s.labelLast && last >= 0
          ? `<c:dLbls><c:dLbl><c:idx val="${last}"/><c:numFmt formatCode="${esc(spec.format)}" sourceLinked="0"/>` +
            `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(8, s.color, true)}<c:dLblPos val="t"/>` +
            `<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbl>` +
            `${off}</c:dLbls>`
          : "";
      const val =
        `<c:val><c:numLit><c:formatCode>${esc(spec.format)}</c:formatCode><c:ptCount val="${n}"/>` +
        s.values.map((v, i) => (v == null ? "" : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join("") +
        `</c:numLit></c:val>`;
      return (
        `<c:ser><c:idx val="${k}"/><c:order val="${k}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>` +
        `<c:spPr>${line}</c:spPr>${marker}${dLbls}${cat}${val}<c:smooth val="0"/></c:ser>`
      );
    })
    .join("");

  const scaling = range
    ? `<c:scaling><c:orientation val="minMax"/><c:max val="${range.max}"/><c:min val="${range.min}"/></c:scaling>`
    : `<c:scaling><c:orientation val="minMax"/></c:scaling>`;

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>` +
    `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:marker val="1"/><c:axId val="5001"/><c:axId val="5002"/></c:lineChart>` +
    `<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>` +
    `<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>` +
    `<c:spPr><a:ln w="9525">${solid("#e5e7eb")}</a:ln></c:spPr>${txPr(7, "#9ca3af")}` +
    `<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="5002"/>${scaling}<c:delete val="0"/><c:axPos val="l"/>` +
    `<c:majorGridlines><c:spPr><a:ln w="6350">${solid("#e5e7eb")}<a:prstDash val="dash"/></a:ln></c:spPr></c:majorGridlines>` +
    `<c:numFmt formatCode="${esc(spec.format)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr(7, "#9ca3af")}` +
    `<c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/>${range ? `<c:majorUnit val="${range.step}"/>` : ""}</c:valAx>` +
    `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(7, "#9ca3af")}</c:chartSpace>`
  );
}
