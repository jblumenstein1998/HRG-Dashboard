import { NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { invalidatePositions } from "@/lib/users/access";
import { ALL_TABS } from "@/lib/users/schema";
import { deletePosition, listPositions, upsertPosition } from "@/lib/users/store";

/**
 * Positions and the tabs they may reach.
 *
 * Every write clears the positions cache so the admin sees the effect of their
 * own edit immediately rather than up to five seconds later — the cache exists
 * to keep page loads off the database, not to delay the person changing it.
 */

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;
  return Response.json({ positions: await listPositions(), allTabs: ALL_TABS });
}

export async function PUT(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    label?: string;
    tabs?: string[];
  };

  const label = body.label?.trim();
  if (!body.id || !label) {
    return Response.json({ error: "Id and label are required." }, { status: 400 });
  }
  // Slug rules: this is a primary key referenced by every user row.
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(body.id)) {
    return Response.json(
      { error: "Id must be lowercase letters, numbers and underscores." },
      { status: 400 },
    );
  }

  await upsertPosition({ id: body.id, label, tabs: body.tabs ?? [] });
  invalidatePositions();
  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

  const problem = await deletePosition(id);
  if (problem) return Response.json({ error: problem }, { status: 409 });

  invalidatePositions();
  return Response.json({ ok: true });
}
