import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { passwordProblem, verifyPassword } from "@/lib/users/password";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/users/session";
import { apiViewer } from "@/lib/users/access";
import { findById, setPassword } from "@/lib/users/store";

/**
 * Changes the signed-in user's own password.
 *
 * The current password is required even though the session already proves
 * identity — it's what stops an unattended browser from becoming a permanent
 * account takeover.
 *
 * `setPassword` bumps token_version, which invalidates every session including
 * this one, so a fresh cookie is minted here. Skipping that would sign the user
 * out the moment they succeeded.
 */
export async function POST(request: NextRequest) {
  const viewer = await apiViewer();
  if (!viewer) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { currentPassword, newPassword } = (await request.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    return Response.json({ error: "Both fields are required." }, { status: 400 });
  }

  const problem = passwordProblem(newPassword);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  if (newPassword === currentPassword) {
    return Response.json({ error: "That's your current password." }, { status: 400 });
  }

  const row = await findById(viewer.user.id);
  if (!row) return Response.json({ error: "Not signed in" }, { status: 401 });

  if (!(await verifyPassword(currentPassword, row.passwordHash))) {
    return Response.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  await setPassword(row.id, newPassword, false);

  const fresh = await findById(row.id);
  const token = await signSession({
    uid: row.id,
    pos: row.positionId,
    ver: fresh?.tokenVersion ?? row.tokenVersion + 1,
    rst: false,
  });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);

  return Response.json({ ok: true });
}
