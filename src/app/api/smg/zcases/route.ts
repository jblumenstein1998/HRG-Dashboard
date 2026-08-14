import { NextRequest, NextResponse } from "next/server";
import { apiViewer } from "@/lib/users/access";
import { resolveRange, type RangeKey } from "@/lib/fiscal";
import {
  ingestZCases,
  lastSyncedAt,
  queryOutstanding,
  queryTotals,
  queryZCases,
  rollupByStore,
  type StoredZCase,
} from "@/lib/smgCaseStore";
import { caseDeepLink, type ZCaseType } from "@/lib/smgCases";

// Only reached when ?refresh=1 makes this hit SMG; the plain read is fast.
export const maxDuration = 120;

/**
 * ZCases for the SMG tab.
 *
 * GET /api/smg/zcases?range=p8&type=unsolicited
 * GET /api/smg/zcases?start=2026-07-08&end=2026-08-06
 * GET /api/smg/zcases?range=t30&refresh=1
 *
 * Reads Postgres — the cron owns ingestion — so the tab paints immediately and
 * keeps working when SMG is slow or down.
 *
 * Windows are on the *event* date (the guest's visit), matching the basis
 * smg360's own ZCase filters offer. See smgCaseStore.CaseWindow.
 *
 * `refresh=1` re-pulls from SMG first, which costs ~6s (a v5 login plus the
 * paged report). The tab is meant to render from the plain read and fire the
 * refresh in the background, then swap in the result: blocking the first paint
 * on SMG would trade a working page for a spinner.
 */

/** Rolling window used when no range is given, in days. */
const DEFAULT_DAYS = 30;

/** How far back a refresh re-reads. Matches the cron's rolling window. */
const REFRESH_DAYS = 45;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * fiscal.ts hands back "YYYY-MM-DDT00:00:00 : YYYY-MM-DDT23:59:59", and its end
 * can be the literal "now". Only the calendar dates matter here — the store
 * compares them as Central dates.
 */
function datesFromRange(range: string): { start: string; end: string } | null {
  const parts = range.split(" : ").map((s) => s.trim());
  if (parts.length !== 2) return null;
  const start = parts[0].split("T")[0];
  const end = parts[1] === "now" ? isoDate(new Date()) : parts[1].split("T")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  return { start, end };
}

const TYPES: ZCaseType[] = ["unsolicited", "locationSurvey", "hotline"];

/**
 * The two guest-facing types. `hotline` is team-member complaints, which aren't
 * part of the guest-recovery picture the tab reports on, so it's opt-in only.
 */
const DEFAULT_TYPES: ZCaseType[] = ["unsolicited", "locationSurvey"];

/**
 * resolveRange falls back to MTD for anything it doesn't recognise, so a typo'd
 * key would quietly return a different period's numbers. Check it here instead.
 */
const RANGE_KEY = /^(today|yesterday|wtd|last_week|t7|mtd|last_period|qtd|ytd|p([1-9]|1[0-2]))$/;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  // Explicit start/end wins; then a fiscal range key; then a rolling default.
  const explicitStart = p.get("start");
  const explicitEnd = p.get("end");
  const rangeKey = p.get("range");

  let start: string;
  let end: string;
  let label: string;

  if (explicitStart && explicitEnd) {
    start = explicitStart;
    end = explicitEnd;
    label = `${start} – ${end}`;
  } else if (rangeKey) {
    if (!RANGE_KEY.test(rangeKey)) {
      return NextResponse.json({ error: `unknown range "${rangeKey}"` }, { status: 400 });
    }
    const resolved = resolveRange(rangeKey as RangeKey);
    const dates = datesFromRange(resolved.range);
    if (!dates) {
      return NextResponse.json({ error: `could not resolve range "${rangeKey}"` }, { status: 400 });
    }
    start = dates.start;
    end = dates.end;
    label = resolved.label;
  } else {
    const now = new Date();
    end = isoDate(now);
    start = isoDate(new Date(now.getTime() - DEFAULT_DAYS * 24 * 60 * 60 * 1000));
    label = `Last ${DEFAULT_DAYS} days`;
  }

  // `type` takes one name, a comma-separated list, or "all".
  const typeParam = p.get("type");
  const types: ZCaseType[] =
    !typeParam ? DEFAULT_TYPES
    : typeParam === "all" ? TYPES
    : (typeParam.split(",").map((t) => t.trim()).filter((t) => (TYPES as string[]).includes(t)) as ZCaseType[]);

  if (types.length === 0) {
    return NextResponse.json({ error: `unknown type "${typeParam}"` }, { status: 400 });
  }

  // `stores` takes a comma-separated list of store numbers; `store` is the
  // single-store shorthand.
  const storesParam = p.get("stores") ?? p.get("store");
  const storeKeys = storesParam
    ? storesParam.split(",").map((s: string) => s.trim()).filter(Boolean)
    : undefined;
  const wantCases = p.get("cases") !== "0";

  let refreshed: { cases: number; ms: number } | null = null;
  let refreshError: string | null = null;

  if (p.get("refresh") === "1") {
    const t0 = Date.now();
    try {
      // `/api/smg/` is public (see proxy.ts) so the tab can paint before auth
      // resolves, but a refresh costs a v5 login and a full SMG pull — that
      // stays behind the session cookie. Reads are unaffected, and so is the
      // cron, which calls ingestZCases directly.
      const viewer = await apiViewer();
      if (!viewer?.position.tabs.includes("/survey-data")) throw new Error("not signed in");

      const now = new Date();
      const from = new Date(now.getTime() - REFRESH_DAYS * 24 * 60 * 60 * 1000);
      const r = await ingestZCases({ start: from, end: now });
      refreshed = { cases: r.cases, ms: Date.now() - t0 };
    } catch (err) {
      // A failed refresh still serves what's stored — stale data beats none.
      refreshError = err instanceof Error ? err.message : String(err);
      console.error(`[ZCase] refresh failed: ${refreshError}`);
    }
  }

  try {
    const window = { start, end, types, stores: storeKeys };
    // Totals are their own aggregate over the same window rather than a sum of
    // what's returned below — otherwise `cases=0` would silently null them out
    // and an unweighted average of store averages would skew small stores up.
    const [totals, stores, outstanding, cases, syncedAt] = await Promise.all([
      queryTotals(window),
      rollupByStore(window),
      queryOutstanding(types, storeKeys),
      wantCases ? queryZCases(window) : Promise.resolve([]),
      lastSyncedAt(),
    ]);

    // Deep links are built here rather than in the client so the card-id format
    // stays with the rest of the SMG knowledge. Note this is the *bare* link,
    // which only resolves for a browser that already has an smg360 session —
    // the tab links through /api/smg/zcase/[caseKey] instead, which signs the
    // browser in on the way.
    const withLink = (c: StoredZCase) => ({ ...c, deepLink: caseDeepLink(c.caseKey) });

    /**
     * Open-case counts come off the outstanding list, not the window aggregate.
     *
     * They're a live figure — an open case is open whichever period you have
     * selected — so windowing them made the tile disagree with the list sitting
     * right underneath it whenever a case's visit date fell outside the period.
     * Deriving both from the one list keeps them equal by construction.
     */
    const openByStore = new Map<string, number>();
    for (const c of outstanding) {
      const key = c.store ?? "unknown";
      openByStore.set(key, (openByStore.get(key) ?? 0) + 1);
    }

    const storeRows = stores.map((s) => ({
      ...s,
      outstanding: openByStore.get(s.store ?? "unknown") ?? 0,
    }));

    // A store can have an open case whose visit falls outside the window, which
    // would otherwise leave it off the table while still showing in the list.
    for (const c of outstanding) {
      const key = c.store ?? "unknown";
      if (storeRows.some((s) => (s.store ?? "unknown") === key)) continue;
      storeRows.push({
        store: c.store,
        unitName: c.unitName,
        cases: 0,
        avgResolveHours: null,
        over24: 0,
        over24Pct: null,
        escalated: 0,
        outstanding: openByStore.get(key) ?? 0,
      });
    }

    return NextResponse.json({
      window: { start, end, label, types },
      totals: { ...totals, outstanding: outstanding.length },
      stores: storeRows,
      outstanding: outstanding.map(withLink),
      cases: cases.map(withLink),
      syncedAt,
      refreshed,
      refreshError,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // An empty/missing table just means the cron hasn't run yet.
    if (/relation "smg_zcases" does not exist/i.test(message)) {
      return NextResponse.json({
        window: { start, end, label, types },
        totals: { cases: 0, avgResolveHours: null, over24: 0, over24Pct: null, outstanding: 0, escalated: 0 },
        stores: [],
        outstanding: [],
        cases: [],
        syncedAt: null,
        refreshed,
        refreshError,
      });
    }
    console.error("[ZCase] /api/smg/zcases failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
