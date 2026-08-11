// Run with:  node --env-file=.env.local scripts/seed-roster.mjs
//
// Loads the HRG roster: three positions and the people in them. Idempotent —
// existing accounts keep their password and their position is left alone, so
// re-running after someone has signed in doesn't disturb them.
//
// Prints a temporary password for every account it creates. That is the only
// time it is readable; it is stored hashed and nothing can show it again.
// Hand them out, then discard the list. Everyone is forced to choose their own
// password at first login.
import { neon } from "@neondatabase/serverless";
import { randomBytes, randomUUID, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const sql = neon(process.env.DATABASE_URL);

const N = 65536, R = 8, P = 1, KEY_LEN = 32;
async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LEN, {
    N, r: R, p: P, maxmem: 128 * N * R * 2,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const tempPassword = (len = 12) =>
  Array.from(randomBytes(len), (b) => ALPHABET[b % ALPHABET.length]).join("");

const ALL = ["/dashboard", "/food-cost", "/par", "/survey-data", "/bonus"];
const OPS = ["/dashboard", "/food-cost", "/par", "/survey-data"];

// Bonus is restricted to Administrator for now — it's still being built. Change
// it in the admin screen, not here; this script won't overwrite an edited row.
const POSITIONS = [
  { id: "administrator", label: "Administrator", tabs: ALL, isAdmin: true },
  { id: "director_of_operations", label: "Director of Operations", tabs: OPS, isAdmin: false },
  { id: "district_manager", label: "District Manager", tabs: OPS, isAdmin: false },
];

const ROSTER = [
  ["Josh Blumenstein",  "josh@hudsonrestaurantgroup.com",             "administrator"],
  ["Connor Lynn",       "connor@hudsonrestaurantgroup.com",           "administrator"],
  ["Derek Qualls",      "derek.qualls@hudsonrestaurantgroup.com",     "director_of_operations"],
  ["Preston James",     "preston.james@hudsonrestaurantgroup.com",    "director_of_operations"],
  ["Maegan McAlister",  "maegan.mcalister@hudsonrestaurantgroup.com", "district_manager"],
  ["Tommy Demorest",    "tommy.demorest@hudsonrestaurantgroup.com",   "district_manager"],
  ["Latonya Hall",      "latonya.hall@hudsonrestaurantgroup.com",     "district_manager"],
  ["Star Allen",        "star.allen@hudsonrestaurantgroup.com",       "district_manager"],
  ["Corey Stephens",    "corey.stephens@hudsonrestaurantgroup.com",   "district_manager"],
];

for (const p of POSITIONS) {
  await sql`
    INSERT INTO app_positions (id, label, tabs, is_admin)
    VALUES (${p.id}, ${p.label}, ${p.tabs}::text[], ${p.isAdmin})
    ON CONFLICT (id) DO NOTHING
  `;
}
console.log(`positions: ${POSITIONS.map((p) => p.id).join(", ")}`);

// Pass --reissue to generate a fresh temporary password for anyone who has
// never signed in. Safe by construction: an account with last_login_at set is
// left alone, so this can't take a working password away from someone.
const reissue = process.argv.includes("--reissue");

const issued = [];
for (const [name, email, positionId] of ROSTER) {
  const [existing] = await sql`
    SELECT id, last_login_at FROM app_users WHERE lower(email) = lower(${email})
  `;
  if (existing) {
    await sql`UPDATE app_users SET name = ${name} WHERE id = ${existing.id}`;

    if (reissue && !existing.last_login_at) {
      const password = tempPassword();
      await sql`
        UPDATE app_users
        SET password_hash = ${await hashPassword(password)},
            must_reset    = TRUE,
            token_version = token_version + 1
        WHERE id = ${existing.id}
      `;
      issued.push([name, email, password]);
      console.log(`  ~ ${email.padEnd(45)} new temporary password`);
    } else {
      console.log(`  = ${email.padEnd(45)} already exists${existing.last_login_at ? " (has signed in)" : ""}`);
    }
    continue;
  }
  const password = tempPassword();
  await sql`
    INSERT INTO app_users (id, email, name, position_id, password_hash, must_reset)
    VALUES (${randomUUID()}, ${email.toLowerCase()}, ${name}, ${positionId},
            ${await hashPassword(password)}, TRUE)
  `;
  issued.push([name, email, password]);
  console.log(`  + ${email.padEnd(45)} created`);
}

// The seed positions from migrate-users.mjs that nobody is in. `= ANY($1)` with
// a text[] parameter, not `IN ${sql(...)}` — that's a postgres.js idiom and the
// Neon driver rejects any call that isn't a tagged template.
const keep = POSITIONS.map((p) => p.id);
const removed = await sql`
  DELETE FROM app_positions
  WHERE NOT (id = ANY(${keep}::text[]))
    AND id NOT IN (SELECT DISTINCT position_id FROM app_users)
  RETURNING id
`;
if (removed.length) console.log(`removed unused positions: ${removed.map((r) => r.id).join(", ")}`);

if (issued.length) {
  console.log("\n═══════ temporary passwords — hand out, then discard ═══════");
  for (const [name, email, password] of issued) {
    console.log(`  ${name.padEnd(20)} ${email.padEnd(45)} ${password}`);
  }
  console.log("═".repeat(62));
  console.log("Everyone is forced to choose their own password at first login.\n");
}

const summary = await sql`
  SELECT p.label, COUNT(u.id)::int AS n, p.tabs, p.is_admin
  FROM app_positions p LEFT JOIN app_users u ON u.position_id = p.id
  GROUP BY p.id, p.label, p.tabs, p.is_admin ORDER BY p.label
`;
console.log("positions now:");
for (const r of summary) {
  console.log(`  ${r.label.padEnd(24)} ${String(r.n).padStart(2)} user(s)  ${r.is_admin ? "[admin] " : "        "}${r.tabs.join(" ")}`);
}
