import { NextRequest, NextResponse } from "next/server";
import { loginBerryService } from "@/lib/berryAuth";
import { warmStandardRanges } from "@/lib/berryData";

// Vercel Cron hits this daily (see vercel.json). Logs into BerryAI server-side
// (no browser session available in a cron context) and pre-warms the same
// standard ranges the app opportunistically warms after a real user request —
// so today/yesterday/wtd/last_week/t7/mtd/qtd/ytd are all already cached
// before anyone opens the dashboard.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await loginBerryService();
    await warmStandardRanges(token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
