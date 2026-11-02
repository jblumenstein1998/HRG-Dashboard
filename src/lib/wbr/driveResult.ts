/**
 * Reading what a "Save to Google Drive" round trip left in the page's address
 * (lib/wbr/driveSave sends the browser back with ?drive=saved|error&…).
 *
 * The link is only ever shown if it's Google's own — the query string is the
 * visitor's to edit, so anything else is dropped rather than put behind a
 * button.
 */

import type { DriveResult } from "@/components/StoreDeckPanel";

export type Search = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function driveResultOf(q: Search): DriveResult | null {
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
