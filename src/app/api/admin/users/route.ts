import { NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { apiViewer } from "@/lib/users/access";
import { ALLOWED_HD } from "@/lib/users/google";
import {
  createUser,
  deleteUser,
  findByEmail,
  listPositions,
  listUsers,
  updateUser,
} from "@/lib/users/store";

/**
 * The user register.
 *
 * Adding someone is only ever "this address may sign in, as this position" —
 * there is no password to issue, because identity comes from Google. The email
 * has to be the one on their Google account, since that is what the callback
 * matches against.
 */

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Only work addresses can ever sign in — Google refuses anything else and the
 * callback double-checks the domain. Rejecting it here means a typo surfaces
 * when the row is created rather than as a baffling refusal weeks later.
 */
function emailProblem(email: string): string | null {
  if (!EMAIL.test(email)) return "That doesn't look like an email address.";
  if (email.split("@")[1]?.toLowerCase() !== ALLOWED_HD) {
    return `Must be an @${ALLOWED_HD} address — Google Sign-In won't accept any other domain.`;
  }
  return null;
}

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const [users, positions] = await Promise.all([listUsers(), listPositions()]);
  return Response.json({ users, positions });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
    positionId?: string;
  };

  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim();
  if (!email || !name || !body.positionId) {
    return Response.json({ error: "Name, email and position are required." }, { status: 400 });
  }

  const problem = emailProblem(email);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  if (await findByEmail(email)) {
    return Response.json({ error: "Someone already has that email." }, { status: 409 });
  }

  const user = await createUser({ email, name, positionId: body.positionId });
  return Response.json({ user });
}

export async function PATCH(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    email?: string;
    positionId?: string;
  };

  if (!body.id) return Response.json({ error: "Missing user id" }, { status: 400 });

  if (body.name || body.email || body.positionId) {
    if (body.email) {
      const problem = emailProblem(body.email.trim().toLowerCase());
      if (problem) return Response.json({ error: problem }, { status: 400 });
    }
    await updateUser(body.id, {
      name: body.name,
      email: body.email,
      positionId: body.positionId,
    });
  }

  return Response.json({ ok: true });
}

/**
 * Removes an account for good, as opposed to PATCH's `disabled`.
 *
 * Deleting yourself is refused here rather than in lib/users/store, because
 * this is the layer that knows who is asking — and it's the one deletion that
 * can't be undone by the person who made it: they'd lose the screen on the way
 * out. Disabling has the same rule, enforced by the UI hiding the button; this
 * being irreversible, it's checked on the server too.
 */
export async function DELETE(request: NextRequest) {
  const viewer = await apiViewer();
  if (!viewer) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!viewer.position.isAdmin) return Response.json({ error: "Not allowed" }, { status: 403 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

  if (id === viewer.user.id) {
    return Response.json({ error: "You can't delete your own account." }, { status: 409 });
  }

  const problem = await deleteUser(id);
  if (problem) return Response.json({ error: problem }, { status: 409 });

  return Response.json({ ok: true });
}
