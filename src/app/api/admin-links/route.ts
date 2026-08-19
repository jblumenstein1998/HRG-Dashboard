import { NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { createAdminLink, deleteAdminLink, updateAdminLink } from "@/lib/adminLinksStore";

/**
 * Adding, editing and removing cards on the Admin tab.
 *
 * Writes only. There is no GET: the page is a server component that reads the
 * directory directly, and the client calls `router.refresh()` after a write to
 * re-render it. That keeps one reading path instead of two that can disagree,
 * and means a card added in one browser shows up in another on its next load
 * without any of them polling.
 *
 * Both handlers are admin-gated while *viewing* only needs the tab. Reading the
 * directory is the point of the tab; editing it is a change everyone with the
 * tab then sees, which is the same line `requireAdminApi` already draws around
 * positions and users.
 */

export async function POST(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Partial<LinkBody>;

  const result = await createAdminLink({
    groupTitle: body.groupTitle ?? "",
    label: body.label ?? "",
    url: body.url ?? "",
    search: body.search,
  });

  // The store validates and reports; this route only chooses the status. 400
  // rather than 422 to match the positions route, which does the same.
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ link: result.link });
}

/**
 * Edits a card in place, including moving it between groups — the reason the
 * card control is a pencil rather than a cross.
 *
 * PUT with the id in the body rather than PATCH with it in the query string,
 * matching the positions route: the client always sends the whole card, so
 * this really is a replacement rather than a partial update, and there is one
 * fewer place for the two halves of a write to disagree about which record
 * they mean.
 */
export async function PUT(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Partial<LinkBody> & { id?: string };
  if (!body.id) return Response.json({ error: "Missing id" }, { status: 400 });

  const result = await updateAdminLink(body.id, {
    groupTitle: body.groupTitle ?? "",
    label: body.label ?? "",
    url: body.url ?? "",
    search: body.search,
  });

  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ link: result.link });
}

type LinkBody = {
  groupTitle: string;
  label: string;
  url: string;
  search: string;
};

export async function DELETE(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

  const removed = await deleteAdminLink(id);
  if (!removed) return Response.json({ error: "That card no longer exists." }, { status: 404 });

  return Response.json({ ok: true });
}
