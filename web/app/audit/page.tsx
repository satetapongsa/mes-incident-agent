"use client";
import { useState } from "react";
import { Bot, Search, ScrollText, UserRound } from "lucide-react";
import { fmt, useApi } from "@/lib/api";
import { Badge, Card, Empty, ErrorBox, Loading, PageTitle } from "@/components/ui";

interface Audit { id: number; who: string; what: string; target: string; before_value: string | null; after_value: string | null; at_time: string }

const whatColor = (w: string) =>
  w.includes("FAILED") ? "red" : w.startsWith("EXECUTE") ? "green" : w.startsWith("APPROVE") ? "blue" : w.startsWith("REJECT") ? "gray"
    : w.startsWith("PROPOSE") ? "orange" : w.startsWith("INJECT") ? "red" : w === "RESOLVE" ? "green" : "gray";

export default function AuditPage() {
  const { data, error, loading, reload } = useApi<Audit[]>("audit?limit=300", 10000);
  const [f, setF] = useState("");
  const rows = (data ?? []).filter((a) => !f || `${a.who} ${a.what} ${a.target} ${a.after_value}`.toLowerCase().includes(f.toLowerCase()));

  return (
    <>
      <PageTitle title="Audit log" icon={ScrollText} sub="Every change: who, what, target, before and after" />
      <Card pad={false}>
        <div className="border-b border-line p-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input className="input w-full pl-9" placeholder="Filter, e.g. agent, EXECUTE, WB-03" value={f} onChange={(e) => setF(e.target.value)} />
          </div>
        </div>
        {error && <div className="p-3"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data ? <div className="px-4"><Loading /></div> : rows.length === 0 ? <Empty text="No audit entries" /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Time</th><th>Who</th><th>What</th><th>Target</th><th>Before</th><th>After</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap text-zinc-500">{fmt(a.at_time)}</td>
                    <td className="whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        {a.who === "agent" ? <Bot className="h-4 w-4 text-violet-400" /> : <UserRound className="h-4 w-4 text-zinc-500" />}
                        <span className={a.who === "agent" ? "text-violet-300" : ""}>{a.who}</span>
                      </span>
                    </td>
                    <td><Badge color={whatColor(a.what)}>{a.what.replaceAll("_", " ").toLowerCase()}</Badge></td>
                    <td className="mono">{a.target}</td>
                    <td className="max-w-xs break-words text-zinc-500">{a.before_value ?? "-"}</td>
                    <td className="max-w-sm break-words text-zinc-300">{a.after_value ?? "-"}</td>
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
