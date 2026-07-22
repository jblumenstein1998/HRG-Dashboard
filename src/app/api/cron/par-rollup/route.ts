import { NextRequest, NextResponse } from "next/server";
import { PAR_LOCATIONS } from "@/lib/par";
import { backfillStoreDay } from "@/lib/parRollup";

// Yesterday's business date in Central time (HRG's operating timezone — see
// the same convention in fiscal.ts's today()), since "today" isn't a closed
// business date yet when this runs.
function yesterdayCentral(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  const d = new Date(get("year"), get("month") - 1, get("day") - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Vercel Cron hits this daily (see vercel.json). Rolls up just yesterday's
// business date for every store — the incremental case. Historical backfill
// is handled separately via POST /api/par/rollup/backfill.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const businessDate = yesterdayCentral();
  for (const loc of PAR_LOCATIONS) {
    await backfillStoreDay(loc.storeId, businessDate);
  }

  return NextResponse.json({ ok: true, businessDate, storesRolledUp: PAR_LOCATIONS.length });
}
