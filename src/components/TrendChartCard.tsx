"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export type TrendPoint = {
  date: string;
  netSales: number;
  transactions: number;
  avgTicket: number;
  laborHours: number;
  splh: number | null;
  tplh: number | null;
};

const METRIC_LABEL: Record<string, string> = {
  netSales: "Net Sales",
  transactions: "Transactions",
  avgTicket: "Average Ticket",
  laborHours: "Labor Hours",
  splh: "SPLH",
  tplh: "TPLH",
};

const METRIC_FORMAT: Record<string, (v: number) => string> = {
  netSales: (v) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
  transactions: (v) => v.toLocaleString(),
  avgTicket: (v) => `$${v.toFixed(2)}`,
  laborHours: (v) => v.toFixed(1),
  splh: (v) => `$${v.toFixed(2)}`,
  tplh: (v) => v.toFixed(2),
};

export default function TrendChartCard({
  store,
  range,
  metric,
  granularity,
  points,
}: {
  store: string;
  range: string;
  metric: string;
  granularity?: string;
  points: TrendPoint[];
}) {
  const fmt = METRIC_FORMAT[metric] ?? ((v: number) => String(v));
  const label = METRIC_LABEL[metric] ?? metric;
  const granularityLabel = granularity === "weekly" ? " (Weekly)" : "";

  if (points.length === 0) {
    return <div className="text-xs text-gray-400 italic">No data in range.</div>;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-2 my-1 not-prose">
      <div className="text-xs font-semibold text-gray-700">
        {store} — {label}
        {granularityLabel}
      </div>
      <div className="text-[10px] text-gray-400 mb-1.5">{range}</div>
      <div style={{ width: "100%", height: 160 }}>
        <ResponsiveContainer>
          <LineChart data={points} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: "#9ca3af" }}
              tickFormatter={(d: string) => d.slice(5)}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "#9ca3af" }}
              width={42}
              tickFormatter={fmt}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={(v) => fmt(Number(v))}
              labelFormatter={(d) => String(d)}
              contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e5e7eb" }}
            />
            <Line type="monotone" dataKey={metric} stroke="#111827" strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
