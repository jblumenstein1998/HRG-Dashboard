/**
 * Weekly full inventory counts, per store, from Net-Chef's Daily Inventory Counts
 * report.
 *
 * Feeds the Quality Director's full-count criterion: a full count every week, at
 * both threshold and target (Josh, 2026-10-28).
 *
 * ── The report ───────────────────────────────────────────────────────────────
 *
 * `/resource/inventory/dailyinventorycounts/location/details` returns one row
 * per product counted, stamped with when it was entered. `inventoryType` is
 * `FINAL` for a full count ("Final for Post", ~200 items). The report also
 * carries `TEMPLATE` rows for critical-item counts, which HRG stopped requiring
 * on 2026-11-04 and which are ignored here.
 *
 * It ignores `locationIdFilter` and answers for the location the session chose,
 * so every store is fetched on its own login (ncPostAtLocation).
 *
 * ── Weeks ────────────────────────────────────────────────────────────────────
 *
 * A full count belongs to the week it closes: the one entered the Monday after
 * a Monday–Sunday week counts that Sunday's stock, which is also how Net-Chef
 * files it (a query for a period returns the Monday after it ends, not the
 * Monday it began). It must be entered **on that Monday** — Josh's rule — by
 * calendar date, so 12:17 AM Monday is on time and 11:53 PM Sunday or any time
 * Tuesday is late. A late count is still shown, as late.
 *
 * A week is only judged once its Monday has passed, so a period in progress is
 * never failed for a count that is not due yet.
 */

import { ncPostAtLocation } from "./netchef";

type Row = {
  statusDate: string;
  inventoryType: string;
  totalRow?: boolean;
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
  weeks: FullCountWeek[];
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

/** "10/26/2026 09:52:31" → { date: "2026-10-26", hhmm: "09:52" }. */
function parseStamp(s: string): { date: string; hhmm: string } | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  return { date: `${m[3]}-${m[1]}-${m[2]}`, hhmm: `${m[4]}:${m[5]}` };
}

/**
 * One store's full counts for a window.
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

  // Full counts by calendar entry date.
  const fullByDate = new Map<string, { first: string; items: number }>();
  for (const r of rows) {
    if (r.inventoryType !== "FINAL") continue;
    const stamp = parseStamp(r.statusDate);
    if (!stamp) continue;
    const cur = fullByDate.get(stamp.date) ?? { first: stamp.hhmm, items: 0 };
    cur.items += 1;
    if (stamp.hhmm < cur.first) cur.first = stamp.hhmm;
    fullByDate.set(stamp.date, cur);
  }

  // Monday–Sunday weeks whose Sunday falls in the window.
  const weeks: FullCountWeek[] = [];
  let firstMonday = start;
  while (!isMonday(firstMonday)) firstMonday = addDays(firstMonday, -1);
  for (let weekStart = firstMonday; addDays(weekStart, 6) <= end; weekStart = addDays(weekStart, 7)) {
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
    weeks,
    fullCountsOnTime: judged.length === 0 ? null : judged.every((w) => w.onTime) ? 1 : 0,
  };
}
