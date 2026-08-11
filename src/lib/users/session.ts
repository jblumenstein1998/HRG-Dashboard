/**
 * The dashboard session cookie.
 *
 * A signed, self-describing token — `base64url(payload).base64url(hmac)` — not
 * a database session id. Middleware runs on every single request including
 * every page navigation, and it runs on the Edge runtime where the Neon driver
 * isn't available; a stateless token means the "are you signed in?" check costs
 * an HMAC verify and no round trip.
 *
 * Signed with Web Crypto rather than node:crypto so this exact module works
 * unchanged in middleware *and* in Node route handlers. No JWT library: the
 * payload is ours, the algorithm is fixed, and `jose` would add a dependency to
 * do the same HMAC.
 *
 * What it deliberately does NOT carry: the position's tab list. Positions are
 * editable in the admin UI, and baking permissions into the token would mean an
 * edit didn't take effect until everyone signed in again. The token says *who*
 * you are; what you may reach is resolved per request from the database (see
 * lib/users/access.ts), which is cheap because it happens in server components
 * that are already hitting Postgres.
 */

export const SESSION_COOKIE = "hrg_session";

/** Twelve hours: a working day, so nobody is signed out mid-shift. */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export type SessionPayload = {
  /** app_users.id */
  uid: string;
  /** app_users.position_id — a hint for the nav, re-checked server-side. */
  pos: string;
  /** app_users.token_version when minted; a bump invalidates this token. */
  ver: number;
  /** Whether the user still owes us a password change. */
  rst: boolean;
  /** Unix seconds. */
  exp: number;
};

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET is missing or shorter than 32 characters");
  }
  return s;
}

const enc = new TextEncoder();

const toB64Url = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of view) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

// Built by allocation rather than Uint8Array.from so the result is typed as
// ArrayBuffer-backed, which is what crypto.subtle's BufferSource requires.
const fromB64Url = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(payload: Omit<SessionPayload, "exp">): Promise<string> {
  const full: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const body = toB64Url(enc.encode(JSON.stringify(full)));
  const sig = await crypto.subtle.sign("HMAC", await key(), enc.encode(body));
  return `${body}.${toB64Url(sig)}`;
}

/**
 * Verifies signature and expiry. Returns null for anything it doesn't like —
 * tampered, truncated, expired, or signed with a rotated secret — so callers
 * treat every failure the same way: not signed in.
 *
 * `crypto.subtle.verify` is constant-time, which is why the signature is
 * checked with it rather than by comparing strings.
 */
export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await key(),
      fromB64Url(sig),
      enc.encode(body),
    );
    if (!ok) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromB64Url(body))) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    if (!payload.uid || !payload.pos) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Cookie attributes, shared by the routes that set and clear it. */
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};
