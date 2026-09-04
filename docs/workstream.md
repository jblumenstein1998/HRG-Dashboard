# Workstream

Recruiting and HR system of record. This is the design note: what the API gives
us, what it doesn't, and how its people get joined to PAR's hours.

## What the API actually exposes

Base URL `https://public-api.workstream.us`. Auth is OAuth2 `client_credentials`
against `POST /tokens`; tokens last seven days. Rate limiting is a 429 with
`Retry-After`, stricter on the payroll-shaped embeds. Pagination is `page` /
`per_page` (max 100). Date filters take `.gte` / `.lte` suffixes. There are no
webhooks.

### The embed syntax, which is the whole ballgame

Embedded resources must be wrapped in **parentheses**:

```
GET /v2/employees?embed=(job_assignments,company,location,department)
```

Without them the parameter is accepted and **silently ignored**, and every
employee comes back as twelve flat fields — no location, no job title, no pay.
A bare comma list, repeated `embed` params, `include` and `expand` all fail the
same quiet way. Only `embed[]` is honest enough to return a 400.

That is worth stating plainly because it is indistinguishable from an API that
does not hold the data, and this document previously said exactly that. With
the parentheses, everything documented comes back.

### Never ask for `information`

The `information` embed returns **social security numbers in plaintext**, plus
date of birth, ethnicity, gender and marital status. `address`,
`emergency_contact`, `eligibility`, `direct_deposits`, `federal_tax` and
`state_tax` are the same class of thing.

None are in `EMPLOYEE_EMBED` and none should be. This dashboard shows who is on
shift and what a store costs; no screen in it is improved by an SSN, and data
never fetched cannot be leaked, logged or cached. If a feature ever seems to
need one, that is a conversation, not a string to extend.

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

…**and with `embed=(…)` it also carries `job_assignments`, `company`,
`location` and `department`** — which is the position, the pay and the store.

Measured across the whole company:

- **868 of 1,224** employees carry a job assignment; the rest are offboarded or
  still onboarding
- **871** assignments carry an hourly rate
- job titles are exactly the operating vocabulary: Crew 550, Cook 101,
  Cashier 98, Shift Lead 56, Director 36, Crew Trainer 18, General Manager 17,
  AGM 12, District Manager 6, Director of Operations 2
- every assignment carries a `location_id` that joins straight to
  `BONUS_STORES.workstreamLocationUuid`, and the per-store counts are sensible:
  College 94, Chesapeake 90, Hampton 83, Columbia 78 … Brentwood 37,
  Portland 24
- a full paged fetch with these embeds takes **about 35 seconds**, which is why
  `workstreamRoster.ts` caches it for an hour instead of reading per request

There is still no route *from* a location to its people — `location_uuid`,
`location` and `location_uuids[]` are ignored as filters, and
`/locations/{uuid}/employees` 404s — but that no longer matters, because the
location arrives on each employee's assignment and grouping happens here.

Note the filters do work: `status=active` → 450, `status=offboarded` → 731,
`hired_date.gte=2026-01-01` → 227, and an invented parameter → 1,224. And a
missing scope is a loud `403`, not silently dropped data — removing the
positions scope made `/positions` fail immediately. Both facts are what made
the ignored `embed` so misleading: everything else in this API fails honestly.

### Rates are concurrent, not historical

An assignment carries several `earning_rates` at once, one per earning type —
a Cashier has `hourly` 13.50 **and** `overtime` 20.25, plus `pto`, `sick` and
`paid_holiday` rows. Across the company: hourly 932, overtime 840, pto 39,
paid_holiday 38, salaried 32, sick 31, and a few
rest_and_recovery / non_productive / double_overtime.

So "their pay rate" means the row whose `earning_type` is `hourly`. Summing or
averaging these invents a number nobody is paid. `period` is `hourly` or
`annually` — not `hour`/`year` as the docs imply, which is a real trap because
the wrong spelling silently matches nothing.

`effective_date` is **null on every row**, so rate history is not
reconstructable from `earning_rates`. `latest_earning_snapshot` holds dated
periods if that is ever needed.

### How much of it is actually filled in

Measured across all 1,224 employees, because a field that exists and a field
that is populated are different things:

| field | filled | notes |
| --- | --- | --- |
| `uuid`, `first_name`, `last_name`, `hired_date`, `status` | 100% | the spine |
| `start_date` | 98% | |
| `onboard_date` | 66% | a timestamp, not a date, unlike its neighbours |
| `termination_date` | 58% | **see below** |
| `middle_initial` | 33% | |
| `applied_date` | 10% | so time-to-hire is not answerable for most people |
| `preferred_name` | 8% | but decisive when present |
| `termination_note` | 2% | free text |

Three things in there change how retention has to be written:

**24 people are `offboarded` with no `termination_date`** — 731 offboarded
against 707 dates. Any turnover count has to decide what to do with them
explicitly rather than let a date filter drop them silently.

**There are duplicate employee records.** The termination notes say so in as
many words — "duplicate", "duplicate account", "duplicate profile", "dup",
"employeed at college duplicate". So headcount from a raw row count is
overstated by an unknown amount, and the same human can appear twice in the
review queue.

**`termination_note` is not a reason code.** Of the 30 filled in, some are
genuinely useful ("left for school", "no call no show", "walked off shift"),
several are system-generated ("… is rejected by Columbia Zaxby's at hiring
complete stage"), and several are housekeeping. It cannot separate voluntary
from involuntary turnover, so it cannot carry a regretted-turnover metric.

### Where position and pay actually live

In **Workstream Payroll**, on the job assignment attached to a payroll team
member — not on the recruiting/onboarding employee record the API hands out.

The account plainly has that module. `/company_roles` spells the vocabulary out:
`configure_payroll`, `manage_payroll_operations`, `manage_payroll_team_members`,
`read_payroll_reports_dashboards_and_analytics`, `view_worker_direct_deposit`,
alongside `manage_schedules`, `manage_attendance` and the time-off permissions.
So HRG runs payroll, scheduling and attendance in Workstream, and none of the
three is reachable through the public API.

The documented data model matches: `job_assignments` → `earning_rates` →
`latest_earning_snapshot` with dated `periods`, and an
`external_earning_code_id` for syncing to a payroll engine. That is a payroll
schema, and `/team_members` — the endpoint whose name matches
`manage_payroll_team_members` — returns only its identity subset: name, status,
start date.

**And the API does project it** — through `embed=(job_assignments,…)`, which is
why the assignment carries `location_id`, `title` and `earning_rates` while the
bare employee record carries none of them.

### Not needed: Custom Reports / Data Export

The same permission list carries `edit_custom_reports`,
`edit_data_export_report` and `edit_data_export_template`, so Workstream also
has a reporting and export feature. It was the fallback plan while the embeds
looked dead, and it is not needed now — an export somebody schedules is a
worse dependency than an API call, and this one works.

Worth remembering only if a future need lands outside what the API exposes.

Also worth knowing before anyone re-plans hours: `manage_schedules` and
`manage_attendance` mean Workstream may hold schedules and clock data too. The
public API exposes neither, so PAR remains the clock regardless.

### v1 and v2 are different populations

`GET /employees` (v1) returns **248 records with statuses `in_progress` (144),
`suspended` (91) and `not_started` (13)** — onboarding progress, not employment.
`GET /v2/employees` returns 1,224 with `active` / `offboarded` / `onboarding` /
`hired`.

**Zero uuids overlap between them.** They are separate record types with
separate ids, so the two cannot be joined on anything but a name. Worth knowing
before anyone reaches for v1 to fill a gap in v2.

### So the shape of what's possible is

**Answerable:** headcount, hires and terminations over any date window, **per
store**; each person's job title and rate of record; the whole retention and
turnover question the bonus scorecard wanted.

**Not answerable:** hours, timesheets, paychecks, gross or net pay. Those are
payroll runs and the public API has none. PAR remains the clock.

No support ticket is needed. The data was there the whole time, behind a pair
of parentheses.

The tax and bank embeds are PII and rate-limited harder than anything else.
Nothing in the codebase requests them.

## The store join

`src/lib/bonus/storeMap.ts` carries `workstreamLocationUuid`, and it is filled
in from **evidence rather than names**.

Workstream's manager logins are store mailboxes carrying the PAR store number —
`hampton57002@zaxbys.com` — and each user's `permission_config.locations` names
the location uuid they administer. Joining those gives a PAR store id and a
Workstream location uuid in one record, with nobody reading a name. Eight of the
twelve stores are pinned that way; the discovery script prints the derivation.

It earns its keep on the first try. The mailbox for **57006 is
`chesapeake57006@zaxbys.com` and it administers Hillcrest** — 57006 is
Hillcrest's PAR id and the word "chesapeake" is a leftover. A name match would
have put Hillcrest's people under Chesapeake and looked perfectly sensible.

The four Tennessee stores have no numbered mailbox and rest on a unique name
plus a second signal: Workstream carries a `- Corporate` twin of every location,
and **no user administers any twin** (0 users, against 3–8 for each operating
restaurant). The plain names are the restaurants.

These uuids are load-bearing: every job assignment carries a `location_id` that
is one of them, so this table is what turns a Workstream roster into a per-store
one. The counts come out sensibly — College 94, Chesapeake 90, Hampton 83,
Columbia 78, down to Brentwood 37 and Portland 24.

### Portland, and the count of restaurants

Workstream has 31 locations: 16 real ones, 15 `- Corporate` twins. Of the real
ones, 13 are the restaurants — the PAR twelve plus **Portland** — with
`Hudson Restaurant Group LLC` as the parent, and Hohenwald and Lafayette
alongside (2–3 managers each).

Portland is **not** in `BONUS_STORES`. Every row there is keyed on a PAR store
id, and Portland has none — no `PAR_TOKEN_*`, no Net-Chef location, and
`lib/jolt.ts` already excludes it for the same reason. Putting it in would not
give it hours; it would give twelve working stores and one that throws on every
PAR call. It is recorded in `WORKSTREAM_ONLY_LOCATIONS` instead, with Hohenwald
and Lafayette, so a later reader knows they were seen and left out deliberately.
When Portland gets a PAR store number and token it moves up, and nothing else
changes.

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

The queue and its rules are unchanged, and the evidence a reviewer sees is now
real: each candidate carries a job title and an hourly rate of record, and the
rate comparison against what PAR paid on a recent shift is a genuine signal
rather than a placeholder.

One number sets the floor on the work: **65 pairs of people share a first and
last name inside Workstream alone** (one name four times over). Those can never
auto-link and will always need a human, before PAR's side is even considered.
The rate agreement is what will settle most of them quickly.

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

The date filters are live-verified and each assignment carries its store, so
**per-store retention is available today** — which is what the bonus gate needs.

The one caveat is coverage: 868 of 1,224 employees carry an assignment, so the
356 without one have no store. They are overwhelmingly offboarded people, which
matters precisely because turnover counts leavers. Whoever writes the metric has
to decide what a terminated employee with no surviving assignment belongs to,
rather than let them fall out of every store's denominator unnoticed.

Still to design:

- a snapshot table, so a period's headcount stays answerable after Workstream's
  current state has moved on
- turnover as a flat number the bonus engine can gate on — `src/lib/bonus/types.ts`
  requires every condition to be a single numeric gate against a single metric
- 90-day retention of new hires, which is the recruiting-side number
- a daily cron, a seventh entry in `vercel.json`, gated on `CRON_SECRET` like the
  other six

And a decision to make deliberately rather than by default: whether turnover
counts against the store on the assignment at the time of leaving, or the store
someone spent most of their tenure at. Workstream keeps one current assignment
per person, not a posting history, so a transfer in month eleven currently lands
the whole departure on the receiving store.

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
