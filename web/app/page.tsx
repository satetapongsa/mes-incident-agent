"use client";
import Link from "next/link";
import { useApi } from "@/lib/api";
import { Card, Empty, ErrorBox, Kpi, Loading, PageTitle, Badge } from "@/components/ui";
import { ParetoChart, TrendChart, type ParetoRow, type TrendRow } from "@/components/charts";

interface Kpis {
  open_incidents: number; new_incidents: number; open_high_priority: number; mttr_hours_30d: number;
  pct_resolved_by_agent: number; pending_approvals: number; created_today: number; resolved_today: number;
  total_incidents: number; equipment_alerts: number; lots_on_hold: number;
}
interface Recurring { ci_name: string; category_tier3: string; occurrences: number; open_count: number; top_root_cause: string; avg_mttr_hours: number; last_seen: string }

export default function Dashboard() {
  const k = useApi<Kpis>("analytics/kpis", 10000);
  const pareto = useApi<ParetoRow[]>("analytics/pareto", 30000);
  const trend = useApi<TrendRow[]>("analytics/trend", 30000);
  const rec = useApi<Recurring[]>("analytics/recurring", 30000);

  return (
    <>
      <PageTitle title="Operations dashboard" sub="Backend site incidents (assembly, test, wafer test) - live from Oracle via remedy-api" />
      {k.error && <div className="mb-4"><ErrorBox error={k.error} onRetry={k.reload} /></div>}
      {k.loading && !k.data ? <Loading /> : k.data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Open incidents" value={k.data.open_incidents} hint={`${k.data.new_incidents} new · ${k.data.open_high_priority} P1/P2`} color="text-amber-400" />
          <Kpi label="MTTR (30 days)" value={k.data.mttr_hours_30d} unit="h" hint={`${k.data.resolved_today} resolved today`} />
          <Kpi label="Resolved by agent" value={k.data.pct_resolved_by_agent ?? 0} unit="%" hint="agent proposal + human approval, 30 days" color="text-violet-300" />
          <Link href="/approvals">
            <Kpi label="Pending approvals" value={k.data.pending_approvals} hint="click to review" color={k.data.pending_approvals ? "text-orange-400" : "text-slate-100"} />
          </Link>
        </div>
      )}
      {k.data && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Badge color={k.data.equipment_alerts ? "red" : "green"}>{k.data.equipment_alerts} equipment alerts</Badge>
          <Badge color={k.data.lots_on_hold ? "orange" : "green"}>{k.data.lots_on_hold} lots on hold</Badge>
          <Badge>{k.data.total_incidents} incidents total</Badge>
          <Badge>{k.data.created_today} created today</Badge>
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card title="Pareto - incidents by category">
          {pareto.error ? <ErrorBox error={pareto.error} /> : !pareto.data ? <Loading /> : pareto.data.length ? <ParetoChart data={pareto.data} /> : <Empty text="No data" />}
        </Card>
        <Card title="30-day trend">
          {trend.error ? <ErrorBox error={trend.error} /> : !trend.data ? <Loading /> : <TrendChart data={trend.data} />}
        </Card>
      </div>

      <Card title="Recurring equipment issues (same CI + category ≥ 3 in 30 days)" className="mt-4"
            right={<Link href="/analysis" className="text-xs normal-case text-amber-400 hover:underline">analysis →</Link>}>
        {rec.error ? <ErrorBox error={rec.error} /> : !rec.data ? <Loading /> : rec.data.length === 0 ? <Empty text="No recurring issues" /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>CI</th><th>Category</th><th>Count</th><th>Open</th><th>Avg MTTR</th><th>Top root cause</th></tr></thead>
              <tbody>
                {rec.data.map((r) => (
                  <tr key={r.ci_name + r.category_tier3}>
                    <td className="font-mono text-amber-300">{r.ci_name}</td>
                    <td>{r.category_tier3}</td>
                    <td className="font-semibold">{r.occurrences}</td>
                    <td>{r.open_count ? <Badge color="orange">{r.open_count}</Badge> : 0}</td>
                    <td>{r.avg_mttr_hours ?? "-"} h</td>
                    <td className="text-slate-400">{r.top_root_cause}</td>
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
