// Run with:  node --env-file=.env.local scripts/migrate-admin-links-tab.mjs
//
// Grants the new "Admin" tab (/admin-links) to every admin position.
//
// No schema change — app_positions.tabs is already a text[], and the tab
// vocabulary lives in code (src/lib/users/tabs.ts). What this fixes is a
// bootstrap gap: adding a tab to ALL_TABS makes it *grantable* in the Users &
// Access screen but grants it to nobody, so the person who would go tick the
// box can't see the tab they're trying to reach until they tick it. Seeding the
// admin positions closes that loop; everyone else is granted the tab by hand,
// which is the point of having positions.
//
// Safe to re-run: the array update is idempotent, and a position that already
// carries the tab is left alone rather than gaining a duplicate entry.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const TAB = "/admin-links";

const granted = await sql`
  UPDATE app_positions
  SET tabs = array_append(tabs, ${TAB})
  WHERE is_admin = TRUE
    AND NOT (${TAB} = ANY(tabs))
  RETURNING label
`;

if (granted.length) {
  console.log(`granted ${TAB} to: ${granted.map((r) => r.label).join(", ")}`);
} else {
  console.log(`no change — every admin position already has ${TAB}`);
}

const summary = await sql`
  SELECT p.label, COUNT(u.id)::int AS n, p.tabs, p.is_admin
  FROM app_positions p LEFT JOIN app_users u ON u.position_id = p.id
  GROUP BY p.id, p.label, p.tabs, p.is_admin ORDER BY p.label
`;
console.log("\npositions now:");
for (const r of summary) {
  console.log(
    `  ${r.label.padEnd(24)} ${String(r.n).padStart(2)} user(s)  ${r.is_admin ? "[admin] " : "        "}${r.tabs.join(" ")}`,
  );
}
