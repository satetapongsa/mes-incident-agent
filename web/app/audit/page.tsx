"use client";
import { useState } from "react";
import { fmt, useApi } from "@/lib/api";
import { Badge, Card, Empty, ErrorBox, Loading, PageTitle } from "@/components/ui";

interface Audit { id: number; who: string; what: string; target: string; before_value: string | null; after_value: string | null; at_time: string }

const whatColor = (w: string) =>
  w.includes("FAILED") ? "red" : w.startsWith("EXECUTE") ? "green" : w.startsWith("APPROVE") ? "blue" : w.startsWith("REJECT") ? "gray"
    : w.startsWith("PROPOSE") ? "orange" : w.startsWith("INJECT") ? "red" : w === "RESOLVE" ? "green" : "purple";

export default function AuditPage() {
  const { data, error, loading, reload } = useApi<Audit[]>("audit?limit=300", 10000);
  const [f, setF] = useState("");
  const rows = (data ?? []).filter((a) => !f || `${a.who} ${a.what} ${a.target} ${a.after_value}`.toLowerCase().includes(f.toLowerCase()));

  return (
    <>
      <PageTitle title="Audit log" sub="Every write (PL/SQL audit_pkg): who, what, target, before, after." />
      <Card>
        <input className="input mb-3 w-full sm:w-80" placeholder="Filter (e.g. agent, EXECUTE, WB-03)" value={f} onChange={(e) => setF(e.target.value)} />
        {error && <ErrorBox error={error} onRetry={reload} />}
        {loading && !data ? <Loading /> : rows.length === 0 ? <Empty text="No audit entries" /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>#</th><th>At</th><th>Who</th><th>What</th><th>Target</th><th>Before</th><th>After</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="font-mono text-xs text-slate-500">{a.id}</td>
                    <td className="whitespace-nowrap text-xs text-slate-400">{fmt(a.at_time)}</td>
                    <td className={a.who === "agent" ? "text-violet-300" : ""}>{a.who}</td>
                    <td><Badge color={whatColor(a.what)}>{a.what}</Badge></td>
                    <td className="font-mono text-xs">{a.target}</td>
                    <td className="max-w-xs break-words text-xs text-slate-500">{a.before_value ?? "-"}</td>
                    <td className="max-w-sm break-words text-xs text-slate-300">{a.after_value ?? "-"}</td>
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
