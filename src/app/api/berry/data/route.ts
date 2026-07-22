import { NextRequest } from "next/server";
import { after } from "next/server";
import { getBerryAuth } from "@/lib/auth";
import { resolveRange, RangeKey } from "@/lib/fiscal";
import { getDriveThruMetrics, warmStandardRanges, ChartFetchError } from "@/lib/berryData";

export async function GET(request: NextRequest) {
  const { token } = await getBerryAuth();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const rangeKey = (request.nextUrl.searchParams.get("range") ?? "mtd") as RangeKey;
  const { range: timeRange, label: rangeLabel } = resolveRange(rangeKey);
  const bust = request.nextUrl.searchParams.get("bust") === "1";

  try {
    const payload = await getDriveThruMetrics(token, timeRange, rangeLabel, { bust });
    after(() => warmStandardRanges(token));
    return Response.json(payload);
  } catch (err) {
    if (err instanceof ChartFetchError) {
      return Response.json(
        { error: "Failed to fetch chart data", detail: err.detail, status: err.status },
        { status: err.status }
      );
    }
    return Response.json({ error: "Failed to establish Superset session" }, { status: 502 });
  }
}
