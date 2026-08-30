import { NextRequest, NextResponse } from "next/server";
import { fetchStoreLists } from "@/lib/jolt";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json({ error: "start and end query params required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: "Dates must be in YYYY-MM-DD format" }, { status: 400 });
  }

  // The UI blocks an over-long range before it asks, but the route is reachable
  // on its own, and a year-wide window is twenty seconds of work that ends in a
  // truncated answer. Keep the limit here too. Mirrors MAX_RANGE_DAYS in
  // JoltClient — change both together.
  const MAX_RANGE_DAYS = 100;
  const utcDay = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const spanDays = Math.round((utcDay(end) - utcDay(start)) / 86_400_000) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Selected range is too long — ${spanDays} days. The maximum is ${MAX_RANGE_DAYS} days.` },
      { status: 400 },
    );
  }

  // Rolling window, for ranges that aren't whole days ("last 24 hours").
  const rawHours = searchParams.get("hours");
  const hours = rawHours ? Math.min(Math.max(Number(rawHours), 1), 168) : undefined;
  if (rawHours && !Number.isFinite(hours)) {
    return NextResponse.json({ error: "hours must be a number between 1 and 168" }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await fetchStoreLists(start, end, { bust: searchParams.get("bust") === "1", hours }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[jolt] fetchStoreLists failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
