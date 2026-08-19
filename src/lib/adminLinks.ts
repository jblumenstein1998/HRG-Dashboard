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
 * A card is a name and the host it points at. Nothing else.
 *
 * It has been trimmed twice. It first carried a one-line description and each
 * group carried a subtitle; those went because at this density the prose was
 * what you had to read past to find the name you came for. It then carried
 * hidden `search` aliases, which went because keeping fifty-one lists of
 * synonyms current is work nobody was going to do, and stale aliases are worse
 * than none — they quietly stop matching what people actually type.
 *
 * The cost is real and worth stating: the filter now sees a card's name and
 * its host, so a system is findable by what it is called and nowhere else.
 * "Insurance" finds Society Insurance and not USLI. The fix, when a card turns
 * out to be unfindable, is to rename it to what people call it — one edit, in
 * the UI, that also improves the card for everyone reading the page.
 */

/** A link as stored: same shape as a seed entry, plus the row's identity. */
export type AdminLink = {
  id: string;
  /** What it's called here — usually the vendor name people say out loud. */
  label: string;
  url: string;
};

/** A seed entry: a stored link before it has an id. */
export type SeedLink = Omit<AdminLink, "id">;

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
      },
      {
        label: "Zaxby's Reporting Hub",
        url: "https://reporting.zaxbys.com/",
      },
      {
        label: "Franly",
        url: "https://zaxbys.franly.com/dashboard",
      },
      {
        label: "SMG",
        url: "https://reporting.smg.com",
      },
      {
        label: "BerryAI",
        url: "https://board.berry-ai.com/company-dashboard",
      },
      {
        label: "Metiri",
        url: "https://metiri.revenuemanage.com/",
      },
      {
        label: "Menu Pricing (RMS)",
        url: "https://ep.revenuemanage.com/PriceStudio",
      },
    ],
  },
  {
    title: "Accounting & Finance",
    links: [
      {
        label: "Restaurant365",
        url: "https://hudsonrestaurantgrou.restaurant365.com/react/accounting/legacy/AllTransactions",
      },
      {
        label: "BFC ReportLink",
        url: "https://reportlink.com/auth/login",
      },
      {
        label: "Chase Paymentech",
        url: "https://secure.paymentech.com/portal/por_new.aspx",
      },
      {
        label: "American Express",
        url: "https://www.americanexpress.com/en-us/business/merchant/dashboard/?intlink=us-mer-merhome-viewacct",
      },
      {
        label: "Stored Value",
        url: "https://signon.us.storedvalue.com/portal/",
      },
    ],
  },
  {
    title: "People & Payroll",
    links: [
      {
        label: "ADP Payroll",
        url: "https://runpayroll.adp.com",
      },
      {
        label: "ADP Background Check",
        url: "https://online.adp.com/signin/v1/?APPID=Select&productId=80e309c3-708f-bae1-e053-3505430b5495&returnURL=https://select.adp.com&callingAppId=Select",
      },
      {
        label: "Workstream",
        url: "https://hr.workstream.us/hiring/new-home",
      },
      {
        label: "Teamworx",
        url: "https://zaxbys.ct-teamworx.com",
      },
      {
        label: "Zaxby's University",
        url: "https://app.schoox.com/academies/home.php?acadId=1669014345",
      },
    ],
  },
  {
    title: "Restaurant Operations",
    links: [
      {
        label: "PAR Brink",
        url: "https://admin24.brinkpos.net/Public/Login",
      },
      {
        label: "Jolt",
        url: "https://app.joltup.com/content/dashboard/contentGroup/Q29udGVudEdyb3VwOjAwMWEwNGYwMjY1NzFmYjQ5NGI1M2RiNDc5YjIyMWFl",
      },
      {
        label: "Steritech",
        url: "https://zaxbys.steritech.com/#/dashboard?account_id_eq=130&round_id_eq=-1&service_id_eq=361",
      },
      {
        label: "ZNet",
        url: "https://znet.zaxbys.com",
      },
      {
        label: "ZFA Portal",
        url: "https://associationservices.my.site.com/ZFA/s/events",
      },
    ],
  },
  {
    title: "Digital & Delivery",
    links: [
      {
        label: "Olo",
        url: "https://my.olo.com",
      },
      {
        label: "Olo Catering",
        url: "https://olo.saleshood.com/my/public/sites/26336WwQZxouYNVoI30Ny9OTtjA1743693629?content_id=307727",
      },
      {
        label: "ezCater",
        url: "https://ezmanage.ezcater.com/orders",
      },
      {
        label: "Relish",
        url: "https://relish.ezcater.com/stores/9864/ezcater_orders",
      },
      {
        label: "DoorDash",
        url: "https://www.doordash.com/merchant/summary?business_id=12704",
      },
      {
        label: "Uber Eats",
        url: "https://merchants.ubereats.com/manager/home/6cb14b61-c71c-50a2-a80f-e6e858f9ed39",
      },
      // The source doc really does list a DoorDash URL for Grubhub. Kept
      // verbatim rather than guessing a Grubhub store id; this used to be
      // flagged on the card itself, and now that cards carry no prose the
      // caveat lives here. Fix it in the UI once the right address is known.
      {
        label: "Grubhub",
        url: "https://www.doordash.com/merchant/summary?store_id=2418930",
      },
      {
        label: "Facebook",
        url: "https://www.facebook.com/",
      },
    ],
  },
  {
    title: "Supply & Purchasing",
    links: [
      {
        label: "CrunchTime Net-Chef",
        url: "https://zaxbys.net-chef.com",
      },
      {
        label: "ArrowStream",
        url: "https://customer.arrowstream.com",
      },
      {
        label: "Manning Brothers",
        url: "https://www.manningbrothers.com/",
      },
      {
        label: "TriMark",
        url: "https://trimark.pincat.com/urLogin.aspx",
      },
      {
        label: "GPAC",
        url: "https://www.gpecommerce.com/zaxbys",
      },
      {
        label: "Vestis",
        url: "https://myaccount.vestis.com/",
      },
      {
        label: "Icebox",
        url: "https://shopify.com/70395527401/account/locations?locale=en-US&referrer=storefront&return_to=%2F",
      },
      {
        label: "Brand Store (SLWM)",
        url: "https://marcomcentral.app.pti.com/printone/home.aspx?uigroup_id=470484",
      },
      {
        label: "Brinks Supply",
        url: "https://brinkssupplysource.nelmar.com/shopping",
      },
      {
        label: "NuCO2",
        url: "https://www.billeriq.com/ebpp/NuCO2/BillPay",
      },
    ],
  },
  {
    title: "Facilities & Technology",
    links: [
      {
        label: "Brinks",
        url: "https://customerportal.brinksinc.com/en/group/customerportal-us",
      },
      {
        label: "ADT",
        url: "https://www.myadt.com/dashboard",
      },
      {
        label: "Acumera",
        url: "https://acumera.atlassian.net/servicedesk/customer/portal/1024",
      },
      {
        label: "GV Cloud",
        url: "https://www.gvaicloud.com/console",
      },
      {
        label: "Atmos Energy",
        url: "https://www.atmosenergy.com/accountcenter/logon/login.html",
      },
      {
        label: "Republic Services",
        url: "https://www.republicservices.com/",
      },
      {
        label: "Mood Media",
        url: "https://harmony.moodmedia.com/select-workgroup",
      },
      {
        label: "Mood Media Payments",
        url: "https://cc6.ondemand.esker.com/ondemand/webaccess/CustomerLogon.aspx?uid=75347B53544F646B32756C543C3B&user=7534436C546D6F6B41722157607D&language=en&skin=skin15",
      },
    ],
  },
  {
    title: "Insurance",
    links: [
      {
        label: "USLI",
        url: "https://myaccount.usli.com/dashboard",
      },
      {
        label: "Society Insurance",
        url: "https://policyholder.societyinsurance.com/policyholder/overview",
      },
      {
        label: "Hanover",
        url: "https://customerselfservice.hanover.com/CustomerPortal/consumer/cl/myaccount.htm",
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

/** The registrable domain: the last two labels of a host. */
function registrableDomain(host: string): string {
  const labels = host.split(".");
  return labels.length > 2 ? labels.slice(-2).join(".") : host;
}

/**
 * Portals whose host tells you nothing about whose logo belongs on the card.
 *
 * Deliberately tiny, and only for the case no rule can solve: a vendor billing
 * through someone else's system. NuCO2's bill pay runs on Billerq, and no
 * amount of host-munging gets from `billeriq.com` to NuCO2's mark because the
 * relationship isn't in the name — it's in the URL's own `/ebpp/NuCO2/` path.
 *
 * The bar for an entry is that the mapping is *evidenced*, not guessed. A
 * `gvaicloud.com -> geovision.com` guess lived here briefly and pulled what
 * looked like an unrelated WordPress site's icon onto the GV Cloud card, which
 * is worse than no icon: initials say "I don't know", a wrong logo says
 * something false. When in doubt, leave it out and let it fall back.
 */
const BRAND_DOMAINS: Record<string, string> = {
  "billeriq.com": "nuco2.com",
};

/**
 * The domains worth asking about for a host, most specific first.
 *
 * Full host before registrable domain, because plenty of these portals publish
 * their icon on the exact subdomain — `admin24.brinkpos.net`,
 * `trimark.pincat.com`, `secure.paymentech.com` all have one, and an earlier
 * version that shortened every host to two labels threw away the very thing
 * that had the icon. The root is worth trying second because the opposite case
 * is just as common: a tenant subdomain like `zaxbys.franly.com` whose icon
 * exists only at `franly.com`.
 *
 * Two labels for the root is deliberately naive — wrong for a multi-part
 * public suffix, and wrong for a platform host that fronts many tenants
 * (`…my.site.com` becomes Salesforce's `site.com`). Shipping a public-suffix
 * list to decorate a link would be a poor trade; the cost of being wrong is
 * one odd-looking icon on a card that still says what it is.
 */
export function iconDomains(host: string): string[] {
  if (!host) return [];
  const brand = BRAND_DOMAINS[host];
  return [...new Set([brand, host, registrableDomain(host)].filter(Boolean))] as string[];
}

/** Where the page asks for a card's icon. See app/api/icon/route.ts. */
export function iconUrl(url: string): string {
  return `/api/icon?host=${encodeURIComponent(linkHost(url))}`;
}

/**
 * Case-insensitive match across the name and the host. Every whitespace-
 * separated term must match somewhere, which makes narrowing by typing more
 * words behave the way people expect.
 *
 * The host is included because it is often the name people know a system by —
 * "brinkpos" finds PAR Brink, "schoox" finds Zaxby's University — and because
 * it is the one piece of matchable text that maintains itself: it changes only
 * when the link does.
 */
export function matchesQuery(link: AdminLink, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = `${link.label} ${linkHost(link.url)}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}
