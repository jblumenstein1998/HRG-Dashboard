import { NextRequest } from "next/server";
import { getBerryAuth } from "@/lib/auth";
import { getTrend, isGranularity, type TrendPoint } from "@/lib/driveThruTrend";

/**
 * Drive-thru trend history for one granularity (week / month / period).
 *
 * Returns every bucket in the fiscal year to date — the client slices to the
 * selected start/end locally, so changing the range never costs a round trip.
 * Buckets come out of Postgres; only ones that are missing or still rolling hit
 * Superset (see getTrend).
 */
export async function GET(request: NextRequest) {
  const { token } = await getBerryAuth();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const g = request.nextUrl.searchParams.get("granularity") ?? "week";
  if (!isGranularity(g)) {
    return Response.json({ error: "Invalid granularity" }, { status: 400 });
  }

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  let data: TrendPoint[];
  try {
    data = await getTrend(token, g, { refresh });
  } catch {
    return Response.json({ error: "Failed to load drive-thru trend" }, { status: 502 });
  }

  return Response.json(data);
}
