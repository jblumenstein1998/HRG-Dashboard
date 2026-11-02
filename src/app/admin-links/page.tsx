import AdminTabClient from "@/components/AdminTabClient";
import { requireTab } from "@/lib/users/access";
import { buildOperatingTargets } from "@/lib/operatingTargets";
import { todayCentralISO } from "@/lib/parRollup";
import { recentWbrWeeks } from "@/lib/wbr/weeks";
import { storeDeckOptions } from "@/lib/wbr/storeData";
import type { DriveResult } from "@/components/StoreDeckPanel";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * What a "Save to Google Drive" round trip left in the address. The link is
 * only ever shown if it's Google's own — the query string is the visitor's to
 * edit, so anything else is dropped rather than put behind a button.
 */
function driveResultOf(q: Search): DriveResult | null {
  const status = one(q.drive);
  if (status === "error") return { status, message: one(q.msg).slice(0, 500) || "Something went wrong." };
  if (status !== "saved") return null;
  const url = one(q.url);
  if (!/^https:\/\/(docs|drive)\.google\.com\//.test(url)) return null;
  let warnings: string[] = [];
  try {
    const w = JSON.parse(one(q.warn) || "[]");
    if (Array.isArray(w)) warnings = w.filter((x): x is string => typeof x === "string").slice(0, 20);
  } catch {
    // No warnings shown rather than a broken page.
  }
  return { status, url, name: one(q.name).slice(0, 200), warnings };
}

/**
 * The Admin tab.
 *
 * Routed at /admin-links rather than /admin because /admin is already Users &
 * Access. The route name is a leftover from when this tab was a directory of
 * links (removed 2026-10-29); renaming it would break bookmarks for a cosmetic
 * gain, and the tab *label* — what anyone actually sees — is "Admin".
 */
export default async function AdminTabPage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requireTab("/admin-links");
  const q = await searchParams;
  return (
    <AdminTabClient
      tabs={viewer.position.tabs}
      isAdmin={viewer.position.isAdmin}
      targets={buildOperatingTargets()}
      deckWeeks={recentWbrWeeks(todayCentralISO(), 26)}
      deckStores={storeDeckOptions()}
      canDrive={!!viewer.user.email}
      driveResult={driveResultOf(q)}
      initialStore={one(q.store)}
      initialWeekEnd={one(q.weekEnd)}
    />
  );
}
