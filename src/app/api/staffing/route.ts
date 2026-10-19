import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireTabApi } from "@/lib/users/adminGuard";
import { getStaffingAt, type StaffingMoment } from "@/lib/staffing";
import { expireEditWindow } from "@/lib/parShiftStore";

/**
 * Who was on the clock, every store.
 *
 * GET /api/staffing                            → now, one instant everywhere
 * GET /api/staffing?at=<ISO>                   → that instant everywhere
 * GET /api/staffing?date=<YYYY-MM-DD>&minutes= → that time of day in each
 *                                                store's own timezone
 *
 * The two are different questions and the difference is the whole point. An
 * instant answers "what is happening across the estate right now". A local time
 * of day answers "how were we staffed at dinner" — and six o'clock in Virginia
 * is an hour before six o'clock in Tennessee, so that one is deliberately
 * twelve different instants.
 *
 * The local form also makes the answer independent of who is asking. An instant
 * built from a wall-clock time in the browser means a manager in Virginia and
 * one in Tennessee get different data from the same control.
 *
 * Ten PAR calls per store on a cold cache — the roster, the job list, two
 * business dates of shifts and seven more for the trailing total — so twelve
 * stores is a couple of minutes the first time and near-instant after, since
 * every underlying fetcher is cached and a past date never changes.
 *
 * Admin-only, like the page. Signing in is enforced by proxy.ts, but that only
 * establishes who somebody is — a store account is signed in too.
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Admin-only, matching the page. These answer with every employee's name,
  // hours and pay rate, so gating the screen while leaving the data open
  // would be a lock on a door beside an open window.
  const denied = await requireTabApi("/staffing");
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  const date = params.get("date");
  const minutesRaw = params.get("minutes");

  let moment: StaffingMoment;

  if (date || minutesRaw !== null) {
    const minutes = Number(minutesRaw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
      return NextResponse.json(
        { error: `Could not read "${date}" as a date (expected YYYY-MM-DD)` },
        { status: 400 },
      );
    }
    // 0 to 1439 — a minute of the day, not a duration, so the bounds are the
    // day itself rather than anything to do with how long a shift runs.
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) {
      return NextResponse.json(
        { error: `minutes must be a whole number from 0 to 1439, got "${minutesRaw}"` },
        { status: 400 },
      );
    }
    moment = { kind: "local", date: date!, minutes };
  } else {
    const raw = params.get("at");
    const at = raw ? new Date(raw) : new Date();
    if (Number.isNaN(at.getTime())) {
      return NextResponse.json({ error: `Could not read "${raw}" as a date and time` }, { status: 400 });
    }
    moment = { kind: "instant", at };
  }

  /*
   * The tab's Refresh button: who works here, re-read from PAR.
   *
   * The staff lists are cached for a day, so a record deleted or terminated in
   * PAR stayed on HR Cleanup until tomorrow. Clearing the tag here makes this
   * request the one that re-reads them, and the sections the page reloads
   * afterwards find the fresh copies in the cache rather than asking PAR again.
   * Shifts on the roster dates are read live too, slider or not.
   */
  const fresh = params.get("fresh") === "1";
  if (fresh) {
    revalidateTag("par-employees", { expire: 0 });
    // And the last 14 days of stored shifts: the usual reason to press Refresh
    // is having just fixed a timecard, and this is the only thing that makes a
    // section re-read PAR for a day we hold — an ordinary load reads Postgres.
    await expireEditWindow().catch((err) => console.error("[staffing] expireEditWindow failed:", err));
  }

  try {
    return NextResponse.json(await getStaffingAt(moment, { fresh }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[staffing] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
