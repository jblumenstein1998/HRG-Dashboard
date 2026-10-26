import { NextRequest, NextResponse } from "next/server";
import { requireTabApi } from "@/lib/users/adminGuard";
import { generateWbr, type WbrStyle } from "@/lib/wbr/generate";

// 26 week reads from Postgres, plus Net-Chef and Berry for the district style.
export const maxDuration = 120;

/**
 * POST { weekEnd?: "YYYY-MM-DD" (a Sunday), style?: "classic" | "district" }
 *
 * Builds the deck for the week ending `weekEnd` (default: the last completed
 * week) and returns it as a .pptx download. Open to anyone with the Admin tab,
 * since nothing is written anywhere — the file only goes back to the caller.
 *
 * The warnings ride along in a header, URI-encoded JSON, so the body can stay
 * the file itself.
 */
export async function POST(request: NextRequest) {
  const denied = await requireTabApi("/admin-links");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { weekEnd?: string; style?: string };
  const style: WbrStyle = body.style === "district" ? "district" : "classic";
  const weekEnd = body.weekEnd && /^\d{4}-\d{2}-\d{2}$/.test(body.weekEnd) ? body.weekEnd : undefined;
  // A week end has to be a Sunday that has finished, or the deck would be built
  // from a partial week.
  if (weekEnd && (new Date(weekEnd + "T12:00:00Z").getUTCDay() !== 0 || weekEnd >= new Date().toISOString().slice(0, 10))) {
    return NextResponse.json({ error: "Pick a completed week." }, { status: 400 });
  }

  try {
    const deck = await generateWbr({ weekEnd, style });
    // Streamed in chunks rather than sent whole: the deck is ~8 MB with the
    // template's screenshots, over Vercel's 4.5 MB cap on a buffered response.
    const CHUNK = 256 * 1024;
    let at = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= deck.file.length) return controller.close();
        controller.enqueue(deck.file.subarray(at, (at += CHUNK)));
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${deck.fileName}"; filename*=UTF-8''${encodeURIComponent(deck.fileName)}`,
        "X-Wbr-Warnings": encodeURIComponent(JSON.stringify(deck.warnings)),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[wbr] generate failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
