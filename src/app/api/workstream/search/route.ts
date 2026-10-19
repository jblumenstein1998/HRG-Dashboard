import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { listStoredRoster } from "@/lib/workstreamStore";
import { storeById } from "@/lib/bonus/storeMap";

/**
 * Find a Workstream employee by name, anywhere in the estate.
 *
 * GET /api/workstream/search?q=noah → up to 20 active people whose name matches
 *
 * The reconciliation queue suggests candidates by comparing names, which is the
 * right default and useless in exactly one case: somebody changed their name.
 * PAR still says Natasha Wilson, Workstream says Noah Starke, and no amount of
 * string distance will ever put those two together — the only thing that can is
 * a person who knows it happened. This endpoint is what they search with.
 *
 * Deliberately not scoped to a store. A name change is often *why* the records
 * drifted apart, and the person may also have transferred; making the search
 * estate-wide costs nothing and avoids a dead end where the right answer exists
 * but is filtered out. The store is reported instead, so the reviewer can see
 * they are reaching across one.
 *
 * Reads only the local roster copy, so it never spends Workstream's 1,000-call
 * daily budget on keystrokes.
 *
 * Admin-only: it returns names next to pay rates.
 */

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  // Two characters is the point where the result list stops being "everyone".
  if (q.length < 2) return NextResponse.json({ q, people: [] });

  try {
    /*
     * Every status, not just current employees.
     *
     * This is the by-hand search, where the person typing has a specific record
     * in mind — most often a leaver whose past shifts still need a title and a
     * rate, or a new hire who has not finished onboarding. Filtering those out
     * would hide exactly what somebody reaches for this box to find. Each hit
     * reports its status so the choice is made knowingly.
     */
    const active = await listStoredRoster();

    // Every part of the name is searchable, preferred name included, because
    // the reviewer may only know one of them.
    const scored = active
      .map((e) => {
        const full = [e.firstName, e.middleInitial, e.lastName].filter(Boolean).join(" ");
        const haystack = `${full} ${e.preferredName}`.toLowerCase();
        if (!haystack.includes(q)) return null;
        return {
          // A name that starts with the query is more likely the one being
          // typed than one that merely contains it.
          rank: haystack.startsWith(q) ? 0 : 1,
          person: {
            uuid: e.uuid,
            name: full.trim(),
            goesBy: e.preferredName || null,
            title: e.jobTitle,
            hourlyRate: e.hourlyRate,
            hiredDate: e.hiredDate,
            storeId: e.storeId,
            storeName: e.storeId ? (storeById(e.storeId)?.name ?? null) : null,
            status: e.status,
          },
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.rank - b.rank || a.person.name.localeCompare(b.person.name))
      .slice(0, 20);

    return NextResponse.json({ q, people: scored.map((s) => s.person) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[workstream-search] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
