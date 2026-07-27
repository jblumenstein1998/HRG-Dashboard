import { NextRequest, NextResponse } from "next/server";
import { ingestTrend, type DateBasis } from "@/lib/smgStore";
import { listPeriodsOfType, MAX_TREND_PERIODS, smgLogin, type DateTypeKey, type LevelKey } from "@/lib/smgTrend";

export const maxDuration = 300;

/**
 * Historical backfill. SMG has data back to Week 1, 2020.
 *
 * POST /api/smg/backfill
 *   { "level": "store", "dateType": "weekly", "from": "Week 1, 2025",
 *     "to": "Week 29, 2026", "dateBasis": "visit", "chunk": 26 }
 *
 * `from`/`to` are SMG period labels (omit for everything available). Reports are
 * requested in chunks because a single very wide trend report times out on
 * SMG's side well before it returns.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    level?: LevelKey;
    dateType?: DateTypeKey;
    from?: string;
    to?: string;
    dateBasis?: DateBasis;
    chunk?: number;
  };

  const level = body.level ?? "store";
  const dateType = body.dateType ?? "weekly";
  const dateBasis = body.dateBasis ?? "visit";
  // Hard-capped at MAX_TREND_PERIODS: a larger chunk doesn't fail, it silently
  // drops the oldest periods in every chunk, leaving gaps at each boundary.
  const chunk = Math.max(1, Math.min(body.chunk ?? MAX_TREND_PERIODS, MAX_TREND_PERIODS));

  const session = await smgLogin();
  const all = await listPeriodsOfType(session, dateType); // newest first
  const oldestFirst = [...all].reverse();

  const startIdx = body.from ? oldestFirst.findIndex((p) => p.label === body.from) : 0;
  const endIdx = body.to ? oldestFirst.findIndex((p) => p.label === body.to) : oldestFirst.length - 1;
  if (startIdx < 0 || endIdx < 0) {
    return NextResponse.json(
      { error: "unknown period label", from: body.from, to: body.to, sample: oldestFirst.slice(-3).map((p) => p.label) },
      { status: 400 },
    );
  }

  const window = oldestFirst.slice(startIdx, endIdx + 1);
  const batches: Record<string, unknown>[] = [];

  for (let i = 0; i < window.length; i += chunk) {
    const slice = window.slice(i, i + chunk);
    const first = slice[0];
    const last = slice[slice.length - 1];
    try {
      const rows = await ingestTrend({
        level,
        dateType,
        dateBasis,
        session,
        startPeriodId: first.id,
        endPeriodId: last.id,
        periods: slice.length,
      });
      batches.push({ from: first.label, to: last.label, rows });
    } catch (err) {
      batches.push({ from: first.label, to: last.label, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const totalRows = batches.reduce((n, b) => n + (typeof b.rows === "number" ? b.rows : 0), 0);
  const failed = batches.filter((b) => b.error);
  return NextResponse.json(
    { ok: failed.length === 0, level, dateType, dateBasis, totalRows, batches },
    { status: failed.length ? 207 : 200 },
  );
}
