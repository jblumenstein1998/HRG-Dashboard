# Workstream

Recruiting and HR system of record. This is the design note: what the API gives
us, what it doesn't, and how its people get joined to PAR's hours.

## What the API actually exposes

Base URL `https://public-api.workstream.us`. Auth is OAuth2 `client_credentials`
against `POST /tokens`; tokens last seven days. Rate limiting is a 429 with
`Retry-After`, stricter on the payroll-shaped embeds. Pagination is `page` /
`per_page` (max 100). Date filters take `.gte` / `.lte` suffixes. There are no
webhooks.

### What it returns, measured — not what the docs describe

Run against the live HRG account on **2026-09-04**, with a dashboard access
token. `scripts/workstream-discover.mjs` reproduces all of this.

| Endpoint | Result |
| --- | --- |
| `/v2/employees` | 1,222 people. **Names, status, and dates. Nothing else.** |
| `/team_members` | the same record under another name |
| `/locations` | 31 — 13 restaurants, each with a `- Corporate` twin, plus the parent LLC |
| `/departments` | 4 — Crew, Shift Lead, Store Leadership, Above Store Leadership |
| `/positions` | job postings. `pay_amount` is advertising copy ("Starting at $14.00") |
| `/position_applications` | 504s unfiltered; works with `status=`. Carries email and phone |

An employee record is exactly:

```
uuid, first_name, middle_initial, last_name, preferred_name,
start_date, applied_date, hired_date, onboard_date,
status, termination_date, termination_note
```

**No location. No department. No job title. No pay rate.** The documented
`embed` parameter is accepted and silently ignored in every syntax (comma list,
repeated params, `include`, `expand`; `embed[]` 400s). There are no
`/v2/employees/{uuid}/job_assignments` or `.../earning_rates` sub-resources —
both 404. And there is no route from a location to its people: `location_uuid`,
`location` and `location_uuids[]` leave the total count at 1,222, and
`/locations/{uuid}/employees` is a 404.

The filters do work, which is how we know the ignored ones are genuinely
ignored: `status=active` → 451, `status=offboarded` → 730,
`hired_date.gte=2026-01-01` → 227, `termination_date.gte=2026-01-01` → 609, and
an invented parameter → 1,222.

### So the shape of what's possible is

**Answerable:** company-wide headcount, hires and terminations across any date
window — retention and turnover, which is what the bonus scorecard wanted.

**Not answerable:** anything per store, anyone's position, anyone's pay rate.

That last line is the one that hurts. Per-store retention is a per-store bonus
gate, and Workstream will not say which store anyone works at.

Whether this is the whole API or only this account is **not established**. The
documented fields may sit behind a module HRG doesn't have, or behind
OAuth-app credentials rather than a hand-minted dashboard token. Re-run the
discovery script after any credential change before concluding anything.

The tax and bank embeds are PII and rate-limited harder than anything else.
Nothing in the codebase requests them.

## The store join

`src/lib/bonus/storeMap.ts` gained `workstreamLocationUuid`, filled in **by
hand** from the discovery script's output. Deliberately not matched at runtime
on name: a name-matched store link would attach one restaurant's roster to
another's hours — wrong rather than missing.

**As of the 2026-09-04 measurement this field has nothing to do.** Employees
carry no location, so knowing a location's uuid buys nothing yet. The uuids are
recorded because they cost nothing to record and are the first thing needed if
the association ever appears.

The uuids also expose a wrinkle worth knowing: Workstream has **31 locations for
13 restaurants** — each store appears twice, once as `HRG Columbia LLC` and
again as `HRG Columbia LLC - Corporate`, plus a `Hudson Restaurant Group LLC`
parent. Any future per-store logic has to decide which twin is the restaurant,
which is exactly the judgement a person makes once when pasting a uuid in.

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

### What the measurement did to the join

The queue and its rules are unchanged and still correct — but with no title and
no rate coming back, the only thing Workstream currently contributes to a linked
person is their **full name**, and the only corroboration a reviewer gets is
what PAR already knew. Two consequences:

- The pay-rate evidence in the candidate list is dead weight until rates appear.
  It is left in place because it costs nothing and is the strongest signal the
  moment it exists.
- **65 pairs of people share a first and last name inside Workstream alone**
  (one name four times over), so those can never auto-link and will always need
  a human. That is the queue's floor, before PAR's side is even considered.

`preferred_name` turned out to be the one genuinely useful extra field: PAR will
have someone as "Trey Ellison" where Workstream's legal record says "Robert", so
a matching preferred name is ranked high and shown to the reviewer as "goes by".

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

The date filters are live-verified, so the arithmetic is available today —
**company-wide only**. Per store is impossible until Workstream associates an
employee with a location, which is the single question to put to their support.

Still to design:

- a snapshot table, so a period's headcount stays answerable after Workstream's
  current state has moved on
- turnover as a flat number the bonus engine can gate on — `src/lib/bonus/types.ts`
  requires every condition to be a single numeric gate against a single metric
- 90-day retention of new hires, which is the recruiting-side number
- a daily cron, a seventh entry in `vercel.json`, gated on `CRON_SECRET` like the
  other six

A company-wide turnover number is worth having on its own, but it cannot gate a
per-store bonus. Worth deciding deliberately rather than by default.

## Prerequisites

1. **Credentials.** Two steps, and being a Super Admin only covers the second:

   - Workstream support must enable the **OAuth App module** on the company
     (help@workstream.is). Nobody can switch it on from inside the dashboard.
   - Then, in **Admin View → Company Settings → Integrations → Access Token**, a
     Super Admin creates a token, ticking `employees`, `locations`,
     `departments` and `positions` — the same four `SCOPES` that `mintToken()`
     asks for. The two lists have to agree, or reads fail with a 403 that reads
     like a broken endpoint rather than a missing permission. The client id and
     secret appear at
     `https://hr.workstream.us/#/account?currentPanel=accesstoken`.

   Until the module is on, `WORKSTREAM_ACCESS_TOKEN` works — minted by hand in
   that same screen, valid seven days, fine for scripts and useless in
   production. Refreshing a token from the ••• menu breaks whatever is using it.
2. **Run the discovery script**, paste the location uuids into `storeMap.ts`.
3. **Run `scripts/migrate-workstream-links.mjs`** to create the table.
4. **Work the queue** at `/admin/workstream-links`, one store at a time.

Steps 2–4 are one afternoon. Step 1 is a support ticket.
