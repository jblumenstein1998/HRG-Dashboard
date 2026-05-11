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

function periodWeekLabel(weekStartISO: string): string {
  const allPeriods = [...FY2025_PERIODS, ...FY2026_PERIODS];
  const period = allPeriods.find(p => weekStartISO >= p.start && weekStartISO <= p.end);
  if (!period) return "last wk";
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const pStart = new Date(period.start + "T00:00:00").getTime();
  const wStart = new Date(weekStartISO + "T00:00:00").getTime();
  const weekNum = Math.floor((wStart - pStart) / msPerWeek) + 1;
  return `P${period.period}-W${weekNum}`;
}

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

    // Most recent closed week: find the entry ending on last Sunday
    const allDates = await fetchAvailableDates(3);
    const todayDate = new Date(today + "T00:00:00");
    const dow = todayDate.getDay(); // 0=Sun
    const lastSun = new Date(todayDate);
    lastSun.setDate(todayDate.getDate() - dow);
    const sunStr = `${lastSun.getFullYear()}-${String(lastSun.getMonth()+1).padStart(2,"0")}-${String(lastSun.getDate()).padStart(2,"0")}`;
    const lastWeek = allDates.find(d => d.endDate === sunStr) ?? allDates[1] ?? allDates[0];

    const ranges: { label: string; start: string; end: string }[] = [
      ...last12.map(p => ({
        label: `p${p.period}-${String(p.fy).slice(2)}`,
        start: p.start,
        end:   p.end,
      })),
      ...(lastWeek
        ? [{ label: periodWeekLabel(lastWeek.startDate), start: lastWeek.startDate, end: lastWeek.endDate }]
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
