import { BERRY_API_BASE } from "@/lib/berry";
import { loginBerryService } from "@/lib/berryAuth";

/**
 * Credentials for calling BerryAI.
 *
 * These used to be the signed-in user's own: `/api/auth/login` forwarded the
 * email and password to BerryAI and kept its token in the `berry_token` cookie,
 * so the cookie was simultaneously the dashboard session and the vendor
 * credential. That coupled two unrelated things — nobody could have a dashboard
 * account without a BerryAI seat, and revoking dashboard access meant changing
 * a credential other people were using.
 *
 * BerryAI is now a back-end service account (BERRY_EMAIL / BERRY_PASSWORD),
 * the same one the crons have always used. Dashboard sessions are separate and
 * live in lib/users/session.ts.
 *
 * The routes that call this are *not* public — the proxy rejects an
 * unauthenticated request to /api/berry/ before it reaches them — so this
 * returning a working token isn't an open door to the vendor's data.
 */

type Cached = { token: string; corpId: string; at: number };

/**
 * Cached per process. A Berry login is a round trip, and these routes are hit
 * several times per page load; without this, opening the Drive-Thru tab would
 * re-authenticate half a dozen times. Twenty minutes is comfortably inside the
 * token's life and short enough that a rotated password takes effect quickly.
 */
const TTL_MS = 20 * 60 * 1000;
let cached: Cached | null = null;
let inFlight: Promise<Cached> | null = null;

async function login(): Promise<Cached> {
  const token = await loginBerryService();

  // corpId comes from the account itself, and every caller that needs it wants
  // the service account's — the same corp the crons already read.
  let corpId = "";
  try {
    const meRes = await fetch(`${BERRY_API_BASE}/user/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (meRes.ok) corpId = (await meRes.json())?.corp?.id ?? "";
  } catch {
    // A missing corp id degrades one endpoint rather than breaking the login.
  }

  return { token, corpId, at: Date.now() };
}

export async function getBerryAuth(): Promise<{ token: string; corpId: string }> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached;

  // Collapse concurrent misses into one login instead of racing several.
  inFlight ??= login()
    .then((c) => {
      cached = c;
      return c;
    })
    .finally(() => {
      inFlight = null;
    });

  try {
    return await inFlight;
  } catch {
    // Callers check for an empty token and return 401/502 themselves; throwing
    // here would turn a vendor outage into an unhandled error on every route.
    return { token: "", corpId: "" };
  }
}
