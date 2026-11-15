"use client";
import Link from "next/link";
import { useState } from "react";
import { type Equipment, type Lot, ago, post, useApi } from "@/lib/api";
import { Badge, Card, Empty, ErrorBox, Loading, PageTitle, StateBadge, StatusBadge } from "@/components/ui";

const SCENARIOS: [string, string][] = [
  ["lot-hold-stuck", "Lot stays on Hold after SPC review"],
  ["trackin-recipe-mismatch", "Equipment recipe ≠ lot recipe"],
  ["equipment-heartbeat-stale", "Productive but heartbeat > 10 min"],
  ["interface-timeout", "SECS/GEM interface Timeout"],
  ["user-permission-missing", "Operator role missing"],
  ["db-slow-query", "Report slow (escalate only)"],
];

const stateBorder: Record<string, string> = {
  Productive: "border-emerald-600/60", Standby: "border-sky-600/60", Down: "border-rose-600", Engineering: "border-violet-600/60",
};

function hb(sec: number) {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export default function Mes() {
  const eq = useApi<Equipment[]>("mes/equipment", 5000);
  const [lotStatus, setLotStatus] = useState("");
  const lots = useApi<Lot[]>(`mes/lots${lotStatus ? `?status=${lotStatus}` : ""}`, 10000);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; id?: string } | null>(null);

  async function inject(s: string) {
    setBusy(s);
    setMsg(null);
    try {
      const r = await post<{ incident_id: string; detail: string }>(`simulate/${s}`);
      setMsg({ ok: true, text: `${s}: ${r.detail}. Ticket opened:`, id: r.incident_id });
      eq.reload();
      lots.reload();
    } catch (e) {
      setMsg({ ok: false, text: `${s}: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageTitle title="MES (Opcenter-style)" sub="Equipment, lots and failure injection. Data refreshes every few seconds." />

      <Card title="Inject failure (simulator)">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SCENARIOS.map(([s, d]) => (
            <button key={s} className="btn-ghost justify-start text-left" disabled={!!busy} onClick={() => inject(s)}>
              <span className="text-rose-400">⚡</span>
              <span>
                <span className="block font-mono text-xs text-amber-300">{busy === s ? "injecting..." : s}</span>
                <span className="block text-xs text-slate-400">{d}</span>
              </span>
            </button>
          ))}
        </div>
        {msg && (
          <div className={`mt-3 rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-emerald-950/40 text-emerald-200" : "bg-rose-950/40 text-rose-200"}`}>
            {msg.text}{" "}
            {msg.id && <Link href={`/incidents/${msg.id}`} className="font-mono text-amber-400 underline">{msg.id} →</Link>}
          </div>
        )}
      </Card>

      <Card title="Equipment" className="mt-4">
        {eq.error ? <ErrorBox error={eq.error} onRetry={eq.reload} /> : !eq.data ? <Loading /> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {eq.data.map((e) => {
              const stale = e.heartbeat_age_sec > 600;
              return (
                <div key={e.equipment_id} className={`rounded-lg border-2 ${stateBorder[e.state] ?? "border-slate-700"} bg-slate-950/70 p-3`}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-base font-bold text-slate-100">{e.equipment_id}</span>
                    <StateBadge s={e.state} />
                  </div>
                  <div className="text-xs text-slate-500">{e.eq_type} · {e.operation}</div>
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500">recipe</span><span className="font-mono">{e.current_recipe}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">interface</span><StateBadge s={e.interface_status} /></div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">heartbeat</span>
                      <span className={stale ? "font-semibold text-rose-400" : "text-emerald-400"}>{stale ? "⚠ " : ""}{hb(e.heartbeat_age_sec)}</span>
                    </div>
                    <div className="flex justify-between"><span className="text-slate-500">lots</span><span>{e.running_lots} run · {e.queued_lots} queue</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Lots" className="mt-4" right={
        <select className="input py-1 text-xs normal-case" value={lotStatus} onChange={(e) => setLotStatus(e.target.value)}>
          <option value="">All</option>
          {["Waiting", "Running", "Hold", "Completed"].map((s) => <option key={s}>{s}</option>)}
        </select>
      }>
        {lots.error ? <ErrorBox error={lots.error} /> : !lots.data ? <Loading /> : lots.data.length === 0 ? <Empty text="No lots" /> : (
          <div className="max-h-[480px] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0 bg-slate-900"><tr><th>Lot</th><th>Status</th><th>Product</th><th>Operation</th><th>Equipment</th><th>Recipe required</th><th>Qty</th><th>Hold</th><th>Updated</th></tr></thead>
              <tbody>
                {lots.data.map((l) => (
                  <tr key={l.lot_id}>
                    <td className="font-mono text-amber-300">{l.lot_id}</td>
                    <td><StatusBadge s={l.status} /></td>
                    <td>{l.product}</td>
                    <td className="text-xs">{l.operation}</td>
                    <td className="font-mono text-xs">{l.equipment_id ?? "-"}</td>
                    <td className="font-mono text-xs">{l.recipe_required}</td>
                    <td className="tabular-nums">{l.qty}</td>
                    <td className="text-xs">{l.hold_code ? <><Badge color="red">{l.hold_code}</Badge> <span className="text-slate-400">{l.hold_reason}</span></> : "-"}</td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{ago(l.updated_at)}</td>
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
