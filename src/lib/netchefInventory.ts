/**
 * Daily critical-item and weekly full inventory counts, per store, from
 * Net-Chef's Daily Inventory Counts report.
 *
 * Feeds the Quality Director's inventory criteria. Josh's goal (2026-10-28),
 * replacing the doc's 0/1/2 rating:
 *
 *   50%   a full count every week, and ≥95% of AM + PM critical counts
 *   100%  a full count every week, and 100% of AM + PM critical counts
 *
 * ── The report ───────────────────────────────────────────────────────────────
 *
 * `/resource/inventory/dailyinventorycounts/location/details` returns one row
 * per product counted, stamped with when it was entered. `inventoryType` is
 * `FINAL` for a full count ("Final for Post", ~200 items) and `TEMPLATE` for a
 * critical-item count (~14 items), whose label names the template. Every store
 * has an AM and a PM template, named differently from store to store — "HRG AM
 * CRITICAL", "Big 6 CC-AM", "HRG Critical PM Count" — so they are told apart by
 * the AM / PM in the name. Hampton also runs a MID count, which is not required
 * and is ignored.
 *
 * It ignores `locationIdFilter` and answers for the location the session chose,
 * so every store is fetched on its own login (ncPostAtLocation). The
 * consolidated variant covers only the five original Tennessee stores.
 *
 * ── Days ─────────────────────────────────────────────────────────────────────
 *
 * A critical count belongs to the business day it was entered on, which ends at
 * 2:15 AM (businessDay.ts) — a PM count entered at 12:30 AM is the night before.
 *
 * A full count belongs to the week it closes: the one entered the Monday after
 * a Monday–Sunday week counts that Sunday's stock, which is also how Net-Chef
 * files it (a query for a period returns the Monday after it ends, not the
 * Monday it began). It must be entered **on that Monday** — Josh's rule — by
 * calendar date, so 12:17 AM Monday is on time and 11:53 PM Sunday or any time
 * Tuesday is late. A late count is still shown, as late.
 *
 * **Mondays are excused from critical counts** (Josh, 2026-10-28). Every store
 * skips both on the full-count day — the full count covers the critical items —
 * and counting them put the 95% threshold out of reach for every store: Spring
 * Hill and Springfield missed nothing in P10 but those four Mondays.
 *
 * A week is only judged once its Monday has passed, so a period in progress is
 * never failed for a count that is not due yet.
 */

import { ncPostAtLocation } from "./netchef";
import { BUSINESS_DAY_START_MINUTES } from "./businessDay";

export type CountKind = "AM" | "PM" | "FULL";

type Row = {
  statusDate: string;
  inventoryType: string;
  inventoryTypeLabel: string;
  totalRow?: boolean;
};

export type CriticalDay = {
  date: string;
  /** Entry time ("HH:MM") of the earliest row, or null when not done. */
  am: string | null;
  pm: string | null;
  /** A Monday: the full count stands in for both critical counts. */
  excused: boolean;
};

export type FullCountWeek = {
  weekStart: string;
  weekEnd: string;
  /** The Monday it is due. */
  dueOn: string;
  /** When it was entered ("YYYY-MM-DD HH:MM"), or null. */
  enteredAt: string | null;
  items: number;
  onTime: boolean;
  /** False while the Monday it is due has not passed. */
  judged: boolean;
};

export type StoreInventoryCounts = {
  days: CriticalDay[];
  weeks: FullCountWeek[];
  /** Done slots ÷ (non-Monday days × 2), as a percentage; null with none in the window. */
  criticalPct: number | null;
  criticalDone: number;
  criticalSlots: number;
  /** 1 when every judged week had an on-time full count, 0 if any did not, null if none judged. */
  fullCountsOnTime: number | null;
};

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isMonday(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

const toMDY = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
};

/** "10/26/2026 09:52:31" → { date: "2026-10-26", minutes, hhmm }. */
function parseStamp(s: string): { date: string; minutes: number; hhmm: string } | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  return { date: `${m[3]}-${m[1]}-${m[2]}`, minutes: Number(m[4]) * 60 + Number(m[5]), hhmm: `${m[4]}:${m[5]}` };
}

function kindOf(r: Row): CountKind | null {
  if (r.inventoryType === "FINAL") return "FULL";
  if (/\bPM\b/i.test(r.inventoryTypeLabel)) return "PM";
  if (/\bAM\b/i.test(r.inventoryTypeLabel)) return "AM";
  return null;
}

/**
 * One store's counts for a window.
 *
 * `start`..`end` are the days scored (inclusive). `today` decides which weeks'
 * Mondays have passed. The report is asked for a week past `end`, so the full
 * count closing the window's last week is in hand.
 */
export async function getStoreInventoryCounts(
  netchefLocationId: number,
  start: string,
  end: string,
  today: string,
): Promise<StoreInventoryCounts> {
  const json = (await ncPostAtLocation(netchefLocationId, "/resource/inventory/dailyinventorycounts/location/details", {
    extraCriteriaMap: { startDate: toMDY(start), endDate: toMDY(addDays(end, 7)), isConsolidated: false },
    pagingInfo: { page: 1, start: 0, limit: 100000 },
  })) as { rows?: Row[] };
  const rows = (json.rows ?? []).filter((r) => !r.totalRow);

  // Critical counts by business day; full counts by calendar entry date.
  const critical = new Map<string, string>(); // `${date}|AM` → earliest hh:mm
  const fullByDate = new Map<string, { first: string; items: number }>();
  for (const r of rows) {
    const kind = kindOf(r);
    const stamp = parseStamp(r.statusDate);
    if (!kind || !stamp) continue;
    if (kind === "FULL") {
      const cur = fullByDate.get(stamp.date) ?? { first: stamp.hhmm, items: 0 };
      cur.items += 1;
      if (stamp.hhmm < cur.first) cur.first = stamp.hhmm;
      fullByDate.set(stamp.date, cur);
    } else {
      const day = stamp.minutes < BUSINESS_DAY_START_MINUTES ? addDays(stamp.date, -1) : stamp.date;
      const key = `${day}|${kind}`;
      const prev = critical.get(key);
      if (!prev || stamp.hhmm < prev) critical.set(key, stamp.hhmm);
    }
  }

  const days: CriticalDay[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    days.push({
      date: d,
      am: critical.get(`${d}|AM`) ?? null,
      pm: critical.get(`${d}|PM`) ?? null,
      excused: isMonday(d),
    });
  }
  const required = days.filter((d) => !d.excused);
  const criticalSlots = required.length * 2;
  const criticalDone = required.reduce((n, d) => n + (d.am ? 1 : 0) + (d.pm ? 1 : 0), 0);

  // Monday–Sunday weeks whose Sunday falls in the window.
  const weeks: FullCountWeek[] = [];
  for (let weekStart = start; addDays(weekStart, 6) <= end; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 6);
    const dueOn = addDays(weekEnd, 1);
    // The first full count entered from that Sunday until the next Sunday —
    // late ones included, so the screen can say "late" rather than "missing".
    let entered: { date: string; first: string; items: number } | null = null;
    for (let d = weekEnd; d < addDays(weekEnd, 7); d = addDays(d, 1)) {
      const f = fullByDate.get(d);
      if (f) { entered = { date: d, ...f }; break; }
    }
    weeks.push({
      weekStart,
      weekEnd,
      dueOn,
      enteredAt: entered ? `${entered.date} ${entered.first}` : null,
      items: entered?.items ?? 0,
      onTime: entered?.date === dueOn,
      judged: dueOn < today,
    });
  }
  const judged = weeks.filter((w) => w.judged);

  return {
    days,
    weeks,
    criticalPct: criticalSlots > 0 ? Math.round((criticalDone / criticalSlots) * 1000) / 10 : null,
    criticalDone,
    criticalSlots,
    fullCountsOnTime: judged.length === 0 ? null : judged.every((w) => w.onTime) ? 1 : 0,
  };
}
