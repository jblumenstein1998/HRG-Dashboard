/**
 * Reading the numbers out of a Slack report, so they can be checked against the
 * systems (lib/slackAccuracy.ts).
 *
 * The field list is the "HRG - Slack Reporting" doc's, minus Catering and
 * ArrowStream (no system holds them) and the morning projections (forecasts,
 * nothing to check them against).
 *
 * The same report arrives as "Net sales- $1547", "NET SALES: *$8,100.68*",
 * "Netsales -2,023.68", "Net-4605.96" and "Total net sales:$11,306.91". So each
 * field is a list of labels, read line by line: the first line carrying a
 * label gives the number after it. A dash straight after a label is a
 * separator, not a minus sign — only comp % and cash can be negative, and for
 * those a sign written against the number ("Comp -9.7", "Comp- -10%") is kept.
 *
 * Pure: no env, no network. Exercised by scripts/check-slack-reports.mjs.
 */

export type ReportFields = {
  netSales: number | null;
  compPct: number | null;
  splh: number | null;
  tplh: number | null;
  avgCheck: number | null;
  /** Seconds. */
  windowSecs: number | null;
  /** Seconds. */
  laneSecs: number | null;
  joltPct: number | null;
  cashOverShort: number | null;
  /** The morning report's "Current Day" forecasts — not checked, shown on Staffing. */
  salesProjection: number | null;
  productivityProjection: number | null;
  /** Hourly sales by the hour the bucket starts, 24-hour local: 11, 12, 13 … */
  hourly: Record<number, number>;
};

/**
 * A number, with an optional sign, $, commas and decimals. Two sign slots: one
 * before the $ ("-$2.00") and one after ("$-2", "- +13.3"). The first only
 * counts when nothing separates it from what follows — "Comp -9.7" is
 * negative, "Cash - $0.37" is a separator and a positive 37 cents.
 */
const NUMBER = String.raw`([+-]?)(\s?)\$?\s?([+-]?)\s?(\d[\d,]*(?:\.\d+)*|\.\d+)`;

/** Text allowed between a label and its value: colons, dashes, stars, "=", "(", "%", spaces. */
const SEP = String.raw`[\s:*=(%\-–]*?`;

type Spec = { labels: RegExp; signed?: boolean; skipLine?: RegExp };

const SPECS: Record<Exclude<keyof ReportFields, "hourly" | "windowSecs" | "laneSecs">, Spec> = {
  netSales: { labels: /(?:total\s*)?net\s*sales?|netsales?|\bnet\b|^\W*sales\b/i, skipLine: /projection|projected/i },
  compPct: { labels: /\bcomp\b\s*%?|\bcomp(?=\s*%)/i, signed: true },
  splh: { labels: /productivity(?:\s*\(splh\))?|\bprod\b|\bsplh\b/i, skipLine: /projection|projected/i },
  tplh: { labels: /\btplh\b/i },
  avgCheck: { labels: /average\s*check|avg\.?\s*check|check\s*average|\bavg\b|\baverage\b|\bac\b/i },
  joltPct: { labels: /\bjolt\b(?:\s*completion)?\s*%?/i },
  cashOverShort: {
    labels: /cash\s*(?:\(?\s*over\s*\/\s*short\s*\)?|over|short)?|over\s*\/\s*short/i,
    signed: true,
    skipLine: /\bcomp\b/i,
  },
  // "Sales projection- $3894", "Sale projection 3973", "Projected sales:11,441",
  // "*Sales projection$11.054.28*", Jefferson's "PJ: 6,863.18"
  // (any spelling of "project…": Brentwood typed "Sales projecttion4186")
  salesProjection: { labels: /\bsales?\s*project[a-z]*|projected\s*sales|^\W*PJ\b/i },
  // "Prod projection- 62.3", "*Productivity projections 75.78*", "Projected prod:$88.93",
  // "Projected SPLH: 62.52" (Beach), Jefferson's "(SPLH) P.P: 67.94"
  productivityProjection: {
    labels: /\bprod(?:uctivity)?\s*project[a-z]*|projected\s*(?:prod(?:uctivity)?|splh)\b|\bP\.\s?P\b/i,
  },
};

const TIME_SPECS = {
  // "Total Window: 1:01", "TW- 1:37", "Window-.59", "Total window: :57"
  windowSecs: /total\s*window|\bwindow\b|\btw\b/i,
  // "Total Lane (with Pull Forward) 3:46", "TL- 3:43", "Drive time- 3:54", "Total time(PF):3:04", "Dt 3:14"
  laneSecs: /total\s*lane|\blane\b|\btl\b|drive\s*time|drove\s*time|total\s*time|total\s*drive|\bdt\b/i,
};

/**
 * "1,954.10" and "11,306" are thousands; "77,35" (College, 2026-08-09) is a
 * decimal comma — a single comma followed by exactly two digits and nothing more.
 */
function toNumber(raw: string): number {
  if (/^\d+,\d{2}$/.test(raw)) return Number(raw.replace(",", "."));
  // "11.054.28" and "$5.119.90" (Hampton): a dot typed for the thousands
  // comma. Only the last dot is the decimal point.
  if ((raw.match(/\./g) ?? []).length > 1) {
    const last = raw.lastIndexOf(".");
    return Number(raw.slice(0, last).replace(/[.,]/g, "") + raw.slice(last));
  }
  return Number(raw.replace(/,/g, ""));
}

function parseNumber(m: RegExpMatchArray, signed: boolean): number {
  const value = toNumber(m[4]);
  const sign = m[3] || (m[2] === "" ? m[1] : "");
  return signed && sign === "-" ? -value : value;
}

/** "3:46" → 226, ":57" → 57, ".59" → 59, "1:01" → 61. */
function parseClock(s: string): number | null {
  const m = s.match(/(\d{1,2})?[:.](\d{2})(?!\d)/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2]);
}

function lines(text: string): string[] {
  return text.split(/\n|•|\s{2,}(?=[A-Za-z])/).map((l) => l.trim()).filter(Boolean);
}

function readField(rows: string[], spec: Spec): number | null {
  for (const line of rows) {
    if (spec.skipLine?.test(line)) continue;
    const label = line.match(spec.labels);
    if (!label || label.index === undefined) continue;
    const rest = line.slice(label.index + label[0].length);
    // A clock ("3:46") after the label isn't this field's number.
    const m = rest.match(new RegExp(`^${SEP}${NUMBER}`));
    if (!m) continue;
    if (/^\d{1,2}:\d{2}/.test(rest.replace(/^[\s:*=(%\-–]*/, ""))) continue;
    return parseNumber(m, spec.signed ?? false);
  }
  return null;
}

function readClock(rows: string[], labels: RegExp): number | null {
  for (const line of rows) {
    const label = line.match(labels);
    if (!label || label.index === undefined) continue;
    const secs = parseClock(line.slice(label.index + label[0].length));
    if (secs !== null) return secs;
  }
  return null;
}

/** Hourly sales: "11-12 $376", "2:3: 797.79", "11-12/341.48", "5-6 -440.55". */
const HOURLY_RE =
  /(?<![\d$.,/:])(11|12|[1-7])\s*[-–:]\s*(12|[1-8])(?![\d.,]|:\d)[\s:*=/\-–]*\$?\s?(\d[\d,]*(?:\.\d+)?)/g;

function readHourly(text: string): Record<number, number> {
  const out: Record<number, number> = {};
  for (const m of text.matchAll(HOURLY_RE)) {
    const from = Number(m[1]);
    if (Number(m[2]) !== (from % 12) + 1) continue;
    // 11 and 12 are morning/noon; 1–7 are afternoon and evening.
    const hour24 = from >= 11 ? from : from + 12;
    if (!(hour24 in out)) out[hour24] = Number(m[3].replace(/,/g, ""));
  }
  return out;
}

export function parseReportFields(text: string): ReportFields {
  const rows = lines(text);
  return {
    netSales: readField(rows, SPECS.netSales),
    compPct: readField(rows, SPECS.compPct),
    splh: readField(rows, SPECS.splh),
    tplh: readField(rows, SPECS.tplh),
    avgCheck: readField(rows, SPECS.avgCheck),
    windowSecs: readClock(rows, TIME_SPECS.windowSecs),
    laneSecs: readClock(rows, TIME_SPECS.laneSecs),
    joltPct: readField(rows, SPECS.joltPct),
    cashOverShort: readField(rows, SPECS.cashOverShort),
    salesProjection: readField(rows, SPECS.salesProjection),
    productivityProjection: readField(rows, SPECS.productivityProjection),
    hourly: readHourly(text),
  };
}
