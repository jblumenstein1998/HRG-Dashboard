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

import { BONUS_STORES, storeById } from "./bonus/storeMap";
import { dateRange, getEmployees, getJobs, getShifts } from "./par";
import {
  linkCoverage,
  proposeStoreLinks,
  type LinkProposal,
  type MatchCandidate,
  type ParPerson,
  type WorkstreamPerson,
} from "./workstreamLink";
import { listDecisions } from "./workstreamLinkStore";
import { listStoredEmployees, listStoredEmployeesForStore, type WorkstreamEmployeeRow } from "./workstreamStore";

/**
 * How many business dates back to look for a pay rate and a job name.
 *
 * A week catches anyone who works at all. Someone who has not been on the
 * schedule in seven days simply shows up in the queue without corroboration,
 * which is honest — there is nothing recent to corroborate against.
 */
const CORROBORATION_DAYS = 7;

/**
 * How far back a PAR record has to show hours to count as a live employee.
 *
 * PAR records are rarely terminated when somebody leaves, so a store's roster
 * accumulates years of people who simply stopped coming: 106 of 151 outstanding
 * reviews had not worked a minute in four weeks, and 99 of those had no
 * Workstream counterpart because there is nobody to have one.
 *
 * Thirty days, rolling rather than a fixed calendar month, so somebody who
 * picks shifts up again reappears on their own — and so the rule does not
 * empty the queue every first of the month.
 */
const ACTIVITY_DAYS = 30;

// ── Workstream side ──────────────────────────────────────────────────────────

/** A stored row, in the shape the matcher works on. */
function toPerson(r: WorkstreamEmployeeRow): WorkstreamPerson {
  return {
    uuid: r.uuid,
    firstName: r.firstName,
    lastName: r.lastName,
    preferredName: r.preferredName,
    status: r.status,
    hiredDate: r.hiredDate,
    startDate: r.startDate,
    terminationDate: r.terminationDate,
    title: r.jobTitle,
    hourlyRate: r.hourlyRate,
  };
}

/**
 * Workstream's roster for one PAR store, **from Postgres**.
 *
 * This used to page the vendor's whole company on every call, behind a cache
 * that was silently declining to store a payload that size — two identical
 * requests took 32.4s each, and the staffing tab did it once per store. It
 * ended in a 429 and nineteen hours locked out. See workstreamStore.ts.
 *
 * Now it is one indexed query against a table a morning cron fills.
 *
 * Everyone is returned, leavers and pending hires included, so a link confirmed
 * while somebody worked here still resolves after they leave — otherwise their
 * past hours would lose the title and rate they were worked at.
 * workstreamLink.ts decides who is matchable: see isActiveEmployee.
 */
export async function workstreamRosterFor(storeId: string): Promise<WorkstreamPerson[]> {
  if (!storeById(storeId)?.workstreamLocationUuid) return [];
  return (await listStoredEmployeesForStore(storeId)).map(toPerson);
}

/**
 * Active Workstream people who are *not* at this store, each labelled with
 * where Workstream does have them.
 *
 * Matching store-by-store made anyone the two systems disagree about invisible.
 * Amethyst Lindsey logged 107 hours at Springfield in PAR while her only live
 * Workstream record sat at White House, so she reached the queue with no
 * candidate at all and nothing to explain why. Eight more active records carry
 * no store whatsoever and were unreachable from every store.
 *
 * Offered as candidates only on an exact name match, and never auto-linked —
 * a cross-store hit means one of the two systems has the wrong store for that
 * person, which is a judgement rather than a formality.
 */
async function activeElsewhere(storeId: string): Promise<WorkstreamPerson[]> {
  const everyone = await listStoredEmployees();
  return everyone
    .filter((r) => r.status === "active" && !r.terminationDate && r.storeId !== storeId)
    .map((r) => ({
      ...toPerson(r),
      atOtherStore: r.storeId ? (storeById(r.storeId)?.name ?? r.storeId) : "no store",
    }));
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

  const start = shiftDate(today, -ACTIVITY_DAYS);
  const dates = dateRange(start, today);
  const dayShifts = await Promise.all(
    dates.map((d) => getShifts(storeId, d).catch(() => [])),
  );

  // Walk oldest to newest so the last write wins and holds the latest rate.
  const recent = new Map<string, { payRate: number | null; jobId: string | null }>();
  // Minutes over the whole window, which is what decides whether a PAR record
  // is a person or a leftover.
  const worked = new Map<string, number>();
  dayShifts.forEach((shifts, i) => {
    const withinCorroboration = dates.length - i <= CORROBORATION_DAYS;
    for (const s of shifts) {
      if (!s.employeeId) continue;
      worked.set(s.employeeId, (worked.get(s.employeeId) ?? 0) + s.minutesWorked);
      // The rate shown to a reviewer stays the recent one: a rate from a month
      // ago is not what to compare against Workstream's current figure.
      if (withinCorroboration) recent.set(s.employeeId, { payRate: s.payRate, jobId: s.jobId });
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
      recentMinutes: worked.get(e.id) ?? 0,
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
  /** Counted over people active in both systems; `ignored` are the leavers. */
  coverage: { total: number; linked: number; review: number; absent: number; ignored: number };
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
    coverage: { total: 0, linked: 0, review: 0, absent: 0, ignored: 0 },
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
    const [parEmployees, workstreamEmployees, elsewhere, decisions] = await Promise.all([
      parRosterFor(storeId, today),
      workstreamRosterFor(storeId),
      activeElsewhere(storeId),
      listDecisions(storeId),
    ]);

    const report = proposeStoreLinks({
      parStoreId: storeId,
      parEmployees,
      workstreamEmployees,
      elsewhere,
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
  /**
   * The store Workstream assigns them to, when it is **not** the store whose
   * hours these are.
   *
   * Workstream's location is the baseline for where somebody belongs, so this
   * being set means they are working a store they are not assigned to — worth
   * flagging, because one of two things is true and both matter: either the
   * assignment is stale after a transfer, or somebody is covering shifts away
   * from their home store and the labour is landing on the wrong P&L.
   *
   * Null in the ordinary case, so a caller can treat it as "nothing to say".
   */
  assignedElsewhere: string | null;
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

  const [parEmployees, workstreamEmployees, elsewhere, decisions] = await Promise.all([
    parRosterFor(storeId, null),
    workstreamRosterFor(storeId),
    activeElsewhere(storeId),
    listDecisions(storeId),
  ]);

  const report = proposeStoreLinks({
    parStoreId: storeId,
    parEmployees,
    workstreamEmployees,
    elsewhere,
    decisions,
  });
  // Both pools, so a person assigned to another store still resolves — and
  // carries where Workstream thinks they belong.
  const ws = new Map([...workstreamEmployees, ...elsewhere].map((e) => [e.uuid, e]));

  for (const p of report.proposals) {
    if (p.state !== "auto" && p.state !== "confirmed") continue;
    const e = p.workstreamUuid ? ws.get(p.workstreamUuid) : null;
    if (!e) continue;
    out.set(p.parEmployeeId, {
      parEmployeeId: p.parEmployeeId,
      workstreamUuid: e.uuid,
      name: [e.firstName, e.lastName].filter(Boolean).join(" ").trim() || null,
      title: e.title,
      hourlyRate: e.hourlyRate,
      hiredDate: e.hiredDate ?? e.startDate ?? null,
      terminationDate: e.terminationDate,
      linkedBy: p.state,
      assignedElsewhere: e.atOtherStore ?? null,
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
