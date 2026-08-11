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

export const ALL_TABS = ["/dashboard", "/food-cost", "/par", "/survey-data", "/bonus"] as const;
export type Tab = (typeof ALL_TABS)[number];

export const TAB_LABELS: Record<Tab, string> = {
  "/dashboard": "Drive-Thru",
  "/food-cost": "Food Cost",
  "/par": "POS Sales",
  "/survey-data": "SMG",
  "/bonus": "Bonus",
};
