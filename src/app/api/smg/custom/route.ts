import { NextRequest, NextResponse } from "next/server";
import { getBerryAuth } from "@/lib/auth";
import { getCustomWindow, type DateBasis } from "@/lib/smgStore";

export const maxDuration = 300;

/**
 * Scores for an arbitrary date range, for the Guest Experience tab's custom
 * From/To picker.
 * GET /api/smg/custom?start=2026-10-01&end=2026-10-15[&dateBasis=visit][&bust=1]
 *
 * Unlike /api/smg/snapshots this can reach SMG, because no cron can know which
 * ranges someone will ask for. Pulls are cached for a few hours (see
 * getCustomWindow); `bust=1` is what the tab's Refresh button sends.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A pull covers every store in one SMG report, so long ranges are fine — but not unbounded. */
const MAX_DAYS = 400;

export async function GET(req: NextRequest) {
  // `/api/smg/` is exempt from the auth proxy so the cron can reach it; this
  // route drives SMG traffic and writes, so it checks the session itself.
  const { token } = await getBerryAuth();
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const start = p.get("start") ?? "";
  const end = p.get("end") ?? "";
  const dateBasis = (p.get("dateBasis") ?? "visit") as DateBasis;
  const bust = p.get("bust") === "1";

  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) {
    return NextResponse.json({ error: "start and end must be YYYY-MM-DD" }, { status: 400 });
  }
  if (start > end) {
    return NextResponse.json({ error: "start must not be after end" }, { status: 400 });
  }
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_DAYS) {
    return NextResponse.json({ error: `range is ${days} days; the limit is ${MAX_DAYS}` }, { status: 400 });
  }
  if (dateBasis !== "visit" && dateBasis !== "survey") {
    return NextResponse.json({ error: `unknown dateBasis "${dateBasis}"` }, { status: 400 });
  }

  try {
    const result = await getCustomWindow({ start, end, dateBasis, bust });
    return NextResponse.json({ start, end, dateBasis, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SMG] /api/smg/custom failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
