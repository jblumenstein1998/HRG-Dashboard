import { NextRequest, NextResponse } from "next/server";
import { loginBerryService } from "@/lib/berryAuth";
import { warmStandardRanges } from "@/lib/berryData";
import { refreshAllTrends } from "@/lib/driveThruTrend";

// Vercel Cron hits this daily (see vercel.json). Logs into BerryAI server-side
// (no browser session available in a cron context) and pre-warms the same
// standard ranges the app opportunistically warms after a real user request —
// so today/yesterday/wtd/last_week/t7/mtd/qtd/ytd are all already cached
// before anyone opens the dashboard.
//
// It also fills in the drive-thru trend buckets (weekly and by fiscal period)
// behind the trend charts. Closed buckets are already stored and get skipped,
// so in practice this fetches only whichever bucket is still in progress — but
// it means the charts never make a user wait on Superset.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await loginBerryService();
    await warmStandardRanges(token);
    const trends = await refreshAllTrends(token);
    return NextResponse.json({ ok: true, trends });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
