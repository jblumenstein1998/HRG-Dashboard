/**
 * The tab vocabulary, with no server-only imports.
 *
 * Deliberately its own module rather than living in schema.ts. Client
 * components need TAB_LABELS to render the nav, and schema.ts imports the Neon
 * client for its DDL — so importing one constant from there pulled `neon()`
 * into every page's browser bundle, where DATABASE_URL is undefined by design
 * and the call threw at module evaluation.
 *
 * Rule of thumb this exists to enforce: anything a "use client" file imports
 * must not transitively reach lib/db.
 */

export const ALL_TABS = [
  "/dashboard",
  "/food-cost",
  "/par",
  "/survey-data",
  "/bonus",
  "/admin-links",
] as const;
export type Tab = (typeof ALL_TABS)[number];

export const TAB_LABELS: Record<Tab, string> = {
  "/dashboard": "Drive-Thru",
  "/food-cost": "Food Cost",
  "/par": "POS Sales",
  "/survey-data": "SMG",
  "/bonus": "Bonus",
  // The route is /admin-links because /admin is the Users & Access screen; the
  // label is what people see, and this tab is "Admin".
  "/admin-links": "Admin",
};

/** Where everyone lands after signing in, when their position allows it. */
export const DEFAULT_TAB: Tab = "/par";

/**
 * The tab to send someone to when no particular destination is implied — after
 * signing in, from the root, or when they've asked for a tab their position
 * can't reach.
 *
 * One definition on purpose: the login page, the root route and the access
 * guard all need this answer, and three copies would drift the first time the
 * default changed. Falls back to whatever the position *can* see, so narrowing
 * a position out of the default can't strand anyone on a redirect they aren't
 * entitled to follow.
 */
export function landingTab(tabs: Tab[]): string {
  if (tabs.includes(DEFAULT_TAB)) return DEFAULT_TAB;
  return tabs[0] ?? "/no-access";
}
