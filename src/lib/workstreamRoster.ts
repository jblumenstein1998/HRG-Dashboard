/**
 * The joined roster: PAR's people, Workstream's positions and pay rates.
 *
 * This is the module that puts the two halves together and the only one the
 * rest of the app should need. It fetches both sides, applies the stored human
 * decisions (workstreamLinkStore.ts) and the automatic exact matches
 * (workstreamLink.ts), and hands back either a review queue for a person to
 * work through or a resolved lookup the staffing screens can read.
 *
 * Two deliberate asymmetries:
 *
 *   Workstream is fetched **whole, once**, and grouped by location here. There
 *   is no per-location employee filter on the API, twelve stores is a few
 *   hundred people, and paging the same list twelve times over a metered vendor
 *   to save a Map is a bad trade.
 *
 *   PAR is fetched **per store**, because PAR is per store — its employee ids
 *   are only unique within a location, and its token is per location too.
 *
 * Pay rate and job title from PAR are collected only for the review queue,
 * where they are corroboration a human uses to tell two Chris Millers apart.
 * They are not part of matching, and the resolved roster does not carry them —
 * the staffing tab already reads PAR's rate off the shift being displayed.
 */

import { unstable_cache } from "next/cache";
import { BONUS_STORES, storeById } from "./bonus/storeMap";
import { dateRange, getEmployees, getJobs, getShifts } from "./par";
import {
  EMPLOYEE_EMBED,
  employeeName,
  hourlyRate,
  listEmployees,
  primaryAssignment,
  type WsEmployee,
} from "./workstream";
import {
  linkCoverage,
  proposeStoreLinks,
  type LinkProposal,
  type MatchCandidate,
  type ParPerson,
} from "./workstreamLink";
import { listDecisions } from "./workstreamLinkStore";

/**
 * How many business dates back to look for a pay rate and a job name.
 *
 * A week catches anyone who works at all. Someone who has not been on the
 * schedule in seven days simply shows up in the queue without corroboration,
 * which is honest — there is nothing recent to corroborate against.
 */
const CORROBORATION_DAYS = 7;

// ── Workstream side ──────────────────────────────────────────────────────────

/**
 * Every Workstream employee, grouped by location uuid.
 *
 * Cached for an hour rather than per request: a roster changes when somebody is
 * hired, and the review queue being an hour stale is invisible, while paging
 * the whole company on every page load is not.
 *
 * Terminated people are kept. The queue needs them — PAR keeps terminated
 * employees on file too, and a link confirmed today has to still resolve when
 * that person's hours are looked at next year.
 */
const workstreamByLocation = unstable_cache(
  async (): Promise<Record<string, WsEmployee[]>> => {
    const all = await listEmployees({ embed: EMPLOYEE_EMBED });
    const out: Record<string, WsEmployee[]> = {};
    for (const e of all) {
      const uuid = e.location?.uuid;
      if (!uuid) continue;
      (out[uuid] ??= []).push(e);
    }
    return out;
  },
  ["workstream-employees-by-location"],
  { revalidate: 60 * 60, tags: ["workstream-data"] },
);

/** Workstream's roster for one PAR store, or an empty list if unmapped. */
export async function workstreamRosterFor(storeId: string): Promise<WsEmployee[]> {
  const uuid = storeById(storeId)?.workstreamLocationUuid;
  if (!uuid) return [];
  const byLocation = await workstreamByLocation();
  return byLocation[uuid] ?? [];
}

// ── PAR side ─────────────────────────────────────────────────────────────────

/**
 * PAR's people for one store, with a recent rate and job attached where the
 * schedule shows one.
 *
 * The rate taken is the one on the most recent shift, not an average: a raise
 * mid-week would average to a number nobody was ever paid, and the reviewer is
 * comparing against Workstream's current rate of record.
 */
async function parRosterFor(storeId: string, today: string | null): Promise<ParPerson[]> {
  const [employees, jobs] = await Promise.all([getEmployees(storeId), getJobs(storeId)]);
  const jobName = new Map(jobs.map((j) => [j.id, j.name]));

  // No date means no evidence wanted — the resolved roster only needs names,
  // because whether a link resolves depends on the stored decisions and on
  // exact-name uniqueness, never on a rate. Skipping the week of shifts keeps
  // the staffing tab's enrichment from doubling its PAR traffic.
  if (!today) {
    return employees.map((e) => ({
      id: e.id,
      firstName: e.firstName,
      lastName: e.lastName,
      displayName: e.displayName,
      jobName: e.jobId ? (jobName.get(e.jobId) ?? null) : null,
      payRate: null,
      terminated: e.terminated,
    }));
  }

  const start = shiftDate(today, -CORROBORATION_DAYS);
  const dates = dateRange(start, today);
  const dayShifts = await Promise.all(
    dates.map((d) => getShifts(storeId, d).catch(() => [])),
  );

  // Walk oldest to newest so the last write wins and holds the latest rate.
  const recent = new Map<string, { payRate: number | null; jobId: string | null }>();
  dayShifts.forEach((shifts) => {
    for (const s of shifts) {
      if (!s.employeeId) continue;
      recent.set(s.employeeId, { payRate: s.payRate, jobId: s.jobId });
    }
  });

  return employees.map((e) => {
    const seen = recent.get(e.id);
    const job = seen?.jobId ?? e.jobId;
    return {
      id: e.id,
      firstName: e.firstName,
      lastName: e.lastName,
      displayName: e.displayName,
      jobName: job ? (jobName.get(job) ?? null) : null,
      payRate: seen?.payRate ?? null,
      terminated: e.terminated,
    };
  });
}

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ── The report ───────────────────────────────────────────────────────────────

export type StoreLinkView = {
  storeId: string;
  storeName: string;
  /** Null when nobody has mapped this store to a Workstream location yet. */
  workstreamLocationUuid: string | null;
  proposals: LinkProposal[];
  unlinkedWorkstream: MatchCandidate[];
  coverage: { total: number; linked: number; review: number; absent: number };
  /** Why this store has nothing to show, when it has nothing to show. */
  error: string | null;
};

/**
 * One store's review queue.
 *
 * Every PAR employee appears, including the ones already linked — a screen that
 * only showed problems would give a reviewer no way to correct a link that was
 * confirmed wrongly, and no way to see how much of the store is actually
 * joined.
 */
export async function getStoreLinkView(storeId: string, today: string): Promise<StoreLinkView> {
  const store = storeById(storeId);
  const base = {
    storeId,
    storeName: store?.name ?? storeId,
    workstreamLocationUuid: store?.workstreamLocationUuid ?? null,
    proposals: [],
    unlinkedWorkstream: [],
    coverage: { total: 0, linked: 0, review: 0, absent: 0 },
  };

  if (!store) return { ...base, error: `Unknown store ${storeId}` };
  if (!store.workstreamLocationUuid) {
    return {
      ...base,
      error:
        "No Workstream location is mapped to this store yet — run scripts/workstream-discover.mjs and fill in workstreamLocationUuid in src/lib/bonus/storeMap.ts.",
    };
  }

  try {
    const [parEmployees, workstreamEmployees, decisions] = await Promise.all([
      parRosterFor(storeId, today),
      workstreamRosterFor(storeId),
      listDecisions(storeId),
    ]);

    const report = proposeStoreLinks({
      parStoreId: storeId,
      parEmployees,
      workstreamEmployees,
      decisions,
    });

    return {
      ...base,
      proposals: report.proposals,
      unlinkedWorkstream: report.unlinkedWorkstream,
      coverage: linkCoverage(report),
      error: null,
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Every store's queue, for the admin screen. Failures are per store. */
export async function getAllLinkViews(today: string): Promise<StoreLinkView[]> {
  return Promise.all(BONUS_STORES.map((s) => getStoreLinkView(s.storeId, today)));
}

// ── The resolved roster ──────────────────────────────────────────────────────

/**
 * What Workstream knows about one person, keyed by PAR employee id.
 *
 * `linkedBy` travels with the record on purpose. A screen showing a pay rate
 * that came from an automatic name match should be able to say so, because the
 * reader's trust in the number should not be the same as for one a manager
 * confirmed by hand.
 */
export type LinkedPerson = {
  parEmployeeId: string;
  workstreamUuid: string;
  /** Workstream's full name — PAR's DisplayName is only a first name and initial. */
  name: string | null;
  title: string | null;
  hourlyRate: number | null;
  hiredDate: string | null;
  terminationDate: string | null;
  linkedBy: "auto" | "confirmed";
};

/**
 * The lookup the staffing screens read: PAR employee id → Workstream facts.
 *
 * Only resolved people are in it. Everyone else is absent from the map, which
 * makes the calling code's fallback the obvious one — show what PAR knows, and
 * leave the Workstream columns empty rather than filling them with a guess.
 */
export async function getLinkedRoster(storeId: string): Promise<Map<string, LinkedPerson>> {
  const out = new Map<string, LinkedPerson>();
  if (!storeById(storeId)?.workstreamLocationUuid) return out;

  const [parEmployees, workstreamEmployees, decisions] = await Promise.all([
    parRosterFor(storeId, null),
    workstreamRosterFor(storeId),
    listDecisions(storeId),
  ]);

  const report = proposeStoreLinks({
    parStoreId: storeId,
    parEmployees,
    workstreamEmployees,
    decisions,
  });
  const ws = new Map(workstreamEmployees.map((e) => [e.uuid, e]));

  for (const p of report.proposals) {
    if (p.state !== "auto" && p.state !== "confirmed") continue;
    const e = p.workstreamUuid ? ws.get(p.workstreamUuid) : null;
    if (!e) continue;
    out.set(p.parEmployeeId, {
      parEmployeeId: p.parEmployeeId,
      workstreamUuid: e.uuid,
      name: employeeName(e),
      title: primaryAssignment(e)?.title ?? null,
      hourlyRate: hourlyRate(e),
      hiredDate: e.hired_date ?? e.start_date ?? null,
      terminationDate: e.termination_date ?? null,
      linkedBy: p.state,
    });
  }
  return out;
}

/**
 * The same lookup, but never a reason for a page to fail.
 *
 * The staffing tab is a PAR feature that Workstream decorates. Missing
 * credentials, an unmapped store or a Workstream outage should cost it two
 * columns, not the hours everybody actually came for — so the failure is logged
 * once and answered with an empty map.
 */
export async function linkedRosterOrEmpty(storeId: string): Promise<Map<string, LinkedPerson>> {
  try {
    return await getLinkedRoster(storeId);
  } catch (err) {
    console.error(
      `[workstream] roster for store ${storeId} unavailable:`,
      err instanceof Error ? err.message : String(err),
    );
    return new Map();
  }
}
