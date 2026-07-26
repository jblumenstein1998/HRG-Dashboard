// Presentation for chat answers, built in code rather than asked of the model.
//
// Every figure a user sees should come from here. The model decides which tool
// to call; it does not get to decide what the number is or how it reads. That
// removes two whole classes of failure at once: a fabricated value can't reach
// the card because the card renders the tool's own output, and the formatting
// rules below can't be violated because they're no longer instructions.
//
// Formatting matches HRG's house conventions: whole dollars for sales totals,
// two decimals for rates and per-unit figures, negatives in parentheses rather
// than with a minus sign, and MM/DD/YYYY dates.

export type DisplayRow = { label: string; value: string };

export type MetricDisplay = {
  title: string;
  subtitle?: string;
  rows: DisplayRow[];
  // Shown beneath the rows, for caveats that must travel with the number —
  // incomplete ranges above all.
  note?: string;
};

const NO_DATA = "—";

/**
 * Picks the display blocks out of a set of tool outputs. Tool results are typed
 * per-tool, so callers that just want "whatever cards this turn produced" get a
 * runtime check instead of a union of every tool's shape.
 */
export function extractDisplays(outputs: readonly unknown[]): MetricDisplay[] {
  return outputs.filter(isMetricDisplayCarrier).map(o => o.display);
}

/** Single-output form, for rendering one tool part at a time. */
export function getDisplay(output: unknown): MetricDisplay | null {
  return isMetricDisplayCarrier(output) ? output.display : null;
}

function isMetricDisplayCarrier(o: unknown): o is { display: MetricDisplay } {
  if (typeof o !== "object" || o === null || !("display" in o)) return false;
  const d = (o as { display: unknown }).display;
  return (
    typeof d === "object" &&
    d !== null &&
    typeof (d as MetricDisplay).title === "string" &&
    Array.isArray((d as MetricDisplay).rows)
  );
}

/** Whole dollars, thousands-separated: 9270.43 -> "$9,270". */
export function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return NO_DATA;
  const rounded = Math.round(Math.abs(n));
  const body = "$" + rounded.toLocaleString("en-US");
  return n < 0 ? `(${body})` : body;
}

/** Dollars to the cent: 81.1 -> "$81.10". */
export function money2(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return NO_DATA;
  const body =
    "$" +
    Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return n < 0 ? `(${body})` : body;
}

/** Bare number to two decimals: 4.7312 -> "4.73". */
export function num2(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return NO_DATA;
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${body})` : body;
}

/** Whole count: 1143 -> "1,143". */
export function count(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return NO_DATA;
  return Math.round(n).toLocaleString("en-US");
}

/** Percent change. Positive keeps a leading +, negative goes in parentheses. */
export function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return NO_DATA;
  const body = Math.abs(n).toFixed(2) + "%";
  if (n < 0) return `(${body})`;
  return `+${body}`;
}

/** Minutes:seconds from a raw seconds value: 154 -> "2:34". */
export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return NO_DATA;
  const total = Math.round(Math.abs(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** ISO date to house format: "2026-07-22" -> "07/22/2026". */
export function usDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/** Inclusive range, collapsing a single day to just that day. */
export function usRange(start: string, end: string): string {
  return start === end ? usDate(start) : `${usDate(start)} – ${usDate(end)}`;
}

/**
 * Caveat text for a total that is missing days outright. Kept here so the
 * wording is identical on every surface and can't be softened in prose.
 */
export function incompleteNote(missingDates: string[]): string | undefined {
  if (!missingDates.length) return undefined;
  const shown = missingDates.slice(0, 5).map(usDate).join(", ");
  const more = missingDates.length > 5 ? ` and ${missingDates.length - 5} more` : "";
  return `Incomplete: no data for ${shown}${more}. The figure above covers only the days that reported and is lower than the true total.`;
}
