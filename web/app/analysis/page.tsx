"use client";
import { useState } from "react";
import { BarChart3, FileText, Loader2, Repeat, Timer } from "lucide-react";
import { post, useApi } from "@/lib/api";
import { Badge, Card, Empty, ErrorBox, Loading, PageTitle } from "@/components/ui";
import { MttrChart, ParetoChart, type MttrRow, type ParetoRow } from "@/components/charts";
import Markdown from "@/components/Markdown";

interface Recurring { ci_name: string; category_tier3: string; occurrences: number; open_count: number; first_seen: string; last_seen: string; top_root_cause: string; avg_mttr_hours: number }

export default function Analysis() {
  const pareto = useApi<ParetoRow[]>("analytics/pareto");
  const mttr = useApi<MttrRow[]>("analytics/mttr");
  const rec = useApi<Recurring[]>("analytics/recurring");
  const [report, setReport] = useState<{ mode: string; markdown: string; generated_at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      setReport(await post("analysis/recurring"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle title="Analysis" icon={BarChart3} sub="Incident history: which problems happen most, how long they take, what keeps coming back"
                 right={<button className="btn-primary" onClick={generate} disabled={busy}>
                   {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Improvement report
                 </button>} />
      {(report || err || busy) && (
        <Card title="Improvement report" icon={FileText} className="mb-4"
              right={report && <span className="flex items-center gap-2 text-xs text-zinc-500"><Badge>{report.mode}</Badge>{new Date(report.generated_at).toLocaleString("en-GB")}</span>}>
          {busy ? <Loading text="Writing the report" /> : err ? <ErrorBox error={err} /> : report && <Markdown text={report.markdown} />}
        </Card>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Incidents by category (Pareto)" icon={BarChart3}>
          {pareto.error ? <ErrorBox error={pareto.error} /> : !pareto.data ? <Loading /> : <ParetoChart data={pareto.data} />}
        </Card>
        <Card title="Time to resolve by category (hours)" icon={Timer}>
          {mttr.error ? <ErrorBox error={mttr.error} /> : !mttr.data ? <Loading /> : <MttrChart data={mttr.data} />}
        </Card>
      </div>
      <Card title="Recurring issues (3 or more in 30 days)" icon={Repeat} className="mt-4" pad={false}>
        {rec.error ? <div className="p-4"><ErrorBox error={rec.error} /></div> : !rec.data ? <div className="px-4"><Loading /></div> : rec.data.length === 0 ? <Empty text="No recurring issues" /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Equipment</th><th>Category</th><th>Count</th><th>Open</th><th>First seen</th><th>Last seen</th><th>Avg MTTR</th><th>Most common root cause</th></tr></thead>
              <tbody>
                {rec.data.map((r) => (
                  <tr key={r.ci_name + r.category_tier3}>
                    <td className="mono font-medium text-zinc-100">{r.ci_name}</td>
                    <td>{r.category_tier3}</td>
                    <td className="font-semibold tabular-nums">{r.occurrences}</td>
                    <td className="tabular-nums">{r.open_count}</td>
                    <td className="text-zinc-500">{new Date(r.first_seen).toLocaleDateString("en-GB")}</td>
                    <td className="text-zinc-500">{new Date(r.last_seen).toLocaleDateString("en-GB")}</td>
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
