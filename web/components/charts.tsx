"use client";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const axis = { stroke: "#71717a", fontSize: 11 };
const tip = { contentStyle: { background: "#111418", border: "1px solid #2a3039", fontSize: 12 }, labelStyle: { color: "#e4e4e7" } };

export interface ParetoRow { category_tier3: string; incident_count: number; cumulative_pct: number }
export function ParetoChart({ data }: { data: ParetoRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 50 }}>
        <CartesianGrid stroke="#1c2127" vertical={false} />
        <XAxis dataKey="category_tier3" {...axis} angle={-35} textAnchor="end" interval={0} height={60} />
        <YAxis yAxisId="l" {...axis} />
        <YAxis yAxisId="r" orientation="right" {...axis} domain={[0, 100]} unit="%" />
        <Tooltip {...tip} />
        <Bar isAnimationActive={false} yAxisId="l" dataKey="incident_count" name="Incidents" fill="#f5a524" radius={[3, 3, 0, 0]} />
        <Line isAnimationActive={false} yAxisId="r" dataKey="cumulative_pct" name="Cumulative %" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export interface TrendRow { trend_date: string; opened: number; resolved: number; resolved_by_agent: number }
export function TrendChart({ data }: { data: TrendRow[] }) {
  const rows = data.map((d) => ({ ...d, day: new Date(d.trend_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) }));
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={rows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid stroke="#1c2127" vertical={false} />
        <XAxis dataKey="day" {...axis} interval={4} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip {...tip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line isAnimationActive={false} dataKey="opened" name="Opened" stroke="#f5a524" strokeWidth={2} dot={false} />
        <Line isAnimationActive={false} dataKey="resolved" name="Resolved" stroke="#34d399" strokeWidth={2} dot={false} />
        <Line isAnimationActive={false} dataKey="resolved_by_agent" name="Resolved (agent, approved)" stroke="#a78bfa" strokeWidth={2} dot={false} strokeDasharray="4 3" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export interface MttrRow { category_tier3: string; avg_hours: number; median_hours: number; resolved_count: number }
export function MttrChart({ data }: { data: MttrRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 40, bottom: 0 }}>
        <CartesianGrid stroke="#1c2127" horizontal={false} />
        <XAxis type="number" {...axis} unit="h" />
        <YAxis type="category" dataKey="category_tier3" {...axis} width={110} />
        <Tooltip {...tip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} dataKey="avg_hours" name="Avg hours" fill="#38bdf8" radius={[0, 3, 3, 0]} />
        <Bar isAnimationActive={false} dataKey="median_hours" name="Median hours" fill="#3f3f46" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
