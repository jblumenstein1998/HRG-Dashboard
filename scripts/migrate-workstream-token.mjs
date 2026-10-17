// Run with:  node --env-file=.env.local scripts/migrate-workstream-token.mjs
//
// Creates the single-row table holding the live Workstream API token, and seeds
// it by refreshing whatever token the environment currently has.
//
// Mirrors ensureWorkstreamTokenSchema() in src/lib/workstreamToken.ts, which
// runs before every read and write, so strictly the table creation is not
// required. The seeding is: it moves a deployment off the hand-pasted token in
// one step, and proves the client credentials work before anything depends on
// them.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const BASE = "https://public-api.workstream.us";

await sql`
  CREATE TABLE IF NOT EXISTS workstream_token (
    id           TEXT PRIMARY KEY,
    token        TEXT NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    name         TEXT NOT NULL DEFAULT ''
  )
`;

const [existing] = await sql`
  SELECT token, expires_at FROM workstream_token WHERE id = 'current'`;

const clientId = process.env.WORKSTREAM_CLIENT_ID;
const clientSecret = process.env.WORKSTREAM_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set WORKSTREAM_CLIENT_ID and WORKSTREAM_CLIENT_SECRET first.");
  process.exit(1);
}

// Refresh whatever we already hold — the stored token if there is one, the
// environment's otherwise. Refreshing rather than minting keeps the company to
// a single live token instead of leaving the old one alive beside the new.
const previous = existing?.token ?? process.env.WORKSTREAM_ACCESS_TOKEN;
if (!previous) {
  console.error("No token to refresh. Paste one into WORKSTREAM_ACCESS_TOKEN to seed from.");
  process.exit(1);
}

const params = new URLSearchParams({
  grant_type: "client_credentials",
  client_id: clientId,
  client_secret: clientSecret,
  token: previous,
});

const res = await fetch(`${BASE}/tokens/refresh_token?${params}`, {
  method: "POST",
  headers: { Accept: "application/json" },
});
const body = await res.text();
if (!res.ok) {
  console.error(`refresh failed: ${res.status} ${body.slice(0, 300)}`);
  process.exit(1);
}

const parsed = JSON.parse(body);
const token = parsed.token ?? parsed.access_token;
const expiresAt = new Date(Date.now() + (Number(parsed.expires_in) || 604800) * 1000);

await sql`
  INSERT INTO workstream_token (id, token, expires_at, refreshed_at, name)
  VALUES ('current', ${token}, ${expiresAt.toISOString()}, now(), ${parsed.name ?? ""})
  ON CONFLICT (id) DO UPDATE SET
    token = EXCLUDED.token, expires_at = EXCLUDED.expires_at,
    refreshed_at = now(), name = EXCLUDED.name
`;

console.log(
  `workstream_token ready — "${parsed.name}" valid until ${expiresAt.toISOString()}`
    + ` (${parsed.scopes?.length ?? 0} scopes).`,
);
console.log("The previous token has been retired by Workstream.");
