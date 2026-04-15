import { BERRY_API_BASE, SUPERSET_BASE, SUPERSET_DASHBOARD_ID } from "./berry";

const EMBEDDED_UUID = "7f63aaec-1db2-4d23-8fb4-3175a1110259";
const SESSION_TTL_MS = 45 * 60 * 1000; // 45 minutes

export type SupersetSession = {
  guestToken: string;
  sessionCookie: string;
  csrfToken: string;
  expiresAt: number;
};

let cached: SupersetSession | null = null;

export function getCachedSession(): SupersetSession | null {
  return cached && Date.now() < cached.expiresAt ? cached : null;
}

export function invalidateSession() {
  cached = null;
}

export async function ensureSession(berryToken: string): Promise<SupersetSession> {
  const existing = getCachedSession();
  if (existing) return existing;

  // Step 1: guest token
  const guestRes = await fetch(
    `${BERRY_API_BASE}/superset/dashboard/${SUPERSET_DASHBOARD_ID}/embed/guest_token/dynamic_rls`,
    { method: "POST", headers: { Authorization: `Bearer ${berryToken}`, "Content-Length": "0" } }
  );
  if (!guestRes.ok) throw new Error("Failed to get guest token");
  const { guest_token } = await guestRes.json();

  // Step 2: session cookie
  const embeddedRes = await fetch(
    `${SUPERSET_BASE}/embedded/${EMBEDDED_UUID}?uiConfig=1`,
    { headers: { "X-GuestToken": guest_token }, redirect: "follow" }
  );
  const setCookie = embeddedRes.headers.getSetCookie?.() ?? [];
  const sessionCookie = setCookie.map((c: string) => c.split(";")[0]).join("; ");

  // Step 3: CSRF token
  let csrfToken = "";
  const csrfRes = await fetch(`${SUPERSET_BASE}/api/v1/security/csrf_token/`, {
    headers: {
      "X-GuestToken": guest_token,
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
  });
  if (csrfRes.ok) {
    csrfToken = (await csrfRes.json())?.result ?? "";
  }

  cached = { guestToken: guest_token, sessionCookie, csrfToken, expiresAt: Date.now() + SESSION_TTL_MS };
  return cached;
}
