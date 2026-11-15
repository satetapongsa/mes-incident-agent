"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { type Incident, ago, useApi } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, PageTitle, PriorityBadge, StatusBadge, Badge } from "@/components/ui";

const STATUSES = ["Open", "New", "Assigned", "In Progress", "Pending", "Resolved", "Closed"];
const CATEGORIES = ["Lot Hold", "Recipe Mismatch", "SECS-GEM Timeout", "Heartbeat Stale", "Permission Missing", "Slow Query",
  "Equipment Alarm", "Scanner Offline", "Label Printer", "Report Error", "Other"];

export default function Incidents() {
  const [status, setStatus] = useState("Open");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ limit: "300" });
  if (status) params.set("status", status);
  if (priority) params.set("priority", priority);
  if (category) params.set("category", category);
  if (q) params.set("search", q);
  const { data, error, loading, reload } = useApi<Incident[]>(`incidents?${params}`, 15000);

  return (
    <>
      <PageTitle title="Incidents" sub="Remedy-style incident queue" />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">All priorities</option>
            {[1, 2, 3, 4].map((p) => <option key={p} value={p}>P{p}</option>)}
          </select>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input className="input min-w-[200px] flex-1" placeholder="Search summary, INC id or CI (e.g. WB-03)" value={search}
                 onChange={(e) => setSearch(e.target.value)} />
          <span className="self-center text-xs text-slate-500">{data ? `${data.length} shown` : ""}</span>
        </div>
        {error && <ErrorBox error={error} onRetry={reload} />}
        {loading && !data ? <Loading /> : data && data.length === 0 ? <Empty text="No incidents match the filters" /> : data && (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>Incident</th><th>Priority</th><th>Status</th><th>Summary</th><th>Category</th><th>CI</th><th>Group</th><th>Created</th></tr>
              </thead>
              <tbody>
                {data.map((i) => (
                  <tr key={i.incident_id}>
                    <td><Link href={`/incidents/${i.incident_id}`} className="font-mono text-amber-400 hover:underline">{i.incident_id}</Link></td>
                    <td><PriorityBadge p={i.priority} /></td>
                    <td><StatusBadge s={i.status} /></td>
                    <td className="max-w-md">
                      <Link href={`/incidents/${i.incident_id}`} className="hover:text-white">{i.summary}</Link>
                      {i.source !== "manual" && <Badge className="ml-2">{i.source}</Badge>}
                      {i.resolved_by === "agent_approved" && <Badge color="purple" className="ml-1">agent</Badge>}
                    </td>
                    <td className="text-slate-400">{i.category_tier3 ?? <span className="text-slate-600">untriaged</span>}</td>
                    <td className="font-mono text-xs">{i.ci_name ?? "-"}</td>
                    <td className="text-xs text-slate-400">{i.assigned_group ?? "-"}</td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{ago(i.created_at)}</td>
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
