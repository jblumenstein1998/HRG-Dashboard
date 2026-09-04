// Run with:  node --env-file=.env.local scripts/migrate-workstream-links.mjs
// Creates the PAR ↔ Workstream employee link table in Neon. Safe to re-run.
//
// Mirrors ensureWorkstreamLinkSchema() in src/lib/workstreamLinkStore.ts, which
// runs before every read and write — so strictly this isn't required. It exists
// because the Workstream Links screen reads before anything has ever written,
// and because the two partial unique indexes below are the part of the design
// worth being able to inspect on a live database without reading the app.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS workstream_employee_links (
    par_store_id    TEXT NOT NULL,
    par_employee_id TEXT NOT NULL,
    -- Empty string for an 'absent' decision: there is no counterpart to name,
    -- and NULL would defeat the primary key.
    workstream_uuid TEXT NOT NULL DEFAULT '',
    -- 'confirmed' | 'absent' | 'rejected'
    status          TEXT NOT NULL,
    decided_by      TEXT NOT NULL DEFAULT '',
    decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    note            TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (par_store_id, par_employee_id, workstream_uuid)
  )
`;

// One live decision per PAR employee; any number of rejections alongside it.
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS workstream_links_one_per_par_employee
    ON workstream_employee_links (par_store_id, par_employee_id)
    WHERE status <> 'rejected'
`;

// A Workstream person is claimed at most once per store. Per store rather than
// globally: PAR employee ids are per location, so somebody working two
// restaurants is legitimately two PAR rows pointing at one Workstream uuid.
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS workstream_links_one_per_workstream_person
    ON workstream_employee_links (par_store_id, workstream_uuid)
    WHERE status = 'confirmed'
`;

const [{ count }] = await sql`SELECT count(*)::int AS count FROM workstream_employee_links`;
console.log(`workstream_employee_links ready — ${count} decision${count === 1 ? "" : "s"} recorded.`);
