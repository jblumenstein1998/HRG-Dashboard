/**
 * The chat is switched off in production while it's being reworked — it was
 * hanging without returning an answer. Local development and preview deploys
 * keep it, so the fix can be built against real data.
 *
 * Nothing is deleted: flip it back on by setting ENABLE_CHAT=1 in the Vercel
 * production environment, no deploy required beyond the redeploy that picks the
 * variable up.
 *
 * Evaluated server-side only (VERCEL_ENV is not exposed to the browser), so the
 * call sites are the root layout and the /api/chat route rather than the client
 * component itself.
 */
export function isChatEnabled(): boolean {
  if (process.env.ENABLE_CHAT === "1") return true;
  return process.env.VERCEL_ENV !== "production";
}
