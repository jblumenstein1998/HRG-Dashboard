import { BranchStore } from "./berry";

export type StoreSection = "Tennessee" | "Virginia";

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
  // Virginia — in display order
  { fragment: "12834 jefferson",          label: "Jefferson",   section: "Virginia",  order: 0 },
  { fragment: "531 oyster point",         label: "Oyster",      section: "Virginia",  order: 1 },
  { fragment: "2201 todds",               label: "Hampton",     section: "Virginia",  order: 2 },
  { fragment: "6120 college",             label: "College",     section: "Virginia",  order: 3 },
  { fragment: "2316 chesapeake square",   label: "Chesapeake",  section: "Virginia",  order: 4 },
  { fragment: "125 hillcrest",            label: "Hillcrest",   section: "Virginia",  order: 5 },
  { fragment: "2332 elson green",         label: "Beach",       section: "Virginia",  order: 6 },
];

function findConfig(branch: BranchStore) {
  const loc = (branch.location ?? "").toLowerCase();
  return STORE_CONFIG.find(({ fragment }) => loc.includes(fragment)) ?? null;
}

/** Returns the preferred display name for a branch, falling back to the BerryAI name. */
export function getStoreLabel(branch: BranchStore): string {
  return findConfig(branch)?.label ?? branch.name;
}

/** Returns the section ("Tennessee" | "Virginia") for a branch, or null if unknown. */
export function getStoreSection(branch: BranchStore): StoreSection | null {
  return findConfig(branch)?.section ?? null;
}

export type SectionedBranches = {
  section: StoreSection;
  branches: BranchStore[];
}[];

/**
 * Groups and sorts branches into Tennessee then Virginia sections,
 * in the defined display order. Branches not in either section are dropped.
 */
export function groupBranches(branches: BranchStore[]): SectionedBranches {
  const sections: StoreSection[] = ["Tennessee", "Virginia"];
  return sections.map((section) => ({
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
