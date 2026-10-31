import { NextResponse, type NextRequest } from "next/server";
import { apiViewer } from "@/lib/users/access";
import { PAR_LOCATIONS } from "@/lib/par";
import { getTeamDuring } from "@/lib/staffing";
import type { Tab } from "@/lib/users/tabs";

export const maxDuration = 60;

/**
 * Who was on one store's clock during a window of a local date.
 *
 * GET /api/team-on-duty?store=<PAR store id or name>&date=YYYY-MM-DD&start=<min>&end=<min>
 *
 * `start` and `end` are minutes past the store's local midnight, both
 * inclusive. Store-local on purpose, like the Staffing slider: a daypart is
 * 11am–2pm on each store's own clock.
 *
 * The ZCase button has its own route (/api/smg/zcase/[caseKey]/team) because
 * its window comes from the case; this one is for callers that already know
 * the window — the drive-thru tab's dayparts. Names, jobs and shift times
 * only, no pay, so it is open to the tabs that use it rather than only to
 * Staffing.
 */

const TABS: Tab[] = ["/dashboard", "/staffing"];

export async function GET(req: NextRequest) {
  const viewer = await apiViewer();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!TABS.some((t) => viewer.position.tabs.includes(t))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const p = req.nextUrl.searchParams;
  const storeParam = (p.get("store") ?? "").trim();
  const date = p.get("date") ?? "";
  const start = Number(p.get("start"));
  const end = Number(p.get("end"));

  const loc = PAR_LOCATIONS.find(
    (l) => l.storeId === storeParam || l.name.toLowerCase() === storeParam.toLowerCase(),
  );
  if (!loc) return NextResponse.json({ error: `No PAR store "${storeParam}"` }, { status: 404 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: `Could not read "${date}" as a date (expected YYYY-MM-DD)` }, { status: 400 });
  }
  const minute = (n: number) => Number.isInteger(n) && n >= 0 && n <= 1439;
  if (!minute(start) || !minute(end) || end < start) {
    return NextResponse.json({ error: "start and end must be minutes 0–1439, start ≤ end" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getTeamDuring(loc.storeId, date, start, end));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[team-on-duty] ${loc.storeId} ${date} ${start}-${end} failed:`, msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
