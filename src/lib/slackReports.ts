/**
 * Slack reporting completion — the GM's "95% or more Slack completion rate".
 *
 * Every store posts four reports a day to its own private channel. The source
 * of truth is the "HRG - Slack Reporting" doc
 * (1gdPeMm13f7y0xeNRiA12F2ppQ0ncoUR7u0LKr4NQXQw), and its times are the
 * store's local time:
 *
 *   by 8:30 AM  Full previous day (net sales, comp, catering, … cash over/short)
 *               plus the current day's sales and productivity projections
 *   by 2:30 PM  11–2 window, with hourly sales 11-12 / 12-1 / 1-2
 *   by 5:30 PM  2–5 window,  with hourly sales 2-3 / 3-4 / 4-5
 *   by 8:30 PM  5–8 window,  with hourly sales 5-6 / 6-7 / 7-8
 *
 * Completion is reports posted by their deadline ÷ reports required. A late
 * report is counted and shown, but does not count as complete — the doc says
 * "by", and leadership calls out late reports in the channels as misses.
 *
 * Nobody posts these from a template. The same report arrives as "10/26
 * lunch / Net 1296 / 11-12 389 …", as "*Total net sales: $3,325.50* /
 * Hourly breakdown: •11-12: 754.42 …", and with ranges typed as "2:3". So a
 * message is classified by what it contains first — the hourly ranges are the
 * one thing every shift report carries — and only falls back to the time it was
 * posted when the content says nothing. Screenshot-only posts carry no text and
 * cannot be read; they don't count.
 *
 * Everything above the fetch is pure (no env, no network, no clock) so
 * scripts/check-slack-reports.mjs can exercise it directly.
 */

export type SlackSlot = "previous_day" | "lunch" | "midday" | "dinner";

export const SLACK_SLOTS: { id: SlackSlot; label: string; deadline: string }[] = [
  { id: "previous_day", label: "8:30 AM full previous day", deadline: "08:30" },
  { id: "lunch", label: "2:30 PM (11–2)", deadline: "14:30" },
  { id: "midday", label: "5:30 PM (2–5)", deadline: "17:30" },
  { id: "dinner", label: "8:30 PM (5–8)", deadline: "20:30" },
];

const DEADLINE_MINUTES: Record<SlackSlot, number> = Object.fromEntries(
  SLACK_SLOTS.map((s) => {
    const [h, m] = s.deadline.split(":").map(Number);
    return [s.id, h * 60 + m];
  }),
) as Record<SlackSlot, number>;

/** When each report's window closes — the earliest it could sensibly be posted. */
const SLOT_OPENS: Record<SlackSlot, number> = {
  previous_day: 0,
  lunch: 13 * 60,
  midday: 16 * 60,
  dinner: 19 * 60,
};

export type SlackMessage = {
  ts: string;
  text?: string;
  user?: string;
  subtype?: string;
  bot_id?: string;
};

// ── Classification ───────────────────────────────────────────────────────────

/** Only the full-day report carries these. */
const FULL_DAY_RE =
  /\bcomp\b|projection|over\s*\/\s*short|arrow\s*stream|\barrow\b|previous day|whole day|full day|all day|catering/i;

/**
 * An hourly range: "11-12", "2-3", "5 - 6", "2:3", "11–12". The look-behind
 * keeps it off dollar amounts and dates, and the look-ahead stops a lane time
 * like "3:27" reading as 3-2.
 */
const RANGE_RE = /(?<![\d$.,/:])(11|12|[1-7])\s*[-–:]\s*(12|[1-8])(?![\d.,/]|:\d)/g;

const RANGE_SLOT: Record<number, SlackSlot> = {
  11: "lunch", 12: "lunch", 1: "lunch",
  2: "midday", 3: "midday", 4: "midday",
  5: "dinner", 6: "dinner", 7: "dinner",
};

/**
 * Is this a sales report at all, rather than chatter? Every report leads with
 * a sales figure: "Net sales- $1547", "Netsales: 1,954.10", "Net 1296",
 * "Sales- $4334". The figure is what keeps out a leader's blank template ("Total
 * net sales:* / Comp % :*") and talk about sales ("sales for Tuesday I see as…").
 */
export function isReport(text: string): boolean {
  // At least three digits, so a blank template's "Net Sales: $ • 5-6: $" —
  // posted and never filled in — doesn't read the hour as the figure.
  if (/(?:\bnet\s*sales?|\bnet|\bsales?)\b\W{0,6}\d[\d,]{2,}/i.test(text)) return true;
  // Or the hourly figures are filled in even though the total was left off
  // ("NET SALES: 2-3: 384 3-4: 795 4-5: 887").
  const filledHours = [...text.matchAll(RANGE_RE)].filter((m) =>
    /^\W{0,4}\d{2,}/.test(text.slice((m.index ?? 0) + m[0].length)),
  );
  return filledHours.length >= 2;
}

/**
 * The report a message is, from its content alone, or null when the content
 * doesn't say (the caller then falls back to the posting time).
 *
 * Hourly ranges are read first: only the shift reports carry them, while the
 * full-day words turn up in a shift report's sign-off ("getting set to comp
 * up!").
 */
export function classifyByContent(text: string): SlackSlot | null {
  const votes = new Map<SlackSlot, number>();
  for (const m of text.matchAll(RANGE_RE)) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    // A real hourly range runs one hour forward: 11-12, 12-1, 1-2 …
    if (to !== (from % 12) + 1) continue;
    const slot = RANGE_SLOT[from];
    if (slot) votes.set(slot, (votes.get(slot) ?? 0) + 1);
  }
  if (votes.size > 0) return [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];

  if (FULL_DAY_RE.test(text)) return "previous_day";
  if (/\blunch\b/i.test(text)) return "lunch";
  if (/\bmid\s*-?\s*day\b/i.test(text)) return "midday";
  if (/\bdinner\b/i.test(text)) return "dinner";
  return null;
}

function classifyByTime(localMinutes: number): SlackSlot {
  if (localMinutes < 12 * 60) return "previous_day";
  if (localMinutes < 16 * 60) return "lunch";
  if (localMinutes < 19 * 60) return "midday";
  return "dinner";
}

// ── Dates ────────────────────────────────────────────────────────────────────

export function localParts(ts: string, timeZone: string): { date: string; minutes: number } {
  const d = new Date(Number(ts) * 1000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/**
 * The date written at the top of a report ("10/22 dinner", "10/27/26 Full
 * Day"), if there is one and it is believable. Reports are sometimes posted
 * days late, and the written date is the only thing that says which shift a
 * late one was for. A date after the posting date, or more than a week before
 * it, is a typo ("11/21 lunch" posted on 10/21) and is ignored.
 */
export function writtenDate(text: string, postedDate: string): string | null {
  const m = text.match(/(?<!\d)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d)/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = Number(postedDate.slice(0, 4));
  for (const y of [year, year - 1]) {
    const iso = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (iso <= postedDate && iso >= addDays(postedDate, -7)) return iso;
  }
  return null;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export type SlotStatus = "on_time" | "late" | "missed";

export type SlackDay = {
  date: string;
  /** null = not due (the store was closed). */
  slots: Record<SlackSlot, SlotStatus | null>;
  /** The Slack ts of the message that filled each slot, if any. */
  posts: Record<SlackSlot, string | null>;
};

export type SlackCompletion = {
  required: number;
  onTime: number;
  late: number;
  missed: number;
  /** On-time ÷ required × 100; null when nothing was required. */
  pct: number | null;
  days: SlackDay[];
};

/**
 * Which day and slot a message satisfies, and when it was posted relative to
 * that slot's deadline. The full-day report covers yesterday but is due the
 * morning it's posted, so it fills that morning's slot.
 */
export type Placement = {
  date: string;
  slot: SlackSlot;
  onTime: boolean;
  /** Whether the content said which report this is, or the posting time had to. */
  by: "content" | "time";
  /** Local posting date and minutes after midnight. */
  posted: { date: string; minutes: number };
};

export function placeMessage(msg: SlackMessage, timeZone: string): Placement | null {
  const text = msg.text ?? "";
  if (msg.bot_id || (msg.subtype && msg.subtype !== "thread_broadcast" && msg.subtype !== "file_share")) return null;
  if (!isReport(text)) return null;

  const posted = localParts(msg.ts, timeZone);
  let byContent = classifyByContent(text);
  // A shift report can't be posted before its window has nearly run: "5-6"
  // at 5:09 PM, or "2-3" at 2:27 PM, is the earlier report with the wrong
  // template pasted in, and the clock is the better witness. Afternoons only:
  // shift ranges posted in the morning are yesterday's report caught up.
  if (
    byContent && byContent !== "previous_day" &&
    posted.minutes >= 12 * 60 && posted.minutes < SLOT_OPENS[byContent] - 60
  ) {
    byContent = null;
  }
  const slot = byContent ?? classifyByTime(posted.minutes);

  // The posting date wins whenever the posting time fits the slot. Typed dates
  // are wrong often enough ("10/22 dinner" posted at 8:38 PM on 10/27, the only
  // dinner report that day) that they are only trusted for a report that is
  // plainly a catch-up — posted well outside its own slot's hours.
  const fitsPostedDay =
    posted.minutes >= SLOT_OPENS[slot] && posted.minutes <= DEADLINE_MINUTES[slot] + 3 * 60;
  const written = fitsPostedDay ? null : writtenDate(text, posted.date);
  let date: string;
  if (slot === "previous_day") {
    date = written ? addDays(written, 1) : posted.date;
  } else {
    // A shift report posted after midnight belongs to the day before.
    date = written ?? (posted.minutes < 3 * 60 ? addDays(posted.date, -1) : posted.date);
  }

  const onTime = posted.date < date || (posted.date === date && posted.minutes <= DEADLINE_MINUTES[slot]);
  return { date, slot, onTime, by: byContent ? "content" : "time", posted };
}

/**
 * Score a store's channel history over [start, end] inclusive.
 *
 * `openDays`, when given, is the set of dates the store traded (PAR net sales
 * above zero). The three shift reports are required on an open day, and the
 * morning report on a day whose previous day was open — so Thanksgiving and
 * Christmas don't count as misses. Without it every day is required.
 */
export function scoreSlackReports(
  messages: SlackMessage[],
  opts: { timeZone: string; start: string; end: string; openDays?: Set<string> | null },
): SlackCompletion {
  // The message that fills each `${date}|${slot}`: the earliest on-time one,
  // else the earliest late one.
  const best = new Map<string, { ts: string; onTime: boolean }>();
  for (const msg of messages) {
    const placed = placeMessage(msg, opts.timeZone);
    if (!placed) continue;
    const key = `${placed.date}|${placed.slot}`;
    const prior = best.get(key);
    const better =
      !prior ||
      (placed.onTime && !prior.onTime) ||
      (placed.onTime === prior.onTime && Number(msg.ts) < Number(prior.ts));
    if (better) best.set(key, { ts: msg.ts, onTime: placed.onTime });
  }

  const isOpen = (d: string) => !opts.openDays || opts.openDays.has(d);
  const days: SlackDay[] = [];
  let required = 0, onTime = 0, late = 0;
  for (let date = opts.start; date <= opts.end; date = addDays(date, 1)) {
    const slots = {} as Record<SlackSlot, SlotStatus | null>;
    const posts = {} as Record<SlackSlot, string | null>;
    for (const { id } of SLACK_SLOTS) {
      const hit = best.get(`${date}|${id}`);
      posts[id] = hit?.ts ?? null;
      const needed = id === "previous_day" ? isOpen(addDays(date, -1)) : isOpen(date);
      if (!needed) {
        slots[id] = null;
        continue;
      }
      required++;
      if (hit?.onTime) { slots[id] = "on_time"; onTime++; }
      else if (hit) { slots[id] = "late"; late++; }
      else slots[id] = "missed";
    }
    days.push({ date, slots, posts });
  }

  return {
    required,
    onTime,
    late,
    missed: required - onTime - late,
    pct: required > 0 ? Math.round((onTime / required) * 1000) / 10 : null,
    days,
  };
}

// ── Slack API ────────────────────────────────────────────────────────────────

/**
 * The token channel history is read with: the dashboard bot, which has
 * `groups:history` and `users:read` and is invited to every store channel
 * (2026-10-29). A new store channel needs the bot invited, or that store reads
 * "can't see the channel" here and goes pending on the scorecard.
 */
function readToken(): string | undefined {
  return process.env.SLACK_BOT_TOKEN;
}

/**
 * Top-level messages in a channel between two instants (unix seconds).
 *
 * A channel the token can't read throws, and the resolver leaves that store's
 * criterion pending rather than scoring it zero.
 */
export async function fetchChannelHistory(
  channelId: string,
  oldest: number,
  latest: number,
): Promise<SlackMessage[]> {
  const token = readToken();
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set");

  const out: SlackMessage[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({
      channel: channelId,
      oldest: String(oldest),
      latest: String(latest),
      limit: "200",
      inclusive: "true",
    });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`https://slack.com/api/conversations.history?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "2");
      await new Promise((r) => setTimeout(r, wait * 1000));
      page--;
      continue;
    }
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      needed?: string;
      messages?: SlackMessage[];
      response_metadata?: { next_cursor?: string };
    };
    if (!data.ok) {
      // A private channel the token's account isn't in reads as "not found".
      if (data.error === "channel_not_found" || data.error === "not_in_channel") {
        throw new Error(`can't see the channel (${data.error}) — invite @hrg_dashboard_bot to it`);
      }
      throw new Error(data.error === "missing_scope" ? `missing_scope (${data.needed})` : (data.error ?? "unknown error"));
    }
    out.push(...(data.messages ?? []));
    cursor = data.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return out;
}

/**
 * Display names for Slack user ids, best effort: needs `users:read`, and any id
 * it can't resolve is simply left out, so callers fall back to the id.
 */
export async function fetchUserNames(ids: string[]): Promise<Map<string, string>> {
  const token = readToken();
  const names = new Map<string, string>();
  if (!token) return names;
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      try {
        const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = (await res.json()) as {
          ok: boolean;
          user?: { real_name?: string; name?: string; profile?: { display_name?: string; real_name?: string } };
        };
        const u = data.user;
        const name = u?.profile?.real_name || u?.real_name || u?.profile?.display_name || u?.name;
        if (data.ok && name) names.set(id, name);
      } catch {
        // A name is a nicety; the id stands in.
      }
    }),
  );
  return names;
}

/** Unix seconds for local midnight at the start of `date` in `timeZone`. */
export function localMidnight(date: string, timeZone: string): number {
  // Start from UTC midnight and correct by the zone's offset at that instant;
  // every store zone is a whole number of hours from UTC.
  const utc = Date.parse(`${date}T00:00:00Z`) / 1000;
  const { date: d, minutes } = localParts(String(utc), timeZone);
  const offset = d < date ? minutes - 24 * 60 : minutes; // local − UTC, in minutes
  return utc - offset * 60;
}
