import { NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { generateTempPassword, passwordProblem } from "@/lib/users/password";
import {
  createUser,
  findByEmail,
  listPositions,
  listUsers,
  setDisabled,
  setPassword,
  updateUser,
} from "@/lib/users/store";

/**
 * The user register.
 *
 * A generated temporary password is returned exactly once, in the response to
 * the request that created or reset it. It is never stored in readable form and
 * there is no endpoint that can show it again — losing it means issuing another,
 * which is a two-click operation and safer than a retrievable secret.
 */

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
    password?: string;
  };

  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim();
  if (!email || !name || !body.positionId) {
    return Response.json({ error: "Name, email and position are required." }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "That doesn't look like an email address." }, { status: 400 });
  }
  if (await findByEmail(email)) {
    return Response.json({ error: "Someone already has that email." }, { status: 409 });
  }

  // An admin may set the first password themselves; otherwise one is generated.
  const password = body.password?.trim() || generateTempPassword();
  if (body.password) {
    const problem = passwordProblem(password);
    if (problem) return Response.json({ error: problem }, { status: 400 });
  }

  const user = await createUser({
    email,
    name,
    positionId: body.positionId,
    password,
    mustReset: true,
  });

  return Response.json({ user, tempPassword: password });
}

export async function PATCH(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    email?: string;
    positionId?: string;
    disabled?: boolean;
    resetPassword?: boolean;
  };

  if (!body.id) return Response.json({ error: "Missing user id" }, { status: 400 });

  if (body.name || body.email || body.positionId) {
    if (body.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) {
      return Response.json({ error: "That doesn't look like an email address." }, { status: 400 });
    }
    await updateUser(body.id, {
      name: body.name,
      email: body.email,
      positionId: body.positionId,
    });
  }

  if (typeof body.disabled === "boolean") {
    await setDisabled(body.id, body.disabled);
  }

  if (body.resetPassword) {
    const password = generateTempPassword();
    await setPassword(body.id, password, true);
    return Response.json({ ok: true, tempPassword: password });
  }

  return Response.json({ ok: true });
}
