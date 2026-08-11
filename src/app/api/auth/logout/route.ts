import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/users/session";

export async function POST() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  // Legacy BerryAI session cookies, cleared so an old browser doesn't keep
  // presenting them.
  jar.delete("berry_token");
  jar.delete("berry_corp");
  return Response.json({ ok: true });
}
