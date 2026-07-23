import { BERRY_API_BASE } from "@/lib/berry";

/**
 * Logs into BerryAI server-side using stored credentials (same pattern as
 * netchef.ts's login) instead of a browser session cookie — used by the daily
 * cron to pre-warm the drive-thru cache, since a cron invocation has no
 * berry_token to reuse the way a real logged-in request does.
 */
export async function loginBerryService(): Promise<string> {
  const email = process.env.BERRY_EMAIL;
  const password = process.env.BERRY_PASSWORD;
  if (!email || !password) throw new Error("BERRY_EMAIL / BERRY_PASSWORD not set");

  const res = await fetch(`${BERRY_API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.detail?.[0]?.msg ?? data?.detail ?? "Invalid credentials";
    throw new Error(`BerryAI login failed: ${msg}`);
  }
  const token: string = data?.access_token ?? data?.token ?? "";
  if (!token) throw new Error("BerryAI login: no token in response");
  return token;
}
