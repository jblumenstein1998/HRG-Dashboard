import { NextRequest, NextResponse } from "next/server";
import { requireTabApi } from "@/lib/users/adminGuard";
import { generateStoreDeck } from "@/lib/wbr/generateStore";
import { storeDeckOptions } from "@/lib/wbr/storeData";

// Two PAR reads, three Net-Chef reports and two Berry reads for one store.
export const maxDuration = 60;

/**
 * POST { store: "<store label>", weekEnd?: "YYYY-MM-DD" (a Sunday) }
 *
 * Builds the single-store deck for the week ending `weekEnd` (default: the last
 * completed week) and returns it as a .pptx download. Lives on the Management
 * tab while it's being worked on, so it checks that tab. Warnings ride along in
 * a header, URI-encoded JSON, so the body can stay the file itself.
 */
export async function POST(request: NextRequest) {
  const denied = await requireTabApi("/management");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { store?: string; weekEnd?: string };
  const store = storeDeckOptions().find((s) => s.label === body.store)?.label;
  if (!store) return NextResponse.json({ error: "Pick a store." }, { status: 400 });
  const weekEnd = body.weekEnd && /^\d{4}-\d{2}-\d{2}$/.test(body.weekEnd) ? body.weekEnd : undefined;
  if (weekEnd && (new Date(weekEnd + "T12:00:00Z").getUTCDay() !== 0 || weekEnd >= new Date().toISOString().slice(0, 10))) {
    return NextResponse.json({ error: "Pick a completed week." }, { status: 400 });
  }

  try {
    const deck = await generateStoreDeck({ store, weekEnd });
    return new Response(Buffer.from(deck.file), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${deck.fileName.replace(/[^\x20-\x7e]/g, "-")}"; filename*=UTF-8''${encodeURIComponent(deck.fileName)}`,
        "X-Wbr-Warnings": encodeURIComponent(JSON.stringify(deck.warnings)),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[store-deck] ${store} failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
