/**
 * Build-time feature flags for the nav.
 *
 * `NEXT_PUBLIC_*` values are inlined into the client bundle when Next builds,
 * so a flag is fixed per deployment — set it in the Vercel environment, not at
 * runtime. That's the point here: the same commit can ship with the tab shown
 * in development and preview but hidden in production.
 */

/**
 * Whether the Bonus tab appears in the tab picker.
 *
 * Off in production while the tab is still being built. It only hides the nav
 * entry — /bonus itself still renders for anyone who goes there directly, which
 * is deliberate, since that's how it gets worked on. It is *not* a security
 * boundary; if the page needs to be genuinely unreachable, block the route.
 *
 * To publish it: set NEXT_PUBLIC_SHOW_BONUS_TAB=1 on Production in Vercel and
 * redeploy, then drop the flag entirely once it's permanent.
 */
export const SHOW_BONUS_TAB = process.env.NEXT_PUBLIC_SHOW_BONUS_TAB === "1";
