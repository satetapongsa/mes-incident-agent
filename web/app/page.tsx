"use client";
import Link from "next/link";
import { AlertCircle, ArrowRight, Bot, ClipboardCheck, Cpu, LayoutDashboard, PauseCircle, Repeat, Timer, TrendingUp, BarChart3 } from "lucide-react";
import { useApi } from "@/lib/api";
import { Badge, Card, Empty, ErrorBox, Kpi, Loading, PageTitle } from "@/components/ui";
import HowItWorks from "@/components/HowItWorks";
import { ParetoChart, TrendChart, type ParetoRow, type TrendRow } from "@/components/charts";

interface Kpis {
  open_incidents: number; new_incidents: number; open_high_priority: number; mttr_hours_30d: number;
  pct_resolved_by_agent: number; pending_approvals: number; created_today: number; resolved_today: number;
  total_incidents: number; equipment_alerts: number; lots_on_hold: number;
}
interface Recurring { ci_name: string; category_tier3: string; occurrences: number; open_count: number; top_root_cause: string; avg_mttr_hours: number }

export default function Dashboard() {
  const k = useApi<Kpis>("analytics/kpis", 10000);
  const pareto = useApi<ParetoRow[]>("analytics/pareto", 30000);
  const trend = useApi<TrendRow[]>("analytics/trend", 30000);
  const rec = useApi<Recurring[]>("analytics/recurring", 30000);

  return (
    <>
      <PageTitle title="Dashboard" icon={LayoutDashboard} sub="Incidents of the backend site (assembly, test, wafer test)" />
      <HowItWorks />
      {k.error && <div className="mb-4"><ErrorBox error={k.error} onRetry={k.reload} /></div>}
      {k.loading && !k.data ? <Loading /> : k.data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Link href="/incidents"><Kpi icon={AlertCircle} label="Open incidents" value={k.data.open_incidents} color="text-accent"
                 hint={`${k.data.new_incidents} new, ${k.data.open_high_priority} high priority`} /></Link>
            <Kpi icon={Timer} label="MTTR, last 30 days" value={k.data.mttr_hours_30d} unit="hours" hint={`${k.data.resolved_today} resolved today`} />
            <Kpi icon={Bot} label="Resolved with agent" value={k.data.pct_resolved_by_agent ?? 0} unit="%" hint="agent proposal, human approved" />
            <Link href="/approvals"><Kpi icon={ClipboardCheck} label="Waiting for approval" value={k.data.pending_approvals}
                 color={k.data.pending_approvals ? "text-orange-400" : "text-zinc-50"} hint="open the approval queue" /></Link>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/mes"><Badge color={k.data.equipment_alerts ? "red" : "green"}><Cpu className="h-3.5 w-3.5" /> {k.data.equipment_alerts} equipment alerts</Badge></Link>
            <Link href="/mes"><Badge color={k.data.lots_on_hold ? "orange" : "green"}><PauseCircle className="h-3.5 w-3.5" /> {k.data.lots_on_hold} lots on hold</Badge></Link>
            <Badge>{k.data.created_today} incidents today</Badge>
            <Badge>{k.data.total_incidents} incidents total</Badge>
          </div>
        </>
      )}

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <Card title="Incidents by category (Pareto)" icon={BarChart3}>
          {pareto.error ? <ErrorBox error={pareto.error} /> : !pareto.data ? <Loading /> : pareto.data.length ? <ParetoChart data={pareto.data} /> : <Empty text="No data" />}
        </Card>
        <Card title="Last 30 days" icon={TrendingUp}>
          {trend.error ? <ErrorBox error={trend.error} /> : !trend.data ? <Loading /> : <TrendChart data={trend.data} />}
        </Card>
      </div>

      <Card title="Recurring equipment issues" icon={Repeat} className="mt-4" pad={false}
            right={<Link href="/analysis" className="flex items-center gap-1 text-sm text-accent hover:underline">Analysis <ArrowRight className="h-4 w-4" /></Link>}>
        {rec.error ? <div className="p-4"><ErrorBox error={rec.error} /></div> : !rec.data ? <div className="px-4"><Loading /></div> : rec.data.length === 0 ? <Empty text="No recurring issues" /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Equipment</th><th>Category</th><th>Count (30 days)</th><th>Open</th><th>Avg MTTR</th><th>Most common root cause</th></tr></thead>
              <tbody>
                {rec.data.map((r) => (
                  <tr key={r.ci_name + r.category_tier3}>
                    <td className="mono font-medium text-zinc-100">{r.ci_name}</td>
                    <td>{r.category_tier3}</td>
                    <td className="font-semibold tabular-nums">{r.occurrences}</td>
                    <td>{r.open_count ? <Badge color="orange">{r.open_count}</Badge> : <span className="text-zinc-600">0</span>}</td>
                    <td className="tabular-nums">{r.avg_mttr_hours ?? "-"} h</td>
                    <td className="text-zinc-400">{r.top_root_cause}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
