import { BranchStore } from "./berry";

export type StoreSection = "Tennessee" | "Virginia" | "Texas";

/** Every section, in the order the tabs list them. */
export const STORE_SECTIONS: StoreSection[] = ["Tennessee", "Virginia", "Texas"];

/** The two-letter market each section is shown as. */
export const SECTION_SHORT: Record<StoreSection, "TN" | "VA" | "TX"> = {
  Tennessee: "TN",
  Virginia: "VA",
  Texas: "TX",
};

const STORE_CONFIG: {
  fragment: string;
  label: string;
  section: StoreSection;
  order: number;
}[] = [
  // Tennessee — in display order
  { fragment: "222 s. james m campbell", label: "Columbia",    section: "Tennessee", order: 0 },
  { fragment: "4882 port royal",          label: "Spring Hill", section: "Tennessee", order: 1 },
  { fragment: "471 old hickory",          label: "Brentwood",   section: "Tennessee", order: 2 },
  { fragment: "800 hwy. 76",               label: "White House", section: "Tennessee", order: 3 },
  { fragment: "3509 tom austin",          label: "Springfield", section: "Tennessee", order: 4 },
  // BerryAI has no Portland branch yet, so the city stands in for a street
  // address not yet seen in Berry's format. No other store is in Portland, so
  // the card appears on its own once Berry onboards the store.
  { fragment: "portland",                 label: "Portland",    section: "Tennessee", order: 5 },
  // Virginia — in display order
  { fragment: "12834 jefferson",          label: "Jefferson",   section: "Virginia",  order: 0 },
  { fragment: "531 oyster point",         label: "Oyster",      section: "Virginia",  order: 1 },
  { fragment: "2201 todds",               label: "Hampton",     section: "Virginia",  order: 2 },
  { fragment: "6120 college",             label: "College",     section: "Virginia",  order: 3 },
  { fragment: "2316 chesapeake square",   label: "Chesapeake",  section: "Virginia",  order: 4 },
  { fragment: "125 hillcrest",            label: "Hillcrest",   section: "Virginia",  order: 5 },
  { fragment: "2332 elson green",         label: "Beach",       section: "Virginia",  order: 6 },
  // Texas — in display order, north to south. Acquired October 2026 and not on
  // BerryAI yet, so like Portland each stands on its city until Berry's address
  // format is known — except Alamo, whose city (San Antonio) isn't distinctive,
  // so it uses its street, 11903 Alamo Ranch Pkwy.
  { fragment: "killeen",                  label: "Killeen",      section: "Texas",     order: 0 },
  { fragment: "temple",                   label: "Temple",       section: "Texas",     order: 1 },
  { fragment: "pflugerville",             label: "Pflugerville", section: "Texas",     order: 2 },
  { fragment: "cibolo",                   label: "Cibolo",       section: "Texas",     order: 3 },
  { fragment: "windcrest",                label: "Windcrest",    section: "Texas",     order: 4 },
  { fragment: "alamo ranch",              label: "Alamo",        section: "Texas",     order: 5 },
];

/**
 * Every store, in display order, without needing a BerryAI branch list in hand.
 *
 * `groupBranches` can only describe the stores BerryAI returned; the admin
 * screen has to offer the whole estate before anyone has fetched anything, so
 * the catalog is derived from the same STORE_CONFIG rather than typed out a
 * second time and left to drift.
 */
export const ALL_STORES: { label: string; section: StoreSection }[] = STORE_SECTIONS.flatMap((section) =>
  STORE_CONFIG.filter((c) => c.section === section)
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ label: c.label, section })),
);

/** Whether a stored store label still names a store in the catalog above. */
export function isKnownStoreLabel(label: string): boolean {
  return ALL_STORES.some((s) => s.label === label);
}

function findConfig(branch: BranchStore) {
  const loc = (branch.location ?? "").toLowerCase();
  return STORE_CONFIG.find(({ fragment }) => loc.includes(fragment)) ?? null;
}

/** Returns the preferred display name for a branch, falling back to the BerryAI name. */
export function getStoreLabel(branch: BranchStore): string {
  return findConfig(branch)?.label ?? branch.name;
}

/** Returns the section ("Tennessee" | "Virginia" | "Texas") for a branch, or null if unknown. */
export function getStoreSection(branch: BranchStore): StoreSection | null {
  return findConfig(branch)?.section ?? null;
}

export type SectionedBranches = {
  section: StoreSection;
  branches: BranchStore[];
}[];

/**
 * Groups and sorts branches into Tennessee, Virginia then Texas sections,
 * in the defined display order. Branches in no section are dropped.
 */
export function groupBranches(branches: BranchStore[]): SectionedBranches {
  return STORE_SECTIONS.map((section) => ({
    section,
    branches: branches
      .filter((b) => getStoreSection(b) === section)
      .sort((a, b) => {
        const oa = findConfig(a)?.order ?? 99;
        const ob = findConfig(b)?.order ?? 99;
        return oa - ob;
      }),
  }));
}
