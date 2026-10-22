import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { NotConnectedError } from "@/lib/google/workspace";
import { AlreadyExistsError, generateWbr } from "@/lib/wbr/generate";

// ~4,000 Slides requests across a dozen calls, plus 26 week reads from Postgres.
export const maxDuration = 120;

/**
 * POST { replace?: boolean, weekEnd?: "YYYY-MM-DD" }
 *
 * Builds this week's deck from last week's. A deck already carrying this
 * week's title is a 409 with its link, unless `replace` — pressing the button
 * twice shouldn't leave two decks with the same name in the folder.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { replace?: boolean; weekEnd?: string };
  const weekEnd = body.weekEnd && /^\d{4}-\d{2}-\d{2}$/.test(body.weekEnd) ? body.weekEnd : undefined;

  try {
    return NextResponse.json(await generateWbr({ replace: Boolean(body.replace), weekEnd }));
  } catch (err) {
    if (err instanceof AlreadyExistsError) {
      return NextResponse.json({ error: err.message, existing: { name: err.file.name, url: err.file.webViewLink } }, { status: 409 });
    }
    if (err instanceof NotConnectedError) {
      return NextResponse.json({ error: err.message, notConnected: true }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[wbr] generate failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
