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

**No location. No department. No job title. No pay rate.**

The docs put those on the profile as nested objects — `job_assignments` with
`earning_rates`, `company`, `location`, `department`, and on v1
`compensation`, `employment_details` and `work_location`. They are on the
employee profile in the Workstream UI, too. They do not come back here. What
was tried, all returning the same twelve flat fields:

- `embed` on the **list** endpoint, as a comma list, as repeated params, as
  `include`, as `expand` (`embed[]` 400s)
- `embed` on the **single-employee** endpoint, `/v2/employees/{uuid}` — every
  documented v2 embed together, and `job_assignments` alone
- the whole of **v1**, `/employees` and `/employees/{uuid}`, with
  `compensation,employment_details,work_location,position,location,department`
- `/team_members` and `/team_members/{uuid}`, same embeds
- `custom_fields` (empty) and `custom_field_values`
- the sub-resources `/v2/employees/{uuid}/job_assignments` and
  `.../earning_rates` — both 404

And there is no route from a location to its people: `location_uuid`,
`location` and `location_uuids[]` leave the total count at 1,222, and
`/locations/{uuid}/employees` is a 404.

**It is not a permissions problem.** Removing the positions scope from the
token made `/positions` and `/position_applications` return `403 Forbiden`
immediately, with the same token. So this API refuses loudly when a scope is
missing — it does not silently drop fields. Whatever is withholding the
profile data is not the scope list.

The filters do work, which is how we know the ignored ones are genuinely
ignored: `status=active` → 451, `status=offboarded` → 730,
`hired_date.gte=2026-01-01` → 227, `termination_date.gte=2026-01-01` → 609, and
an invented parameter → 1,222.

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

### v1 and v2 are different populations

`GET /employees` (v1) returns **248 records with statuses `in_progress` (144),
`suspended` (91) and `not_started` (13)** — onboarding progress, not employment.
`GET /v2/employees` returns 1,224 with `active` / `offboarded` / `onboarding` /
`hired`.

**Zero uuids overlap between them.** They are separate record types with
separate ids, so the two cannot be joined on anything but a name. Worth knowing
before anyone reaches for v1 to fill a gap in v2.

### So the shape of what's possible is

**Answerable:** company-wide headcount, hires and terminations across any date
window — retention and turnover, which is what the bonus scorecard wanted.

**Not answerable:** anything per store, anyone's position, anyone's pay rate.

That last line is the one that hurts. Per-store retention is a per-store bonus
gate, and Workstream will not say which store anyone works at.

Whether this is the whole API or only this account is **not established**. The
fields exist in the product — they are on the profile screen — so the question
for Workstream support is specific:

> Our `GET /v2/employees` and `GET /v2/employees/{uuid}` return only names,
> status and dates. The documented `embed` values — `job_assignments`,
> `earning_rates`, `company`, `location`, `department` — are accepted and
> ignored, on both the list and the single-employee endpoint, and on v1 with
> `compensation` / `employment_details` / `work_location`. A missing scope
> gives us a clean 403, so this is not a permissions error we can see. What
> enables those nested objects on our account?

Re-run the discovery script after any answer before concluding anything.

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

**As of the 2026-09-04 measurement these uuids have nothing to do**, because
employees carry no location. They are recorded because they cost nothing and are
the first thing needed if the association appears.

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
