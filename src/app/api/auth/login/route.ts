import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { BERRY_BASE_URL } from "@/lib/berry";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, password } = body;

  if (!email || !password) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  const berryRes = await fetch(`${BERRY_BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await berryRes.json();

  if (!berryRes.ok) {
    const message =
      data?.detail?.[0]?.msg ?? data?.detail ?? "Invalid credentials";
    return Response.json({ error: message }, { status: berryRes.status });
  }

  // BerryAI returns the token — inspect the key name
  const token: string =
    data?.access_token ?? data?.token ?? data?.jwt ?? data?.data?.token ?? "";

  if (!token) {
    return Response.json(
      { error: "No token returned from BerryAI", raw: data },
      { status: 502 }
    );
  }

  const cookieStore = await cookies();
  cookieStore.set("berry_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
  });

  return Response.json({ ok: true });
}
