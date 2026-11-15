"use client";
import Link from "next/link";
import { useState } from "react";
import {
  Activity, ArrowRight, CircleCheck, CircleX, Database, Factory, FileCode2, KeyRound, Layers, Loader2, PauseCircle, Plug,
  Radio, ShieldAlert, TriangleAlert, Unplug, Zap, type LucideIcon,
} from "lucide-react";
import { type Equipment, type Lot, ago, post, useApi } from "@/lib/api";
import { Badge, Card, Empty, ErrorBox, Loading, PageTitle, StateSignal, StatusSignal, stateColor } from "@/components/ui";

const SCENARIOS: [string, string, LucideIcon][] = [
  ["lot-hold-stuck", "Lot stays on hold after SPC review", PauseCircle],
  ["trackin-recipe-mismatch", "Equipment recipe does not match lot", FileCode2],
  ["equipment-heartbeat-stale", "Productive but no heartbeat > 10 min", Activity],
  ["interface-timeout", "SECS/GEM interface timeout", Unplug],
  ["user-permission-missing", "Operator role missing", KeyRound],
  ["db-slow-query", "Report slow (escalate only)", Database],
];

const bar: Record<string, string> = { green: "bg-emerald-500", blue: "bg-sky-500", red: "bg-rose-500", purple: "bg-violet-500", gray: "bg-zinc-600" };

function hb(sec: number) {
  if (sec < 60) return `${sec} s`;
  return `${Math.floor(sec / 60)} min ${sec % 60} s`;
}

function Tile({ e }: { e: Equipment }) {
  const stale = e.heartbeat_age_sec > 600;
  const ifOk = e.interface_status === "Online";
  const alarm = stale || !ifOk || e.state === "Down";
  return (
    <div className={`overflow-hidden rounded-md border ${alarm ? "border-rose-800" : "border-line"} bg-panel`}>
      <div className={`h-1 ${bar[stateColor[e.state]] ?? bar.gray}`} />
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="mono text-base font-semibold text-zinc-50">{e.equipment_id}</span>
          {alarm && <TriangleAlert className="h-4 w-4 text-rose-400" />}
        </div>
        <div className="text-xs text-zinc-500">{e.eq_type}</div>
        <div className="mt-2.5 space-y-1.5 text-sm">
          <div className="flex items-center justify-between"><span className="text-zinc-500">State</span><StateSignal s={e.state} /></div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-zinc-500">{ifOk ? <Plug className="h-3.5 w-3.5" /> : <Unplug className="h-3.5 w-3.5" />}Interface</span>
            <span className={ifOk ? "text-zinc-300" : "font-medium text-rose-400"}>{e.interface_status}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-zinc-500"><Radio className="h-3.5 w-3.5" />Heartbeat</span>
            <span className={stale ? "font-medium text-rose-400" : "text-zinc-300"}>{hb(e.heartbeat_age_sec)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-zinc-500"><FileCode2 className="h-3.5 w-3.5" />Recipe</span>
            <span className="mono text-zinc-300">{e.current_recipe}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-zinc-500"><Layers className="h-3.5 w-3.5" />Lots</span>
            <span className="text-zinc-300">{e.running_lots} running, {e.queued_lots} queued</span>
          </div>
        </div>
      </div>
    </div>
  );
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
      setMsg({ ok: true, text: `${r.detail}. New ticket:`, id: r.incident_id });
      eq.reload();
      lots.reload();
    } catch (e) {
      setMsg({ ok: false, text: `${s}: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  const ops = Array.from(new Set((eq.data ?? []).map((e) => e.operation)));
  const alarms = (eq.data ?? []).filter((e) => e.heartbeat_age_sec > 600 || e.interface_status !== "Online" || e.state === "Down").length;

  return (
    <>
      <PageTitle title="Shop floor" icon={Factory} sub="Equipment and lots (Opcenter-style MES). Updates every 5 seconds."
                 right={eq.data && <Badge color={alarms ? "red" : "green"}>{alarms ? <ShieldAlert className="h-3.5 w-3.5" /> : <CircleCheck className="h-3.5 w-3.5" />} {alarms} equipment alarms</Badge>} />

      {eq.error ? <ErrorBox error={eq.error} onRetry={eq.reload} /> : !eq.data ? <Loading /> : (
        <div className="space-y-5">
          {ops.map((op) => (
            <div key={op}>
              <div className="label mb-2">{op.replace("_", " ")}</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                {eq.data!.filter((e) => e.operation === op).map((e) => <Tile key={e.equipment_id} e={e} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      <Card title="Lots" icon={Layers} className="mt-6" pad={false} right={
        <select className="input h-8" value={lotStatus} onChange={(e) => setLotStatus(e.target.value)}>
          <option value="">All statuses</option>
          {["Waiting", "Running", "Hold", "Completed"].map((s) => <option key={s}>{s}</option>)}
        </select>
      }>
        {lots.error ? <div className="p-4"><ErrorBox error={lots.error} /></div> : !lots.data ? <div className="px-4"><Loading /></div> : lots.data.length === 0 ? <Empty text="No lots" /> : (
          <div className="max-h-[480px] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0 z-10"><tr><th>Lot</th><th>Status</th><th>Product</th><th>Operation</th><th>Equipment</th><th>Recipe required</th><th>Qty</th><th>Hold</th><th>Updated</th></tr></thead>
              <tbody>
                {lots.data.map((l) => (
                  <tr key={l.lot_id}>
                    <td className="mono font-medium text-zinc-100">{l.lot_id}</td>
                    <td><StatusSignal s={l.status} /></td>
                    <td>{l.product}</td>
                    <td className="text-zinc-400">{l.operation}</td>
                    <td className="mono">{l.equipment_id ?? "-"}</td>
                    <td className="mono text-zinc-400">{l.recipe_required}</td>
                    <td className="tabular-nums">{l.qty.toLocaleString()}</td>
                    <td>{l.hold_code ? <span className="flex items-center gap-2"><Badge color="red">{l.hold_code}</Badge><span className="text-zinc-500">{l.hold_reason}</span></span> : <span className="text-zinc-600">-</span>}</td>
                    <td className="whitespace-nowrap text-zinc-500">{ago(l.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Failure simulator (for demo and testing)" icon={Zap} className="mt-6">
        <p className="mb-3 text-sm text-zinc-500">Breaks MES data on purpose and opens a ticket the way an operator would write it.</p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {SCENARIOS.map(([s, d, Icon]) => (
            <button key={s} className="flex items-center gap-3 rounded-md border border-line bg-raised p-3 text-left transition-colors hover:border-zinc-600 disabled:opacity-50"
                    disabled={!!busy} onClick={() => inject(s)}>
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded bg-ink">
                {busy === s ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : <Icon className="h-4 w-4 text-zinc-400" />}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-100">{d}</div>
                <div className="mono truncate text-zinc-500">{s}</div>
              </div>
            </button>
          ))}
        </div>
        {msg && (
          <div className={`mt-3 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2.5 text-sm ${msg.ok ? "border-emerald-900 bg-emerald-950/30 text-emerald-200" : "border-rose-900 bg-rose-950/40 text-rose-200"}`}>
            {msg.ok ? <CircleCheck className="h-4 w-4" /> : <CircleX className="h-4 w-4" />}
            {msg.text}
            {msg.id && <Link href={`/incidents/${msg.id}`} className="mono inline-flex items-center gap-1 font-medium text-accent hover:underline">{msg.id} <ArrowRight className="h-4 w-4" /></Link>}
          </div>
        )}
      </Card>
    </>
  );
}
