import { unstable_cache } from "next/cache";

const ACCESS_TOKEN = process.env.PAR_ACCESS_TOKEN ?? "";
const BASE_URL     = process.env.PAR_BASE_URL ?? "https://api-apiint.brinkpos.net";

export const PAR_IS_SANDBOX = BASE_URL.includes("apiint");

export type PARLocation = { storeId: string; name: string; state: "TN" | "VA" };

const PROD_LOCATIONS: PARLocation[] = [
  { storeId: "36001", name: "Springfield",  state: "TN" },
  { storeId: "42601", name: "White House",  state: "TN" },
  { storeId: "56301", name: "Brentwood",    state: "TN" },
  { storeId: "61401", name: "Spring Hill",  state: "TN" },
  { storeId: "28901", name: "Columbia",     state: "TN" },
  { storeId: "57001", name: "College",      state: "VA" },
  { storeId: "57002", name: "Hampton",      state: "VA" },
  { storeId: "57003", name: "Oyster",       state: "VA" },
  { storeId: "57004", name: "Chesapeake",   state: "VA" },
  { storeId: "57005", name: "Jefferson",    state: "VA" },
  { storeId: "57006", name: "Hillcrest",    state: "VA" },
  { storeId: "57007", name: "Beach",        state: "VA" },
];

export const PAR_LOCATIONS: PARLocation[] = PAR_IS_SANDBOX
  ? [{ storeId: "SANDBOX", name: "API Lab-01 (Sandbox)", state: "TN" }]
  : PROD_LOCATIONS;

export function getLocationToken(storeId: string): string {
  if (PAR_IS_SANDBOX) return process.env.PAR_SANDBOX_LOCATION_TOKEN ?? "";
  return process.env[`PAR_TOKEN_${storeId}`] ?? "";
}

// ── Rate limiter (5 concurrent per PAR best-practice guide) ──────────────────

class Semaphore {
  private permits: number;
  private waiters: (() => void)[] = [];
  constructor(n: number) { this.permits = n; }
  acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return Promise.resolve(); }
    return new Promise(r => this.waiters.push(r));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next(); else this.permits++;
  }
}
const sem = new Semaphore(5);

// ── Cache ─────────────────────────────────────────────────────────────────────
// Wrapped with unstable_cache (below) instead of an in-memory Map: on Vercel each
// serverless invocation can land on a different instance, so a module-level Map
// doesn't actually survive between requests in production — unstable_cache is
// backed by Next's durable Data Cache, which does.

const CACHE_REVALIDATE_SECONDS = 60 * 60; // 1 hr

// ── XML helpers ───────────────────────────────────────────────────────────────

function tagVal(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[a-zA-Z]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z]+:)?${tag}>`, "i");
  return xml.match(re)?.[1]?.trim() ?? null;
}

function allTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[a-zA-Z]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z]+:)?${tag}>`, "gi");
  const out: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

// Removes a nested array block (e.g. Order.Entries, Shift.Breaks) before scalar-field
// extraction, since those arrays contain elements (OrderItem, Break, ...) with their own
// same-named fields (NetSales, StartTime, ...) that would otherwise be matched first by
// tagVal's naive first-match regex.
function stripTag(xml: string, tag: string): string {
  const re = new RegExp(`<(?:[a-zA-Z]+:)?${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:[a-zA-Z]+:)?${tag}>`, "i");
  return xml.replace(re, "");
}

// ── SOAP transport ────────────────────────────────────────────────────────────

async function soapPost(service: string, action: string, body: string, locationToken: string): Promise<string> {
  await sem.acquire();
  try {
    const res = await fetch(`${BASE_URL}/${service}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": `"${action}"`,
        "AccessToken": ACCESS_TOKEN,
        "LocationToken": locationToken,
      },
      body: `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`,
      signal: AbortSignal.timeout(30_000),
    });
    return res.text();
  } finally {
    sem.release();
  }
}

// ── Data types ────────────────────────────────────────────────────────────────

export type PAROrder = {
  netSales:   number;
  closedHour: number | null; // local hour 0-23, null if ClosedTime missing
  closedMinutes: number | null; // minutes since local midnight, null if ClosedTime missing
  isRefund:   boolean;
  // PAR's own "does this count as a transaction" flag (Order.Count, always 0 or 1).
  // Some closed $0 orders have Count=0 (not real transactions — duplicates/corrections)
  // while others are legitimate $0 transactions (e.g. comps) with Count=1. Order array
  // length overcounts vs PAR's own transaction count; always sum isCountedOrder instead
  // of using orders.length for order/transaction counts or avg-ticket calculations.
  isCountedOrder: boolean;
};

export type PARShift = {
  startMinutes: number; // minutes from midnight, local time
  endMinutes:   number;
  minutesWorked: number;
  // True if this employee hasn't clocked out yet. PAR represents "no clock-out
  // yet" as an EndTime whose DateTime is the sentinel 0001-01-01 — NOT a missing
  // tag — so this can't be inferred from endDt being null.
  isOpen: boolean;
};

// ── XML parsing (shared between cached and always-live fetchers) ────────────

function parseOrdersXml(xml: string): PAROrder[] {
  return allTags(xml, "Order").map(o => {
    const top           = stripTag(o, "Entries"); // line items carry their own NetSales
    const netSales      = parseFloat(tagVal(top, "NetSales") ?? "0") || 0;
    const isRefund      = tagVal(top, "IsRefund") === "true";
    const isCountedOrder = tagVal(top, "Count") === "1";
    const closedTimeXml = tagVal(top, "ClosedTime") ?? "";
    const dtStr         = tagVal(closedTimeXml, "DateTime");
    const closedDate    = dtStr ? new Date(dtStr) : null;
    const closedHour    = closedDate ? closedDate.getHours() : null;
    const closedMinutes = closedDate ? closedDate.getHours() * 60 + closedDate.getMinutes() : null;
    return { netSales, closedHour, closedMinutes, isRefund, isCountedOrder };
  });
}

function parseShiftsXml(xml: string): PARShift[] {
  return allTags(xml, "Shift").map(s => {
    const top = stripTag(s, "Breaks"); // breaks carry their own StartTime/EndTime
    const minutesWorked = parseInt(tagVal(top, "MinutesWorked") ?? "0") || 0;
    const startDt = tagVal(tagVal(top, "StartTime") ?? "", "DateTime");
    const endDt   = tagVal(tagVal(top, "EndTime")   ?? "", "DateTime");
    // Sentinel "no value" date PAR uses for an EndTime that hasn't happened yet.
    const isOpen  = !endDt || endDt.startsWith("0001-01-01");
    const toMins  = (dt: string | null) => {
      if (!dt) return null;
      const d = new Date(dt);
      return d.getHours() * 60 + d.getMinutes();
    };
    const startMinutes = toMins(startDt) ?? 0;
    const endMinutes   = isOpen ? Math.min(startMinutes + minutesWorked, 1440) : (toMins(endDt) ?? Math.min(startMinutes + minutesWorked, 1440));
    return { startMinutes, endMinutes, minutesWorked, isOpen };
  });
}

// ── Fetch functions ───────────────────────────────────────────────────────────

export const getOrders = unstable_cache(
  async (storeId: string, businessDate: string): Promise<PAROrder[]> => {
    const token = getLocationToken(storeId);
    const xml = await soapPost(
      "Sales2.svc",
      "http://www.brinksoftware.com/webservices/sales/v2/ISalesWebService2/GetOrders",
      `<GetOrders xmlns="http://www.brinksoftware.com/webservices/sales/v2"><request><BusinessDate>${businessDate}T00:00:00</BusinessDate><ExcludeOpenOrders>true</ExcludeOpenOrders></request></GetOrders>`,
      token,
    );
    return parseOrdersXml(xml);
  },
  ["par-orders"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["par-data"] },
);

export const getShifts = unstable_cache(
  async (storeId: string, businessDate: string): Promise<PARShift[]> => {
    const token = getLocationToken(storeId);
    const xml = await soapPost(
      "Labor2.svc",
      "http://www.brinksoftware.com/webservices/labor/v2/ILaborWebService2/GetShifts",
      `<GetShifts xmlns="http://www.brinksoftware.com/webservices/labor/v2"><request><BusinessDate>${businessDate}T00:00:00</BusinessDate></request></GetShifts>`,
      token,
    );
    return parseShiftsXml(xml);
  },
  ["par-shifts"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["par-data"] },
);

// Uncached variants — used by the live "Today vs Last Year" table, which needs
// to reflect PAR's numbers at the exact moment of each refresh (today's order
// count and open shifts' worked-minutes keep changing minute to minute), not
// whatever happened to be sitting in the 1hr shared cache.
export async function getOrdersLive(storeId: string, businessDate: string): Promise<PAROrder[]> {
  const token = getLocationToken(storeId);
  const xml = await soapPost(
    "Sales2.svc",
    "http://www.brinksoftware.com/webservices/sales/v2/ISalesWebService2/GetOrders",
    `<GetOrders xmlns="http://www.brinksoftware.com/webservices/sales/v2"><request><BusinessDate>${businessDate}T00:00:00</BusinessDate><ExcludeOpenOrders>true</ExcludeOpenOrders></request></GetOrders>`,
    token,
  );
  return parseOrdersXml(xml);
}

export async function getShiftsLive(storeId: string, businessDate: string): Promise<PARShift[]> {
  const token = getLocationToken(storeId);
  const xml = await soapPost(
    "Labor2.svc",
    "http://www.brinksoftware.com/webservices/labor/v2/ILaborWebService2/GetShifts",
    `<GetShifts xmlns="http://www.brinksoftware.com/webservices/labor/v2"><request><BusinessDate>${businessDate}T00:00:00</BusinessDate></request></GetShifts>`,
    token,
  );
  return parseShiftsXml(xml);
}

// ── Date utilities ────────────────────────────────────────────────────────────

export function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const s = new Date(start + "T00:00:00");
  const e = new Date(end   + "T00:00:00");
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

