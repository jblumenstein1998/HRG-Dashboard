import { NextRequest, NextResponse } from "next/server";
import {
  PAR_LOCATIONS,
  getOrders,
  getShifts,
  getDayParts,
  dateRange,
  shiftByHour,
  shiftByDaypart,
} from "@/lib/par";

export type PARDailyRow = {
  date:        string;
  netSales:    number;
  transactions: number;
  avgTicket:   number;
  laborHours:  number;
};

export type PARHourlyRow = {
  hour:         number;
  netSales:     number;
  transactions: number;
  avgTicket:    number;
  laborHours:   number;
};

export type PARDaypartRow = {
  name:       string;
  isPeak:     boolean;
  laborHours: number;
};

export type PARLocationResult = {
  storeId:     string;
  name:        string;
  state:       "TN" | "VA";
  startDate:   string;
  endDate:     string;
  summary: {
    netSales:     number;
    transactions: number;
    avgTicket:    number;
    laborHours:   number;
    peakHours:    number;
    nonPeakHours: number;
  };
  daily:    PARDailyRow[];
  hourly:   PARHourlyRow[];
  dayparts: PARDaypartRow[];
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get("storeId");
  const start   = searchParams.get("start");
  const end     = searchParams.get("end");

  if (!storeId || !start || !end) {
    return NextResponse.json({ error: "storeId, start, end required" }, { status: 400 });
  }

  const loc = PAR_LOCATIONS.find(l => l.storeId === storeId);
  if (!loc) return NextResponse.json({ error: "Unknown storeId" }, { status: 404 });

  const dates = dateRange(start, end);

  const [dayparts, ...dailyRaw] = await Promise.all([
    getDayParts(storeId).catch(() => []),
    ...dates.map(d =>
      Promise.all([
        getOrders(storeId, d).catch(() => []),
        getShifts(storeId, d).catch(() => []),
      ]).then(([orders, shifts]) => ({ date: d, orders, shifts }))
    ),
  ]);

  // Accumulators
  const hourlySales  = new Array(24).fill(0);
  const hourlyTx     = new Array(24).fill(0);
  const hourlyLabor  = new Array(24).fill(0); // minutes
  const dpLabor      = new Array(dayparts.length).fill(0); // minutes
  const daily: PARDailyRow[] = [];

  let totalSales = 0;
  let totalTx    = 0;
  let totalLabor = 0; // minutes
  let peakLabor  = 0;
  let nonPeakLabor = 0;

  for (const { date, orders, shifts } of dailyRaw) {
    let daySales = 0, dayTx = 0, dayLabor = 0;

    for (const o of orders) {
      if (o.isRefund) {
        daySales += o.netSales; // refunds are negative, naturally reduces total
        continue;
      }
      daySales += o.netSales;
      dayTx++;
      if (o.closedHour !== null) {
        hourlySales[o.closedHour] += o.netSales;
        hourlyTx[o.closedHour]++;
      }
    }

    for (const s of shifts) {
      dayLabor += s.minutesWorked;
      const byHour = shiftByHour(s);
      byHour.forEach((m, h) => { hourlyLabor[h] += m; });
      if (dayparts.length) {
        const byDp = shiftByDaypart(s, dayparts);
        byDp.forEach((m, i) => {
          dpLabor[i] += m;
          if (dayparts[i].isPeak) peakLabor += m;
          else nonPeakLabor += m;
        });
      } else {
        totalLabor += s.minutesWorked; // fallback if no dayparts
      }
    }

    totalSales += daySales;
    totalTx    += dayTx;
    totalLabor += dayLabor;

    daily.push({
      date,
      netSales:    Math.round(daySales * 100) / 100,
      transactions: dayTx,
      avgTicket:   dayTx > 0 ? Math.round((daySales / dayTx) * 100) / 100 : 0,
      laborHours:  Math.round((dayLabor / 60) * 100) / 100,
    });
  }

  // If no dayparts, treat all labor as non-peak
  if (!dayparts.length) nonPeakLabor = totalLabor;

  const hourly: PARHourlyRow[] = [];
  for (let h = 0; h < 24; h++) {
    if (hourlySales[h] === 0 && hourlyTx[h] === 0 && hourlyLabor[h] === 0) continue;
    hourly.push({
      hour:         h,
      netSales:     Math.round(hourlySales[h] * 100) / 100,
      transactions: hourlyTx[h],
      avgTicket:    hourlyTx[h] > 0 ? Math.round((hourlySales[h] / hourlyTx[h]) * 100) / 100 : 0,
      laborHours:   Math.round((hourlyLabor[h] / 60) * 100) / 100,
    });
  }

  const daypartsOut: PARDaypartRow[] = dayparts.map((dp, i) => ({
    name:       dp.name,
    isPeak:     dp.isPeak,
    laborHours: Math.round((dpLabor[i] / 60) * 100) / 100,
  }));

  const result: PARLocationResult = {
    storeId:   loc.storeId,
    name:      loc.name,
    state:     loc.state,
    startDate: start,
    endDate:   end,
    summary: {
      netSales:     Math.round(totalSales * 100) / 100,
      transactions: totalTx,
      avgTicket:    totalTx > 0 ? Math.round((totalSales / totalTx) * 100) / 100 : 0,
      laborHours:   Math.round((totalLabor  / 60) * 100) / 100,
      peakHours:    Math.round((peakLabor   / 60) * 100) / 100,
      nonPeakHours: Math.round((nonPeakLabor / 60) * 100) / 100,
    },
    daily,
    hourly,
    dayparts: daypartsOut,
  };

  return NextResponse.json(result);
}
