"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bot, Loader2, Plus, Search, TicketCheck, X } from "lucide-react";
import { type Equipment, type Incident, ago, post, useApi, useUser } from "@/lib/api";
import { Badge, Card, Empty, ErrorBox, Field, Loading, PageTitle, PriorityBadge, StatusSignal } from "@/components/ui";

const STATUSES = ["Open", "New", "Assigned", "In Progress", "Pending", "Resolved", "Closed"];
const CATEGORIES = ["Lot Hold", "Recipe Mismatch", "SECS-GEM Timeout", "Heartbeat Stale", "Permission Missing", "Slow Query",
  "Equipment Alarm", "Scanner Offline", "Label Printer", "Report Error", "Other"];

function NewIncident({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [user] = useUser();
  const eq = useApi<Equipment[]>("mes/equipment");
  const [f, setF] = useState({ summary: "", description: "", ci_name: "", priority: "3" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const inc = await post<Incident>("incidents", {
        summary: f.summary, description: f.description || null, ci_name: f.ci_name || null,
        priority: Number(f.priority), submitter: user, source: "manual",
      });
      router.push(`/incidents/${inc.incident_id}`);
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card title="New incident" icon={Plus} className="mb-4"
          right={<button className="btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>}>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-4">
        <div className="md:col-span-4">
          <Field label="Summary (what is wrong)">
            <input className="input w-full" required maxLength={200} value={f.summary} autoFocus
                   placeholder="e.g. Cannot track-in lot LT2611-0031 on WB-02, recipe mismatch"
                   onChange={(e) => setF({ ...f, summary: e.target.value })} />
          </Field>
        </div>
        <div className="md:col-span-4">
          <Field label="Details">
            <textarea className="input w-full" rows={3} value={f.description}
                      placeholder="Lot id, equipment, user, error message, since when"
                      onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
        </div>
        <Field label="Equipment / CI">
          <select className="input w-full" value={f.ci_name} onChange={(e) => setF({ ...f, ci_name: e.target.value })}>
            <option value="">Not specified</option>
            {(eq.data ?? []).map((x) => <option key={x.equipment_id} value={x.equipment_id}>{x.equipment_id} - {x.eq_type}</option>)}
            <option value="MESDB01">MESDB01 - MES database</option>
          </select>
        </Field>
        <Field label="Priority">
          <select className="input w-full" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="1">P1 Critical - line down</option>
            <option value="2">P2 High - one machine down</option>
            <option value="3">P3 Medium</option>
            <option value="4">P4 Low</option>
          </select>
        </Field>
        <Field label="Submitted by">
          <input className="input w-full" value={user} disabled />
        </Field>
        <div className="flex items-end">
          <button className="btn-primary w-full" disabled={busy || !f.summary.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create incident
          </button>
        </div>
        {err && <div className="md:col-span-4"><ErrorBox error={err} /></div>}
      </form>
    </Card>
  );
}

export default function Incidents() {
  const [status, setStatus] = useState("Open");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

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
      <PageTitle title="Incidents" icon={TicketCheck} sub="Incident queue (Remedy-style)"
                 right={!creating && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New incident</button>} />
      {creating && <NewIncident onClose={() => setCreating(false)} />}
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input className="input w-full pl-9" placeholder="Search summary, incident id or equipment (e.g. WB-03)" value={search}
                   onChange={(e) => setSearch(e.target.value)} />
          </div>
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
          <span className="px-1 text-sm text-zinc-500">{data ? `${data.length} shown` : ""}</span>
        </div>
        {error && <div className="p-3"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data ? <div className="px-4"><Loading /></div> : data && data.length === 0 ? <Empty text="No incidents match the filters" /> : data && (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>Incident</th><th>Priority</th><th>Status</th><th>Summary</th><th>Category</th><th>Equipment</th><th>Group</th><th>Opened</th></tr>
              </thead>
              <tbody>
                {data.map((i) => (
                  <tr key={i.incident_id}>
                    <td><Link href={`/incidents/${i.incident_id}`} className="mono text-accent hover:underline">{i.incident_id}</Link></td>
                    <td><PriorityBadge p={i.priority} /></td>
                    <td><StatusSignal s={i.status} /></td>
                    <td className="max-w-md">
                      <Link href={`/incidents/${i.incident_id}`} className="text-zinc-100 hover:text-white">{i.summary}</Link>
                      {i.resolved_by === "agent_approved" && <span title="Resolved by agent proposal, approved by a human" className="ml-2 inline-flex align-middle text-violet-400"><Bot className="h-4 w-4" /></span>}
                    </td>
                    <td className="text-zinc-400">{i.category_tier3 ?? <span className="text-zinc-600">Not triaged</span>}</td>
                    <td className="mono text-zinc-300">{i.ci_name ?? "-"}</td>
                    <td className="text-zinc-400">{i.assigned_group ?? "-"}</td>
                    <td className="whitespace-nowrap text-zinc-500">{ago(i.created_at)}</td>
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
