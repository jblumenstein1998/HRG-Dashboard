import { NextResponse } from "next/server";
import { fetchLocationReport, fetchAvailableDates, LOCATION_NAMES } from "@/lib/netchef";
import { PERIODS } from "@/lib/fiscal";

const FY2025_PERIODS = [
  { period: 1,  start: "2024-12-30", end: "2025-01-26" },
  { period: 2,  start: "2025-01-27", end: "2025-02-23" },
  { period: 3,  start: "2025-02-24", end: "2025-03-30" },
  { period: 4,  start: "2025-03-31", end: "2025-04-27" },
  { period: 5,  start: "2025-04-28", end: "2025-05-25" },
  { period: 6,  start: "2025-05-26", end: "2025-06-29" },
  { period: 7,  start: "2025-06-30", end: "2025-07-27" },
  { period: 8,  start: "2025-07-28", end: "2025-08-24" },
  { period: 9,  start: "2025-08-25", end: "2025-09-28" },
  { period: 10, start: "2025-09-29", end: "2025-10-26" },
  { period: 11, start: "2025-10-27", end: "2025-11-23" },
  { period: 12, start: "2025-11-24", end: "2025-12-28" },
];

const ALL_PERIODS = [...FY2025_PERIODS, ...PERIODS];

function todayCST(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => String(parts.find(p => p.type === t)?.value ?? "");
  return `${g("year")}-${g("month")}-${g("day")}`;
}

function periodWeekLabel(weekStartISO: string): string {
  const period = ALL_PERIODS.find(p => weekStartISO >= p.start && weekStartISO <= p.end);
  if (!period) return weekStartISO;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weekNum = Math.floor((new Date(weekStartISO + "T00:00:00").getTime() - new Date(period.start + "T00:00:00").getTime()) / msPerWeek) + 1;
  return `P${period.period}-W${weekNum}`;
}

export async function GET() {
  try {
    const today = todayCST();

    // Find the 2 most recent completed weeks ending on last Sunday
    const allDates = await fetchAvailableDates(5);
    const todayDate = new Date(today + "T00:00:00");
    const dow = todayDate.getDay();
    const lastSun = new Date(todayDate);
    lastSun.setDate(todayDate.getDate() - dow);
    const sunStr = `${lastSun.getFullYear()}-${String(lastSun.getMonth() + 1).padStart(2, "0")}-${String(lastSun.getDate()).padStart(2, "0")}`;

    const foundIdx = allDates.findIndex(d => d.endDate === sunStr);
    const firstIdx = foundIdx >= 0 ? foundIdx : 1;
    // Slice newest-first, then reverse so display order is oldest → newest
    const weeks = allDates.slice(firstIdx, firstIdx + 2).reverse();

    const locationIds = Object.keys(LOCATION_NAMES).map(Number);

    // Fetch one week at a time (12 concurrent) to avoid overwhelming the Net-Chef session
    const weekResults: (number | null)[][] = [];
    for (const w of weeks) {
      const weekData = await Promise.all(
        locationIds.map(id =>
          fetchLocationReport(id, w.startDate, w.endDate)
            .then(r => r.variancePct)
            .catch(() => null)
        )
      );
      weekResults.push(weekData);
    }

    const stores = locationIds.map((id, locIdx) => ({
      locationId: id,
      name: LOCATION_NAMES[id],
      values: weekResults.map(weekData => weekData[locIdx]),
    }));

    // Sort by most recent week, ascending absolute value (best first)
    stores.sort((a, b) => {
      const av = a.values[a.values.length - 1];
      const bv = b.values[b.values.length - 1];
      return Math.abs(av ?? Infinity) - Math.abs(bv ?? Infinity);
    });

    return NextResponse.json({
      weeks: weeks.map(w => periodWeekLabel(w.startDate)),
      weekRanges: weeks.map(w => ({ start: w.startDate, end: w.endDate })),
      stores,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[NC] recent-weeks failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
