import { NextRequest, NextResponse } from "next/server";
import { ingestZCases } from "@/lib/smgCaseStore";

// A ZCase pull is a v5 login (~3s) plus one paged report (~1s per 50 cases).
// Nowhere near the survey sync's cost, but the login dominates and SMG is not
// always quick, so leave room.
export const maxDuration = 120;

/** Rolling re-sync window, in days. */
const DEFAULT_DAYS = 45;

/**
 * Backfill ceiling. Wide enough to reach the start of FY2025 (2024-12-30, about
 * 590 days before mid-FY2026), which is as far back as the tab reports — see
 * EARLIEST_FISCAL_YEAR. The pull splits its own date window, so a request this
 * size is still one round trip unless it actually returns thousands of rows.
 */
const MAX_DAYS = 900;

/**
 * Vercel Cron hits this daily (see vercel.json), matching the other SMG jobs —
 * Hobby caps crons at once a day anyway.
 *
 * Re-pulls a rolling window rather than only new cases: a ZCase is created
 * unresolved and resolved hours or days later, so rows already stored keep
 * changing. Anything inside the window gets re-read and upserted on `case_key`.
 *
 * Forty-five days is well past the point where cases settle (the slowest
 * observed resolution is ~33 hours) while still being cheap — but it's the
 * backstop, not the main freshness mechanism. The tab refreshes on open, so
 * this exists to catch what happens while nobody is looking, and to keep the
 * outstanding list honest overnight.
 *
 * Pass `?days=N` to widen it for a backfill.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const requested = Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS);
  const days = Math.min(Math.max(Number.isFinite(requested) ? requested : DEFAULT_DAYS, 1), MAX_DAYS);

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  const startedAt = Date.now();
  try {
    const { cases, unmappedUnits } = await ingestZCases({ start, end });
    const ms = Date.now() - startedAt;

    // Cron failures are invisible on Vercel unless something is written to the
    // log, so both outcomes say so explicitly and in a greppable shape.
    console.log(`[ZCase] synced ${cases} cases over ${days}d in ${ms}ms`);

    return NextResponse.json({
      ok: true,
      cases,
      days,
      ms,
      unmappedUnits,
      window: { start: start.toISOString(), end: end.toISOString() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ZCase] sync FAILED after ${Date.now() - startedAt}ms: ${message}`);
    return NextResponse.json({ ok: false, error: message, days }, { status: 500 });
  }
}
