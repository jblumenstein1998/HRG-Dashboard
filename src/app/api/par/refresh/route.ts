import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

// Manually busts the 1hr PAR data cache (see unstable_cache calls in @/lib/par),
// so the next fetch pulls fresh data from PAR instead of waiting for the TTL.
export async function POST() {
  // { expire: 0 } forces immediate expiration (vs. "max" stale-while-revalidate),
  // since this is a manual "get me fresh data now" trigger, not a background hint.
  revalidateTag("par-data", { expire: 0 });
  return NextResponse.json({ ok: true });
}
