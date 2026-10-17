/**
 * Which business day it is — the one definition every tab shares.
 *
 * HRG's business day ends at 2:15 AM local, PAR's own end of day, not at
 * midnight. PAR exposes no setting for it, but every store's data shows it:
 * each business date carries a handful of tickets closed at exactly 2:15 AM
 * local the next morning (PAR's end-of-day closing out whatever was left open),
 * Central for TN and Eastern for VA alike — measured across five stores and six
 * days in October 2026. So until 2:15 AM, "today" is still the day that just
 * ended, and a store open past midnight keeps its late sales on the day PAR
 * files them under.
 *
 * The date is read in Central for the company as a whole, the convention the
 * app already had; Vercel runs UTC, so the server clock can't be used directly.
 * Pure — no env reads — so client components can import it too.
 */

export const BUSINESS_DAY_START_MINUTES = 2 * 60 + 15;

export const HRG_TIME_ZONE = "America/Chicago";

export type ZonedParts = { y: number; m: number; d: number; hh: number; mm: number };

export function zonedParts(timeZone: string, at: Date = new Date()): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute") };
}

export const isoOf = ({ y, m, d }: { y: number; m: number; d: number }): string =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * The local clock shifted back to the business-day start: the shifted date is
 * the business date, and the shifted time is minutes since the day began.
 */
export function businessParts(timeZone: string = HRG_TIME_ZONE, at: Date = new Date()): ZonedParts {
  return zonedParts(timeZone, new Date(at.getTime() - BUSINESS_DAY_START_MINUTES * 60_000));
}

/** Minutes since local midnight → minutes since the 2:15 AM business-day start. */
export function businessMinutes(minutesOfDay: number): number {
  return (minutesOfDay - BUSINESS_DAY_START_MINUTES + 1440) % 1440;
}

/** Today's business date as "YYYY-MM-DD". */
export function businessDateISO(timeZone: string = HRG_TIME_ZONE): string {
  return isoOf(businessParts(timeZone));
}

/** Today's business date as a local-midnight Date, for date-arithmetic callers. */
export function businessDate(timeZone: string = HRG_TIME_ZONE): Date {
  const { y, m, d } = businessParts(timeZone);
  return new Date(y, m - 1, d);
}
