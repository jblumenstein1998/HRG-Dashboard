/**
 * A tiny drawing kit: rectangles, rounded cards and text boxes, positioned in
 * points on the 720×405 page. A Canvas only records shapes; lib/wbr/pptx.ts
 * turns them into PowerPoint slide XML.
 *
 * Colours are the dashboard's Tailwind palette, so a slide reads like a
 * screenshot of the tab it summarises.
 */

/** Tailwind (v3 hex equivalents) — the classes the dashboard actually uses. */
export const C = {
  white: "#ffffff",
  gray50: "#f9fafb",
  gray100: "#f3f4f6",
  gray200: "#e5e7eb",
  gray300: "#d1d5db",
  gray400: "#9ca3af",
  gray500: "#6b7280",
  gray600: "#4b5563",
  gray700: "#374151",
  gray800: "#1f2937",
  gray900: "#111827",
  green50: "#f0fdf4",
  green600: "#16a34a",
  yellow50: "#fefce8",
  yellow600: "#ca8a04",
  red50: "#fef2f2",
  red600: "#dc2626",
  red700: "#b91c1c",
} as const;

export const FONT = "Geist";

export type TextStyle = {
  size: number;
  color: string;
  bold?: boolean;
  align?: "START" | "CENTER" | "END";
  valign?: "TOP" | "MIDDLE" | "BOTTOM";
};

export type Shape =
  | { kind: "box"; x: number; y: number; w: number; h: number; fill: string; line?: string; round?: boolean }
  | { kind: "text"; x: number; y: number; w: number; h: number; content: string; style: TextStyle };

/** One slide's shapes, in drawing order (later ones on top). */
export class Canvas {
  readonly shapes: Shape[] = [];

  /** A filled shape; `line` adds a 0.75pt outline, otherwise none. */
  box(x: number, y: number, w: number, h: number, fill: string, opts: { line?: string; round?: boolean } = {}) {
    this.shapes.push({ kind: "box", x, y, w, h, fill, ...opts });
  }

  /** A transparent text box. */
  text(x: number, y: number, w: number, h: number, content: string, style: TextStyle) {
    // Text boxes keep ~7pt of inset each side, which wraps "-10.9%" inside a
    // 30pt chip. Centred text is widened symmetrically so it keeps its centre
    // but gets the room; the shape underneath sets the visible size anyway.
    if (style.align === "CENTER") {
      x -= 10;
      w += 20;
    }
    if (content) this.shapes.push({ kind: "text", x, y, w, h, content, style });
  }

  /** A rounded chip with centred text — the WoW/YoY and status pills. */
  chip(x: number, y: number, w: number, h: number, content: string, tone: Tone, size = 7) {
    const t = TONES[tone];
    this.box(x, y, w, h, t.bg, { round: true });
    this.text(x, y, w, h, content, { size, bold: true, color: t.fg, align: "CENTER" });
  }

  /** A hairline — drawn as a thin rectangle, which renders crisper than a line. */
  rule(x: number, y: number, w: number, h: number, color: string) {
    this.box(x, y, w, h, color);
  }
}

export type Tone = "good" | "warn" | "bad" | "neutral";
export const TONES: Record<Tone, { bg: string; fg: string }> = {
  good: { bg: C.green50, fg: C.green600 },
  warn: { bg: C.yellow50, fg: C.yellow600 },
  bad: { bg: C.red50, fg: C.red600 },
  neutral: { bg: C.gray100, fg: C.gray500 },
};

/** Sign of a change as a tone; zero and unknown are neutral. */
export const toneOf = (v: number | null): Tone => (v == null || Math.abs(v) < 0.05 ? "neutral" : v > 0 ? "good" : "bad");
