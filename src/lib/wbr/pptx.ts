/**
 * Splices drawn slides into a PowerPoint template.
 *
 * The template is an ordinary .pptx (the WBR deck exported from Google Slides).
 * Slides the caller marks as replaceable are taken out — with their notes,
 * comments and any images nothing else uses — and the new slides go in where
 * the first of them stood. Everything else in the file is left byte for byte,
 * so the hand-built slides come through exactly as they were exported.
 *
 * New slides are written as plain DrawingML shapes (rect / roundRect / text
 * box), measured in points on a 720×405 page.
 */

import JSZip from "jszip";
import { C, FONT, type Canvas, type Shape } from "@/lib/wbr/draw";
import { chartXml } from "@/lib/wbr/pptxChart";

const EMU = 12700; // per point
const REL_SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const CT_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const REL_CHART = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
const CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";

const emu = (pt: number) => Math.round(pt * EMU);
const hex = (c: string) => c.replace("#", "").toUpperCase();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** All the visible text on a slide, runs joined — for recognising slides by what they say. */
export const slideText = (xml: string) =>
  [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
    .map((m) => m[1])
    .join("")
    .replace(/&amp;/g, "&")
    .toUpperCase();

// ── Slide XML ────────────────────────────────────────────────────────────────

const xfrm = (s: { x: number; y: number; w: number; h: number }) =>
  `<a:xfrm><a:off x="${emu(s.x)}" y="${emu(s.y)}"/><a:ext cx="${emu(s.w)}" cy="${emu(s.h)}"/></a:xfrm>`;
const fill = (c: string) => `<a:solidFill><a:srgbClr val="${hex(c)}"/></a:solidFill>`;

/** A roundRect's corner as a fixed radius: the adjust value is a share (of 100000) of the shorter side. */
const avLst = (s: { w: number; h: number; round?: boolean; radius?: number }) =>
  s.round && s.radius != null
    ? `<a:avLst><a:gd name="adj" fmla="val ${Math.round(Math.min(50000, (s.radius / Math.min(s.w, s.h)) * 100000))}"/></a:avLst>`
    : `<a:avLst/>`;

/** `chartRel` is the slide relationship id of this shape's chart part, for chart shapes. */
/** Clips a convex polygon to the half-plane where f(pt) >= 0 (Sutherland–Hodgman, one edge). */
function clip(poly: [number, number][], f: (p: [number, number]) => number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

/** "/" stripes across a w×h box: bands between the lines x + (h − y) = k and k + width, every width + gap. */
function stripePaths(w: number, h: number, width: number, gap: number): string {
  const rect: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]];
  const paths: string[] = [];
  for (let k = -width; k < w + h; k += width + gap) {
    const band = clip(clip(rect, ([x, y]) => x + (h - y) - k), ([x, y]) => k + width - (x + (h - y)));
    if (band.length < 3) continue;
    const pt = ([x, y]: [number, number]) => `<a:pt x="${emu(x)}" y="${emu(y)}"/>`;
    paths.push(
      `<a:path w="${emu(w)}" h="${emu(h)}"><a:moveTo>${pt(band[0])}</a:moveTo>` +
        band.slice(1).map((p) => `<a:lnTo>${pt(p)}</a:lnTo>`).join("") +
        `<a:close/></a:path>`,
    );
  }
  return paths.join("");
}

function shapeXml(s: Shape, id: number, chartRel?: string): string {
  if (s.kind === "stripes") {
    return (
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Stripes ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr>${xfrm(s)}<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/>` +
      `<a:pathLst>${stripePaths(s.w, s.h, s.width, s.gap)}</a:pathLst></a:custGeom>${fill(s.color)}<a:ln><a:noFill/></a:ln></p:spPr></p:sp>`
    );
  }
  if (s.kind === "chart") {
    return (
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
      `<p:xfrm><a:off x="${emu(s.x)}" y="${emu(s.y)}"/><a:ext cx="${emu(s.w)}" cy="${emu(s.h)}"/></p:xfrm>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
      `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${chartRel}"/></a:graphicData></a:graphic></p:graphicFrame>`
    );
  }
  if (s.kind === "box") {
    const ln = s.line ? `<a:ln w="${emu(0.75)}">${fill(s.line)}</a:ln>` : `<a:ln><a:noFill/></a:ln>`;
    return (
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr>${xfrm(s)}<a:prstGeom prst="${s.round ? "roundRect" : "rect"}">${avLst(s)}</a:prstGeom>${fill(s.fill)}${ln}</p:spPr></p:sp>`
    );
  }
  const st = s.style;
  const anchor = st.valign === "TOP" ? "t" : st.valign === "BOTTOM" ? "b" : "ctr";
  const algn = st.align === "CENTER" ? "ctr" : st.align === "END" ? "r" : "l";
  const rPr =
    `<a:rPr lang="en-US" sz="${Math.round(st.size * 100)}" b="${st.bold ? 1 : 0}" dirty="0">${fill(st.color)}` +
    `<a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface="${FONT}"/><a:sym typeface="${FONT}"/></a:rPr>`;
  // Each line its own paragraph, with the master's bullets and spacing switched
  // off — a plain text box inherits the master's "other" text style otherwise.
  const paras = s.content
    .split("\n")
    .map(
      (line) =>
        `<a:p><a:pPr marL="0" indent="0" algn="${algn}"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc>` +
        `<a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft><a:buNone/></a:pPr>` +
        (line ? `<a:r>${rPr}<a:t>${esc(line)}</a:t></a:r>` : "") +
        `<a:endParaRPr lang="en-US" sz="${Math.round(st.size * 100)}" dirty="0"/></a:p>`,
    )
    .join("");
  // Google Slides' text-box insets (0.1" sides, 0.05" top and bottom) — which
  // the layouts were measured against — are also PowerPoint's defaults.
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(s)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${anchor}" rtlCol="0"><a:noAutofit/></a:bodyPr>` +
    `<a:lstStyle/>${paras}</p:txBody></p:sp>`
  );
}

/** A whole slide: gray-50 background, the layout's own graphics hidden, then the shapes. */
function slideXml(canvas: Canvas, chartRels: Map<Shape, string>): string {
  const shapes = canvas.shapes.map((s, i) => shapeXml(s, i + 2, chartRels.get(s))).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" showMasterSp="0">` +
    `<p:cSld><p:bg><p:bgPr>${fill(C.gray50)}<a:effectLst/></p:bgPr></p:bg><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
}

// ── Package surgery ──────────────────────────────────────────────────────────

type Rel = { id: string; type: string; target: string };

const parseRels = (xml: string): Rel[] =>
  [...xml.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => {
    const attr = (name: string) => m[0].match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "";
    return { id: attr("Id"), type: attr("Type"), target: attr("Target") };
  });

/** "../media/image1.png" relative to "ppt/slides/" → "ppt/media/image1.png". */
function resolve(base: string, target: string): string {
  const parts = base.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

const relsPath = (part: string) => {
  const i = part.lastIndexOf("/");
  return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
};

async function read(zip: JSZip, path: string): Promise<string> {
  const f = zip.file(path);
  if (!f) throw new Error(`Template is missing ${path}`);
  return f.async("string");
}

export type TemplateSlide = { index: number; path: string; text: string };

/**
 * Builds the deck: `template` with every slide `replace` picks swapped out for
 * `slides`, inserted where the first picked slide was. Throws if none is picked
 * — a template that has lost its data slides would otherwise come back as a
 * deck with none at all.
 */
export async function spliceDeck(
  template: Uint8Array,
  replace: (s: TemplateSlide) => boolean,
  slides: Canvas[],
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  let pres = await read(zip, "ppt/presentation.xml");
  let presRels = await read(zip, "ppt/_rels/presentation.xml.rels");
  let types = await read(zip, "[Content_Types].xml");
  const rels = parseRels(presRels);

  const order = [...pres.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"[^>]*\br:id="([^"]+)"[^>]*\/>/g)].map((m) => ({
    tag: m[0],
    id: Number(m[1]),
    path: resolve("ppt", rels.find((r) => r.id === m[2])!.target),
    rId: m[2],
  }));
  const picked: (typeof order)[number][] = [];
  for (const [index, s] of order.entries()) {
    if (replace({ index, path: s.path, text: slideText(await read(zip, s.path)) })) picked.push(s);
  }
  if (!picked.length) throw new Error("The template has no sales or productivity slides to replace.");

  // The new slides borrow the first replaced slide's layout. Its graphics are
  // hidden (showMasterSp="0"), but every slide must name one.
  const firstRels = parseRels(await read(zip, relsPath(picked[0].path)));
  const layout = firstRels.find((r) => r.type.endsWith("/slideLayout"));
  if (!layout) throw new Error(`Couldn't find the layout of ${picked[0].path}`);
  const layoutPath = resolve(picked[0].path.replace(/\/[^/]+$/, ""), layout.target);

  // ── Take the old slides out ──
  const dropped = new Set<string>();
  for (const s of picked) {
    const own = parseRels(await read(zip, relsPath(s.path)));
    for (const r of own) {
      // Notes and comments belong to this slide alone; images may be shared
      // (the logo is on most slides), so those are swept up afterwards.
      if (r.type.endsWith("/notesSlide") || r.type.endsWith("/comments")) {
        const p = resolve(s.path.replace(/\/[^/]+$/, ""), r.target);
        zip.remove(p);
        zip.remove(relsPath(p));
        dropped.add(p);
      }
    }
    zip.remove(s.path);
    zip.remove(relsPath(s.path));
    dropped.add(s.path);
    presRels = presRels.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${s.rId}"[^>]*/>`), "");
  }
  for (const p of dropped) types = types.replace(new RegExp(`<Override\\b[^>]*PartName="/${p}"[^>]*/>`), "");

  // Media no remaining part points at.
  const used = new Set<string>();
  for (const name of Object.keys(zip.files)) {
    if (!name.endsWith(".rels")) continue;
    const base = name.replace(/_rels\/[^/]*\.rels$/, "").replace(/\/$/, "");
    for (const r of parseRels(await zip.file(name)!.async("string"))) used.add(resolve(base, r.target));
  }
  for (const name of Object.keys(zip.files)) {
    if (name.startsWith("ppt/media/") && !used.has(name)) zip.remove(name);
  }

  // ── Put the new ones in ──
  let nextFile = Math.max(...Object.keys(zip.files).map((n) => Number(n.match(/^ppt\/slides\/slide(\d+)\.xml$/)?.[1] ?? 0))) + 1;
  // Slide ids must be unique and are never reused, so count on from the highest.
  let nextId = Math.max(...order.map((s) => s.id)) + 1;
  const layoutRel = `../slideLayouts/${layoutPath.split("/").pop()}`;
  const tags: string[] = [];
  let nextChart = 1;
  for (const [k, canvas] of slides.entries()) {
    const path = `ppt/slides/slide${nextFile++}.xml`;
    const rId = `rIdWbr${k + 1}`;
    // Each chart shape becomes its own chart part, related from this slide.
    const chartRels = new Map<Shape, string>();
    let extraRels = "";
    for (const s of canvas.shapes) {
      if (s.kind !== "chart") continue;
      const name = `chartWbr${nextChart++}.xml`;
      const cr = `rIdChart${chartRels.size + 1}`;
      chartRels.set(s, cr);
      zip.file(`ppt/charts/${name}`, chartXml(s.spec));
      types = types.replace("</Types>", `<Override ContentType="${CT_CHART}" PartName="/ppt/charts/${name}"/></Types>`);
      extraRels += `<Relationship Id="${cr}" Type="${REL_CHART}" Target="../charts/${name}"/>`;
    }
    zip.file(path, slideXml(canvas, chartRels));
    zip.file(
      relsPath(path),
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="${layoutRel}"/>${extraRels}</Relationships>`,
    );
    presRels = presRels.replace("</Relationships>", `<Relationship Id="${rId}" Type="${REL_SLIDE}" Target="${path.replace("ppt/", "")}"/></Relationships>`);
    types = types.replace("</Types>", `<Override ContentType="${CT_SLIDE}" PartName="/${path}"/></Types>`);
    tags.push(`<p:sldId id="${nextId++}" r:id="${rId}"/>`);
  }

  // The new run of slides takes the first old slide's place in the order; the
  // rest of the old ones just go.
  pres = pres.replace(picked[0].tag, tags.join(""));
  for (const s of picked.slice(1)) pres = pres.replace(s.tag, "");

  zip.file("ppt/presentation.xml", pres);
  zip.file("ppt/_rels/presentation.xml.rels", presRels);
  zip.file("[Content_Types].xml", types);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
