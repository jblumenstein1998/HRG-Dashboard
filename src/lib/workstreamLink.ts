/**
 * Joining a PAR employee to a Workstream employee.
 *
 * PAR knows hours. Workstream knows position and pay rate. Nothing joins them:
 * PAR's employee record carries no external id, no email and no phone, and its
 * ids are per store, so the same person working two restaurants is two PAR rows
 * and one Workstream record. The only overlapping field is a name.
 *
 * ── Why this is a review queue and not a matcher ─────────────────────────────
 *
 * A name match is a guess. "M Johnson" is two people at Hampton; "Chris" is
 * Christopher in one system and Christina in the other; a new hire exists in
 * Workstream for a week before PAR has heard of them. Guessing wrong here does
 * not produce a blank cell — it produces someone else's pay rate next to your
 * hours, which is worse than having nothing.
 *
 * So this module never decides a doubtful match. It decides exactly one case
 * automatically: the two names are character-for-character identical after
 * normalisation, and that name is unique on both sides of the store. Everything
 * else becomes a proposal with ranked candidates, and a person confirms it.
 *
 * ── Why the decisions are stored and the matches are not ─────────────────────
 *
 * Only human decisions are persisted (workstreamLinkStore.ts). The automatic
 * exact matches are recomputed on every read. That is what makes this survive
 * hiring: a new employee whose name is unambiguous links the day both systems
 * know them, with nobody involved; a new employee whose name is ambiguous shows
 * up in the queue by itself, without an import step anyone has to remember to
 * run. The queue is a standing surface, not a migration.
 *
 * A stored decision always beats a computed one, in both directions — a
 * confirmed link overrides an exact-name match that disagrees with it, and a
 * rejected pair stays rejected no matter how well the names read.
 *
 * Pure functions only: no database, no network. That keeps the ranking testable
 * against a fixture and keeps the rules in one readable place.
 */

import type { WsEmployee } from "./workstream";
import { employeeName, hourlyRate, preferredName, primaryAssignment } from "./workstream";

// ── The two sides ────────────────────────────────────────────────────────────

/**
 * A person as PAR knows them.
 *
 * `payRate` and `jobName` are optional because PAR keeps neither on the
 * employee record — they live on shifts. A caller that has recent shifts to
 * hand should pass them: they are corroboration a human reviewer can use, not
 * something this module matches on.
 */
export type ParPerson = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  jobName?: string | null;
  payRate?: number | null;
  terminated: boolean;
};

/** What a stored decision says about one PAR employee. */
export type LinkDecisionStatus =
  /** This PAR employee is this Workstream employee. Set by a person. */
  | "confirmed"
  /** This PAR employee has no Workstream record, and that is expected. */
  | "absent"
  /** This specific pair is not the same person. Suppresses the candidate. */
  | "rejected";

export type LinkDecision = {
  parStoreId: string;
  parEmployeeId: string;
  /** Empty string for "absent" — there is no counterpart to name. */
  workstreamUuid: string;
  status: LinkDecisionStatus;
  decidedBy: string;
  decidedAt: string;
};

// ── Name normalisation ───────────────────────────────────────────────────────

/** Suffixes that are not part of a name for matching purposes. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * A name reduced to what two systems could plausibly agree on.
 *
 * Accents are folded, punctuation dropped (O'Brien, Smith-Jones), generational
 * suffixes removed, and whitespace collapsed. Nothing here is clever — it is
 * only meant to stop trivia like a middle initial or a hyphen from splitting
 * one person into two.
 */
export function normalizeName(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFKD")
    // Combining marks left behind by NFKD, so José and Jose are one person.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SUFFIXES.has(w))
    .join(" ")
    .trim();
}

/**
 * The key an automatic match is allowed to use: normalised first and last name
 * only. Middle names are dropped because one system records them and the other
 * does not, at random.
 */
export function nameKey(first: string | null | undefined, last: string | null | undefined): string {
  const f = normalizeName(first).split(" ")[0] ?? "";
  const parts = normalizeName(last).split(" ").filter(Boolean);
  const l = parts[parts.length - 1] ?? "";
  return f && l ? `${f} ${l}` : "";
}

/**
 * Nicknames, for ranking candidates only.
 *
 * This table exists so a reviewer sees "Mike Alvarez" next to "Michael Alvarez"
 * at the top of the list instead of hunting for it. It is never allowed to
 * create an automatic link — a nickname is exactly the kind of near-miss that
 * is right nine times and wrong the tenth, and the tenth is someone's pay rate.
 */
const NICKNAMES: Record<string, string> = {
  al: "albert", alex: "alexander", andy: "andrew", ben: "benjamin", bill: "william",
  bob: "robert", cathy: "catherine", charlie: "charles", chris: "christopher",
  chuck: "charles", dan: "daniel", dave: "david", deb: "deborah", don: "donald",
  ed: "edward", fred: "frederick", greg: "gregory", jake: "jacob", jen: "jennifer",
  jim: "james", joe: "joseph", john: "jonathan", ken: "kenneth", kim: "kimberly",
  liz: "elizabeth", matt: "matthew", meg: "margaret", mike: "michael", nick: "nicholas",
  pat: "patricia", pete: "peter", phil: "phillip", rick: "richard", rob: "robert",
  ron: "ronald", sam: "samuel", steve: "stephen", sue: "susan", tim: "timothy",
  toby: "tobias", tom: "thomas", tony: "anthony", vicky: "victoria", will: "william",
};

/** Both names reduced to a canonical first name, where one is known. */
function canonicalFirst(first: string): string {
  return NICKNAMES[first] ?? first;
}

/**
 * Dice coefficient over character bigrams, 0..1.
 *
 * A cheap similarity that handles the transpositions and dropped letters that
 * typed names actually contain, without pulling in a dependency for it.
 */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  const total = (a.length - 1) + (b.length - 1);
  return total > 0 ? (2 * shared) / total : 0;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * How alike two names are, 0..100, with the reasons spelled out.
 *
 * The reasons matter more than the number: they are rendered next to the
 * candidate so a reviewer can see *why* it was offered and disagree on the
 * evidence rather than on a score they have no way to interpret.
 */
function scoreNames(par: ParPerson, ws: WsEmployee): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const pFirst = normalizeName(par.firstName).split(" ")[0] ?? "";
  const pLast = (normalizeName(par.lastName).split(" ").filter(Boolean).pop()) ?? "";
  const wFirst = normalizeName(ws.first_name).split(" ")[0] ?? "";
  const wLast = (normalizeName(ws.last_name).split(" ").filter(Boolean).pop()) ?? "";

  if (!pLast || !wLast) {
    // PAR sometimes carries only a DisplayName. Fall back to whole-string
    // similarity so the person is still offered candidates rather than none.
    const s = similarity(normalizeName(par.displayName), normalizeName(employeeName(ws)));
    if (s > 0) reasons.push(`names ${Math.round(s * 100)}% alike (no last name on the PAR record)`);
    return { score: Math.round(s * 60), reasons };
  }

  const lastExact = pLast === wLast;
  const lastLike = similarity(pLast, wLast);

  // Workstream holds a preferred name, and it is often the only name the store
  // uses — PAR will say "Trey Ellison" where Workstream's legal record says
  // "Robert". Treated as an alternative first name for ranking only: a
  // preferred name that matches is strong evidence for a human, and still not
  // grounds for an automatic link.
  const wPreferred = normalizeName(preferredName(ws)).split(" ")[0] ?? "";
  if (lastExact && wPreferred && wPreferred === pFirst && pFirst !== wFirst) {
    reasons.push(`last name matches; Workstream has them as "${ws.first_name}" but they go by "${ws.preferred_name}"`);
    return { score: 92, reasons };
  }

  let score: number;
  if (lastExact && pFirst === wFirst) {
    score = 100;
    reasons.push("first and last name match exactly");
  } else if (lastExact && canonicalFirst(pFirst) === canonicalFirst(wFirst)) {
    score = 86;
    reasons.push(`last name matches; "${pFirst}" and "${wFirst}" are the same name`);
  } else if (lastExact && pFirst && wFirst && pFirst[0] === wFirst[0]) {
    score = 78;
    reasons.push("last name matches, first initial matches");
  } else if (lastExact) {
    score = 62;
    reasons.push("last name matches, first name does not");
  } else if (pFirst === wFirst && lastLike > 0.5) {
    score = 68;
    reasons.push("first name matches, last name is similar — a name change or a typo");
  } else {
    const whole = similarity(`${pFirst} ${pLast}`, `${wFirst} ${wLast}`);
    score = Math.round(whole * 60);
    if (whole > 0.4) reasons.push(`names ${Math.round(whole * 100)}% alike`);
  }
  return { score, reasons };
}

/** Corroborating evidence. Adjusts the ranking; never creates a match. */
function scoreCorroboration(par: ParPerson, ws: WsEmployee): { delta: number; reasons: string[] } {
  const reasons: string[] = [];
  let delta = 0;

  const wsRate = hourlyRate(ws);
  if (par.payRate != null && par.payRate > 0 && wsRate != null) {
    const gap = Math.abs(par.payRate - wsRate);
    if (gap < 0.005) {
      delta += 6;
      reasons.push(`same pay rate ($${wsRate.toFixed(2)})`);
    } else if (gap <= 0.25) {
      delta += 3;
      reasons.push(`pay rates within 25¢ ($${par.payRate.toFixed(2)} PAR / $${wsRate.toFixed(2)} Workstream)`);
    } else {
      delta -= 4;
      reasons.push(`pay rates differ ($${par.payRate.toFixed(2)} PAR / $${wsRate.toFixed(2)} Workstream)`);
    }
  }

  const title = primaryAssignment(ws)?.title;
  if (par.jobName && title) {
    const s = similarity(normalizeName(par.jobName), normalizeName(title));
    if (s > 0.6) {
      delta += 2;
      reasons.push(`same job (${title})`);
    }
  }

  // Someone PAR has terminated who is still active in Workstream, or the other
  // way round, is common and normal during the week either system lags. Worth
  // saying out loud, not worth penalising.
  if (par.terminated && !ws.termination_date) {
    reasons.push("terminated in PAR, still active in Workstream");
  }

  return { delta, reasons };
}

// ── Proposals ────────────────────────────────────────────────────────────────

export type MatchCandidate = {
  workstreamUuid: string;
  name: string | null;
  /** What they go by, when it differs from the legal first name. */
  goesBy: string | null;
  title: string | null;
  hourlyRate: number | null;
  hiredDate: string | null;
  terminationDate: string | null;
  /** 0..100. A ranking aid for a human, not a threshold anything acts on. */
  score: number;
  reasons: string[];
};

export type LinkState =
  /** Linked by an exact, unique name match. Nobody had to look at it. */
  | "auto"
  /** Linked because a person said so. */
  | "confirmed"
  /** A person recorded that there is no Workstream record for them. */
  | "absent"
  /** Nobody has decided, and this module will not decide for them. */
  | "review";

export type LinkProposal = {
  parStoreId: string;
  parEmployeeId: string;
  parName: string;
  parJob: string | null;
  parPayRate: number | null;
  parTerminated: boolean;
  state: LinkState;
  /** The resolved counterpart, when there is one. */
  workstreamUuid: string | null;
  /** Ranked alternatives, best first. Present even once linked, for changing it. */
  candidates: MatchCandidate[];
};

export type StoreLinkReport = {
  parStoreId: string;
  proposals: LinkProposal[];
  /**
   * Workstream people at this location that no PAR employee resolved to.
   * Usually a new hire PAR has not been told about, or an office role that
   * never clocks in — but a long-lived entry here means a link is missing.
   */
  unlinkedWorkstream: MatchCandidate[];
};

/** Candidates below this are noise and are not offered at all. */
const MIN_CANDIDATE_SCORE = 40;

/** How many alternatives a reviewer is shown. */
const MAX_CANDIDATES = 5;

function toCandidate(ws: WsEmployee, score = 0, reasons: string[] = []): MatchCandidate {
  const assignment = primaryAssignment(ws);
  return {
    workstreamUuid: ws.uuid,
    name: employeeName(ws),
    goesBy: preferredName(ws),
    title: assignment?.title ?? null,
    hourlyRate: hourlyRate(ws),
    hiredDate: ws.hired_date ?? ws.start_date ?? null,
    terminationDate: ws.termination_date ?? null,
    score,
    reasons,
  };
}

/**
 * Resolve one store's PAR roster against its Workstream roster.
 *
 * The order of precedence is the whole design:
 *
 *   1. a human decision, if there is one
 *   2. an exact, unique name match on both sides
 *   3. nothing — it goes to review with candidates
 *
 * Rule 2 is deliberately strict about *unique*. Two people called Chris Miller
 * at the same store means neither is auto-linked, even though both names match
 * exactly, because "matches exactly" and "identifies a person" are not the same
 * claim. That case is exactly the one a reviewer needs to see.
 */
export function proposeStoreLinks(input: {
  parStoreId: string;
  parEmployees: ParPerson[];
  workstreamEmployees: WsEmployee[];
  decisions: LinkDecision[];
}): StoreLinkReport {
  const { parStoreId, parEmployees, workstreamEmployees } = input;

  const decisions = input.decisions.filter((d) => d.parStoreId === parStoreId);
  const confirmed = new Map<string, string>();
  const absent = new Set<string>();
  const rejected = new Set<string>();
  for (const d of decisions) {
    if (d.status === "confirmed") confirmed.set(d.parEmployeeId, d.workstreamUuid);
    else if (d.status === "absent") absent.add(d.parEmployeeId);
    else if (d.status === "rejected") rejected.add(`${d.parEmployeeId} ${d.workstreamUuid}`);
  }

  const wsByUuid = new Map(workstreamEmployees.map((w) => [w.uuid, w]));

  // Uniqueness is counted over the whole roster, before anything is claimed —
  // a name is ambiguous or not on its own terms, regardless of what got
  // matched first.
  const parKeyCounts = new Map<string, number>();
  for (const p of parEmployees) {
    const k = nameKey(p.firstName, p.lastName);
    if (k) parKeyCounts.set(k, (parKeyCounts.get(k) ?? 0) + 1);
  }
  const wsByKey = new Map<string, WsEmployee[]>();
  for (const w of workstreamEmployees) {
    const k = nameKey(w.first_name, w.last_name);
    if (!k) continue;
    const list = wsByKey.get(k) ?? [];
    list.push(w);
    wsByKey.set(k, list);
  }

  // A Workstream record already spoken for by a confirmed decision cannot be
  // auto-matched to somebody else.
  const claimed = new Set(confirmed.values());

  const proposals: LinkProposal[] = [];
  const resolved = new Set<string>();

  for (const p of parEmployees) {
    const base = {
      parStoreId,
      parEmployeeId: p.id,
      parName: [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || p.displayName,
      parJob: p.jobName ?? null,
      parPayRate: p.payRate ?? null,
      parTerminated: p.terminated,
    };

    const ranked = workstreamEmployees
      .filter((w) => !rejected.has(`${p.id} ${w.uuid}`))
      .map((w) => {
        const name = scoreNames(p, w);
        const extra = scoreCorroboration(p, w);
        return toCandidate(
          w,
          Math.max(0, Math.min(100, name.score + extra.delta)),
          [...name.reasons, ...extra.reasons],
        );
      })
      .filter((c) => c.score >= MIN_CANDIDATE_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CANDIDATES);

    const decided = confirmed.get(p.id);
    if (decided && wsByUuid.has(decided)) {
      resolved.add(decided);
      proposals.push({ ...base, state: "confirmed", workstreamUuid: decided, candidates: ranked });
      continue;
    }
    if (decided) {
      // Confirmed against somebody who is no longer in this location's roster —
      // a transfer, or a record Workstream deleted. Say so rather than quietly
      // dropping the link.
      proposals.push({ ...base, state: "review", workstreamUuid: null, candidates: ranked });
      continue;
    }
    if (absent.has(p.id)) {
      proposals.push({ ...base, state: "absent", workstreamUuid: null, candidates: ranked });
      continue;
    }

    const key = nameKey(p.firstName, p.lastName);
    const exact = key ? (wsByKey.get(key) ?? []) : [];
    const unique =
      key.length > 0 &&
      exact.length === 1 &&
      (parKeyCounts.get(key) ?? 0) === 1 &&
      !claimed.has(exact[0].uuid) &&
      !rejected.has(`${p.id} ${exact[0].uuid}`);

    if (unique) {
      resolved.add(exact[0].uuid);
      proposals.push({ ...base, state: "auto", workstreamUuid: exact[0].uuid, candidates: ranked });
    } else {
      proposals.push({ ...base, state: "review", workstreamUuid: null, candidates: ranked });
    }
  }

  const unlinkedWorkstream = workstreamEmployees
    .filter((w) => !resolved.has(w.uuid))
    .map((w) => toCandidate(w));

  return { parStoreId, proposals, unlinkedWorkstream };
}

/** How much of a store is joined, for a banner that says whether to trust a column. */
export function linkCoverage(report: StoreLinkReport): {
  total: number;
  linked: number;
  review: number;
  absent: number;
} {
  let linked = 0;
  let review = 0;
  let absent = 0;
  for (const p of report.proposals) {
    if (p.state === "auto" || p.state === "confirmed") linked++;
    else if (p.state === "absent") absent++;
    else review++;
  }
  return { total: report.proposals.length, linked, review, absent };
}
