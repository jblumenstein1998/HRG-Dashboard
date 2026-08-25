# Tenant config refactor — inventory and plan

Status: **proposal, nothing implemented.** Written 2026-08-25 against `main` @ `12d88c7`
**plus the uncommitted working tree** — the Jolt integration (`src/lib/jolt.ts`,
`src/app/api/jolt/`, `src/components/JoltClient.tsx`) is untracked as of writing, so it
appears in this inventory but not in `12d88c7`. Commit it before starting, or the Jolt
rows below won't match what you see.

Goal: move every credential and tenant identifier out of `process.env` reads scattered
through the integration clients and into a `TenantConfig` object passed as a parameter,
so the source can later be swapped from env vars to a database row without touching the
clients.

---

## 0. Executive summary — the three things worth knowing before you start

1. **No credential is shipped to the browser.** There is no `NEXT_PUBLIC_` variable
   anywhere in the repo, and no `"use client"` file reads `process.env`. Details and the
   re-check command are in §2.

2. **`process.env` is only about half the problem.** The bigger surface is tenant identity
   *hard-coded in source*: the 12-store list appears in five different files
   (`par.ts`, `stores.ts`, `netchef.ts`, `surveyMeta.ts`, `bonus/storeMap.ts`), plus
   vendor account ids in `smgCases.ts` and `schoox.ts` and a Jolt company-name map in
   `jolt.ts`. Threading a config object through the clients while leaving
   `PAR_LOCATIONS` as a module-scope `const` imported by ten files would give you a
   half-refactor that still can't serve a second franchisee. This is inventoried as
   **Group 1B** (§1.2) and it drives most of the commit sequence.

3. **Three structural blockers sit underneath the parameter-threading work** (§4.9):
   module-level mutable session singletons, `unstable_cache` wrappers built at module
   scope with fixed keys, and Postgres tables with no tenant column. None of them need to
   be fixed to land this refactor, but each one silently breaks the moment a second
   tenant exists, so the plan sequences them explicitly rather than leaving them implied.

---

## 1. Inventory of `process.env` reads

Every read in `src/`, `scripts/`, and the config files: 33 matching lines in `src/`, plus 25 in `scripts/`.

### 1.1 Group 1A — TENANT config (env-read)

Credentials, tokens, and account identifiers that would differ between two Zaxby's
franchisees. **In scope.**

| File:line | Variable | Integration | What it's used for |
|---|---|---|---|
| `src/lib/par.ts:3` | `PAR_ACCESS_TOKEN` | PAR / Brink POS | Partner-level access token, sent on every PAR call. Read once at module scope into a `const`. |
| `src/lib/par.ts:4` | `PAR_BASE_URL` | PAR / Brink POS | API host. **Also doubles as an environment switch** — `PAR_IS_SANDBOX = BASE_URL.includes("apiint")`, which then selects the location list and the token lookup. See §1.4. |
| `src/lib/par.ts:30` | `PAR_SANDBOX_LOCATION_TOKEN` | PAR / Brink POS | Location token when running against the sandbox host. |
| `src/lib/par.ts:31` | `` PAR_TOKEN_${storeId} `` | PAR / Brink POS | **Dynamic key.** Per-store location token, one per PAR store id. Twelve exist in `.env.local`: `PAR_TOKEN_28901`, `36001`, `42601`, `56301`, `57001`–`57007`, `61401`. This is the only place the codebase builds an env key at runtime, and it is the read that most resists a static typed config. |
| `src/lib/netchef.ts:33` | `NETCHEF_USERNAME` | Net-Chef | Form login to `zaxbys.net-chef.com`. |
| `src/lib/netchef.ts:34` | `NETCHEF_PASSWORD` | Net-Chef | Same. |
| `src/lib/netchef.ts:87` | `NETCHEF_SESSION_ID_UTF` | Net-Chef | Optional pre-seeded `session_idUTF` cookie merged into the jar. |
| `src/lib/schoox.ts:126` | `SCHOOX_USERNAME` | Schoox (Zaxby's University) | Form login to `app.schoox.com`. |
| `src/lib/schoox.ts:127` | `SCHOOX_PASSWORD` | Schoox | Same. |
| `src/lib/smgTrend.ts:146` | `SMG_USERNAME` | SMG (`reporting.smg.com`) | WebForms login. Session is then threaded as a parameter — see §4.3, this is the pattern to copy. |
| `src/lib/smgTrend.ts:147` | `SMG_PASSWORD` | SMG | Same. Also the credential behind SMG 360 / ZCases, via the SSO handoff in `smgCases.ts:157`. |
| `src/lib/jolt.ts:65` | `JOLT_USERNAME` | Jolt | Login to `app.joltup.com`; the response carries `companyId`. |
| `src/lib/jolt.ts:66` | `JOLT_PASSWORD` | Jolt | Same. |
| `src/lib/berryAuth.ts:10` | `BERRY_EMAIL` | BerryAI / Superset | Service-account login. Token is threaded as a parameter from here on. |
| `src/lib/berryAuth.ts:11` | `BERRY_PASSWORD` | BerryAI / Superset | Same. |
| `src/app/api/slack/route.ts:33, 92` | `SLACK_SIGNING_SECRET` | Slack | Verifies inbound webhook signatures. Per-Slack-app, therefore per-business. |
| `src/app/api/slack/route.ts:48, 92` | `SLACK_BOT_TOKEN` | Slack | `chat.postMessage` bearer token. Per-workspace. |
| `src/app/api/slack/route.ts:22` | `ALLOWED_SLACK_USER_IDS` | Slack | Comma-separated allowlist of Slack user ids permitted to talk to the agent. Per-workspace. |

**Present in `.env.local` but never read by any code** — decide whether to carry them
forward or drop them:

| Variable | Note |
|---|---|
| `STERITECH_USERNAME`, `STERITECH_PASSWORD` | No reader anywhere in `src/` or `scripts/`. Either a planned integration or a dead credential — if dead, revoke it rather than migrating it. |
| `PAR_SANDBOX_LOCATION_ID` | Only `PAR_SANDBOX_LOCATION_TOKEN` is read; the id is unused. |
| `NEON_PROJECT_ID`, `NEON_AUTH_BASE_URL`, `VITE_NEON_AUTH_URL` | Neon/Vercel integration leftovers, unread. The `VITE_` prefix suggests it arrived from a template. |

### 1.2 Group 1B — TENANT config that is NOT in env (hard-coded in source)

**This is the group that actually blocks a second business,** and it is invisible if you
only grep for `process.env`. Same test as Group 1A: would this differ for another
franchisee? Yes for every row below.

| File:line | Constant | What it is |
|---|---|---|
| `src/lib/par.ts:10-23` | `PROD_LOCATIONS` → `PAR_LOCATIONS` | The 12-store list: PAR store id, display name, state. **Imported by 10 modules including two server-component pages.** The most viral single item in this refactor. |
| `src/lib/netchef.ts:221` | `LOCATION_NAMES` | Net-Chef location id → store name, 12 entries. |
| `src/lib/stores.ts:5-24` | `STORE_CONFIG` | Street-address fragment → label + TN/VA section + display order. The BerryAI join key. |
| `src/lib/surveyMeta.ts:17-18` | `TN_STORES`, `VA_STORES` | Market membership. |
| `src/lib/surveyMeta.ts:20` | `STORE_LABELS` | PAR store id → name, 12 entries (duplicates `PAR_LOCATIONS`). |
| `src/lib/surveyMeta.ts:38` | `STORE_COLOR` | Per-store chart color, 12 entries. Cosmetic but per-tenant. |
| `src/lib/bonus/storeMap.ts:48-61` | `BONUS_STORES` | The consolidated four-vendor join table (PAR id, name, state, Berry address fragment, Net-Chef location id, SMG unit key). **The best-shaped of the five lists — the others should collapse into this one.** |
| `src/lib/jolt.ts:30-38` | `JOLT_TO_STORE` | `"HRG <name> LLC"` → store name. Contains the literal business name. |
| `src/lib/jolt.ts:41` | `EXCLUDED_JOLT_LOCATIONS` | `"Hwy 52 \| HRG Portland LLC"`. |
| `src/lib/jolt.ts:44` | `STORES_WITHOUT_JOLT` | Five stores Jolt isn't deployed to. |
| `src/lib/smgCases.ts:34` | `ACCOUNT_ID` | smg360 account id. Sent as a header on every 360 request. |
| `src/lib/smgCases.ts:37,40,47` | `CARD_ID`, `REPORT_ID`, `SOURCE_IDS` | smg360 card/report/feed ids. Brand-level for Zaxby's, but tied to this login's visibility. |
| `src/lib/smgCases.ts:53` | `HIERARCHY_PROJECT_IDS` | `[1616, 1615, 1746]` — "hierarchy projects this login can see". Explicitly per-login, therefore per-tenant. |
| `src/lib/schoox.ts:30` | `ACADEMY_ID` | `"1669014345"`. The file's own comment argues it's a brand constant, not per-deployment — revisit that reasoning under multi-tenant, since a different franchisee may sit in a different academy. |
| `src/lib/berry.ts:3` | `SUPERSET_DASHBOARD_ID` | `"15"` — the BerryAI dashboard this account embeds. |
| `src/lib/supersetSession.ts:4` | `EMBEDDED_UUID` | The embedded-dashboard uuid. Pairs with the above. |
| `src/lib/users/google.ts:16` | `ALLOWED_HD` | `"hudsonrestaurantgroup.com"` — the Workspace domain allowed to sign in. Hard tenant boundary. |

### 1.3 Group 2 — DEPLOYMENT config (out of scope, stays global)

| File:line | Variable | Use |
|---|---|---|
| `src/lib/db.ts:3` | `DATABASE_URL` | Neon connection string. See the caveat in §1.4. |
| `src/lib/users/session.ts:40` | `SESSION_SECRET` | HMAC key for the `hrg_session` cookie. |
| `src/lib/users/session.ts:122` | `NODE_ENV` | `secure` flag on the session cookie. |
| `src/app/api/auth/google/start/route.ts:37` | `NODE_ENV` | `secure` flag on the OAuth state cookie. |
| `src/lib/users/google.ts:25,29,35` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client. See §1.4 — arguably tenant. |
| `src/app/api/cron/bonus-rollup/route.ts:26` | `CRON_SECRET` | Vercel Cron bearer auth. |
| `src/app/api/cron/drive-thru-warm/route.ts:18` | `CRON_SECRET` | Same. |
| `src/app/api/cron/par-rollup/route.ts:28` | `CRON_SECRET` | Same. |
| `src/app/api/cron/smg-snapshots/route.ts:24` | `CRON_SECRET` | Same. |
| `src/app/api/cron/smg-sync/route.ts:21` | `CRON_SECRET` | Same. |
| `src/app/api/cron/zcase-sync/route.ts:38` | `CRON_SECRET` | Same. |
| `src/app/api/smg/backfill/route.ts:20` | `CRON_SECRET` | Same. |
| `scripts/*.mjs` (11 files) | `DATABASE_URL` | One-off migration/inspection scripts. Out of scope; leave them on env. |
| `.env.local` only | `VERCEL_*`, `TURBO_*`, `NX_DAEMON`, `PG*`, `POSTGRES_*` | Injected by Vercel/Neon/tooling. Never read by `src/`. |

Exploration scripts read tenant credentials directly (`scripts/smg-explore.mjs:19-21`,
`scripts/schoox-courses-explore.mjs:26-27`, `scripts/schoox-courses-verify.mjs:32`,
`scripts/netchef-inventory-discover.mjs:16-17,71-72`, `scripts/debug-par-orders.mjs:4-8`).
These are developer tools, not app code — **leave them on `process.env`** and don't count
them against the refactor. Noted here only so a later "no `process.env` outside the config
module" lint rule scopes itself to `src/`.

### 1.4 Four judgment calls to make before coding

These sit on the boundary. My recommendation is given, but the answer changes the shape of
`TenantConfig`, so decide now rather than mid-refactor.

1. **`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — tenant or deployment?**
   Listed above as deployment because one OAuth client can authenticate any Google account.
   But it pairs with `ALLOWED_HD`, which is unambiguously tenant. **Recommendation:** keep
   the OAuth *client* global (deployment), move `ALLOWED_HD` into `TenantConfig` as
   `allowedEmailDomain`. One client, per-tenant domain allowlist.

2. **`PAR_BASE_URL` is doing two jobs.** It is a tenant setting (which PAR host serves this
   franchisee) *and* a deployment mode switch — `PAR_IS_SANDBOX` derives from it and then
   swaps out `PAR_LOCATIONS` entirely for a single fake sandbox store. Threading base URL
   through as tenant config while `PAR_LOCATIONS` still flips on a module-scope boolean
   would be genuinely confusing. **Recommendation:** split them. `TenantConfig.par.baseUrl`
   for the host, and make the sandbox store list an explicit tenant fixture rather than a
   derived branch.

3. **`DATABASE_URL` stays global — but the schema doesn't.** One database is correct; the
   15 tables in it (`par_daily_metrics`, `smg_scores`, `smg_snapshots`, `smg_zcases`,
   `netchef_costs`, `drive_thru_cache`, `drive_thru_trend`, `superset_session_cache`,
   `bonus_*`, `app_*`) have **no tenant column**. `DATABASE_URL` is out of scope; the
   missing column is the real multi-tenant blocker and is sequenced in §5 as deferred work.

4. **`CRON_SECRET` stays global, but the cron routes become fan-out points.** A Vercel Cron
   invocation carries no tenant. Once there are two tenants, each cron route has to
   enumerate tenants and loop. Deployment-scoped secret, tenant-scoped body — see §4.8.

---

## 2. Client-side credential exposure — **clean, with one thing to watch**

**Finding: no credential is currently shipped to the browser.**

Three independent checks, all negative:

1. **No `NEXT_PUBLIC_` variable exists anywhere** — not in `src/`, `scripts/`,
   `next.config.ts`, `vercel.json`, `.env.local`, or `.env.local.example`.
2. **No `"use client"` file reads `process.env`.** All 33 `src/` reads are in `src/lib/*` (server
   modules), `src/app/api/*` route handlers, or `scripts/*.mjs`. Cross-checking the 23
   `"use client"` files against the env-read file list gives an empty intersection.
3. **`next.config.ts` has no `env:` block**, so nothing is inlined into the client bundle
   at build time. The file contains only two redirects.

Re-check command, worth keeping as a habit during the refactor:

```bash
# Must print nothing.
grep -rn "NEXT_PUBLIC" src/ next.config.ts vercel.json
comm -12 \
  <(grep -rl '"use client"' src | sort) \
  <(grep -rl "process\.env" src | sort)
```

**The one thing to watch.** Tenant *identifiers* do reach the browser today, and correctly
so — `src/app/par/page.tsx:2` and `src/app/par/hourly/page.tsx:2` import `PAR_LOCATIONS`
in a server component and pass the store list to `PARClient` / `HourlyAuditClient` as
props; `STORE_LABELS`, `STORE_COLOR`, and `BONUS_STORES` are imported directly by client
components. These are names, PAR store ids, and Net-Chef location ids — not secrets, and
the browser needs them to render.

That is fine at one tenant. Under multiple tenants it becomes a **data-scoping** question
rather than a secrets question: whatever mechanism replaces these imports must send the
*signed-in tenant's* store list and nothing else. The failure mode is a client bundle that
statically contains every tenant's store list, which leaks the customer roster to anyone
who views source. Flagging it now because the natural refactor — "import the config from a
shared module" — walks straight into it.

---

## 3. Proposed `TenantConfig`

Drafted from Group 1A and 1B together. Suggested home: `src/lib/tenant/types.ts`, with the
env-backed implementation in `src/lib/tenant/fromEnv.ts` so the eventual
`src/lib/tenant/fromDb.ts` is a drop-in sibling.

```ts
/**
 * Everything that differs between two Zaxby's franchisees.
 *
 * Deliberately excludes DATABASE_URL, SESSION_SECRET, CRON_SECRET and NODE_ENV —
 * those belong to the deployment and stay on process.env.
 *
 * Sourced from env today (fromEnv.ts); the shape is chosen so a Postgres-backed
 * loader can satisfy it without any integration client changing.
 */
export type TenantConfig = {
  /** Stable slug, e.g. "hrg". Cache keys and tenant-scoped DB rows key on this. */
  id: string;
  /** Display name, e.g. "Hudson Restaurant Group". */
  name: string;
  /** Google Workspace domain permitted to sign in. Replaces ALLOWED_HD. */
  allowedEmailDomain: string;

  /**
   * The canonical store roster — one row per location, carrying every vendor's
   * identifier for it. Supersedes PAR_LOCATIONS, LOCATION_NAMES, STORE_CONFIG,
   * STORE_LABELS and BONUS_STORES, which are five partial copies of this today.
   * Keyed on PAR store id, following the reasoning already written down in
   * src/lib/bonus/storeMap.ts.
   */
  stores: TenantStore[];

  par: {
    baseUrl: string;                       // PAR_BASE_URL
    accessToken: string;                   // PAR_ACCESS_TOKEN
    /** PAR store id -> location token. Replaces the dynamic PAR_TOKEN_${id} read. */
    locationTokens: Record<string, string>;
  };

  netchef: {
    username: string;                      // NETCHEF_USERNAME
    password: string;                      // NETCHEF_PASSWORD
    /** Optional pre-seeded session cookie. NETCHEF_SESSION_ID_UTF. */
    sessionIdUtf?: string;
  };

  smg: {
    username: string;                      // SMG_USERNAME
    password: string;                      // SMG_PASSWORD
    /** smg360 (ZCases) identifiers, currently hard-coded in smgCases.ts. */
    cases: {
      accountId: string;
      cardId: string;
      reportId: string;
      sourceIds: string[];
      hierarchyProjectIds: number[];
    };
  };

  schoox: {
    username: string;                      // SCHOOX_USERNAME
    password: string;                      // SCHOOX_PASSWORD
    academyId: string;                     // currently a const in schoox.ts
  };

  jolt: {
    username: string;                      // JOLT_USERNAME
    password: string;                      // JOLT_PASSWORD
    /** Jolt location name -> store name. Replaces JOLT_TO_STORE. */
    locationToStore: Record<string, string>;
    /** Jolt locations with no dashboard store. Replaces EXCLUDED_JOLT_LOCATIONS. */
    excludedLocations: string[];
  };

  berry: {
    email: string;                         // BERRY_EMAIL
    password: string;                      // BERRY_PASSWORD
    supersetDashboardId: string;           // currently a const in berry.ts
    embeddedUuid: string;                  // currently a const in supersetSession.ts
  };

  /** Optional: not every tenant runs the Slack agent. */
  slack?: {
    signingSecret: string;                 // SLACK_SIGNING_SECRET
    botToken: string;                      // SLACK_BOT_TOKEN
    allowedUserIds: string[];              // ALLOWED_SLACK_USER_IDS, split on ","
    /** Slack team id — how an inbound webhook resolves to this tenant. See §4.7. */
    teamId: string;
  };
};

export type TenantStore = {
  /** PAR store id — canonical key across all vendors. */
  storeId: string;
  name: string;
  /** Market/section label. "TN"/"VA" today; widened so another tenant isn't stuck. */
  market: string;
  /** Display order within the market. */
  order: number;
  /** Chart color. From STORE_COLOR. */
  color: string;
  netchefLocationId: number;
  /** Lowercase street-address fragment — the only BerryAI join available. */
  berryFragment: string;
  smgUnitKey: string;
  /** Jolt company name, or null where Jolt isn't deployed (STORES_WITHOUT_JOLT). */
  joltLocationName: string | null;
};
```

Three notes on the shape:

- **PAR location tokens live in `par.locationTokens`, not on the store row.** Tempting to
  put the token next to the store it belongs to, but `TenantStore[]` is the thing that gets
  passed to client components (§2). Keeping credentials out of that object entirely means a
  future `<PARClient stores={config.stores}>` can never accidentally serialize a token into
  the page.
- **`stores` is the merge of five existing lists.** That merge is the single highest-risk
  step in the whole refactor, which is why §5 gives it two commits (build it, then migrate
  consumers) rather than one.
- **`slack` is optional; the others are not.** If a tenant may legitimately lack Net-Chef
  or Jolt, widen those to optional too and make the corresponding routes return an explicit
  "not configured" rather than throwing on a missing credential.

---

## 4. Call graph — what the config has to be threaded through

Read `→` as "calls". Depth counted from the route handler to the `process.env` read.

### 4.1 PAR / Brink

```
/api/cron/par-rollup            → PAR_LOCATIONS
                                → parRollup.backfillStoreDay(storeId, date)
                                    → par.getOrders / par.getShifts
                                        → getLocationToken(storeId)   [env, depth 3]
                                        → ACCESS_TOKEN, BASE_URL      [module const]
/api/par/rollup/backfill        → parRollup.backfillRange → backfillStoreDay → (as above)
/api/par/sales-snapshot         → salesSnapshot.getSalesSnapshot(range)
                                    → par.getOrders / getOrdersLive / getShiftsLive  [depth 3]
                                    → parRollup.getTotalsForRange                     [DB only]
/api/par/data                   → parRollup.getDailyRowsForRange       [DB only]
/api/par/hourly-breakdown       → parRollup.getHourlyBreakdown         [DB only]
/api/par/weekly-sales           → parRollup.getNetSalesForRange / getLaborHoursForRange [DB only]
/api/par/sales-tier             → salesTierData.getSalesTierData → parRollup           [DB only]
/api/par/{net-sales,transactions,avg-check}-comp
                                → netSalesComp.* → parRollup                           [DB only]
/api/smg/sales                  → parRollup.getNetSalesForRange                        [DB only]
/api/slack → dashboardAgent → dashboardTools → parRollup.* + par.getShiftsLive         [depth 4]
app/par/page.tsx                → PAR_LOCATIONS → props → PARClient        [server component]
app/par/hourly/page.tsx         → PAR_LOCATIONS → props → HourlyAuditClient [server component]
```

**Awkward — the worst spot in the refactor.** `PAR_LOCATIONS` is a module-scope `const`
imported by ten modules: `parRollup.ts`, `netSalesComp.ts`, `salesSnapshot.ts`,
`salesTierData.ts`, `tools/storeResolver.ts`, four API routes, and two pages. Only the
credential reads sit behind functions; the store list is a static import, so every consumer
has to change from `import { PAR_LOCATIONS }` to receiving it. The two *pages* are the
sharp edge — a server component has no natural place to receive a parameter, so it must
resolve the tenant from the session itself.

Note that most PAR read paths are DB-only: they query `par_daily_metrics` and never call
PAR. **Only the rollup/backfill crons and `sales-snapshot`'s live calls actually need PAR
credentials.** That is a useful narrowing — the credential threading is a small subgraph;
the store-*list* threading is the wide one.

### 4.2 Net-Chef

```
/api/netchef/categories       → fetchCategoryMatrix   ┐
/api/netchef/data             → fetchNcReport /       │
                                fetchLocationReport   │
/api/netchef/dates            → fetchAvailableDates   ├→ login()  [env, depth 2]
/api/netchef/history          → fetchHistory          │   ↳ module-level `let session`
/api/netchef/items            → fetchLocationItems    │
/api/netchef/period-history   → fetchPeriodHistory    │
/api/netchef/recent-weeks     → fetchLocationReport   ┘
/api/bonus/inputs             → bonus/compute.computePeriod
/api/cron/bonus-rollup        →   → netchefRollup.ingestPeriodCosts
                                      → fetchLocationReport → login()   [depth 4]
/api/slack → …tools           → fetchLocationReport → login()           [depth 4]
```

Shallow and uniform for the seven direct routes. The bonus path is the deep one — four
hops, and `computePeriod` also reaches PAR, SMG and BerryAI in the same call, so it is the
one function that needs the *whole* `TenantConfig` rather than one vendor's slice.

### 4.3 SMG — `reporting.smg.com` (already the right pattern)

```
/api/cron/smg-sync      → smgLogin()                    [env, depth 1]
                        → smgStore.ingestRecentPeriods({ session, … })
                            → smgTrend.fetchTrend(session, q)     ← session is a PARAMETER
/api/cron/smg-snapshots → smgLogin() → smgStore.ingestSnapshot({ session, … })
/api/smg/backfill       → smgLogin() + listPeriodsOfType(session) + ingestTrend({session})
/api/smg/refresh        → smgLogin() + listPeriodsOfType(session) + smgStore.*
/api/smg/scores         → smgStore.queryScores                    [DB only]
/api/smg/snapshots      → smgStore.querySnapshots                 [DB only]
```

**This is the model to copy.** `smgLogin()` is the *only* function touching env; it returns
an `SmgSession` that every downstream function accepts as an explicit first parameter.
Converting this integration is a one-line change — `smgLogin(config.smg)` — because the
threading already exists. Every other client should end up looking like this.

### 4.4 SMG 360 / ZCases

```
/api/cron/zcase-sync        → smgCaseStore.ingestZCases
                                → smgCases.getCaseToken(session?)
                                    → smgTrend.smgLogin()   [env, depth 3]
                                → fetchUnitMap / fetchZCases  → ACCOUNT_ID, CARD_ID,
                                                                REPORT_ID, SOURCE_IDS,
                                                                HIERARCHY_PROJECT_IDS
                                                                [hard-coded consts]
/api/smg/zcases             → smgCaseStore.* (DB) + smgCases.caseDeepLink → CARD_ID
/api/smg/zcases/details     → smgCases.getCaseToken + fetchCaseDetail
/api/smg/zcase/[caseKey]    → smgCases.getCaseToken + caseDeepLink
```

Credential threading is easy (it rides on `smgLogin`). The **account identifiers** are the
work: five module-scope constants used across a dozen functions inside `smgCases.ts`.
Contained to one file, so this is tedious rather than risky.

### 4.5 Schoox / ZU

```
/api/zu/compliance → fetchZuReport()    → cachedReport     = unstable_cache(buildReport,     ["zu-compliance"])
/api/zu/tests      → fetchZuTestReport()→ cachedTestReport = unstable_cache(buildTestReport, ["zu-tests"])
/api/zu/members    → fetchZuMembers(unitId) → cachedMembers = unstable_cache(fetchMembers,   ["zu-members"])
                                                 → session login → env  [depth 3]
```

**Awkward.** The three `unstable_cache` wrappers are constructed at *module scope* with
fixed key arrays (`schoox.ts:377, 473, 674`), and `/api/zu/compliance` invalidates by the
literal tag `"zu-compliance"` (`route.ts:21`). Two consequences:

- The cache key must gain the tenant id, or tenant A's ZU report is served to tenant B.
  That means the wrapper can no longer be built once at module scope — it has to be built
  per tenant (memoized in a `Map<tenantId, …>`) or the tenant id has to enter the key array.
- `unstable_cache` serializes its arguments into the key. Passing a whole `TenantConfig`
  (containing passwords) as an argument to a cached function would **write credentials into
  the Next.js Data Cache**. Pass `config.id` into the cached function and resolve the full
  config *inside* it, never across the cache boundary.

That second point is a real correctness/security trap and applies anywhere `unstable_cache`
meets this refactor — `par.ts:236,251` wrap `getOrders` / `getShifts` the same way. Worth an explicit code
comment when you get there.

### 4.6 BerryAI / Superset

```
/api/berry/data          → getBerryAuth()  → loginBerryService()  [env, depth 2]
                         → berryData.getDriveThruMetrics(token, …)      ← token is a PARAMETER
                             → supersetSession.ensureSession(berryToken)
                                 → sql: superset_session_cache WHERE id = 1
/api/berry/warm-periods  → getBerryAuth() → berryData.getDriveThruMetrics
/api/berry/drive-thru-trend → getBerryAuth() → driveThruTrend.getTrend
/api/berry/branches      → getBerryAuth() + BERRY_API_BASE
/api/berry/discover      → getBerryAuth() + BERRY_API_BASE / SUPERSET_BASE
/api/cron/drive-thru-warm→ loginBerryService() → warmStandardRanges(token)
                                              → driveThruTrend.refreshAllTrends(berryToken)
/api/slack → …tools      → getBerryAuth() / loginBerryService()  [depth 4]
```

Token threading is already good. Two tenant-blind caches sit underneath:
`auth.ts:32-33`'s module-level `cached` / `inFlight` singleton, and
`supersetSession.ts`'s single row `WHERE id = 1`. Both would hand tenant A's session to
tenant B verbatim.

### 4.7 Slack agent

```
/api/slack  → SLACK_SIGNING_SECRET (verify)  [env, depth 0]
            → ALLOWED_SLACK_USER_IDS (authorize)
            → dashboardAgent → dashboardTools → PAR, Net-Chef, BerryAI  [depth 4]
            → SLACK_BOT_TOKEN (reply)
```

**Awkward — and the only genuine chicken-and-egg in the set.** Verifying the signature
requires knowing which tenant's signing secret to use, but the tenant is only knowable
*from* the request body. The resolution order has to be: parse `team_id` from the raw body
→ look up the tenant by `slack.teamId` → verify the signature with that tenant's secret →
only then trust anything else in the payload. Getting this order wrong means verifying a
forged request against an attacker-chosen tenant. Worth its own commit and its own careful
read.

### 4.8 Cron routes generally

`vercel.json` schedules six crons. None carries a tenant, and all authenticate with the
global `CRON_SECRET`. Today each one does the work directly; under multiple tenants each
becomes `for (const tenant of await listTenants()) { … }`. Design decision to make: fan out
*inside* one invocation (simple, but one tenant's vendor outage delays the others and the
whole thing shares a single function timeout) or have the cron enqueue per-tenant work. At
two or three tenants, in-invocation fan-out with per-tenant error isolation is enough —
don't build a queue yet.

### 4.9 Structural blockers, collected

| # | Blocker | Where | Why it bites |
|---|---|---|---|
| 1 | Module-level mutable session singletons | `netchef.ts:29,138`, `jolt.ts:50,51,357`, `schoox.ts:102`, `auth.ts:32,33` | A warm function instance serves tenant B using tenant A's authenticated session. Must become `Map<tenantId, Session>`. |
| 2 | `unstable_cache` with module-scope fixed keys | `schoox.ts:377,473,674`, `par.ts:236,251` | Cross-tenant cache bleed; plus the credentials-in-cache-key trap (§4.5). |
| 3 | No tenant column on any table | all 15 tables | `SELECT … FROM par_daily_metrics WHERE store_id = '36001'` returns whichever tenant wrote it. Store ids are vendor-assigned and **not** globally unique across franchisees. |
| 4 | `superset_session_cache WHERE id = 1` | `supersetSession.ts:20,29` | Single-row by construction. |
| 5 | Tenant identity in the client bundle | §2 | Static imports of store lists into client components. |

Blockers 1, 2, and 4 are cheap and are folded into the commits below. Blocker 3 is the big
one and is deliberately deferred — it's a schema migration, and doing it before the config
threading means doing it twice.

---

## 5. Proposed commit sequence

Fourteen commits. Every one leaves `main` green and shippable; nothing below changes
rendered output, and the fixture diff in §6 should stay empty throughout. Each commit is
small enough to read in one sitting.

**Phase A — introduce the type, change no behavior**

1. **Add `TenantConfig` types and the env-backed loader.**
   New files only: `src/lib/tenant/types.ts`, `src/lib/tenant/fromEnv.ts`,
   `src/lib/tenant/index.ts` exporting `getTenantConfig(): TenantConfig`. Reads exactly the
   same env vars as today. **Nothing imports it yet.** Pure addition, zero risk.

2. **Build the canonical `stores` roster inside the loader.**
   Populate `TenantConfig.stores` by merging `BONUS_STORES` with `STORE_COLOR` and
   `PAR_LOCATIONS`' ordering. Add a temporary module-scope assertion that the merged roster
   reproduces all five existing lists element-for-element. Still nothing consumes it.
   **This is the commit to review hardest.**

**Phase B — convert integrations, one per commit, shallowest first**

3. **SMG.** `smgLogin(creds)` takes credentials; callers pass `getTenantConfig().smg`.
   One line per caller, because the session already threads (§4.3).

4. **BerryAI.** `loginBerryService(creds)`; `getBerryAuth(config)`. Convert `auth.ts`'s
   singleton to `Map<tenantId, Cached>` in the same commit — it's a few lines, and
   separating them leaves a known-wrong cache sitting in `main`.

5. **Net-Chef.** `login(creds)`; thread `config.netchef` through the seven `fetch*` entry
   points. Convert the module `session` to a per-tenant map.

6. **Jolt.** Same shape. Move `JOLT_TO_STORE`, `EXCLUDED_JOLT_LOCATIONS`, and
   `STORES_WITHOUT_JOLT` into config in the same commit — they're small and used only here.

7. **Schoox.** Thread `config.schoox` *and* handle the `unstable_cache` keying (§4.5).
   Larger than 3–6 because of the cache work; split into 7a (thread credentials) and 7b
   (tenant-key the caches) if the diff gets past ~150 lines.

8. **SMG 360 / ZCases.** Move the five account-identifier constants into
   `config.smg.cases`. Contained to `smgCases.ts` plus its three callers.

9. **PAR credentials.** `config.par.baseUrl` / `accessToken` / `locationTokens`. Resolves
   the dynamic `PAR_TOKEN_${storeId}` read into a map lookup, and splits the
   `PAR_IS_SANDBOX` derivation per §1.4(2). **Credentials only — not the store list.**

**Phase C — the store roster**

10. **Migrate store-list consumers to `config.stores`, server-side.**
    `parRollup`, `netSalesComp`, `salesSnapshot`, `salesTierData`, `storeResolver`,
    `netchefRollup`, `bonus/*`, and the four API routes. Delete `PROD_LOCATIONS`,
    `LOCATION_NAMES`, `STORE_CONFIG`, `STORE_LABELS`, `BONUS_STORES`, and the temporary
    assertion from commit 2. **The largest diff in the plan** — if it's too big to review,
    split by consumer (10a PAR-side, 10b bonus-side, 10c agent tools).

11. **Migrate the two pages and their client components.**
    `app/par/page.tsx` and `app/par/hourly/page.tsx` resolve the tenant from the session
    and pass the roster down as props. Establishes the pattern for §2's scoping concern.

**Phase D — remaining surfaces and the switch**

12. **Slack.** `config.slack`, plus the resolve-tenant-before-verify ordering from §4.7.
    Its own commit because the security ordering deserves a focused read.

13. **Auth domain.** `ALLOWED_HD` → `config.allowedEmailDomain`. Small.

14. **Close the door.** Add an ESLint rule (or a CI grep) banning `process.env` in `src/`
    outside `src/lib/tenant/` and the deployment allowlist (`DATABASE_URL`,
    `SESSION_SECRET`, `CRON_SECRET`, `NODE_ENV`, `GOOGLE_CLIENT_*`). This is what stops the
    refactor from eroding.

**Deferred to the multi-tenant project proper — not this refactor**

15. Tenant column + composite keys on all 15 tables; tenant-scope every query.
16. `superset_session_cache` keyed by tenant instead of `id = 1`.
17. Cron fan-out over tenants.
18. `fromDb.ts`, plus tenant resolution in `src/proxy.ts`.

Commits 1–14 are the refactor you asked for. 15–18 are what it *enables*, and they
shouldn't share a branch with it — the whole point of stopping at 14 is that
`getTenantConfig()` becomes a single seam to swap.

---

## 6. Verification plan — fixture capture and diff

No test suite. The mechanism is: capture every API route's response before the refactor,
capture again after, diff. Roughly 45 minutes of setup, then ~2 minutes per check.

### 6.1 The idea

Write `scripts/capture-fixtures.mjs` (a dev script, in the same style as the existing
`scripts/*.mjs`) that hits every GET route against a locally running dev server with a real
session cookie, normalizes volatile fields, and writes one JSON file per route into
`fixtures/<label>/`. Run it once on `main`, once per commit or per phase, and `diff -r`.

```bash
# Before: on main, with `npm run dev` running
HRG_SESSION="<hrg_session cookie value>" node scripts/capture-fixtures.mjs before

# After: on the refactor branch, same dev server, same cookie
HRG_SESSION="<...>" node scripts/capture-fixtures.mjs after

diff -r fixtures/before fixtures/after && echo "IDENTICAL"
```

Grab the cookie from DevTools → Application → Cookies → `hrg_session` on a signed-in
localhost session. It's signed with `SESSION_SECRET`, which doesn't change across the
refactor, so one capture covers every run. Add `fixtures/` to `.gitignore` — the captures
contain real store-level sales data.

### 6.2 Routes to capture

All read-only GETs. **Skip anything that writes** — the crons, `/api/par/refresh`,
`/api/par/rollup/backfill`, `/api/smg/backfill`, `/api/smg/refresh`, `/api/bonus/lock`,
`/api/bonus/inputs` (POST), `/api/admin/*`, `/api/admin-links`, `/api/slack`.

```
/api/par/data?…                      /api/netchef/data?…
/api/par/weekly-sales?…              /api/netchef/categories?…
/api/par/sales-snapshot?range=…      /api/netchef/dates
/api/par/sales-tier?range=…          /api/netchef/history
/api/par/hourly-breakdown?…          /api/netchef/items?…
/api/par/net-sales-comp              /api/netchef/period-history?…
/api/par/transactions-comp           /api/netchef/recent-weeks?…
/api/par/avg-check-comp
                                     /api/zu/compliance
/api/smg/scores?…                    /api/zu/members?unitId=…
/api/smg/snapshots?…                 /api/zu/tests
/api/smg/sales?…
/api/smg/zcases?range=…              /api/jolt/completion
/api/smg/zcases/details?…            /api/jolt/lists
                                     /api/jolt/due-soon
/api/berry/data?range=…              /api/jolt/submitters
/api/berry/branches
/api/berry/drive-thru-trend?…
```

### 6.3 Making the diff meaningful — the part that needs care

A naive capture will diff noisily and you'll stop trusting it. Three sources of noise, all
fixable:

1. **Pin every date.** Never capture a route with a relative range (`today`, `wtd`, `mtd`)
   without also pinning it — run "before" and "after" on the same calendar day, and prefer
   explicit `startDate`/`endDate` params where the route accepts them. Put the pinned query
   strings in the script as constants so both runs are byte-identical.

2. **Normalize volatile fields** before writing. At minimum strip or zero `fetchedAt`,
   `updatedAt`, `syncedAt`, any `*At` timestamp, and anything named `duration`/`elapsed`.
   A small recursive normalizer is enough:

   ```js
   const VOLATILE = /^(fetchedAt|updatedAt|syncedAt|generatedAt|lastSync.*|.*Ms|duration)$/;
   const normalize = (v) =>
     Array.isArray(v) ? v.map(normalize)
     : v && typeof v === "object"
       ? Object.fromEntries(
           Object.entries(v)
             .sort(([a], [b]) => a.localeCompare(b))
             .map(([k, x]) => [k, VOLATILE.test(k) ? "<volatile>" : normalize(x)]))
       : v;
   ```
   Sorting keys means a property-order change from an object-shape refactor doesn't show up
   as a diff.

3. **Separate live-vendor routes from DB-only routes.** Most routes read Postgres and are
   perfectly reproducible. A handful hit a vendor live and can legitimately change between
   two runs ten minutes apart: `/api/par/sales-snapshot` (live PAR orders/shifts),
   `/api/zu/*` (Schoox), `/api/jolt/*`, `/api/netchef/data` on a cache miss. **Capture these
   into a separate `live/` subdirectory** and treat a diff there as "look at it", not "you
   broke it". The `db/` subdirectory should be byte-identical, always — that's the real
   signal.

### 6.4 What to run when

| Point | Check |
|---|---|
| Before commit 1 | Capture `before/`. Capture it **twice, ten minutes apart, and diff the two against each other**. Whatever differs is inherent noise — add those fields to the normalizer until `before/db` is stable against itself. Do not skip this; it's what makes every later diff trustworthy. |
| After each of commits 3–9 | Capture and diff only that vendor's routes. Fast, and pins blame to one commit. |
| After commit 10 | Full capture. This is the riskiest commit; expect to actually find something here. |
| After commit 11 | Diff isn't enough — the pages changed, not just routes. Load `/par` and `/par/hourly` in a browser and eyeball the store list, ordering, and colors. |
| After commit 14 | Full capture, plus `grep -rn "process\.env" src/` should return only the deployment allowlist. |

### 6.5 Two cheap extras worth having

- **A roster equality assertion** (added in commit 2, deleted in commit 10): assert the
  merged `config.stores` reproduces all five legacy lists exactly. This catches the
  store-merge class of bug *at import time* rather than via a diff, and it's ~20 lines.
- **`npx tsc --noEmit` and `npm run lint` after every commit.** Not a test suite, but for a
  refactor that is overwhelmingly "change a signature, fix the callers", the type checker
  catches most mistakes before a fixture diff ever would.

### 6.6 What this plan does not catch

Being explicit, since the point is that you trust the result:

- **Write paths.** The crons and backfill routes are excluded from capture, so a bug in
  `backfillStoreDay`'s credential threading surfaces only as *tomorrow's* data being wrong.
  Mitigation: after commit 9, manually invoke `/api/cron/par-rollup` with the `CRON_SECRET`
  against a date that's already rolled up, and confirm the row it writes matches the row
  already in `par_daily_metrics`.
- **Anything cached long enough to hide a break.** Schoox and PAR both cache for an hour. A
  route can return a correct cached body while the credential threading underneath it is
  broken. Where a route has a cache-bust param (`/api/zu/compliance?fresh=1`,
  `/api/netchef/data`'s invalidation), capture both the cached and the fresh variant.
- **The client components.** Fixtures cover API responses, not rendering. Commit 11 needs
  human eyes.
