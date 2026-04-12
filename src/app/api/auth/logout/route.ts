import { cookies } from "next/headers";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete("berry_token");
  return Response.json({ ok: true });
}
