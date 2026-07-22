import { PAR_LOCATIONS, type PARLocation } from "@/lib/par";
import { LOCATION_NAMES } from "@/lib/netchef";

export type ResolvedStore = PARLocation & { ncLocationId: number | null };

const NC_ID_BY_NAME = new Map<string, number>(
  Object.entries(LOCATION_NAMES).map(([id, name]) => [name.toLowerCase(), Number(id)])
);

export function listResolvedStores(): ResolvedStore[] {
  return PAR_LOCATIONS.map(loc => ({
    ...loc,
    ncLocationId: NC_ID_BY_NAME.get(loc.name.toLowerCase()) ?? null,
  }));
}

/** Case-insensitive exact-then-substring match on PAR's canonical store names. */
export function resolveStore(storeName: string): ResolvedStore | null {
  const stores = listResolvedStores();
  const needle = storeName.trim().toLowerCase();
  const exact = stores.find(s => s.name.toLowerCase() === needle);
  if (exact) return exact;
  const partial = stores.find(s => s.name.toLowerCase().includes(needle) || needle.includes(s.name.toLowerCase()));
  return partial ?? null;
}
