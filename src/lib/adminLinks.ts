/**
 * The Admin tab's link directory: types, the seed catalog, and the pure
 * helpers the page renders with.
 *
 * Every back-office system HRG signs into, in one place, because the answer to
 * "where do I go to do X" was previously a shared Google Doc that only some
 * people had open. Data only — no server imports — so the client component can
 * import it without dragging anything into the browser bundle that doesn't
 * belong there (see lib/users/tabs.ts for the rule this follows).
 *
 * The list below is a *seed*, not the live list. Admins add and remove cards
 * from the tab itself, so the rows live in Postgres (lib/adminLinksStore.ts)
 * and this array is only what a brand-new database starts with. Editing an
 * entry here will not change a database that has already been seeded — change
 * it in the UI.
 *
 * What is deliberately NOT here: credentials. The source doc carried a username
 * and password for one vendor inline. Putting those in the repo would publish
 * them to every clone, every CI log and every deployment bundle, and the tab is
 * reachable by any position an admin grants it to. Logins belong in a password
 * manager; this file only says where the door is.
 *
 * `search` holds the aliases people actually type — vendor names that differ
 * from the label ("Crunchtime" for Net-Chef), the shorthand from the doc, and
 * the job the system does. It is matched alongside the label and note so the
 * filter finds a system by any name it goes by.
 */

/** A link as stored: same shape as a seed entry, plus the row's identity. */
export type AdminLink = {
  id: string;
  /** What it's called here — usually the vendor name people say out loud. */
  label: string;
  url: string;
  /** One line on what it's for. Shown under the label. */
  note: string;
  /** Extra terms the filter should match. Empty when nobody supplied any. */
  search: string;
};

/**
 * A seed entry. `search` stays optional here and required on `AdminLink` so
 * the fifty-odd entries below don't each need an empty string, while
 * everything downstream can treat it as a plain string.
 */
export type SeedLink = Omit<AdminLink, "id" | "search"> & { search?: string };

export type AdminLinkGroup = {
  title: string;
  /** Why these belong together, shown under the group heading. */
  blurb: string;
  links: AdminLink[];
};

export type SeedLinkGroup = {
  title: string;
  blurb: string;
  links: SeedLink[];
};

export const SEED_LINK_GROUPS: SeedLinkGroup[] = [
  {
    title: "Reporting & Analytics",
    blurb: "Where the numbers on the other tabs come from.",
    links: [
      {
        label: "PowerBI",
        url: "https://app.powerbi.com",
        note: "Microsoft BI workspaces and shared reports.",
        search: "power bi microsoft dashboards",
      },
      {
        label: "Zaxby's Reporting Hub",
        url: "https://reporting.zaxbys.com/",
        note: "Brand-published reporting for franchisees.",
        search: "zaxbys brand reporting hub franchise",
      },
      {
        label: "Franly",
        url: "https://zaxbys.franly.com/dashboard",
        note: "Franchise operations scorecards and benchmarking.",
        search: "franly franchise scorecard benchmark",
      },
      {
        label: "SMG",
        url: "https://reporting.smg.com",
        note: "Guest satisfaction surveys and ZCases — source for the SMG tab.",
        search: "service management group guest satisfaction survey zcase",
      },
      {
        label: "BerryAI",
        url: "https://board.berry-ai.com/company-dashboard",
        note: "Drive-thru timing and video analytics — source for the Drive-Thru tab.",
        search: "berry ai drive thru timer video",
      },
      {
        label: "Metiri",
        url: "https://metiri.revenuemanage.com/",
        note: "Revenue management analytics.",
        search: "metiri revenue manage pricing analytics",
      },
      {
        label: "Menu Pricing (RMS)",
        url: "https://ep.revenuemanage.com/PriceStudio",
        note: "PriceStudio — menu price studies and rollouts.",
        search: "rms price studio revenue management menu pricing",
      },
    ],
  },
  {
    title: "Accounting & Finance",
    blurb: "The books, the card processors and the gift-card ledger.",
    links: [
      {
        label: "Restaurant365",
        url: "https://hudsonrestaurantgrou.restaurant365.com/react/accounting/legacy/AllTransactions",
        note: "Accounting — opens on All Transactions.",
        search: "r365 restaurant 365 accounting gl transactions invoices",
      },
      {
        label: "BFC ReportLink",
        url: "https://reportlink.com/auth/login",
        note: "Bookkeeping reports from BFC.",
        search: "bfc report link bookkeeping",
      },
      {
        label: "Chase Paymentech",
        url: "https://secure.paymentech.com/portal/por_new.aspx",
        note: "Card processing settlements, chargebacks and deposits.",
        search: "chase paymentech credit card processing merchant settlement",
      },
      {
        label: "American Express",
        url: "https://www.americanexpress.com/en-us/business/merchant/dashboard/?intlink=us-mer-merhome-viewacct",
        note: "Amex merchant account and disputes.",
        search: "amex american express merchant",
      },
      {
        label: "Stored Value",
        url: "https://signon.us.storedvalue.com/portal/",
        note: "Gift card program and balances.",
        search: "stored value gift card svs",
      },
    ],
  },
  {
    title: "People & Payroll",
    blurb: "Hiring, paying, scheduling and training the team.",
    links: [
      {
        label: "ADP Payroll",
        url: "https://runpayroll.adp.com",
        note: "RUN — payroll processing and tax filings.",
        search: "adp run payroll wages taxes",
      },
      {
        label: "ADP Background Check",
        url: "https://online.adp.com/signin/v1/?APPID=Select&productId=80e309c3-708f-bae1-e053-3505430b5495&returnURL=https://select.adp.com&callingAppId=Select",
        note: "ADP Select — pre-hire screening.",
        search: "adp select background check screening pre-hire",
      },
      {
        label: "Workstream",
        url: "https://hr.workstream.us/hiring/new-home",
        note: "Applicant tracking and onboarding.",
        search: "workstream hiring ats applicants onboarding recruiting",
      },
      {
        label: "Teamworx",
        url: "https://zaxbys.ct-teamworx.com",
        note: "CrunchTime scheduling and labor.",
        search: "teamworx crunchtime scheduling labor shifts",
      },
      {
        label: "Zaxby's University",
        url: "https://app.schoox.com/academies/home.php?acadId=1669014345",
        note: "Schoox — brand training and certifications.",
        search: "zu schoox training lms certification learning",
      },
    ],
  },
  {
    title: "Restaurant Operations",
    blurb: "The systems the stores run on day to day.",
    links: [
      {
        label: "PAR Brink",
        url: "https://admin24.brinkpos.net/Public/Login",
        note: "POS back office — menus, pricing, employees.",
        search: "par brink pos point of sale register admin",
      },
      {
        label: "Jolt",
        url: "https://app.joltup.com/content/dashboard/contentGroup/Q29udGVudEdyb3VwOjAwMWEwNGYwMjY1NzFmYjQ5NGI1M2RiNDc5YjIyMWFl",
        note: "Checklists, temperature logs and food safety tasks.",
        search: "jolt checklist temp log food safety labels tasks",
      },
      {
        label: "Steritech",
        url: "https://zaxbys.steritech.com/#/dashboard?account_id_eq=130&round_id_eq=-1&service_id_eq=361",
        note: "Food-safety audits and pest control rounds.",
        search: "steritech ecolab brand standards audit pest inspection",
      },
      {
        label: "ZNet",
        url: "https://znet.zaxbys.com",
        note: "Zaxby's franchisee intranet — bulletins and brand standards.",
        search: "znet zaxbys intranet franchisee brand standards bulletin",
      },
      {
        label: "ZFA Portal",
        url: "https://associationservices.my.site.com/ZFA/s/events",
        note: "Zaxby's Franchisee Association — events and membership.",
        search: "zfa franchisee association events convention",
      },
    ],
  },
  {
    title: "Digital & Delivery",
    blurb: "Off-premise ordering, the marketplaces and the brand's social presence.",
    links: [
      {
        label: "Olo",
        url: "https://my.olo.com",
        note: "Digital ordering platform — menus, hours, order routing.",
        search: "olo digital ordering online orders dispatch",
      },
      {
        label: "Olo Catering",
        url: "https://olo.saleshood.com/my/public/sites/26336WwQZxouYNVoI30Ny9OTtjA1743693629?content_id=307727",
        note: "Catering enablement and training materials.",
        search: "olo catering saleshood training",
      },
      {
        label: "ezCater",
        url: "https://ezmanage.ezcater.com/orders",
        note: "ezManage — catering orders.",
        search: "ezcater ezmanage catering orders",
      },
      {
        label: "Relish",
        url: "https://relish.ezcater.com/stores/9864/ezcater_orders",
        note: "ezCater Relish — recurring workplace catering.",
        search: "relish ezcater workplace catering orders",
      },
      {
        label: "DoorDash",
        url: "https://www.doordash.com/merchant/summary?business_id=12704",
        note: "Merchant portal — business-level summary.",
        search: "door dash delivery marketplace merchant",
      },
      {
        label: "Uber Eats",
        url: "https://merchants.ubereats.com/manager/home/6cb14b61-c71c-50a2-a80f-e6e858f9ed39",
        note: "Merchant manager — store status and orders.",
        search: "uber eats ubereats delivery marketplace merchant",
      },
      {
        label: "Grubhub",
        url: "https://www.doordash.com/merchant/summary?store_id=2418930",
        note: "Store-level marketplace summary. Link is as recorded in the source doc — verify before relying on it.",
        search: "grubhub grub hub delivery marketplace",
      },
      {
        label: "Facebook",
        url: "https://www.facebook.com/",
        note: "Store pages, reviews and local posts.",
        search: "facebook meta social pages reviews",
      },
    ],
  },
  {
    title: "Supply & Purchasing",
    blurb: "Food, smallwares, uniforms and everything else that gets ordered.",
    links: [
      {
        label: "CrunchTime Net-Chef",
        url: "https://zaxbys.net-chef.com",
        note: "Inventory and food cost — source for the Food Cost tab.",
        search: "crunchtime crunch time netchef net-chef inventory food cost counts",
      },
      {
        label: "ArrowStream",
        url: "https://customer.arrowstream.com",
        note: "Distribution visibility, pricing and order tracking.",
        search: "arrowstream arrow stream distribution supply chain freight",
      },
      {
        label: "Manning Brothers",
        url: "https://www.manningbrothers.com/",
        note: "Restaurant equipment and smallwares.",
        search: "manning brothers equipment smallwares",
      },
      {
        label: "TriMark",
        url: "https://trimark.pincat.com/urLogin.aspx",
        note: "Equipment and supplies catalog.",
        search: "trimark pincat equipment supplies catalog",
      },
      {
        label: "GPAC",
        url: "https://www.gpecommerce.com/zaxbys",
        note: "Zaxby's-approved purchasing storefront.",
        search: "gpac gp ecommerce purchasing storefront zaxbys",
      },
      {
        label: "Vestis",
        url: "https://myaccount.vestis.com/",
        note: "Uniforms, linens and floor mats.",
        search: "vestis aramark uniform linen mats rental",
      },
      {
        label: "Icebox",
        url: "https://shopify.com/70395527401/account/locations?locale=en-US&referrer=storefront&return_to=%2F",
        note: "Branded merchandise and apparel storefront.",
        search: "icebox shopify merch apparel swag",
      },
      {
        label: "Brand Store (SLWM)",
        url: "https://marcomcentral.app.pti.com/printone/home.aspx?uigroup_id=470484",
        note: "MarcomCentral — print and POP marketing materials. Shared login; ask an admin.",
        search: "slwm marcom central brand store print pop signage marketing materials",
      },
      {
        label: "Brinks Supply",
        url: "https://brinkssupplysource.nelmar.com/shopping",
        note: "Nelmar — deposit bags and cash-handling supplies.",
        search: "brinks supply nelmar deposit bags coin cash supplies",
      },
      {
        label: "NuCO2",
        url: "https://www.billeriq.com/ebpp/NuCO2/BillPay",
        note: "Beverage CO2 service and bill pay.",
        search: "nuco2 co2 carbonation beverage gas bill pay billeriq",
      },
    ],
  },
  {
    title: "Facilities & Technology",
    blurb: "Utilities, waste, security, networking and in-store media.",
    links: [
      {
        label: "Brinks",
        url: "https://customerportal.brinksinc.com/en/group/customerportal-us",
        note: "Armored cash pickup and deposit tracking.",
        search: "brinks armored cash pickup deposits safe",
      },
      {
        label: "ADT",
        url: "https://www.myadt.com/dashboard",
        note: "Alarm monitoring and access.",
        search: "adt alarm security monitoring burglar",
      },
      {
        label: "Acumera",
        url: "https://acumera.atlassian.net/servicedesk/customer/portal/1024",
        note: "Managed network service desk — open a ticket for store connectivity.",
        search: "acumera network firewall internet connectivity ticket servicedesk",
      },
      {
        label: "GV Cloud",
        url: "https://www.gvaicloud.com/console",
        note: "Camera and video console.",
        search: "gv cloud gvai camera video surveillance nvr",
      },
      {
        label: "Atmos Energy",
        url: "https://www.atmosenergy.com/accountcenter/logon/login.html",
        note: "Natural gas accounts and billing.",
        search: "atmos energy gas utility bill",
      },
      {
        label: "Republic Services",
        url: "https://www.republicservices.com/",
        note: "Waste and recycling service and billing.",
        search: "republic services waste trash dumpster recycling grease",
      },
      {
        label: "Mood Media",
        url: "https://harmony.moodmedia.com/select-workgroup",
        note: "Harmony — in-store music and messaging.",
        search: "mood media harmony music audio in-store messaging",
      },
      {
        label: "Mood Media Payments",
        url: "https://cc6.ondemand.esker.com/ondemand/webaccess/CustomerLogon.aspx?uid=75347B53544F646B32756C543C3B&user=7534436C546D6F6B41722157607D&language=en&skin=skin15",
        note: "Esker — Mood invoices and payment.",
        search: "mood payments esker invoice billing",
      },
    ],
  },
  {
    title: "Insurance",
    blurb: "Policies, certificates and claims.",
    links: [
      {
        label: "USLI",
        url: "https://myaccount.usli.com/dashboard",
        note: "United States Liability Insurance — policies and certificates.",
        search: "usli liability insurance policy certificate coi claim",
      },
      {
        label: "Society Insurance",
        url: "https://policyholder.societyinsurance.com/policyholder/overview",
        note: "Policyholder portal — coverage and claims.",
        search: "society insurance policyholder claim coverage",
      },
      {
        label: "Hanover",
        url: "https://customerselfservice.hanover.com/CustomerPortal/consumer/cl/myaccount.htm",
        note: "Commercial lines self-service.",
        search: "hanover commercial lines insurance policy claim",
      },
    ],
  },
];

/**
 * Where a group sits, and what its subtitle says.
 *
 * The seed's order is meaningful — Reporting first because it's what people
 * open most, Insurance last because it's touched twice a year — so groups keep
 * that order rather than sorting alphabetically. A group an admin invents
 * later has no place in that ranking, so it sorts after all the seeded ones,
 * alphabetically among its peers, and shows no subtitle. Better an unexplained
 * heading than a made-up explanation of someone else's grouping.
 */
const SEED_GROUP_TITLES = SEED_LINK_GROUPS.map((g) => g.title);

export function groupRank(title: string): number {
  const i = SEED_GROUP_TITLES.indexOf(title);
  return i === -1 ? SEED_GROUP_TITLES.length : i;
}

export function groupBlurb(title: string): string {
  return SEED_LINK_GROUPS.find((g) => g.title === title)?.blurb ?? "";
}

/**
 * Whether a URL is safe to put in an `href`.
 *
 * This is the one piece of validation that is not about tidiness. Anyone who
 * can add a card can choose its URL, and `javascript:` in an href runs as this
 * origin the moment a colleague clicks the card — session cookie and all. Only
 * http and https are allowed, and the check parses rather than pattern-matches
 * so it can't be walked past with whitespace or mixed case.
 *
 * Exported and used on the server; the client calls it too, but only to grey
 * out the submit button. The server check is the one that counts.
 */
export function isSafeUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url.trim());
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The host a link points at, for the favicon lookup and the caption under the
 * label. Returns "" rather than throwing on a malformed URL so one bad entry
 * renders plainly instead of blanking the page.
 */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * The domain to ask for a favicon, which is not the same as the host to show.
 *
 * Nearly every link here is a tenant subdomain — `zaxbys.franly.com`,
 * `hudsonrestaurantgrou.restaurant365.com`, `signon.us.storedvalue.com` — and
 * the favicon service has only crawled the vendor's public root, so asking for
 * the subdomain returns its generic globe placeholder. Asking for the last two
 * labels gets the vendor's real mark, which is the whole point of showing an
 * icon: recognising the portal without reading.
 *
 * Two labels is deliberately naive. It is wrong for a multi-part public suffix
 * (`example.co.uk` would become `co.uk`) and for a platform host that fronts
 * many tenants (`…my.site.com` becomes Salesforce's `site.com`), and it can't
 * be right for both without shipping a public-suffix list for a decoration.
 * The cost of being wrong is one wrong-looking icon; the card still says what
 * it is, and `linkHost` still shows the true host underneath.
 */
export function faviconDomain(url: string): string {
  const host = linkHost(url);
  const labels = host.split(".");
  return labels.length > 2 ? labels.slice(-2).join(".") : host;
}

/**
 * Case-insensitive match across label, note, aliases and host, so "crunchtime"
 * finds Net-Chef and "coi" finds USLI. Every whitespace-separated term must
 * match somewhere, which makes narrowing by typing more words behave the way
 * people expect.
 */
export function matchesQuery(link: AdminLink, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = `${link.label} ${link.note} ${link.search ?? ""} ${linkHost(link.url)}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}
