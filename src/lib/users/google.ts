/**
 * Google Sign-In (OAuth 2.0 authorization code flow, with PKCE).
 *
 * Every account is on one Google Workspace domain, so identity is delegated
 * entirely: the dashboard never sees or stores a password, there is nothing to
 * reset, and offboarding someone from Workspace ends their dashboard access as
 * a side effect.
 *
 * Google only *authenticates*. It says who you are; app_users and app_positions
 * still decide whether you may sign in at all and what you can reach. Being an
 * @hudsonrestaurantgroup.com account is not enough — an administrator has to
 * have added you.
 */

/** Only these accounts may sign in. Checked server-side, not merely hinted. */
export const ALLOWED_HD = "hudsonrestaurantgroup.com";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Carries the CSRF state and the PKCE verifier across the round trip. */
export const OAUTH_COOKIE = "hrg_oauth";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function clientId(): string {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new Error("GOOGLE_CLIENT_ID is not set");
  return v;
}

function clientSecret(): string {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new Error("GOOGLE_CLIENT_SECRET is not set");
  return v;
}

/**
 * The redirect target, derived from the request rather than configured.
 *
 * Vercel serves preview deployments on generated hostnames; a hardcoded URL
 * would work in production and nowhere else. Whatever origin the browser
 * actually reached is the one Google must send it back to — and it has to be
 * registered in the Google Cloud console either way, so this can't be abused
 * to redirect somewhere unregistered.
 */
export const redirectUri = (origin: string) => `${origin}/api/auth/google/callback`;

const b64url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

export function buildAuthUrl(opts: {
  origin: string;
  state: string;
  challenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(opts.origin),
    response_type: "code",
    scope: "openid email profile",
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    // A hint that pre-filters the account chooser to the work domain. It is
    // NOT a security control — the callback re-checks the domain itself.
    hd: ALLOWED_HD,
    // Always show the chooser, so someone signed into a personal account can
    // pick their work one instead of being silently refused.
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

export type GoogleIdentity = { email: string; name: string | null };

/**
 * Trades the authorization code for an ID token and returns the identity.
 *
 * The ID token's signature is deliberately not verified. In the authorization
 * code flow the token arrives in the *response to our own* server-to-server
 * POST, authenticated with the client secret over TLS — Google's documentation
 * explicitly says signature validation can be skipped in that case, because
 * there is no untrusted party in the path. Everything a signature wouldn't tell
 * us is still checked below: issuer, audience, expiry, verified email, domain.
 */
export async function exchangeCode(opts: {
  code: string;
  verifier: string;
  origin: string;
}): Promise<GoogleIdentity> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(opts.origin),
      grant_type: "authorization_code",
      code_verifier: opts.verifier,
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }

  const { id_token: idToken } = (await res.json()) as { id_token?: string };
  if (!idToken) throw new Error("Google returned no id_token");

  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed id_token");

  const claims = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
    ),
  ) as {
    iss?: string;
    aud?: string;
    exp?: number;
    email?: string;
    email_verified?: boolean;
    hd?: string;
    name?: string;
  };

  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") {
    throw new Error("Unexpected id_token issuer");
  }
  if (claims.aud !== clientId()) throw new Error("id_token was issued for another client");
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error("id_token has expired");
  if (!claims.email) throw new Error("id_token carried no email");

  // An unverified address could be one the account holder doesn't control.
  if (claims.email_verified !== true) throw new Error("That Google account's email isn't verified");

  // The real domain check. `hd` is present for Workspace accounts; comparing the
  // address too catches a consumer account that happens to use the domain.
  const domain = claims.email.split("@")[1]?.toLowerCase();
  if (claims.hd?.toLowerCase() !== ALLOWED_HD || domain !== ALLOWED_HD) {
    throw new Error(`Only ${ALLOWED_HD} accounts can sign in`);
  }

  return { email: claims.email.toLowerCase(), name: claims.name ?? null };
}

export { randomToken };
