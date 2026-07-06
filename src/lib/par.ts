const ACCESS_TOKEN = process.env.PAR_ACCESS_TOKEN ?? "";
const BASE_URL     = process.env.PAR_BASE_URL ?? "https://api-apiint.brinkpos.net";

export const PAR_IS_SANDBOX = BASE_URL.includes("apiint");

export type PARLocation = { storeId: string; name: string; state: "TN" | "VA" };

// TODO: confirm VA storeId → name mapping with Josh before going to production
const PROD_LOCATIONS: PARLocation[] = [
  { storeId: "36001", name: "Springfield",  state: "TN" },
  { storeId: "42601", name: "White House",  state: "TN" },
  { storeId: "56301", name: "Brentwood",    state: "TN" },
  { storeId: "61401", name: "Spring Hill",  state: "TN" },
  { storeId: "28901", name: "Columbia",     state: "TN" },
  { storeId: "57001", name: "VA-57001",     state: "VA" },
  { storeId: "57002", name: "VA-57002",     state: "VA" },
  { storeId: "57003", name: "VA-57003",     state: "VA" },
  { storeId: "57004", name: "VA-57004",     state: "VA" },
  { storeId: "57005", name: "VA-57005",     state: "VA" },
  { storeId: "57006", name: "VA-57006",     state: "VA" },
  { storeId: "57007", name: "VA-57007",     state: "VA" },
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

const CACHE_TTL_MS     = 60 * 60 * 1000;       // 1 hr for past dates
const CACHE_TODAY_MS   = 15 * 60 * 1000;        // 15 min for today
const DAYPART_CACHE_MS = 24 * 60 * 60 * 1000;  // 24 hr — dayparts rarely change

const ordersCache   = new Map<string, { data: PAROrder[];   at: number }>();
const shiftsCache   = new Map<string, { data: PARShift[];   at: number }>();
const daypartsCache = new Map<string, { data: PARDayPart[]; at: number }>();

function ttl(dateStr: string): number {
  const today = new Date().toISOString().split("T")[0];
  return dateStr >= today ? CACHE_TODAY_MS : CACHE_TTL_MS;
}

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

async function settingsPost(body: string): Promise<string> {
  await sem.acquire();
  try {
    const res = await fetch(`${BASE_URL}/Settings.svc`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": `"http://tempuri.org/ISettingsWebService/GetDayParts"`,
      },
      body: `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`,
      signal: AbortSignal.timeout(15_000),
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
  isRefund:   boolean;
};

export type PARShift = {
  startMinutes: number; // minutes from midnight, local time
  endMinutes:   number;
  minutesWorked: number;
};

export type PARDayPart = {
  id:           number;
  name:         string;
  startMinutes: number; // minutes from midnight
  isPeak:       boolean; // Lunch or Dinner
};

// ── Fetch functions ───────────────────────────────────────────────────────────

export async function getOrders(storeId: string, businessDate: string): Promise<PAROrder[]> {
  const token = getLocationToken(storeId);
  const key   = `orders:${storeId}:${businessDate}`;
  const hit   = ordersCache.get(key);
  if (hit && Date.now() - hit.at < ttl(businessDate)) return hit.data;

  const xml = await soapPost(
    "Sales2.svc",
    "http://www.brinksoftware.com/webservices/sales/v2/ISalesWebService2/GetOrders",
    `<GetOrders xmlns="http://www.brinksoftware.com/webservices/sales/v2"><request><BusinessDate>${businessDate}T00:00:00</BusinessDate><ExcludeOpenOrders>true</ExcludeOpenOrders></request></GetOrders>`,
    token,
  );

  const data: PAROrder[] = allTags(xml, "Order").map(o => {
    const netSales      = parseFloat(tagVal(o, "NetSales") ?? "0") || 0;
    const isRefund      = tagVal(o, "IsRefund") === "true";
    const closedTimeXml = tagVal(o, "ClosedTime") ?? "";
    const dtStr         = tagVal(closedTimeXml, "DateTime");
    const closedHour    = dtStr ? new Date(dtStr).getHours() : null;
    return { netSales, closedHour, isRefund };
  });

  ordersCache.set(key, { data, at: Date.now() });
  return data;
}

export async function getShifts(storeId: string, businessDate: string): Promise<PARShift[]> {
  const token = getLocationToken(storeId);
  const key   = `shifts:${storeId}:${businessDate}`;
  const hit   = shiftsCache.get(key);
  if (hit && Date.now() - hit.at < ttl(businessDate)) return hit.data;

  const xml = await soapPost(
    "Labor2.svc",
    "http://www.brinksoftware.com/webservices/labor/v2/ILaborWebService2/GetShifts",
    `<GetShifts xmlns="http://www.brinksoftware.com/webservices/labor/v2"><request><BusinessDate>${businessDate}T00:00:00</BusinessDate></request></GetShifts>`,
    token,
  );

  const data: PARShift[] = allTags(xml, "Shift").map(s => {
    const minutesWorked = parseInt(tagVal(s, "MinutesWorked") ?? "0") || 0;
    const startDt = tagVal(tagVal(s, "StartTime") ?? "", "DateTime");
    const endDt   = tagVal(tagVal(s, "EndTime")   ?? "", "DateTime");
    const toMins  = (dt: string | null) => {
      if (!dt) return null;
      const d = new Date(dt);
      return d.getHours() * 60 + d.getMinutes();
    };
    const startMinutes = toMins(startDt) ?? 0;
    const endMinutes   = toMins(endDt)   ?? Math.min(startMinutes + minutesWorked, 1440);
    return { startMinutes, endMinutes, minutesWorked };
  });

  shiftsCache.set(key, { data, at: Date.now() });
  return data;
}

export async function getDayParts(storeId: string): Promise<PARDayPart[]> {
  const token = getLocationToken(storeId);
  const key   = `dayparts:${storeId}`;
  const hit   = daypartsCache.get(key);
  if (hit && Date.now() - hit.at < DAYPART_CACHE_MS) return hit.data;

  const xml = await settingsPost(
    `<GetDayParts xmlns="http://tempuri.org/"><accessToken>${ACCESS_TOKEN}</accessToken><locationToken>${token}</locationToken></GetDayParts>`,
  );

  const data: PARDayPart[] = allTags(xml, "DayPart").map(d => {
    const id   = parseInt(tagVal(d, "Id")   ?? "0") || 0;
    const name = tagVal(d, "Name") ?? "";
    const stStr = tagVal(d, "StartTime") ?? "";
    const stDate = stStr ? new Date(stStr) : null;
    const startMinutes = stDate ? stDate.getHours() * 60 + stDate.getMinutes() : 0;
    const lname = name.toLowerCase();
    const isPeak = lname.includes("lunch") || lname.includes("dinner");
    return { id, name, startMinutes, isPeak };
  }).sort((a, b) => a.startMinutes - b.startMinutes);

  daypartsCache.set(key, { data, at: Date.now() });
  return data;
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

// ── Labor distribution helpers ────────────────────────────────────────────────

export function shiftByHour(shift: PARShift): number[] {
  const hours = new Array(24).fill(0);
  const start = Math.max(0,    shift.startMinutes);
  const end   = Math.min(1440, shift.endMinutes);
  for (let h = 0; h < 24; h++) {
    const hStart = h * 60;
    const hEnd   = hStart + 60;
    const overlap = Math.max(0, Math.min(end, hEnd) - Math.max(start, hStart));
    hours[h] += overlap;
  }
  return hours; // minutes per hour
}

export function shiftByDaypart(shift: PARShift, dayparts: PARDayPart[]): number[] {
  const totals = new Array(dayparts.length).fill(0);
  const start = Math.max(0,    shift.startMinutes);
  const end   = Math.min(1440, shift.endMinutes);
  for (let i = 0; i < dayparts.length; i++) {
    const dpStart = dayparts[i].startMinutes;
    const dpEnd   = i + 1 < dayparts.length ? dayparts[i + 1].startMinutes : 1440;
    const overlap = Math.max(0, Math.min(end, dpEnd) - Math.max(start, dpStart));
    totals[i] += overlap;
  }
  return totals; // minutes per daypart
}
