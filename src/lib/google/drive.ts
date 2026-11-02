/**
 * Saving a file into the signed-in person's own Google Drive.
 *
 * Sign-in (lib/users/google.ts) only learns who someone is. Writing to their
 * Drive needs their say-so, asked for at the moment they press the button:
 * the same OAuth client, the narrow `drive.file` scope (files this app creates,
 * nothing else in their Drive), and the sign-in callback URL that's already
 * registered with Google — the state carries a "d_" prefix so the callback can
 * tell a Drive save from a sign-in.
 *
 * No token is kept. The access token Google returns is used for the one upload
 * and dropped; the next save asks Google again, which after the first consent
 * passes straight back without a prompt.
 */

import { ALLOWED_HD, redirectUri } from "@/lib/users/google";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Marks a Drive-save round trip in the OAuth `state`, so the shared callback can route it. */
export const DRIVE_STATE_PREFIX = "d_";

/** Holds the state, PKCE verifier and what to build, across the trip to Google. */
export const DRIVE_COOKIE = "hrg_drive_oauth";

/** The folder decks go into, in the person's My Drive; created on first save. */
export const DRIVE_FOLDER = "Store Reviews";

function client(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Google isn't configured on this deployment.");
  return { id, secret };
}

export function buildDriveAuthUrl(opts: { origin: string; state: string; challenge: string; email: string }): string {
  const params = new URLSearchParams({
    client_id: client().id,
    redirect_uri: redirectUri(opts.origin),
    response_type: "code",
    // openid + email so the callback can check it's the same person who's signed in.
    scope: `openid email ${DRIVE_SCOPE}`,
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    // Straight to their work account; no chooser, and no prompt once they've agreed.
    login_hint: opts.email,
    hd: ALLOWED_HD,
    include_granted_scopes: "true",
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

/** Trades the code for an access token, and says whose it is. */
export async function exchangeDriveCode(opts: { code: string; verifier: string; origin: string }): Promise<{ accessToken: string; email: string }> {
  const { id, secret } = client();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri(opts.origin),
      grant_type: "authorization_code",
      code_verifier: opts.verifier,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token?: string; id_token?: string; scope?: string };
  if (!body.access_token) throw new Error("Google returned no access token.");
  if (!body.scope?.split(" ").includes(DRIVE_SCOPE)) throw new Error("Google Drive access wasn't granted.");
  // As at sign-in: the id_token came back on our own TLS call, authenticated
  // with the client secret, so its claims are read rather than its signature checked.
  const claims = JSON.parse(Buffer.from((body.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8") || "{}") as {
    email?: string;
    email_verified?: boolean;
    hd?: string;
  };
  if (!claims.email || !claims.email_verified || claims.hd !== ALLOWED_HD) throw new Error("That isn't an HRG Google account.");
  return { accessToken: body.access_token, email: claims.email.toLowerCase() };
}

async function drive<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!res.ok) {
    const text = await res.text();
    // The usual first-time failure, worth saying plainly.
    if (/has not been used|is disabled/i.test(text)) throw new Error("The Google Drive API isn't enabled on the dashboard's Google Cloud project.");
    throw new Error(`Google Drive ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/** The "Store Reviews" folder this app made in their My Drive, made now if it isn't there. */
async function folderId(token: string): Promise<string> {
  // drive.file only sees what this app created, so this finds our folder and nothing else.
  const q = `name = '${DRIVE_FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const found = await drive<{ files: { id: string }[] }>(token, `${DRIVE}/files?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1" })}`);
  if (found.files[0]) return found.files[0].id;
  const made = await drive<{ id: string }>(token, `${DRIVE}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: "application/vnd.google-apps.folder" }),
  });
  return made.id;
}

/**
 * Uploads a .pptx into the Store Reviews folder, converted to Google Slides.
 * Returns the Slides link.
 */
export async function saveDeckToDrive(token: string, name: string, pptx: Uint8Array): Promise<{ id: string; url: string }> {
  const parent = await folderId(token);
  const boundary = `hrg${crypto.randomUUID().replace(/-/g, "")}`;
  const meta = JSON.stringify({ name, mimeType: "application/vnd.google-apps.presentation", parents: [parent] });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const file = await drive<{ id: string; webViewLink?: string }>(token, `${UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([head, Buffer.from(pptx), tail]),
  });
  return { id: file.id, url: file.webViewLink ?? `https://docs.google.com/presentation/d/${file.id}/edit` };
}
