import { NextResponse } from "next/server";
import { getBerryAuth } from "@/lib/auth";
import { resolveRange, type RangeKey } from "@/lib/fiscal";
import { getDriveThruMetrics, ChartFetchError } from "@/lib/berryData";

// Manual "catch up the cache" trigger — warms last_week plus every fiscal
// period (P1-P12) using the caller's own BerryAI session, sequentially (Superset
// itself is slow, so no point hammering it concurrently). Closed periods land
// in the permanent cache; the in-progress period gets the normal rolling TTL.
const RANGE_KEYS: RangeKey[] = [
  "last_week",
  "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12",
];

export async function GET() {
  const { token } = await getBerryAuth();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const results: { rangeKey: string; label: string; ok: boolean; storeCount?: number; error?: string }[] = [];

  for (const rangeKey of RANGE_KEYS) {
    const { range, label } = resolveRange(rangeKey);
    try {
      const payload = await getDriveThruMetrics(token, range, label);
      results.push({ rangeKey, label, ok: true, storeCount: payload.store_count });
    } catch (err) {
      const message = err instanceof ChartFetchError ? `HTTP ${err.status}` : String(err);
      results.push({ rangeKey, label, ok: false, error: message });
    }
  }

  return NextResponse.json({ done: true, results });
}
