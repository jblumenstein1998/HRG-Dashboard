import { NextResponse, type NextRequest } from "next/server";
import { apiViewer } from "@/lib/users/access";
import { PAR_LOCATIONS, getStoreTimeZone } from "@/lib/par";
import { getTeamDuring } from "@/lib/staffing";
import { BUSINESS_DAY_START_MINUTES, isoOf, zonedParts } from "@/lib/businessDay";
import type { Tab } from "@/lib/users/tabs";

export const maxDuration = 60;

/**
 * Who was on one store's clock during a window.
 *
 * GET /api/team-on-duty?store=<PAR store id or name>&date=YYYY-MM-DD&start=<min>&end=<min>
 * GET /api/team-on-duty?store=<PAR store id or name>&from=<unix s>&to=<unix s>
 *
 * The first form is store-local on purpose, like the Staffing slider: a
 * daypart is 11am–2pm on each store's own clock, and `start`/`end` are minutes
 * past that date's midnight, both inclusive.
 *
 * The second is for windows that are instants — a Jolt list, from when it was
 * shown to its deadline. They are read on the store's clock and filed under
 * PAR's business date, which runs to 2:15 AM, so a closing list shown at
 * 10:30pm and due at midnight is one window on one date (minutes 1350–1440),
 * not two halves either side of midnight.
 *
 * The ZCase button has its own route (/api/smg/zcase/[caseKey]/team) because
 * its window comes from the case. Names, jobs and shift times only, no pay, so
 * this is open to the tabs that use it rather than only to Staffing.
 */

const TABS: Tab[] = ["/dashboard", "/jolt", "/staffing"];

/** Longest window answered — a full day; anything wider isn't one shift's work. */
const MAX_WINDOW_MINUTES = 1440;

export async function GET(req: NextRequest) {
  const viewer = await apiViewer();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!TABS.some((t) => viewer.position.tabs.includes(t))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const p = req.nextUrl.searchParams;
  const storeParam = (p.get("store") ?? "").trim();
  const loc = PAR_LOCATIONS.find(
    (l) => l.storeId === storeParam || l.name.toLowerCase() === storeParam.toLowerCase(),
  );
  if (!loc) return NextResponse.json({ error: `No PAR store "${storeParam}"` }, { status: 404 });

  let date: string;
  let start: number;
  let end: number;

  if (p.has("from") || p.has("to")) {
    const from = Number(p.get("from"));
    const to = Number(p.get("to"));
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
      return NextResponse.json({ error: "from and to must be unix seconds, from ≤ to" }, { status: 400 });
    }
    const local = zonedParts(getStoreTimeZone(loc.storeId), new Date(from * 1000));
    start = local.hh * 60 + local.mm;
    let day = Date.UTC(local.y, local.m - 1, local.d);
    // Before PAR's end of day, the clock still belongs to yesterday's date.
    if (start < BUSINESS_DAY_START_MINUTES) {
      day -= 86_400_000;
      start += 1440;
    }
    const d = new Date(day);
    date = isoOf({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
    end = start + Math.round((to - from) / 60);
  } else {
    date = p.get("date") ?? "";
    start = Number(p.get("start"));
    end = Number(p.get("end"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: `Could not read "${date}" as a date (expected YYYY-MM-DD)` }, { status: 400 });
    }
    const minute = (n: number) => Number.isInteger(n) && n >= 0 && n <= 1439;
    if (!minute(start) || !minute(end) || end < start) {
      return NextResponse.json({ error: "start and end must be minutes 0–1439, start ≤ end" }, { status: 400 });
    }
  }
  if (end - start > MAX_WINDOW_MINUTES) {
    return NextResponse.json({ error: "Window is longer than a day" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getTeamDuring(loc.storeId, date, start, end));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[team-on-duty] ${loc.storeId} ${date} ${start}-${end} failed:`, msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
