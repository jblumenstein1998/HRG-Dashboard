/**
 * Acting in Google Drive and Slides as one connected HRG account.
 *
 * Sign-in (lib/users/google.ts) only ever learns who someone is. Writing a deck
 * needs standing access, so an admin connects their account once through the
 * same OAuth client with offline access to Slides and Drive; the refresh token
 * is kept, AES-GCM encrypted under SESSION_SECRET, in one row of
 * `google_connections`. Every deck the dashboard makes is then created as that
 * person, in their Drive, exactly as if they had made it by hand.
 *
 * Same client id and secret as sign-in — the Slides and Drive APIs just have to
 * be enabled on that Cloud project, and this callback registered on the client.
 */

import { sql } from "@/lib/db";
import { ALLOWED_HD } from "@/lib/users/google";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const WORKSPACE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/presentations",
  // Full Drive, not drive.file: copying last week's deck means reading a file
  // this app didn't create.
  "https://www.googleapis.com/auth/drive",
];

/** The one connection the WBR generator uses. */
const CONNECTION_ID = "wbr";

/** Its own cookie, so connecting mid-session can't collide with a sign-in in flight. */
export const WORKSPACE_OAUTH_COOKIE = "hrg_ws_oauth";

export const workspaceRedirectUri =(origin: string) => `${origin}/api/auth/google-slides/callback`;

// ── Storage ──────────────────────────────────────────────────────────────────

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = sql`
      CREATE TABLE IF NOT EXISTS google_connections (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        connected_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `.then(
      () => undefined,
      (err) => {
        schemaReady = null;
        throw err;
      },
    );
  }
  return schemaReady;
}

async function key(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  // Domain-separated from the session HMAC, which uses the same secret.
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`google-refresh:${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

async function seal(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plain));
  return `${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

async function open(sealed: string): Promise<string> {
  const [iv, ct] = sealed.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(ct));
  return new TextDecoder().decode(pt);
}

export type WorkspaceConnection = { email: string; connectedAt: string };

export async function getConnection(): Promise<WorkspaceConnection | null> {
  await ensureSchema();
  const rows = (await sql`SELECT email, connected_at FROM google_connections WHERE id = ${CONNECTION_ID}`) as {
    email: string;
    connected_at: string | Date;
  }[];
  const r = rows[0];
  return r ? { email: r.email, connectedAt: new Date(r.connected_at).toISOString() } : null;
}

export async function disconnect(): Promise<void> {
  cached = null;
  await ensureSchema();
  await sql`DELETE FROM google_connections WHERE id = ${CONNECTION_ID}`;
}

// ── OAuth ────────────────────────────────────────────────────────────────────

function client(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  return { id, secret };
}

export function buildWorkspaceAuthUrl(opts: { origin: string; state: string; challenge: string }): string {
  const params = new URLSearchParams({
    client_id: client().id,
    redirect_uri: workspaceRedirectUri(opts.origin),
    response_type: "code",
    scope: WORKSPACE_SCOPES.join(" "),
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    hd: ALLOWED_HD,
    // offline + consent is what makes Google return a refresh token every
    // time, rather than only on the very first grant.
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

/** Trades the code for tokens and stores the refresh token. Returns the account connected. */
export async function completeWorkspaceAuth(opts: { code: string; verifier: string; origin: string }): Promise<string> {
  const { id, secret } = client();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: id,
      client_secret: secret,
      redirect_uri: workspaceRedirectUri(opts.origin),
      grant_type: "authorization_code",
      code_verifier: opts.verifier,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { refresh_token?: string; id_token?: string; scope?: string };
  if (!body.refresh_token) throw new Error("Google returned no refresh token — try connecting again.");

  const granted = new Set((body.scope ?? "").split(" "));
  const missing = WORKSPACE_SCOPES.filter((s) => s.startsWith("https://") && !granted.has(s));
  if (missing.length) throw new Error(`Access to ${missing.map((s) => s.split("/").pop()).join(" and ")} wasn't granted.`);

  // Same reasoning as sign-in for not verifying the signature: the token came
  // back on our own authenticated server-to-server call.
  const claims = body.id_token
    ? (JSON.parse(Buffer.from(body.id_token.split(".")[1], "base64url").toString()) as { email?: string; hd?: string })
    : {};
  if (!claims.email || claims.hd?.toLowerCase() !== ALLOWED_HD) {
    throw new Error(`Connect an @${ALLOWED_HD} account.`);
  }

  await ensureSchema();
  const sealed = await seal(body.refresh_token);
  await sql`
    INSERT INTO google_connections (id, email, refresh_token)
    VALUES (${CONNECTION_ID}, ${claims.email.toLowerCase()}, ${sealed})
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, refresh_token = EXCLUDED.refresh_token, connected_at = now()
  `;
  return claims.email.toLowerCase();
}

export class NotConnectedError extends Error {
  constructor(message = "Google isn't connected yet — an admin has to connect it first.") {
    super(message);
  }
}

// One generation makes a dozen API calls; refreshing for each would be waste.
let cached: { token: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  await ensureSchema();
  const rows = (await sql`SELECT refresh_token FROM google_connections WHERE id = ${CONNECTION_ID}`) as { refresh_token: string }[];
  if (!rows[0]) throw new NotConnectedError();
  const { id, secret } = client();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: await open(rows[0].refresh_token),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    // Revoked, password reset, or the account left Workspace.
    if (text.includes("invalid_grant")) throw new NotConnectedError("The Google connection has expired — reconnect it.");
    throw new Error(`Google token refresh failed: ${res.status} ${text}`);
  }
  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: access_token, until: Date.now() + (expires_in - 120) * 1000 };
  return access_token;
}

// ── API calls ────────────────────────────────────────────────────────────────

/**
 * One Google API call, retried on what is worth retrying: a dropped connection
 * ("fetch failed"), 429 rate limiting and 5xx. A deck is a dozen calls in a
 * row, and losing the whole thing to one blip on the eleventh is the failure
 * this exists for. Slides batchUpdate is atomic per call, so a retried request
 * never half-applies; the worst case is a retry after a success whose response
 * was lost, which surfaces as a duplicate-id 400 rather than a silent dupe.
 */
async function google<T>(url: string, init: RequestInit = {}): Promise<T> {
  const where = url.split("?")[0];
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...init.headers },
      });
    } catch (err) {
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      throw new Error(`Couldn't reach Google (${where}): ${cause?.code ?? cause?.message ?? String(err)}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`Google API ${res.status} on ${where}: ${await res.text()}`);
    return (await res.json()) as T;
  }
}

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const SLIDES = "https://slides.googleapis.com/v1/presentations";
// The decks live on a shared drive; without these Drive pretends they don't exist.
const ALL_DRIVES = "supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives";

export type DriveFile = { id: string; name: string; createdTime: string; webViewLink: string };

export async function findPresentations(nameContains: string): Promise<DriveFile[]> {
  const q = `name contains '${nameContains.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.presentation' and trashed = false`;
  const res = await google<{ files: DriveFile[] }>(
    `${DRIVE}?${ALL_DRIVES}&orderBy=createdTime desc&pageSize=50&fields=files(id,name,createdTime,webViewLink)&q=${encodeURIComponent(q)}`,
  );
  return res.files ?? [];
}

export async function copyFile(fileId: string, name: string): Promise<DriveFile> {
  return google<DriveFile>(`${DRIVE}/${fileId}/copy?supportsAllDrives=true&fields=id,name,createdTime,webViewLink`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function trashFile(fileId: string): Promise<void> {
  await google(`${DRIVE}/${fileId}?supportsAllDrives=true`, { method: "PATCH", body: JSON.stringify({ trashed: true }) });
}

export async function getPresentation<T>(presentationId: string, fields: string): Promise<T> {
  return google<T>(`${SLIDES}/${presentationId}?fields=${encodeURIComponent(fields)}`);
}

export async function batchUpdate(presentationId: string, requests: Record<string, unknown>[]): Promise<void> {
  if (!requests.length) return;
  await google(`${SLIDES}/${presentationId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
}
