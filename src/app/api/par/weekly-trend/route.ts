import { NextRequest, NextResponse } from "next/server";
import { getWeeklyTrend } from "@/lib/parWeeklyTrend";

// Generous ceiling on one request — the rollup reaches back to mid-2024, so
// this covers the whole history while still refusing a runaway range.
const MAX_WEEKS = 160;

const isMonday = (v: string | null): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + "T00:00:00Z").getUTCDay() === 1;

/** GET ?from=<Monday>&to=<Monday> — week-beginning dates, both inclusive. */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!isMonday(from) || !isMonday(to)) {
    return NextResponse.json({ error: "from and to must be week-beginning Mondays (YYYY-MM-DD)" }, { status: 400 });
  }
  const weekCount = Math.round((Date.parse(to) - Date.parse(from)) / (7 * 86_400_000)) + 1;
  if (weekCount < 1 || weekCount > MAX_WEEKS) {
    return NextResponse.json({ error: `from must be on or before to, at most ${MAX_WEEKS} weeks apart` }, { status: 400 });
  }

  return NextResponse.json(await getWeeklyTrend(from, to));
}
