import { NextRequest } from "next/server";
import { getBerryAuth } from "@/lib/auth";
import { fetchWeeklyHistory, WeeklyHistoryPoint } from "@/lib/berryWeekly";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cache: { data: WeeklyHistoryPoint[]; expiresAt: number } | null = null;

export async function GET(request: NextRequest) {
  const { token } = await getBerryAuth();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const bust = request.nextUrl.searchParams.get("bust") === "1";
  if (!bust && cache && Date.now() < cache.expiresAt) {
    return Response.json(cache.data);
  }

  let data: WeeklyHistoryPoint[];
  try {
    data = await fetchWeeklyHistory(token);
  } catch {
    return Response.json({ error: "Failed to fetch weekly history" }, { status: 502 });
  }

  if (data.some(w => Object.keys(w.stores).length > 0)) {
    cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  }

  return Response.json(data);
}
