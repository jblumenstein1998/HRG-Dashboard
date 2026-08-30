// Local dev helper: mint an hrg_session cookie for an admin so API routes and
// gated pages can be curled without the Google OAuth round trip.
//
//   node --env-file=.env.local scripts/mint-session.mjs [email]
//
// Prints the cookie value. Mirrors signSession() in src/lib/users/session.ts.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const email = process.argv[2] ?? "josh@hudsonrestaurantgroup.com";

const [user] = await sql`
  SELECT u.id, u.position_id, u.token_version, p.is_admin, p.tabs
  FROM app_users u JOIN app_positions p ON p.id = u.position_id
  WHERE u.email = ${email}
`;
if (!user) { console.error(`no app_users row for ${email}`); process.exit(1); }

const enc = new TextEncoder();
const b64 = b => Buffer.from(b).toString("base64url");
const payload = {
  uid: user.id, pos: user.position_id, ver: user.token_version,
  exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
};
const body = b64(enc.encode(JSON.stringify(payload)));
const key = await crypto.subtle.importKey(
  "raw", enc.encode(process.env.SESSION_SECRET),
  { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
);
const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));

console.error(`# ${email}  admin=${user.is_admin}  tabs=${JSON.stringify(user.tabs)}`);
console.log(`${body}.${b64(new Uint8Array(sig))}`);
