import { NextRequest, NextResponse } from "next/server";
import { fetchSmgReport, invalidateSmgCache } from "@/lib/smg";

function formatDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function mondayOf(d: Date): Date {
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(m.getDate() + diff);
  return m;
}

function resolveRange(range: string): { start: string; end: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = formatDate(today);

  if (range === "7d") {
    const s = new Date(today);
    s.setDate(s.getDate() - 7);
    return { start: formatDate(s), end };
  }
  if (range === "cw") {
    return { start: formatDate(mondayOf(today)), end };
  }
  if (range === "pw") {
    const mon = mondayOf(today);
    mon.setDate(mon.getDate() - 7);
    const sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    return { start: formatDate(mon), end: formatDate(sun) };
  }
  if (range === "cp") {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: formatDate(s), end };
  }
  if (range === "pp") {
    const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const e = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: formatDate(s), end: formatDate(e) };
  }
  // default: current period
  const s = new Date(today.getFullYear(), today.getMonth(), 1);
  return { start: formatDate(s), end };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const bust = searchParams.get("bust") === "1";
  if (bust) invalidateSmgCache();

  const range = searchParams.get("range") ?? "cp";
  const customStart = searchParams.get("start");
  const customEnd = searchParams.get("end");

  const { start, end } =
    customStart && customEnd
      ? { start: customStart, end: customEnd }
      : resolveRange(range);

  try {
    const report = await fetchSmgReport(start, end, range);
    return NextResponse.json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SMG] fetchSmgReport failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
