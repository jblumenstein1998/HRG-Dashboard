// Shared daypart reference — matches the daypart_index dimension already used
// by the BerryAI drive-thru dashboard (see PEAK_DAYPARTS/NONPEAK_DAYPARTS in
// berryData.ts: peak = {2, 4} = lunch/dinner, non-peak = the rest), extended
// here with hour ranges and nicknames for the PAR hourly-window tool. Hour
// ranges are store-local wall-clock time — PAR's own order/shift timestamps
// are already each store's own local time, so no timezone conversion is ever
// needed here.

export type Daypart = {
  index: number;
  nickname: string | null;
  startMinutes: number; // inclusive, minutes since local midnight
  endMinutes: number; // exclusive, minutes since local midnight
};

export const DAYPARTS: Daypart[] = [
  { index: 1, nickname: null, startMinutes: 0, endMinutes: 11 * 60 },
  { index: 2, nickname: "lunch", startMinutes: 11 * 60, endMinutes: 14 * 60 },
  { index: 3, nickname: "afternoon snack", startMinutes: 14 * 60, endMinutes: 17 * 60 },
  { index: 4, nickname: "dinner", startMinutes: 17 * 60, endMinutes: 20 * 60 },
  { index: 5, nickname: "late night", startMinutes: 20 * 60, endMinutes: 23 * 60 },
  { index: 6, nickname: null, startMinutes: 23 * 60, endMinutes: 24 * 60 },
];

function fmtHour(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? "AM" : "PM";
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

export function daypartLabel(d: Daypart): string {
  const range = `${fmtHour(d.startMinutes)}–${fmtHour(d.endMinutes)}`;
  return d.nickname ? `Daypart ${d.index} (${d.nickname}, ${range})` : `Daypart ${d.index} (${range})`;
}

// Resolves a daypart by index ("2"), nickname ("lunch"), or alias
// ("late night snack" -> daypart 5). Returns null if nothing matches.
export function resolveDaypart(query: string): Daypart | null {
  const q = query.trim().toLowerCase();

  const byIndex = q.match(/^(?:daypart\s*)?([1-6])$/);
  if (byIndex) return DAYPARTS.find((d) => d.index === Number(byIndex[1])) ?? null;

  const aliases: Record<string, number> = {
    lunch: 2,
    "afternoon snack": 3,
    afternoon: 3,
    snack: 3,
    dinner: 4,
    "late night": 5,
    "late night snack": 5,
    "late-night": 5,
    "late-night snack": 5,
  };
  if (q in aliases) return DAYPARTS.find((d) => d.index === aliases[q]) ?? null;

  return DAYPARTS.find((d) => d.nickname === q) ?? null;
}
