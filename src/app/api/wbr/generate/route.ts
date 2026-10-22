import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { NotConnectedError } from "@/lib/google/workspace";
import { AlreadyExistsError, generateWbr, type GenerateMode } from "@/lib/wbr/generate";

// ~4,000 Slides requests across a dozen calls, plus 26 week reads from Postgres.
export const maxDuration = 120;

/**
 * POST { mode?: "new" | "replace" | "copy", weekEnd?: "YYYY-MM-DD" (a Sunday) }
 *
 * Builds the deck for the week ending `weekEnd` (default: the last completed
 * week). A deck already carrying that week's title is a 409 with its link in
 * "new" mode — pressing the button twice shouldn't leave two decks with the
 * same name in the folder — and the panel then offers replace or copy.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { mode?: string; weekEnd?: string };
  const weekEnd = body.weekEnd && /^\d{4}-\d{2}-\d{2}$/.test(body.weekEnd) ? body.weekEnd : undefined;
  const mode: GenerateMode = body.mode === "replace" || body.mode === "copy" ? body.mode : "new";
  // A week end has to be a Sunday that has finished, or the deck would be built
  // from a partial week.
  if (weekEnd && (new Date(weekEnd + "T12:00:00Z").getUTCDay() !== 0 || weekEnd >= new Date().toISOString().slice(0, 10))) {
    return NextResponse.json({ error: "Pick a completed week." }, { status: 400 });
  }

  try {
    return NextResponse.json(await generateWbr({ mode, weekEnd }));
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
