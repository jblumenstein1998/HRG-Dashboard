import { NextResponse } from "next/server";
import { fetchPeriodHistory, fetchAvailableDates } from "@/lib/netchef";
import { PERIODS } from "@/lib/fiscal";

// FY2025 fiscal periods (4-4-5 calendar, starts Dec 30 2024)
const FY2025_PERIODS = [
  { period: 1,  fy: 2025, start: "2024-12-30", end: "2025-01-26" },
  { period: 2,  fy: 2025, start: "2025-01-27", end: "2025-02-23" },
  { period: 3,  fy: 2025, start: "2025-02-24", end: "2025-03-30" },
  { period: 4,  fy: 2025, start: "2025-03-31", end: "2025-04-27" },
  { period: 5,  fy: 2025, start: "2025-04-28", end: "2025-05-25" },
  { period: 6,  fy: 2025, start: "2025-05-26", end: "2025-06-29" },
  { period: 7,  fy: 2025, start: "2025-06-30", end: "2025-07-27" },
  { period: 8,  fy: 2025, start: "2025-07-28", end: "2025-08-24" },
  { period: 9,  fy: 2025, start: "2025-08-25", end: "2025-09-28" },
  { period: 10, fy: 2025, start: "2025-09-29", end: "2025-10-26" },
  { period: 11, fy: 2025, start: "2025-10-27", end: "2025-11-23" },
  { period: 12, fy: 2025, start: "2025-11-24", end: "2025-12-28" },
];

const FY2026_PERIODS = PERIODS.map(p => ({ ...p, fy: 2026 }));

function todayCST(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => String(parts.find(p => p.type === t)?.value ?? "");
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export async function GET() {
  try {
    const today = todayCST();

    // Combine both fiscal years, filter to completed, take last 12
    const allPeriods = [...FY2025_PERIODS, ...FY2026_PERIODS];
    const last12 = allPeriods.filter(p => p.end < today).slice(-12);

    // Most recent closed week (index 1 = last complete week)
    const allDates = await fetchAvailableDates(3);
    const lastWeek = allDates[1] ?? allDates[0];

    const ranges: { label: string; start: string; end: string }[] = [
      ...last12.map(p => ({
        label: `p${p.period}-${String(p.fy).slice(2)}`,
        start: p.start,
        end:   p.end,
      })),
      ...(lastWeek
        ? [{ label: "last wk", start: lastWeek.startDate, end: lastWeek.endDate }]
        : []),
    ];

    const rows = await fetchPeriodHistory(ranges);
    return NextResponse.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[NC] fetchPeriodHistory failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
