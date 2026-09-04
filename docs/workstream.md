# Workstream

Recruiting and HR system of record. This is the design note: what the API gives
us, what it doesn't, and how its people get joined to PAR's hours.

## What the API actually exposes

Base URL `https://public-api.workstream.us`. Auth is OAuth2 `client_credentials`
against `POST /tokens`; tokens last seven days. Rate limiting is a 429 with
`Retry-After`, stricter on the payroll-shaped embeds. Pagination is `page` /
`per_page` (max 100). Date filters take `.gte` / `.lte` suffixes. There are no
webhooks.

| Endpoint | What it's good for |
| --- | --- |
| `/v2/employees?embed=job_assignments,location,department` | names, hire and termination dates, position title, pay rate of record |
| `/locations`, `/departments` | the store map's missing key |
| `/positions`, `/position_applications` | the recruiting funnel |

### The thing that changes the plan

**There is no payroll-run data in the public API.** No paychecks, no gross or
net pay, no hours, no timesheets, no pay-period register. What exists that looks
like payroll is:

- `earning_rates` — the rate of record, per job assignment, with an
  `effective_date`, so rate *history* is reconstructable
- `direct_deposits`, `federal_tax`, `state_tax` — setup, not payments

So "pull payroll data" resolves to **rates and titles from Workstream, hours
from PAR**. That is not a workaround; it is the correct division. PAR is the
clock. `src/lib/staffing.ts` already computes regular and overtime minutes and
costs them at the rate recorded *on each shift*, which is what people were
actually paid. Workstream contributes what they are *supposed* to be paid, which
is a different and also useful number — where the two disagree, somebody wants
to know, and the staffing tab now says so.

The tax and bank embeds are PII and rate-limited harder than anything else.
Nothing in the codebase requests them.

## The store join

`src/lib/bonus/storeMap.ts` gained `workstreamLocationUuid`. It is filled in **by
hand**, from `node --env-file=.env.local scripts/workstream-discover.mjs`, which
prints every Workstream location beside the PAR store it resembles.

Deliberately not matched at runtime on name. Twelve stores change about never,
and a name-matched store link would attach one restaurant's roster to another's
hours — wrong rather than missing. A store with no uuid simply has no Workstream
data, and every screen says so instead of guessing.

## The employee join

This is the hard part, and the reason for most of the code.

PAR's employee record carries no external id, no email and no phone. Its ids are
per store, so one person working two restaurants is two PAR rows and one
Workstream record. **The only overlapping field is a name.**

A name match is a guess, and guessing wrong doesn't produce a blank cell — it
produces someone else's pay rate beside your hours. So:

### Resolution order

1. **A stored human decision**, if there is one.
2. **An exact, unique name match** — identical after normalisation, and unique
   on *both* sides of the store. Two people called Chris Miller at one store
   means neither is auto-linked, because "matches exactly" and "identifies a
   person" are not the same claim.
3. **Nothing.** It goes to the review queue with ranked candidates.

Normalisation folds accents, drops punctuation and generational suffixes, and
ignores middle names. Nicknames (Mike/Michael) and pay-rate agreement affect
*ranking only* — they can never create a link.

### Why decisions are stored and matches are not

`workstream_employee_links` holds only what people decided. The automatic
matches are recomputed on every read.

That is what makes this survive hiring rather than being a one-time import:

- a new hire with an unambiguous name links the day both systems know them,
  with nobody involved
- a new hire with an ambiguous name appears in the queue by itself
- a roster change corrects itself instead of leaving a stale row behind

Three kinds of decision, and the third matters most:

| status | meaning |
| --- | --- |
| `confirmed` | this PAR employee is this Workstream employee |
| `absent` | this PAR employee has no Workstream record — stop asking |
| `rejected` | this *pair* is not the same person — stop offering it |

Without `rejected` and `absent` the queue never empties, and a review surface
that never empties is one people stop opening.

Two partial unique indexes enforce the shape: one live decision per PAR
employee, and one confirmed claim per Workstream person *per store*.

### Where it lives

| File | Role |
| --- | --- |
| `src/lib/workstream.ts` | the vendor client — auth, paging, types. DB-free, like `par.ts` |
| `src/lib/workstreamLink.ts` | the matching rules. Pure functions, no DB, no network |
| `src/lib/workstreamLinkStore.ts` | the decisions table |
| `src/lib/workstreamRoster.ts` | fetches both sides and applies the rules |
| `src/app/admin/workstream-links` | the screen people confirm on (admin-only) |
| `src/app/api/workstream/links` | GET the queue, POST one decision |

Decisions record the email of whoever made them, because the question a wrong
link raises six months later is "who said these were the same person?".

## What the staffing tab shows now

`StaffOnClock` and `EmployeeWeekHours` each carry a `workstream` field, null
unless that person is joined:

- **full name** — PAR's `DisplayName` is only a first name and a last initial
- **position** — what they were hired as, next to the job they clocked in as
- **rate of record** — flagged when it disagrees with the shift's rate
- **hire and termination dates**

If Workstream is unreachable, unconfigured, or the store is unmapped, the lookup
returns empty and the tab loses two columns rather than failing. The hours were
never Workstream's to supply.

## Retention (next, not built)

Workstream is the only system that knows hire and termination dates, so it is
the only possible source for retention — which is why the bonus scorecard wants
it.

The one design decision already made, in `employedOn()`: retention is answered
as a **date test**, never by reading `status`. `status` is only ever the present
tense, and "how many people did we have in P3" is a question about the past.

Still to design:

- a snapshot table, so a period's headcount stays answerable after Workstream's
  current state has moved on
- turnover as a flat number the bonus engine can gate on — `src/lib/bonus/types.ts`
  requires every condition to be a single numeric gate against a single metric
- 90-day retention of new hires, which is the recruiting-side number
- a daily cron, a seventh entry in `vercel.json`, gated on `CRON_SECRET` like the
  other six

## Prerequisites

1. **Credentials.** `WORKSTREAM_CLIENT_ID` / `WORKSTREAM_CLIENT_SECRET` require
   Workstream support to enable the OAuth App module (help@workstream.is); only
   a Super Admin can request it. Until then, `WORKSTREAM_ACCESS_TOKEN` works —
   minted by hand in the dashboard, valid seven days, fine for scripts and
   useless in production.
2. **Run the discovery script**, paste the location uuids into `storeMap.ts`.
3. **Run `scripts/migrate-workstream-links.mjs`** to create the table.
4. **Work the queue** at `/admin/workstream-links`, one store at a time.

Steps 2–4 are one afternoon. Step 1 is a support ticket.
