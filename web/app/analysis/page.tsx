"use client";
import { useState } from "react";
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
      <PageTitle title="Analysis" sub="Historical incidents: Pareto, MTTR, recurring issues (Oracle views v_incident_pareto, v_mttr_by_category, v_recurring_issues)"
                 right={<button className="btn-primary" onClick={generate} disabled={busy}>{busy ? "Generating..." : "✦ Generate improvement report"}</button>} />
      {(report || err || busy) && (
        <Card title="Improvement report (skill: recurring-issue-review)" className="mb-4"
              right={report && <span className="text-xs normal-case"><Badge>{report.mode}</Badge> {new Date(report.generated_at).toLocaleString("en-GB")}</span>}>
          {busy ? <Loading text="Agent is writing the report..." /> : err ? <ErrorBox error={err} /> : report && <Markdown text={report.markdown} />}
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Pareto by category">
          {pareto.error ? <ErrorBox error={pareto.error} /> : !pareto.data ? <Loading /> : <ParetoChart data={pareto.data} />}
        </Card>
        <Card title="MTTR by category (hours)">
          {mttr.error ? <ErrorBox error={mttr.error} /> : !mttr.data ? <Loading /> : <MttrChart data={mttr.data} />}
        </Card>
      </div>
      <Card title="Recurring issues (30 days, ≥ 3 times)" className="mt-4">
        {rec.error ? <ErrorBox error={rec.error} /> : !rec.data ? <Loading /> : rec.data.length === 0 ? <Empty text="No recurring issues" /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>CI</th><th>Category</th><th>Count</th><th>Open</th><th>First seen</th><th>Last seen</th><th>Avg MTTR</th><th>Most common root cause</th></tr></thead>
              <tbody>
                {rec.data.map((r) => (
                  <tr key={r.ci_name + r.category_tier3}>
                    <td className="font-mono text-amber-300">{r.ci_name}</td>
                    <td>{r.category_tier3}</td>
                    <td className="font-semibold">{r.occurrences}</td>
                    <td>{r.open_count}</td>
                    <td className="text-xs text-slate-500">{new Date(r.first_seen).toLocaleDateString("en-GB")}</td>
                    <td className="text-xs text-slate-500">{new Date(r.last_seen).toLocaleDateString("en-GB")}</td>
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
