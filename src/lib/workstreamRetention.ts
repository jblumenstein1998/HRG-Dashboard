/**
 * New-hire retention, per store, from Workstream and PAR together.
 *
 * Feeds the Training Director's `t_retention_30/60/90`, which are computed from
 * P11 FY2026 onward and entered by hand before that (`autoFromPeriod` in
 * rules.ts).
 *
 * ── What "30-day retention" is taken to mean ─────────────────────────────────
 *
 * Of the hires whose **30th day fell inside the period**, the share who were
 * still employed on it.
 *
 * The cohort is pinned to the day being measured rather than the day someone
 * was hired, and that is the whole design. Score by hire date instead and a
 * period's number cannot be known until thirty days after the period ends, and
 * worse, it keeps changing after the period closes — a bonus figure that moves
 * once it has been paid. Pinning to the anniversary means every hire in the
 * cohort has already had its answer settled by the time the period is scored.
 *
 * A termination dated exactly on the anniversary counts as *not* retained: they
 * did not complete the day.
 *
 * ── Who is a hire ────────────────────────────────────────────────────────────
 *
 * Josh's rule (2026-10-26): **a Workstream record is a hire once it has logged
 * any time in PAR.** Workstream creates the record the moment a manager moves a
 * candidate to "Hired", so it is full of people who were unwound at Hiring
 * Complete, never came to orientation, or were entered twice. Counting them as
 * leavers took Hampton's P10 30-day figure from 100% to 64%.
 *
 * The date-based shortcut ("terminated on or before their start date") is not
 * a substitute: 19 of the 63 records it caught since April had in fact clocked
 * shifts.
 *
 * PAR and Workstream share no id, only a name, so "logged time in PAR" means a
 * PAR employee at the person's store whose first name and surname match theirs
 * and who clocked a shift on or after two weeks before their start date. Each
 * person lands in one of four places:
 *
 *   worked        a match clocked in, or a person said so. In the cohort.
 *   never worked  PAR has them but they never clocked in; or PAR has nobody by
 *                 the name and Workstream ended them on or before their start
 *                 date; or a person said so. Left out.
 *   excluded      terminated as a duplicate profile or a transfer. Left out —
 *                 a store does not lose a hire because somebody moved.
 *   unverified    no PAR record matches the name. The store's figure stays
 *                 pending until a person resolves them (retentionReviewStore),
 *                 because dropping them silently would flatter the store and
 *                 counting them would penalise it for a typo.
 *
 * A confirmed link from the Staffing tab's review queue counts as a match, so
 * nobody resolves the same person twice.
 *
 * ── Which store ──────────────────────────────────────────────────────────────
 *
 * The store Workstream has them at, from our synced copy — which remembers a
 * leaver's store after Workstream drops it (workstreamStore.ts). For the few
 * leavers who dropped out before that copy first saw them, the store whose PAR
 * record matched them; if nothing does, they are listed as unattributed and
 * hold no store's figure, since they could belong to any of them.
 */

import { sql } from "./db";
import { getEmployees, type PAREmployee } from "./par";
import { normalizeName } from "./workstreamLink";
import { BONUS_STORES, WORKSTREAM_ONLY_LOCATIONS } from "./bonus/storeMap";
import { listRetentionReviews, type RetentionReview } from "./retentionReviewStore";

/** The anniversaries the bonus scorecard gates on. */
export const RETENTION_DAYS = [30, 60, 90] as const;
export type RetentionDay = (typeof RETENTION_DAYS)[number];

/** How far before a Workstream start date a PAR shift still counts as theirs. */
const EARLY_SHIFT_DAYS = 14;

/**
 * Termination notes that mean the record ended without the person leaving.
 * Matched on the free-text note, so an unlabelled duplicate is missed — the
 * notes are all there is.
 */
const NOT_A_LEAVER = /dup|twice|moved to|moving to|transfer|hired in at|another (store|location)/i;

export type RetentionStatus = "worked" | "never_worked" | "excluded" | "unverified";

export type RetentionPerson = {
  workstreamUuid: string;
  name: string;
  startedOn: string;
  anniversary: string;
  terminatedOn: string | null;
  terminationNote: string;
  status: RetentionStatus;
  /** Only meaningful when status is "worked". */
  stayed: boolean;
  /** How the status was reached, in a few words, for the screen. */
  reason: string;
  /** Set when a person decided this one. */
  reviewedBy: string | null;
  /** For unverified people: PAR records at the store that look close. */
  suggestions: string[];
};

export type StoreRetention = {
  storeId: string;
  storeName: string;
  /** Keyed by 30 / 60 / 90. */
  byDay: Record<number, {
    /** Hires whose Nth day fell in the window. */
    cohort: number;
    /** How many of them were still employed on it. */
    stayed: number;
    /** People who could not be checked against PAR. */
    unverified: number;
    /**
     * stayed / cohort as a percentage. Null when anybody is unverified, when
     * nobody reached the mark, or when PAR could not be read for the store.
     */
    percent: number | null;
    people: RetentionPerson[];
  }>;
  /** PAR's employee list could not be read, so nothing here could be checked. */
  parUnavailable: boolean;
};

export type RetentionReport = {
  start: string;
  /** Inclusive. */
  end: string;
  stores: StoreRetention[];
  /** People with no store from either system, by anniversary. */
  unattributed: Record<number, RetentionPerson[]>;
};

type WsRow = {
  uuid: string;
  first_name: string;
  preferred_name: string;
  last_name: string;
  status: string;
  started: string | null;
  termination_date: string | null;
  termination_note: string;
  location_uuid: string | null;
  store_id: string | null;
};

/** ISO date `days` after `iso`. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Name words, with apostrophes closed up rather than split on: Heav'n is
 * "heavn" in PAR, and normalizeName alone would make it "heav n".
 */
function words(raw: string | null | undefined): string[] {
  return normalizeName((raw ?? "").replace(/['’`]/g, "")).split(" ").filter(Boolean);
}

/**
 * Does this PAR employee carry this Workstream person's name?
 *
 * First name (or the name they go by) exactly, and any word of the surname —
 * so Torres-Roman matches PAR's Torres — or PAR's single-letter initial. Typos
 * and nicknames are deliberately not guessed at; they go to a person.
 */
function nameMatches(ws: WsRow, par: PAREmployee): boolean {
  const firsts = new Set([words(ws.first_name)[0], words(ws.preferred_name)[0]].filter(Boolean));
  const parFirst = words(par.firstName)[0];
  if (!parFirst || !firsts.has(parFirst)) return false;
  const lasts = words(ws.last_name);
  const parLast = words(par.lastName).at(-1);
  if (!parLast || lasts.length === 0) return false;
  if (parLast.length === 1) return lasts.some((l) => l.startsWith(parLast));
  return lasts.includes(parLast);
}

/** Near-misses worth showing a reviewer: same first name or same surname. */
function looksClose(ws: WsRow, par: PAREmployee): boolean {
  const firsts = new Set([words(ws.first_name)[0], words(ws.preferred_name)[0]].filter(Boolean));
  const lasts = words(ws.last_name);
  const pf = words(par.firstName)[0] ?? "";
  const pl = words(par.lastName).at(-1) ?? "";
  const sharesFirst = [...firsts].some((f) => f.slice(0, 3) === pf.slice(0, 3) && pf.length > 0);
  const sharesLast = lasts.some((l) => l.slice(0, 4) === pl.slice(0, 4) && pl.length > 1);
  return sharesFirst && sharesLast;
}

const fullName = (r: WsRow) =>
  [r.preferred_name && r.preferred_name !== r.first_name ? `${r.first_name} (${r.preferred_name})` : r.first_name, r.last_name]
    .filter(Boolean).join(" ").trim() || r.uuid;

/**
 * New-hire retention for every store over one window.
 *
 * One read of the synced Workstream copy, one PAR employee list per store
 * (cached a day in par.ts), and one query for whether each name-matched PAR
 * employee clocked in.
 */
export async function getRetention(start: string, end: string): Promise<RetentionReport> {
  const [rows, reviews, links] = await Promise.all([
    sql`
      SELECT uuid, first_name, preferred_name, last_name, status,
             COALESCE(start_date, hired_date)::text AS started,
             termination_date::text AS termination_date,
             termination_note, location_uuid, store_id
      FROM workstream_employees
      WHERE COALESCE(start_date, hired_date) + 90 >= ${start}::date
        AND COALESCE(start_date, hired_date) + 30 <= ${end}::date
    `.then((r) => r as WsRow[]),
    listRetentionReviews(),
    // Staffing-tab links a person confirmed. Read directly rather than through
    // workstreamLinkStore so a missing table (never reviewed) is just empty.
    sql`
      SELECT par_store_id, par_employee_id, workstream_uuid
      FROM workstream_employee_links WHERE status = 'confirmed'
    `
      .then((r) => r as { par_store_id: string; par_employee_id: string; workstream_uuid: string }[])
      .catch(() => []),
  ]);

  const otherLocations = new Set<string>(WORKSTREAM_ONLY_LOCATIONS.map((l) => l.workstreamLocationUuid));

  // ── The cohort: everybody with an anniversary in the window ────────────────
  type Entry = { row: WsRow; day: RetentionDay; anniversary: string };
  const entries: Entry[] = [];
  for (const row of rows) {
    if (!row.started) continue;
    // Hohenwald and Lafayette: real restaurants with no store here.
    if (row.location_uuid && otherLocations.has(row.location_uuid) && !row.store_id) continue;
    for (const day of RETENTION_DAYS) {
      const anniversary = addDays(row.started, day);
      if (anniversary >= start && anniversary <= end) entries.push({ row, day, anniversary });
    }
  }

  // ── PAR's people, per store ────────────────────────────────────────────────
  const parByStore = new Map<string, PAREmployee[] | null>();
  await Promise.all(
    BONUS_STORES.map(async (s) => {
      try {
        parByStore.set(s.storeId, await getEmployees(s.storeId));
      } catch {
        parByStore.set(s.storeId, null);
      }
    }),
  );

  // Candidate PAR records per person: a confirmed link wins outright, then name
  // matches at their store, or at every store when they have none.
  const linkedPar = new Map<string, { storeId: string; employeeId: string }[]>();
  for (const l of links) {
    const list = linkedPar.get(l.workstream_uuid) ?? [];
    list.push({ storeId: l.par_store_id, employeeId: l.par_employee_id });
    linkedPar.set(l.workstream_uuid, list);
  }

  const people = new Map(entries.map((e) => [e.row.uuid, e.row]));
  const candidates = new Map<string, { storeId: string; employeeId: string }[]>();
  for (const row of people.values()) {
    const linked = linkedPar.get(row.uuid);
    if (linked?.length) {
      candidates.set(row.uuid, linked);
      continue;
    }
    const stores = row.store_id ? [row.store_id] : BONUS_STORES.map((s) => s.storeId);
    const found: { storeId: string; employeeId: string }[] = [];
    for (const storeId of stores) {
      for (const p of parByStore.get(storeId) ?? []) {
        if (nameMatches(row, p)) found.push({ storeId, employeeId: p.id });
      }
    }
    candidates.set(row.uuid, found);
  }

  // Which of those candidates clocked in from two weeks before the start date
  // to the termination date (or to now). One query for all of them.
  const probes: { uuid: string; storeId: string; employeeId: string; from: string; to: string }[] = [];
  for (const row of people.values()) {
    for (const c of candidates.get(row.uuid) ?? []) {
      probes.push({
        uuid: row.uuid,
        storeId: c.storeId,
        employeeId: c.employeeId,
        from: addDays(row.started as string, -EARLY_SHIFT_DAYS),
        to: row.termination_date ?? "9999-12-31",
      });
    }
  }
  const workedAt = new Map<string, Set<string>>();
  // The PAR clock numbers each person matched, as "store|employee".
  const clockedAs = new Map<string, Set<string>>();
  if (probes.length > 0) {
    const hits = (await sql`
      SELECT DISTINCT p.uuid, p.store_id, p.employee_id
      FROM UNNEST(
        ${probes.map((p) => p.uuid)}::text[],
        ${probes.map((p) => p.storeId)}::text[],
        ${probes.map((p) => p.employeeId)}::text[],
        ${probes.map((p) => p.from)}::date[],
        ${probes.map((p) => p.to)}::date[]
      ) AS p(uuid, store_id, employee_id, from_date, to_date)
      WHERE EXISTS (
        SELECT 1 FROM par_shifts s
        WHERE s.store_id = p.store_id AND s.employee_id = p.employee_id
          AND s.business_date BETWEEN p.from_date AND p.to_date
      )
    `) as { uuid: string; store_id: string; employee_id: string }[];
    for (const h of hits) {
      const set = workedAt.get(h.uuid) ?? new Set<string>();
      set.add(h.store_id);
      workedAt.set(h.uuid, set);
      const clocks = clockedAs.get(h.uuid) ?? new Set<string>();
      clocks.add(`${h.store_id}|${h.employee_id}`);
      clockedAs.set(h.uuid, clocks);
    }
  }

  // ── Classify ───────────────────────────────────────────────────────────────
  const byStore = new Map<string, StoreRetention>();
  for (const s of BONUS_STORES) {
    byStore.set(s.storeId, {
      storeId: s.storeId,
      storeName: s.name,
      byDay: Object.fromEntries(
        RETENTION_DAYS.map((d) => [d, { cohort: 0, stayed: 0, unverified: 0, percent: null, people: [] }]),
      ),
      parUnavailable: parByStore.get(s.storeId) === null,
    });
  }
  const unattributed: Record<number, RetentionPerson[]> = Object.fromEntries(RETENTION_DAYS.map((d) => [d, []]));

  for (const { row, day, anniversary } of entries) {
    const review: RetentionReview | undefined = reviews.get(row.uuid);
    const worked = workedAt.get(row.uuid);
    const hasCandidates = (candidates.get(row.uuid) ?? []).length > 0;

    let status: RetentionStatus;
    let reason: string;
    let storeId = row.store_id;

    if (row.termination_note && NOT_A_LEAVER.test(row.termination_note)) {
      status = "excluded";
      reason = "Duplicate or transfer";
    } else if (review) {
      status = review.outcome;
      reason = review.outcome === "worked" ? "Confirmed worked" : "Confirmed never worked";
      storeId = storeId ?? review.storeId;
    } else if (worked && worked.size > 0) {
      if (!storeId) storeId = worked.size === 1 ? [...worked][0] : null;
      status = "worked";
      reason = "Clocked in at PAR";
    } else if (hasCandidates) {
      status = "never_worked";
      reason = "In PAR, never clocked in";
    } else if (row.termination_date && row.termination_date <= (row.started as string)) {
      // Two signals agree: Workstream ended them by their start date, and PAR
      // has nobody by the name. Josh's call (2026-10-27) to settle these
      // without a reviewer — about 18 of P10's 40 unverified were this.
      status = "never_worked";
      reason = "Ended by start date, not in PAR";
    } else {
      status = "unverified";
      reason = "No PAR record with this name";
    }

    const stayed = !row.termination_date || row.termination_date > anniversary;
    const suggestions =
      status === "unverified" && storeId
        ? (parByStore.get(storeId) ?? [])
            .filter((p) => looksClose(row, p))
            .slice(0, 5)
            .map((p) => p.displayName || `${p.firstName} ${p.lastName}`)
        : [];

    const person: RetentionPerson = {
      workstreamUuid: row.uuid,
      name: fullName(row),
      startedOn: row.started as string,
      anniversary,
      terminatedOn: row.termination_date,
      terminationNote: row.termination_note,
      status,
      stayed,
      reason,
      reviewedBy: review?.decidedBy ?? null,
      suggestions,
    };

    const target = storeId ? byStore.get(storeId) : undefined;
    if (!target) {
      unattributed[day].push(person);
      continue;
    }
    target.byDay[day].people.push(person);
  }

  for (const row of byStore.values()) {
    for (const days of RETENTION_DAYS) {
      const d = row.byDay[days];
      collapseDuplicates(d.people, clockedAs);
      d.cohort = d.people.filter((p) => p.status === "worked").length;
      d.stayed = d.people.filter((p) => p.status === "worked" && p.stayed).length;
      d.unverified = d.people.filter((p) => p.status === "unverified").length;
      d.people.sort((a, b) => a.anniversary.localeCompare(b.anniversary) || a.name.localeCompare(b.name));
      d.percent =
        row.parUnavailable || d.unverified > 0 || d.cohort === 0
          ? null
          : Math.round((d.stayed / d.cohort) * 1000) / 10;
    }
  }

  return { start, end, stores: [...byStore.values()], unattributed };
}

/**
 * Two Workstream records that clocked in under one PAR clock number are one
 * person, counted once.
 *
 * Workstream is full of unlabelled duplicates — a manager re-enters somebody,
 * and the old record is terminated with no note. Hampton's P10 30-day list had
 * James Perry and Adrian Drake twice each, one copy "left" and one "stayed",
 * so each duplicate read as a leaver. Only an exact, single shared clock number
 * merges: a name PAR itself holds twice could be two real people.
 *
 * The record that stayed is kept, else the later start; the others are left
 * out and say who they duplicate.
 */
function collapseDuplicates(people: RetentionPerson[], clockedAs: Map<string, Set<string>>): void {
  const byClock = new Map<string, RetentionPerson[]>();
  for (const p of people) {
    if (p.status !== "worked") continue;
    const clocks = clockedAs.get(p.workstreamUuid);
    if (!clocks || clocks.size !== 1) continue;
    const key = [...clocks][0];
    byClock.set(key, [...(byClock.get(key) ?? []), p]);
  }
  for (const group of byClock.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => Number(b.stayed) - Number(a.stayed) || b.startedOn.localeCompare(a.startedOn));
    const [kept, ...dupes] = group;
    for (const d of dupes) {
      d.status = "excluded";
      d.reason = `Duplicate record of ${kept.name} (same PAR clock number)`;
    }
  }
}

/**
 * The same figures shaped the way bonus/metrics.ts wants them: a flat number
 * per store per metric id.
 *
 * A store with a null figure is **absent from the map** rather than present as
 * zero. Zero would score as total failure; absent leaves the criterion pending,
 * which is the honest answer to "somebody still has to be checked" or "nobody
 * reached ninety days this period".
 */
export function retentionMetrics(report: RetentionReport): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const s of report.stores) {
    const values = new Map<string, number>();
    for (const days of RETENTION_DAYS) {
      const pct = s.byDay[days].percent;
      if (pct !== null) values.set(`t_retention_${days}`, pct);
    }
    out.set(s.storeId, values);
  }
  return out;
}

/** The metric ids retention owns, so callers can treat them as a set. */
export const RETENTION_METRIC_IDS = RETENTION_DAYS.map((d) => `t_retention_${d}`);
