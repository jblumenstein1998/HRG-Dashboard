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
 * A card shows a name, the host it points at, and nothing else. It carried a
 * one-line description and each group carried a subtitle; both are gone by
 * request, because at this density the explanations were what you had to read
 * past to find the name you were looking for. `search` is what replaces them:
 * the aliases people actually type — vendor names that differ from the label
 * ("Crunchtime" for Net-Chef), the shorthand from the doc, and the job the
 * system does. None of it renders. It exists so the filter finds a system by
 * any name it goes by, which is the job the visible prose was doing badly.
 */

/** A link as stored: same shape as a seed entry, plus the row's identity. */
export type AdminLink = {
  id: string;
  /** What it's called here — usually the vendor name people say out loud. */
  label: string;
  url: string;
  /** Extra terms the filter should match. Never rendered; empty is fine. */
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
  links: AdminLink[];
};

export type SeedLinkGroup = {
  title: string;
  links: SeedLink[];
};

export const SEED_LINK_GROUPS: SeedLinkGroup[] = [
  {
    title: "Reporting & Analytics",
    links: [
      {
        label: "PowerBI",
        url: "https://app.powerbi.com",
        search: "power bi microsoft dashboards",
      },
      {
        label: "Zaxby's Reporting Hub",
        url: "https://reporting.zaxbys.com/",
        search: "zaxbys brand reporting hub franchise",
      },
      {
        label: "Franly",
        url: "https://zaxbys.franly.com/dashboard",
        search: "franly franchise scorecard benchmark",
      },
      {
        label: "SMG",
        url: "https://reporting.smg.com",
        search: "service management group guest satisfaction survey zcase",
      },
      {
        label: "BerryAI",
        url: "https://board.berry-ai.com/company-dashboard",
        search: "berry ai drive thru timer video",
      },
      {
        label: "Metiri",
        url: "https://metiri.revenuemanage.com/",
        search: "metiri revenue manage pricing analytics",
      },
      {
        label: "Menu Pricing (RMS)",
        url: "https://ep.revenuemanage.com/PriceStudio",
        search: "rms price studio revenue management menu pricing",
      },
    ],
  },
  {
    title: "Accounting & Finance",
    links: [
      {
        label: "Restaurant365",
        url: "https://hudsonrestaurantgrou.restaurant365.com/react/accounting/legacy/AllTransactions",
        search: "r365 restaurant 365 accounting gl transactions invoices",
      },
      {
        label: "BFC ReportLink",
        url: "https://reportlink.com/auth/login",
        search: "bfc report link bookkeeping",
      },
      {
        label: "Chase Paymentech",
        url: "https://secure.paymentech.com/portal/por_new.aspx",
        search: "chase paymentech credit card processing merchant settlement",
      },
      {
        label: "American Express",
        url: "https://www.americanexpress.com/en-us/business/merchant/dashboard/?intlink=us-mer-merhome-viewacct",
        search: "amex american express merchant",
      },
      {
        label: "Stored Value",
        url: "https://signon.us.storedvalue.com/portal/",
        search: "stored value gift card svs",
      },
    ],
  },
  {
    title: "People & Payroll",
    links: [
      {
        label: "ADP Payroll",
        url: "https://runpayroll.adp.com",
        search: "adp run payroll wages taxes",
      },
      {
        label: "ADP Background Check",
        url: "https://online.adp.com/signin/v1/?APPID=Select&productId=80e309c3-708f-bae1-e053-3505430b5495&returnURL=https://select.adp.com&callingAppId=Select",
        search: "adp select background check screening pre-hire",
      },
      {
        label: "Workstream",
        url: "https://hr.workstream.us/hiring/new-home",
        search: "workstream hiring ats applicants onboarding recruiting",
      },
      {
        label: "Teamworx",
        url: "https://zaxbys.ct-teamworx.com",
        search: "teamworx crunchtime scheduling labor shifts",
      },
      {
        label: "Zaxby's University",
        url: "https://app.schoox.com/academies/home.php?acadId=1669014345",
        search: "zu schoox training lms certification learning",
      },
    ],
  },
  {
    title: "Restaurant Operations",
    links: [
      {
        label: "PAR Brink",
        url: "https://admin24.brinkpos.net/Public/Login",
        search: "par brink pos point of sale register admin",
      },
      {
        label: "Jolt",
        url: "https://app.joltup.com/content/dashboard/contentGroup/Q29udGVudEdyb3VwOjAwMWEwNGYwMjY1NzFmYjQ5NGI1M2RiNDc5YjIyMWFl",
        search: "jolt checklist temp log food safety labels tasks",
      },
      {
        label: "Steritech",
        url: "https://zaxbys.steritech.com/#/dashboard?account_id_eq=130&round_id_eq=-1&service_id_eq=361",
        search: "steritech ecolab brand standards audit pest inspection",
      },
      {
        label: "ZNet",
        url: "https://znet.zaxbys.com",
        search: "znet zaxbys intranet franchisee brand standards bulletin",
      },
      {
        label: "ZFA Portal",
        url: "https://associationservices.my.site.com/ZFA/s/events",
        search: "zfa franchisee association events convention",
      },
    ],
  },
  {
    title: "Digital & Delivery",
    links: [
      {
        label: "Olo",
        url: "https://my.olo.com",
        search: "olo digital ordering online orders dispatch",
      },
      {
        label: "Olo Catering",
        url: "https://olo.saleshood.com/my/public/sites/26336WwQZxouYNVoI30Ny9OTtjA1743693629?content_id=307727",
        search: "olo catering saleshood training",
      },
      {
        label: "ezCater",
        url: "https://ezmanage.ezcater.com/orders",
        search: "ezcater ezmanage catering orders",
      },
      {
        label: "Relish",
        url: "https://relish.ezcater.com/stores/9864/ezcater_orders",
        search: "relish ezcater workplace catering orders",
      },
      {
        label: "DoorDash",
        url: "https://www.doordash.com/merchant/summary?business_id=12704",
        search: "door dash delivery marketplace merchant",
      },
      {
        label: "Uber Eats",
        url: "https://merchants.ubereats.com/manager/home/6cb14b61-c71c-50a2-a80f-e6e858f9ed39",
        search: "uber eats ubereats delivery marketplace merchant",
      },
      // The source doc really does list a DoorDash URL for Grubhub. Kept
      // verbatim rather than guessing a Grubhub store id; this used to be
      // flagged on the card itself, and now that cards carry no prose the
      // caveat lives here. Fix it in the UI once the right address is known.
      {
        label: "Grubhub",
        url: "https://www.doordash.com/merchant/summary?store_id=2418930",
        search: "grubhub grub hub delivery marketplace",
      },
      {
        label: "Facebook",
        url: "https://www.facebook.com/",
        search: "facebook meta social pages reviews",
      },
    ],
  },
  {
    title: "Supply & Purchasing",
    links: [
      {
        label: "CrunchTime Net-Chef",
        url: "https://zaxbys.net-chef.com",
        search: "crunchtime crunch time netchef net-chef inventory food cost counts",
      },
      {
        label: "ArrowStream",
        url: "https://customer.arrowstream.com",
        search: "arrowstream arrow stream distribution supply chain freight",
      },
      {
        label: "Manning Brothers",
        url: "https://www.manningbrothers.com/",
        search: "manning brothers equipment smallwares",
      },
      {
        label: "TriMark",
        url: "https://trimark.pincat.com/urLogin.aspx",
        search: "trimark pincat equipment supplies catalog",
      },
      {
        label: "GPAC",
        url: "https://www.gpecommerce.com/zaxbys",
        search: "gpac gp ecommerce purchasing storefront zaxbys",
      },
      {
        label: "Vestis",
        url: "https://myaccount.vestis.com/",
        search: "vestis aramark uniform linen mats rental",
      },
      {
        label: "Icebox",
        url: "https://shopify.com/70395527401/account/locations?locale=en-US&referrer=storefront&return_to=%2F",
        search: "icebox shopify merch apparel swag",
      },
      {
        label: "Brand Store (SLWM)",
        url: "https://marcomcentral.app.pti.com/printone/home.aspx?uigroup_id=470484",
        search: "slwm marcom central brand store print pop signage marketing materials",
      },
      {
        label: "Brinks Supply",
        url: "https://brinkssupplysource.nelmar.com/shopping",
        search: "brinks supply nelmar deposit bags coin cash supplies",
      },
      {
        label: "NuCO2",
        url: "https://www.billeriq.com/ebpp/NuCO2/BillPay",
        search: "nuco2 co2 carbonation beverage gas bill pay billeriq",
      },
    ],
  },
  {
    title: "Facilities & Technology",
    links: [
      {
        label: "Brinks",
        url: "https://customerportal.brinksinc.com/en/group/customerportal-us",
        search: "brinks armored cash pickup deposits safe",
      },
      {
        label: "ADT",
        url: "https://www.myadt.com/dashboard",
        search: "adt alarm security monitoring burglar",
      },
      {
        label: "Acumera",
        url: "https://acumera.atlassian.net/servicedesk/customer/portal/1024",
        search: "acumera network firewall internet connectivity ticket servicedesk",
      },
      {
        label: "GV Cloud",
        url: "https://www.gvaicloud.com/console",
        search: "gv cloud gvai camera video surveillance nvr",
      },
      {
        label: "Atmos Energy",
        url: "https://www.atmosenergy.com/accountcenter/logon/login.html",
        search: "atmos energy gas utility bill",
      },
      {
        label: "Republic Services",
        url: "https://www.republicservices.com/",
        search: "republic services waste trash dumpster recycling grease",
      },
      {
        label: "Mood Media",
        url: "https://harmony.moodmedia.com/select-workgroup",
        search: "mood media harmony music audio in-store messaging",
      },
      {
        label: "Mood Media Payments",
        url: "https://cc6.ondemand.esker.com/ondemand/webaccess/CustomerLogon.aspx?uid=75347B53544F646B32756C543C3B&user=7534436C546D6F6B41722157607D&language=en&skin=skin15",
        search: "mood payments esker invoice billing",
      },
    ],
  },
  {
    title: "Insurance",
    links: [
      {
        label: "USLI",
        url: "https://myaccount.usli.com/dashboard",
        search: "usli liability insurance policy certificate coi claim",
      },
      {
        label: "Society Insurance",
        url: "https://policyholder.societyinsurance.com/policyholder/overview",
        search: "society insurance policyholder claim coverage",
      },
      {
        label: "Hanover",
        url: "https://customerselfservice.hanover.com/CustomerPortal/consumer/cl/myaccount.htm",
        search: "hanover commercial lines insurance policy claim",
      },
    ],
  },
];

/**
 * Where a group sits on the page.
 *
 * The seed's order is meaningful — Reporting first because it's what people
 * open most, Insurance last because it's touched twice a year — so groups keep
 * that order rather than sorting alphabetically. A group an admin invents
 * later has no place in that ranking, so it sorts after all the seeded ones,
 * alphabetically among its peers.
 */
const SEED_GROUP_TITLES = SEED_LINK_GROUPS.map((g) => g.title);

export function groupRank(title: string): number {
  const i = SEED_GROUP_TITLES.indexOf(title);
  return i === -1 ? SEED_GROUP_TITLES.length : i;
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
 * Case-insensitive match across label, aliases and host, so "crunchtime" finds
 * Net-Chef and "coi" finds USLI. Every whitespace-separated term must match
 * somewhere, which makes narrowing by typing more words behave the way people
 * expect.
 *
 * This is now the only thing standing between someone and a card they can't
 * see the description of, so `search` carries the weight the visible notes
 * used to: a card added without aliases is findable only by its own name.
 */
export function matchesQuery(link: AdminLink, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = `${link.label} ${link.search} ${linkHost(link.url)}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}
