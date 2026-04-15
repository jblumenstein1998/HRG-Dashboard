import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { BERRY_API_BASE } from "@/lib/berry";
import { ensureSession } from "@/lib/supersetSession";

export async function POST(request: NextRequest) {
  const { email, password } = await request.json();
  if (!email || !password) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  // 1. Login
  const loginRes = await fetch(`${BERRY_API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    const msg = loginData?.detail?.[0]?.msg ?? loginData?.detail ?? "Invalid credentials";
    return Response.json({ error: msg }, { status: loginRes.status });
  }
  const token: string = loginData?.access_token ?? loginData?.token ?? "";
  if (!token) {
    return Response.json({ error: "No token in response", raw: loginData }, { status: 502 });
  }

  // 2. Fetch user/me to get corp id
  const meRes = await fetch(`${BERRY_API_BASE}/user/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meData = await meRes.json();
  const corpId: string = meData?.corp?.id ?? "";

  const cookieStore = await cookies();
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24,
  };
  cookieStore.set("berry_token", token, opts);
  cookieStore.set("berry_corp", corpId, opts);

  // Pre-warm Superset session cache so the first dashboard load skips the auth chain
  ensureSession(token).catch(() => {});

  return Response.json({ ok: true });
}
