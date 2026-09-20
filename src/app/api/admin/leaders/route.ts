import { NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { createLeader, deleteLeader, listLeaders, updateLeader } from "@/lib/users/leaders";

/**
 * Above-store leaders and their store assignments.
 *
 * Admin-only for every verb including GET: the list is small and uninteresting,
 * but it is edited from exactly one screen and read from the Drive-Thru page
 * through its server component, so nothing needs an unguarded read here.
 */

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;
  return Response.json({ leaders: await listLeaders() });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim();
  if (!name) return Response.json({ error: "A name is required." }, { status: 400 });

  const leader = await createLeader(name);
  if (!leader) {
    return Response.json({ error: "There's already a leader with that name." }, { status: 409 });
  }
  return Response.json({ leader });
}

export async function PATCH(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    stores?: string[];
  };
  if (!body.id) return Response.json({ error: "Missing leader id" }, { status: 400 });

  // An empty name would leave an unnamed entry in the Drive-Thru dropdown, so
  // it's rejected rather than quietly ignored the way an absent one is.
  if (body.name !== undefined && !body.name.trim()) {
    return Response.json({ error: "A name is required." }, { status: 400 });
  }

  const problem = await updateLeader(body.id, { name: body.name, stores: body.stores });
  if (problem) return Response.json({ error: problem }, { status: 409 });
  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

  await deleteLeader(id);
  return Response.json({ ok: true });
}
