/**
 * Postgres persistence for the Admin tab's link directory.
 *
 * One table, `app_admin_links`, one row per card. The list started life as a
 * constant in lib/adminLinks.ts; it moved here the moment admins could add and
 * remove cards, because a list people edit cannot live in a file that only
 * changes on deploy.
 *
 * `group_title` is plain text rather than a foreign key to a groups table.
 * Groups here are a way of arranging fifty cards on a page, not an entity
 * anything else refers to — no row points at a group, and an empty one is
 * meaningless. Storing the title on the link means adding a card to a new group
 * creates the group and removing the last card retires it, with no orphan rows
 * and no second screen to manage them.
 *
 * Schema creation follows the schema.ts / smgStore.ts pattern: an idempotent
 * ensure* memoised per process, called before every read and write.
 */

import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import {
  SEED_LINK_GROUPS,
  groupRank,
  isSafeUrl,
  type AdminLink,
  type AdminLinkGroup,
} from "./adminLinks";

let schemaReady: Promise<void> | null = null;

export function ensureAdminLinkSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createAdminLinkSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/**
 * Creates the table and, only on a database that has never had it, fills it
 * with the seed catalog.
 *
 * The existence check has to happen *before* the CREATE, because
 * `CREATE TABLE IF NOT EXISTS` succeeds identically whether it built the table
 * or found it, and this needs to tell those apart. Seeding on "the table is
 * empty" instead would be a real bug rather than a stylistic one: an admin who
 * deleted every card would watch all fifty-one reappear at the next cold start.
 *
 * Two instances cold-starting together can both see the table missing and both
 * seed. The ids are derived from the seed content rather than random, so the
 * second insert collides on the primary key and does nothing — which is why
 * `seedId` exists and why this doesn't need a lock.
 */
async function createAdminLinkSchema(): Promise<void> {
  const [probe] = (await sql`
    SELECT to_regclass('public.app_admin_links') IS NOT NULL AS present
  `) as { present: boolean }[];
  const isNew = !probe?.present;

  await sql`
    CREATE TABLE IF NOT EXISTS app_admin_links (
      id          TEXT PRIMARY KEY,
      group_title TEXT NOT NULL,
      label       TEXT NOT NULL,
      url         TEXT NOT NULL,
      -- Retired: cards used to show a one-line description and no longer do.
      -- Kept rather than dropped because dropping is one-way on a live
      -- database and reclaims nothing, and the DEFAULT means no write has to
      -- mention it. No read mentions it either -- see toLink. If it is still
      -- here and still unread in a year, that is the time to drop it.
      note        TEXT NOT NULL DEFAULT '',
      -- Aliases the filter should match beyond the label. Free text, space
      -- separated; empty when whoever added the card supplied none. This is
      -- the only way a card is findable by anything but its own name.
      search      TEXT NOT NULL DEFAULT '',
      -- Position within the group. Seeded rows keep the catalog's order; a card
      -- added later sorts after them, which is also the order it was added in.
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS app_admin_links_group_idx
      ON app_admin_links (group_title, sort_order)
  `;

  if (!isNew) return;

  for (const group of SEED_LINK_GROUPS) {
    for (const [i, link] of group.links.entries()) {
      await sql`
        INSERT INTO app_admin_links (id, group_title, label, url, search, sort_order)
        VALUES (
          ${seedId(group.title, link.label)},
          ${group.title},
          ${link.label},
          ${link.url},
          ${link.search ?? ""},
          ${i}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }
  }
}

/**
 * A stable id for a seeded row, so a concurrent double-seed collides instead of
 * duplicating. Prefixed `seed:` purely so it's obvious in the table which rows
 * came from the catalog and which someone typed.
 */
function seedId(groupTitle: string, label: string): string {
  const slug = `${groupTitle}-${label}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `seed:${slug}`;
}

const toLink = (r: Record<string, unknown>): AdminLink => ({
  id: String(r.id),
  label: String(r.label),
  url: String(r.url),
  search: String(r.search ?? ""),
});

/**
 * The whole directory, grouped and ordered the way the page renders it.
 *
 * Grouping happens here rather than in the component so the client receives
 * exactly what it draws. Ordering is by `groupRank` — the seed's deliberate
 * order, with admin-invented groups after it — then by each row's position
 * within its group.
 */
export async function listAdminLinkGroups(): Promise<AdminLinkGroup[]> {
  await ensureAdminLinkSchema();
  const rows = (await sql`
    SELECT * FROM app_admin_links ORDER BY sort_order, label
  `) as Record<string, unknown>[];

  const byTitle = new Map<string, AdminLink[]>();
  for (const r of rows) {
    const title = String(r.group_title);
    const list = byTitle.get(title);
    if (list) list.push(toLink(r));
    else byTitle.set(title, [toLink(r)]);
  }

  return [...byTitle.entries()]
    .sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b))
    .map(([title, links]) => ({ title, links }));
}

/** The group names already in use, for the add form's suggestions. */
export async function listAdminLinkGroupTitles(): Promise<string[]> {
  await ensureAdminLinkSchema();
  const rows = (await sql`
    SELECT DISTINCT group_title FROM app_admin_links
  `) as { group_title: string }[];
  return rows
    .map((r) => r.group_title)
    .sort((a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b));
}

export type AdminLinkInput = {
  groupTitle: string;
  label: string;
  url: string;
  search?: string;
};

type CleanInput = { groupTitle: string; label: string; url: string; search: string };

/**
 * Trims and checks the fields both writes share.
 *
 * Returns the problem as a string rather than throwing, matching
 * `deletePosition` in lib/users/store.ts: the caller is an API route that has
 * to turn it into a status code either way, and a thrown error there is
 * indistinguishable from the database being down.
 *
 * The URL check is not cosmetic — see `isSafeUrl`. It runs here as well as in
 * the browser because the browser's copy is a convenience and this one is the
 * control, and it has to run on the *edit* path too: a card that was safe when
 * it was added is not thereby safe after someone changes its address.
 */
function clean(input: AdminLinkInput): { ok: CleanInput } | { error: string } {
  const groupTitle = input.groupTitle.trim();
  const label = input.label.trim();
  const url = input.url.trim();
  const search = (input.search ?? "").trim();

  if (!groupTitle) return { error: "Pick or name a group." };
  if (!label) return { error: "Give the card a name." };
  if (label.length > 60) return { error: "Name is too long (60 characters max)." };
  if (!isSafeUrl(url)) return { error: "Enter a full http:// or https:// address." };
  if (groupTitle.length > 60) return { error: "Group name is too long (60 characters max)." };

  return { ok: { groupTitle, label, url, search } };
}

/** Adds a card, or returns why it can't. */
export async function createAdminLink(
  input: AdminLinkInput,
): Promise<{ link: AdminLink } | { error: string }> {
  await ensureAdminLinkSchema();

  const checked = clean(input);
  if ("error" in checked) return checked;
  const { groupTitle, label, url, search } = checked.ok;

  const rows = (await sql`
    INSERT INTO app_admin_links (id, group_title, label, url, search, sort_order)
    VALUES (
      ${randomUUID()},
      ${groupTitle},
      ${label},
      ${url},
      ${search},
      ${await tailOf(groupTitle)}
    )
    RETURNING *
  `) as Record<string, unknown>[];

  return { link: toLink(rows[0]) };
}

/**
 * Edits a card — including moving it to another group, which is the reason
 * this exists rather than remove-and-re-add.
 *
 * Recategorising has to renumber, not just relabel: `sort_order` is only
 * meaningful within a group, so a card keeping its old number would land at an
 * arbitrary point in the new group — quite possibly interleaved with cards it
 * has nothing to do with. Moving one therefore appends it to the end of its
 * destination, the same place a newly added card goes, which is the only
 * position that doesn't silently reorder what was already there. A card staying
 * put keeps its number, so editing a name never makes a card jump.
 */
export async function updateAdminLink(
  id: string,
  input: AdminLinkInput,
): Promise<{ link: AdminLink } | { error: string }> {
  await ensureAdminLinkSchema();

  const checked = clean(input);
  if ("error" in checked) return checked;
  const { groupTitle, label, url, search } = checked.ok;

  const [current] = (await sql`
    SELECT group_title, sort_order FROM app_admin_links WHERE id = ${id}
  `) as { group_title: string; sort_order: number }[];
  if (!current) return { error: "That card no longer exists." };

  const moved = current.group_title !== groupTitle;
  const sortOrder = moved ? await tailOf(groupTitle) : current.sort_order;

  const rows = (await sql`
    UPDATE app_admin_links
    SET group_title = ${groupTitle},
        label       = ${label},
        url         = ${url},
        search      = ${search},
        sort_order  = ${sortOrder}
    WHERE id = ${id}
    RETURNING *
  `) as Record<string, unknown>[];

  return { link: toLink(rows[0]) };
}

/** The next free position at the bottom of a group. */
async function tailOf(groupTitle: string): Promise<number> {
  const [row] = (await sql`
    SELECT COALESCE(MAX(sort_order), -1) AS last
    FROM app_admin_links WHERE group_title = ${groupTitle}
  `) as { last: number }[];
  return Number(row?.last ?? -1) + 1;
}

/** Removes a card. Returns false when the id matched nothing. */
export async function deleteAdminLink(id: string): Promise<boolean> {
  await ensureAdminLinkSchema();
  const rows = (await sql`
    DELETE FROM app_admin_links WHERE id = ${id} RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}
