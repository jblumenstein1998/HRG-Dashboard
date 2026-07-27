import { NextRequest, NextResponse } from "next/server";
import { getSalesSnapshot, parseSnapshotRange, DEFAULT_SNAPSHOT_RANGE } from "@/lib/salesSnapshot";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("range");
  const range = raw == null ? DEFAULT_SNAPSHOT_RANGE : parseSnapshotRange(raw);
  if (!range) {
    return NextResponse.json(
      { error: `Unknown range "${raw}" — expected today | yesterday | wtd | ptd | ytd | p<n>` },
      { status: 400 }
    );
  }

  const result = await getSalesSnapshot(range);
  return NextResponse.json(result);
}
