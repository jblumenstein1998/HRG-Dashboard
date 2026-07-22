import { BERRY_API_BASE, SUPERSET_BASE, SUPERSET_DASHBOARD_ID } from "./berry";
import { sql } from "./db";

const EMBEDDED_UUID = "7f63aaec-1db2-4d23-8fb4-3175a1110259";
const SESSION_TTL_MS = 45 * 60 * 1000; // 45 minutes

export type SupersetSession = {
  guestToken: string;
  sessionCookie: string;
  csrfToken: string;
  expiresAt: number;
};

// Single shared session (not keyed per user — matches the original in-memory
// behavior). Persisted to Postgres instead of a module-level variable so it
// survives cold starts on Vercel: without this, every serverless invocation
// that lands on a fresh instance re-runs the full 3-step handshake (guest
// token → embedded session cookie → CSRF token, three round-trips to
// BerryAI/Superset) instead of reusing a still-valid session.
export async function getCachedSession(): Promise<SupersetSession | null> {
  const rows = await sql`SELECT guest_token, session_cookie, csrf_token, expires_at FROM superset_session_cache WHERE id = 1`;
  if (rows.length === 0) return null;
  const row = rows[0] as { guest_token: string; session_cookie: string; csrf_token: string; expires_at: string };
  const expiresAt = new Date(row.expires_at).getTime();
  if (Date.now() >= expiresAt) return null;
  return { guestToken: row.guest_token, sessionCookie: row.session_cookie, csrfToken: row.csrf_token, expiresAt };
}

export async function invalidateSession(): Promise<void> {
  await sql`DELETE FROM superset_session_cache WHERE id = 1`;
}

export async function ensureSession(berryToken: string): Promise<SupersetSession> {
  const existing = await getCachedSession();
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

  const expiresAt = Date.now() + SESSION_TTL_MS;
  await sql`
    INSERT INTO superset_session_cache (id, guest_token, session_cookie, csrf_token, expires_at)
    VALUES (1, ${guest_token}, ${sessionCookie}, ${csrfToken}, ${new Date(expiresAt).toISOString()})
    ON CONFLICT (id)
    DO UPDATE SET guest_token = EXCLUDED.guest_token, session_cookie = EXCLUDED.session_cookie,
                  csrf_token = EXCLUDED.csrf_token, expires_at = EXCLUDED.expires_at
  `;

  return { guestToken: guest_token, sessionCookie, csrfToken, expiresAt };
}
