import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { disconnect } from "@/lib/google/workspace";

/** Forgets the connected Google account. Google-side access stays until revoked there. */
export async function DELETE() {
  const denied = await requireAdminApi();
  if (denied) return denied;
  await disconnect();
  return NextResponse.json({ ok: true });
}
