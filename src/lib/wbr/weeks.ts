/** The weeks the WBR panel offers. Pure — the caller supplies "today". */

export type WbrWeekOption = { weekEnd: string; label: string };

const shift = (iso: string, days: number) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/**
 * The last `n` completed Mon–Sun data weeks before `todayISO`, newest first,
 * each labelled by the meeting it feeds (the following week) — which is the
 * week the deck's title names.
 */
export function recentWbrWeeks(todayISO: string, n: number): WbrWeekOption[] {
  const dow = new Date(todayISO + "T12:00:00Z").getUTCDay();
  // Today's week isn't finished even on a Sunday, so step back to last Sunday.
  const lastSunday = shift(todayISO, -(dow === 0 ? 7 : dow));
  return Array.from({ length: n }, (_, i) => {
    const end = shift(lastSunday, -7 * i);
    return {
      weekEnd: end,
      label: `${md(shift(end, 1))}–${md(shift(end, 7))} meeting · data ${md(shift(end, -6))}–${md(end)}`,
    };
  });
}
